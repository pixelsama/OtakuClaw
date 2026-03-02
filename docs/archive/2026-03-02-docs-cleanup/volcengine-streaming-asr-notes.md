# Volcengine 流式 ASR 接入笔记

在 `feat/real-streaming-asr` 分支上，我们为项目引入了豆包语音的大模型流式识别。这个过程踩了很多坑，下面把关键经验记录下来，方便后续排查和复用。

---

## 1. 官方 Demo vs. 我们的服务

| 项目 | 官方脚本（demo/sauc_websocket_demo.py） | 主链路（input-handler → dialog-engine） |
| --- | --- | --- |
| 音频位置 | 直接放在 demo 目录下，脚本读取本地文件 | 音频通过 WebSocket 上传到 input-handler，落在 `/tmp/aivtuber_tasks/<task_id>/input.webm` |
| 音频格式 | 脚本调用 PyAV/ffmpeg 转成 **WAV (PCM 16kHz mono s16)** 后再逐包发送 | 保存的是原始 `audio/webm;codecs=opus`，需要我们在服务端自行解码 |
| 协议实现 | 官方示例自带：全量请求 → gzip → 序列号 → 分片 | 我们初版仅发裸 PCM，未加 WAV 头 & gzip & 序列号，导致服务端只返回 `log_id` |

> 结论：**要么像 Demo 一样发送经过封装的 WAV 分片，要么在服务端把 WebM/Opus 转成 16kHz PCM 后再接入 Volcengine。**

---

## 2. 音频解码：PyAV + ffmpeg 缺一不可

libsoundfile 在很多 Linux 发行版中并不支持 WebM/Opus，所以最开始对付 input-handler 保存的 `input.webm` 时会直接抛出 “unsupported audio”。最终我们采用了层级解码策略：

1. **PyAV 解码（优先）**  
   - `services/dialog-engine/src/dialog_engine/audio/preprocessor.py` 中使用 PyAV 将内存中的 WebM 直接解成 16k 单声道 PCM。  
   - 每帧解码后统一 reshape 为 `(samples, 1)`，避免 numpy 维度不匹配。
2. **ffmpeg 子进程兜底（若容器内存在 ffmpeg）**  
   - 调用 `ffmpeg -i pipe:0 -acodec pcm_f32le -ar 16000 -ac 1`，将输入转换成 float32 PCM。
3. **再不行就按 PCM 解释**  
   - 将数据按 float32 或 int16 整体 reshape 成 `(N, 1)`，保证后续仍有可用的 PCM。

此外，为了让日志可观察，我们给音频预处理加上了 DEBUG 级别的提示：
```
audio.preprocessor: using PyAV decoder ...
audio.preprocessor: ffmpeg decode failed ...
audio.preprocessor: falling back to raw PCM ...
```

> 快速验证：进入 `demo/` 目录，用官方脚本对 input-handler 保存的 `input.webm` 跑一遍，只要能输出“你好”之类的文本，就说明端到端数据是健康的。然后再看 dialog-engine 日志是否同样能走到 PyAV 分支。

---

## 3. 流式协议实现要点

和官方 Demo 对比，我们在 `VolcengineAsrProvider` 里做了以下调整（文件路径：`services/dialog-engine/src/dialog_engine/asr/providers/volcengine.py`）：

1. **完整的 config frame**  
   - JSON 结构必须包含 `user / audio / request`，并设置 `model_name=bigmodel`、开启 `enable_itn / enable_punc / enable_ddc / enable_intermediate_result` 等字段。
2. **WAV 分片发送**  
   - 将 PCM 包装成 WAV（带 header）后分 200ms 发送；最后一包带负序号（标记结束）。  
   - 每帧 gzip 压缩，header 中 `message_type_specific_flags` 按官方要求设置（0x01 正序、0x03 最后一包）。
3. **结果解析**  
   - 识别结果可能嵌套在 `result / utterances / alternatives` 里，必须递归提取；否则只会得到 additions.log_id。

> 提示：连接成功但一直只有 `"result":{"additions":{"log_id":...}}`，通常是音频格式/协议不对；日志里若看到 `volcengine.asr.payload {"text":...}` 就标志成功。

---

## 4. 观察与排错 Checklist

1. **前端上传音频是否存到 `/tmp/aivtuber_tasks/<task_id>/input.webm`**  
   - 如果文件为空，基本是前端数据链路的问题。
2. **demo 脚本能否识别成功**  
   - `demo/sauc_python/sauc_websocket_demo.py` 支持读取 .env 的凭证，直接通过 PyAV + 官方协议测试。
3. **dialog-engine 日志检查**  
   - `audio.preprocessor: using PyAV decoder ...` → 解码无误。  
   - `volcengine.asr.payload {"text": "...", "utterances": ...}` → 已拿到识别文本。  
   - 若仍是 `"unsupported audio"`，说明 PyAV/ffmpeg 均失败，需要查看容器依赖或音频本身。
4. **input-handler 返回的错误**  
   - 新的处理逻辑会把 4xx 的 JSON detail 打到日志里，例如 `dialog_engine_http_error:400{"detail":"unsupported audio"}`，便于准确定位。

---

## 5. 部署与更新注意事项

1. **Dockerfile 更新**  
   - 离线环境最好在 dialog-engine 镜像里安装 ffmpeg（或包含 libav* 运行库），确保 fallback 不会失败。
2. **重建服务**  
   ```
   docker compose -f docker-compose.dev.yml build dialog-engine input-handler
   docker compose -f docker-compose.dev.yml up -d dialog-engine input-handler
   ```
3. **确保环境变量正确**  
   - `ASR_VOLC_APP_KEY / ASR_VOLC_ACCESS_KEY / ASR_VOLC_RESOURCE_ID / ASR_VOLC_ENDPOINT`（Access Key 是否需要 `Bearer;` 前缀，取决于后台设置）。

---

## 6. 经验教训总结

1. **Demo 能跑，不代表服务端能直接复用**  
   - 官方示例处理的是“本地文件 + 完整协议 + 已封装 WAV”。我们必须在自己的链路里补齐这些步骤。
2. **音频格式是流式识别的核心**  
   - 即使凭证配置正确，如果音频仍是 Opus 或变长 PCM，Volcengine 也只会返回 log_id。  
   - PyAV 是现阶段最方便的纯 Python 方案，必要时增加 ffmpeg fallback。
3. **日志要足够详细**  
   - DEBUG 日志中直接打印 payload 片段、解码流程，可以让排查极快定位失败点。
4. **出现 `empty_transcript` 要优先看日志**  
   - 如果音频是空/静音，也会导致最终 transcript 为空，需要先确认音频内容再怀疑 ASR。

---

通过以上调整，我们已经让 demo 和主项目两条链路表现一致，并能稳定拿到 Volcengine 的识别结果。后续若有新的音频格式接入（如 AAC、MP4 等），重复上述步骤，确保解码 → 分片 → 协议三个环节无误即可。祝调试顺利！

