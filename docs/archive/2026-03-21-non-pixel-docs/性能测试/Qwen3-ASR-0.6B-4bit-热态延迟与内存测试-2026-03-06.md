# Qwen3-ASR-0.6B-4bit 热态延迟与内存测试

- 测试日期: 2026-03-06
- 测试机器: Apple Silicon Mac
- 测试模型: `mlx-community/Qwen3-ASR-0.6B-4bit`
- 本地部署路径: `.tmp/mlx-audio-asr-0.6b-test/models/Qwen3-ASR-0.6B-4bit`
- 测试脚本: `.tmp/mlx-audio-asr-0.6b-test/bench_hot_asr.py`

## 测试方法

- 先在同一 Python 进程内加载模型
- 固定测试音频后，先预热 1 次
- 再连续进行 5 次热态识别
- 统计每次端到端识别耗时、模型内部 `total_time`、进程 RSS、MLX peak memory

## 测试音频

- 文本: `今天测试语音识别延迟`
- 语音来源: macOS `say -v Tingting`
- 音频文件: `.tmp/mlx-audio-asr-0.6b-test/out/asr_latency_input.wav`
- 采样率: `24000 Hz`
- 音频时长: `2.385 s`

## 冷加载参考

- 模型加载时间: `2452.00 ms`
- 进程空载 RSS: `66.77 MB`
- 模型加载后 RSS: `1216.73 MB`

## 预热结果

- 预热耗时: `407.43 ms`
- 模型内部 `total_time`: `399.95 ms`
- 预热后 RSS: `1234.03 MB`
- 预热峰值 RSS: `1234.06 MB`
- MLX peak memory: `1.194 GB`
- 识别结果: `今天测试语音识别延迟。`

## 热态 5 次结果

| 轮次 | 端到端耗时 | 模型 total_time | 运行后 RSS | MLX peak memory | 识别结果 |
| --- | ---: | ---: | ---: | ---: | --- |
| 1 | 167.39 ms | 167.24 ms | 1234.36 MB | 1.199 GB | 今天测试语音识别延迟。 |
| 2 | 165.86 ms | 165.74 ms | 1234.58 MB | 1.199 GB | 今天测试语音识别延迟。 |
| 3 | 162.21 ms | 162.07 ms | 1234.64 MB | 1.199 GB | 今天测试语音识别延迟。 |
| 4 | 155.11 ms | 154.95 ms | 1234.59 MB | 1.199 GB | 今天测试语音识别延迟。 |
| 5 | 164.78 ms | 164.64 ms | 1234.61 MB | 1.199 GB | 今天测试语音识别延迟。 |

## 热态汇总

- 热态端到端耗时均值: `163.07 ms`
- 热态端到端耗时中位数: `164.78 ms`
- 热态端到端耗时范围: `155.11 ms ~ 167.39 ms`
- 热态模型 `total_time` 均值: `162.93 ms`
- 热态运行末 RSS: `1234.61 MB`
- 热态峰值 RSS: `1234.95 MB`
- 热态 MLX peak memory: `1.199 GB`

## 结论

这个模型在热态下处理一段 `2.385 s` 的中文短音频，端到端识别耗时大约是 `155 ms ~ 167 ms`，均值 `163 ms`。换算成实时系数，约为 `0.068x`，明显快于实时。

内存方面，这个模型在加载后常驻 RSS 大约 `1.22 GB`，热态识别时峰值 RSS 约 `1.235 GB`，MLX 侧峰值内存约 `1.199 GB`。对比先前测试过的本地 Qwen3-TTS 1.7B/0.6B，ASR 这条链路的内存和时延都轻得多。

## 原始结果

- JSON 原始输出: `.tmp/mlx-audio-asr-0.6b-test/out/hot_benchmark.json`
