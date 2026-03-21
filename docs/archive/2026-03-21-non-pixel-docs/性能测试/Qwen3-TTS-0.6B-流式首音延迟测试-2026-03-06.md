# Qwen3-TTS 0.6B 流式首音延迟测试报告（2026-03-06）

## 1. 测试目标

验证 `Qwen3-TTS-12Hz-0.6B-CustomVoice` 的本地 MLX 推理是否支持流式输出，以及流式是否能让首音更快出现。

本次对以下两种量化版本做对比：

- `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-4bit`
- `mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit`

## 2. 测试环境

- 机器：`MacBook Air`
- 芯片：`Apple M4`
- 内存：`24 GB`
- 推理框架：`mlx-audio`
- Python：`3.11.14`

## 3. 测试输入

- 文本：`今天我们测试延迟表现`
- 长度：`10` 个汉字
- Speaker：`vivian`
- 语言：`Chinese`

## 4. 测试方法

同一模型在同一 Python 进程中完成加载，然后分别对以下三种模式进行测试：

1. `non_stream`
   - `stream=False`
2. `stream_i2_0`
   - `stream=True`
   - `streaming_interval=2.0`
3. `stream_i0_4`
   - `stream=True`
   - `streaming_interval=0.4`

每种模式先做 `1` 次预热，再执行 `3` 次正式测量。关注指标：

- 首音延迟：第一个音频 chunk 返回时间
- 总耗时：整句音频生成完成时间
- chunk 数量：流式切分粒度

说明：

- `mlx-audio` 当前实现中，`streaming_interval` 会影响每次积累多少 token 才解码一次音频 chunk。
- 因此“是否更快听到第一声”不仅取决于 `stream=True`，还取决于 `streaming_interval` 的大小。

## 5. 结果

### 5.1 4bit

| 模式 | 首音均值 | 总耗时均值 | chunk 数量 |
| --- | ---: | ---: | ---: |
| 非流式 | `1309.76 ms` | `1322.23 ms` | `1` |
| 流式 `interval=2.0` | `840.05 ms` | `1372.99 ms` | `2` |
| 流式 `interval=0.4` | `195.12 ms` | `1174.93 ms` | `6~7` |

### 5.2 8bit

| 模式 | 首音均值 | 总耗时均值 | chunk 数量 |
| --- | ---: | ---: | ---: |
| 非流式 | `1652.92 ms` | `1669.92 ms` | `1` |
| 流式 `interval=2.0` | `1109.54 ms` | `1852.25 ms` | `2` |
| 流式 `interval=0.4` | `255.99 ms` | `1620.58 ms` | `6~8` |

## 6. 结论

结论很明确：

1. 这套本地 `mlx-audio + Qwen3-TTS 0.6B` 确实支持流式输出。
2. 流式输出确实能显著降低首音延迟。
3. 但默认 `streaming_interval=2.0` 只是“有改善”，真正明显拉低首音的是更小的 `streaming_interval`。

按本次实测：

- `4bit`
  - 非流式首音约 `1.31 s`
  - 流式 `2.0` 首音约 `0.84 s`
  - 流式 `0.4` 首音约 `0.20 s`
- `8bit`
  - 非流式首音约 `1.65 s`
  - 流式 `2.0` 首音约 `1.11 s`
  - 流式 `0.4` 首音约 `0.26 s`

也就是说，若目标是“尽快听到第一声”，`stream=True` 本身还不够，`streaming_interval` 需要往更小的方向调。

## 7. 观察

- `4bit` 在这次测试里，流式 `interval=0.4` 不仅首音最快，总耗时也低于非流式。
- `8bit` 在这次测试里，流式 `interval=0.4` 把首音压得很低，但整句总耗时并没有像 4bit 那样明显下降。
- `interval` 越小，chunk 数量越多，播放器链路和前端拼接处理的复杂度也会提高。

## 8. 实际建议

如果目标是本地实时交互，当前这台机器上的优先建议是：

1. 首选 `4bit + stream=True`
2. `streaming_interval` 先从 `0.4` 这一档开始试
3. 如果前端播放链路后续要接真实对话系统，再继续测“更小 chunk 是否导致卡顿、爆音或拼接感”

## 9. 原始数据

原始 JSON：

- `Free-Agent-Vtuber-Openclaw/.tmp/mlx-streaming-bench/out/streaming_benchmark.json`
