# Qwen3-TTS 0.6B 8bit 热态延迟与内存测试报告（2026-03-06）

## 1. 测试目标

验证模型 `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` 在 `Free-Agent-Vtuber-Openclaw/.tmp` 中的本地部署结果，并测试：

1. 10 个汉字文本的 TTS 延迟大约是多少
2. 模型运行时会占用多少内存

## 2. 模型来源与部署位置

- Hugging Face：`https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`
- 本地部署目录：`Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-0.6b-test`
- 模型目录：`Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-0.6b-test/models/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`
- Python 运行时：复用 `Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-test/.venv`
- Python 版本：`3.11.14`
- `huggingface_hub`：`1.5.0`

根据模型自带 `README.md`，该模型是从 `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` 转换得到的 MLX 版本，面向 `mlx-audio` 使用。

## 3. 测试环境

- 机器：`MacBook Air`
- 芯片：`Apple M4`
- CPU 核心：`10` 核（`4` 性能核 + `6` 能效核）
- 内存：`24 GB`
- 推理框架：`mlx-audio`

## 4. 测试输入

- 文本：`今天我们测试延迟表现`
- 文本长度：`10` 个汉字
- `lang_code`：`Chinese`
- `voice`：`Vivian`

说明：

- `Vivian` 是当前项目里 Qwen3-TTS 的既有默认 speaker 口径，便于和之前测试保持一致。
- 本次测试仅针对 TTS 本体，不包含 Electron UI、主工程语音会话 IPC、音频播放链路等额外开销。

## 5. 测试方法

为避免把 Python 进程重复启动时间混入“非冷启动”结果，本次测试使用同一个 Python 进程，按以下顺序执行：

1. 调用 `load_model()` 加载模型
2. 执行 `1` 次预热推理
3. 在模型已驻留内存的情况下连续执行 `5` 次同文本推理
4. 记录：
   - 模型冷加载耗时
   - 预热耗时
   - 每次热态推理首段返回时间
   - 每次热态总耗时
   - 进程 RSS 常驻值与峰值
   - `mlx-audio` 内部上报的峰值内存

说明：

- 该模型在本次测试中每轮只返回 `1` 段音频，因此“首包延迟”基本等于“整句完成时间”。
- RSS 使用 `ps -o rss` 轮询采样，属于操作系统进程口径。
- `mlx-audio` 的 `peak_memory_usage` 属于框架内部统计口径，数值可能高于进程 RSS。

## 6. 模型体积

- 模型目录总大小：`1.9 GB`
- 主权重 `model.safetensors`：`1.2 GB`
- `speech_tokenizer/model.safetensors`：`665 MB`

## 7. 结果

### 7.1 冷加载与预热

- 冷加载耗时：`5015.04 ms`
- 加载完成后 RSS：`916.83 MB`
- 预热首轮耗时：`2165.84 ms`
- 预热音频时长：`3.12 s`
- 预热完成后 RSS：`759.55 MB`

### 7.2 热态 10 字 TTS 实测

| 轮次 | 首段返回时间 | 总耗时 | 音频时长 | 内部峰值内存 |
| --- | ---: | ---: | ---: | ---: |
| run_1 | `1788.00 ms` | `1794.72 ms` | `2.88 s` | `3.87 GB` |
| run_2 | `1738.87 ms` | `1744.70 ms` | `2.96 s` | `3.87 GB` |
| run_3 | `1731.44 ms` | `1737.73 ms` | `2.96 s` | `3.87 GB` |
| run_4 | `1602.20 ms` | `1607.10 ms` | `2.56 s` | `3.87 GB` |
| run_5 | `1906.40 ms` | `1912.21 ms` | `3.12 s` | `3.92 GB` |

### 7.3 热态统计汇总

- 首段返回时间均值：`1753.38 ms`
- 首段返回时间中位数：`1738.87 ms`
- 首段返回时间最小值：`1602.20 ms`
- 首段返回时间最大值：`1906.40 ms`
- 总耗时均值：`1759.29 ms`
- 总耗时中位数：`1744.70 ms`
- 总耗时最小值：`1607.10 ms`
- 总耗时最大值：`1912.21 ms`
- 生成音频时长均值：`2.896 s`

## 8. 内存占用结论

按本次测试的两种统计口径：

- 进程空载基线：`58.41 MB`
- 模型加载后 RSS：约 `916.83 MB`
- 预热后稳定 RSS：约 `760 MB`
- 测试期间进程峰值 RSS：约 `957.34 MB`
- `mlx-audio` 内部上报峰值内存：`3.87 GB ~ 3.92 GB`

可操作性的理解方式：

- 常驻占用可按 `0.76 GB` 级别估算
- 运行峰值可按 `0.96 GB RSS` 级别估算
- 若按框架内部统计口径，推理阶段峰值接近 `3.9 GB`

## 9. 结论

本次测试下，`Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit` 在 `Apple M4 / 24 GB` 环境中，热态下生成 `10` 个汉字的 TTS：

- 典型耗时约为 `1.7` 到 `1.9` 秒
- 波动范围相对小，最慢约 `1.91` 秒
- 相比之前测试过的 `Qwen3-TTS-12Hz-1.7B-VoiceDesign-bf16`，速度更快、RSS 更低

如果只从本地部署的响应速度和资源占用看，这个 `0.6B 8bit` 版本明显更适合作为本地可用的候选方案。

## 10. 备注

测试过程中出现了两个运行时警告，但本次未阻止模型正常出声：

1. `qwen3_tts` model type 配置警告
2. tokenizer `regex pattern` 警告

这份报告记录的是当前机器、当前依赖版本、当前输入文本下的实测数据，后续若更换 speaker、文本长度或 `mlx-audio` 版本，结果可能会变化。
