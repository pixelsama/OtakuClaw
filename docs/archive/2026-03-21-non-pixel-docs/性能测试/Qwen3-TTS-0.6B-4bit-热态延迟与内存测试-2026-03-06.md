# Qwen3-TTS 0.6B 4bit 热态延迟与内存测试报告（2026-03-06）

## 1. 测试目标

验证模型 `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit` 在 `Free-Agent-Vtuber-Openclaw/.tmp` 中的本地部署结果，并测试：

1. 10 个汉字文本的 TTS 延迟大约是多少
2. 模型运行时会占用多少内存

## 2. 模型来源与部署位置

- Hugging Face：`https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit`
- 本地部署目录：`Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-0.6b-4bit-test`
- 模型目录：`Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-0.6b-4bit-test/models/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit`
- 原始结果 JSON：`Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-0.6b-4bit-test/out/hot_benchmark.json`
- Python 运行时：复用 `Free-Agent-Vtuber-Openclaw/.tmp/mlx-audio-test/.venv`
- Python 版本：`3.11.14`
- 推理框架：`mlx-audio`

根据模型自带 `README.md`，该模型是从 `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice` 转换得到的 MLX 版本，面向 `mlx-audio` 使用。

## 3. 测试环境

- 机器：`MacBook Air`
- 芯片：`Apple M4`
- CPU 核心：`10` 核（`4` 性能核 + `6` 能效核）
- 内存：`24 GB`
- 操作系统：`macOS`

## 4. 测试输入

- 文本：`今天我们测试延迟表现`
- 文本长度：`10` 个汉字
- `lang_code`：`Chinese`
- `voice`：`vivian`

说明：

- 这里沿用了前面 TTS 测试的同一文本与同一 speaker，便于横向对比。
- 本次测试只覆盖 `mlx` 本地模型推理，不包含 Electron UI、音频播放链路、IPC、主工程会话调度等额外开销。

## 5. 测试方法

为避免把 Python 进程重复启动时间混入“非冷启动”结果，本次测试使用同一个 Python 进程，按以下顺序执行：

1. 将模型下载到 `.tmp/mlx-audio-0.6b-4bit-test/models`
2. 调用 `load_model()` 加载模型
3. 执行 `1` 次预热推理
4. 在模型已驻留内存的情况下连续执行 `5` 次同文本推理
5. 记录：
   - 模型冷加载耗时
   - 预热耗时
   - 每次热态推理首段返回时间
   - 每次热态总耗时
   - 进程 RSS 常驻值与峰值
   - `mlx-audio` 内部上报的峰值内存

说明：

- 本次 5 轮测试中每轮都只返回 `1` 段音频，因此“首包延迟”基本等于“整句完成时间”。
- RSS 使用 `ps -o rss` 轮询采样，属于操作系统进程口径。
- `mlx-audio` 的 `peak_memory_usage` 属于框架内部统计口径，数值可能高于进程 RSS。

## 6. 模型体积

- 模型目录总大小：`1.69 GB`
- 主权重 `model.safetensors`：`1.01 GB`
- `speech_tokenizer/model.safetensors`：`682 MB`

## 7. 结果

### 7.1 冷加载与预热

- 冷加载耗时：`2589.95 ms`
- 加载完成后 RSS：`909.77 MB`
- 预热首轮耗时：`1689.04 ms`
- 预热音频时长：`2.72 s`
- 预热完成后 RSS：`688.73 MB`

### 7.2 热态 10 字 TTS 实测

| 轮次 | 首段返回时间 | 总耗时 | 音频时长 | 内部峰值内存 |
| --- | ---: | ---: | ---: | ---: |
| run_1 | `1309.56 ms` | `1314.92 ms` | `2.56 s` | `3.413 GB` |
| run_2 | `1751.04 ms` | `1765.32 ms` | `3.76 s` | `3.953 GB` |
| run_3 | `1394.01 ms` | `1400.69 ms` | `2.88 s` | `3.953 GB` |
| run_4 | `1247.10 ms` | `1252.57 ms` | `2.64 s` | `3.953 GB` |
| run_5 | `1341.57 ms` | `1348.14 ms` | `2.80 s` | `3.953 GB` |

### 7.3 热态统计汇总

- 首段返回时间均值：`1408.66 ms`
- 首段返回时间中位数：`1341.57 ms`
- 首段返回时间最小值：`1247.10 ms`
- 首段返回时间最大值：`1751.04 ms`
- 总耗时均值：`1416.33 ms`
- 总耗时中位数：`1348.14 ms`
- 总耗时最小值：`1252.57 ms`
- 总耗时最大值：`1765.32 ms`
- 生成音频时长均值：`2.928 s`

## 8. 内存占用结论

按本次测试的两种统计口径：

- 进程空载基线：`65.69 MB`
- 模型加载后 RSS：约 `909.77 MB`
- 预热后稳定 RSS：约 `688.73 MB`
- 测试期间进程峰值 RSS：约 `1616.06 MB`
- `mlx-audio` 内部上报峰值内存：`3.413 GB ~ 3.953 GB`

可操作性的理解方式：

- 常驻占用可按 `0.69 GB` 级别估算
- 运行峰值可按 `1.62 GB RSS` 级别估算
- 若按框架内部统计口径，推理阶段峰值接近 `4.0 GB`

## 9. 结论

本次测试下，`Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit` 在 `Apple M4 / 24 GB` 环境中，热态下生成 `10` 个汉字的 TTS：

- 典型耗时约为 `1.25` 到 `1.40` 秒
- 最慢一轮约 `1.77` 秒
- 相比前面测试过的 `Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`，热态速度进一步下降到了 `1.4s` 级别

如果只看本地响应速度，这个 `0.6B 4bit` 版本目前是前面几组 Qwen3-TTS 里更适合实时交互的一档。

## 10. 备注

测试过程中出现了两个运行时警告，但本次未阻止模型正常出声：

1. `qwen3_tts` model type 配置警告
2. tokenizer `regex pattern` 警告

这份报告记录的是当前机器、当前依赖版本、当前输入文本下的实测数据。后续若更换 speaker、文本长度或 `mlx-audio` 版本，结果可能会变化。
