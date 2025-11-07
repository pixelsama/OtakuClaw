# TTS Audio Delivery Debug Plan

我们目前锁定了两个可能的根因：
1. Output Handler 没有把 ingest WS 收到的音频 chunk 转发给前端 /ws/output。
2. Dialog-engine 在 SSE 还没结束前就提前关闭 HTTP 连接（`peer closed connection`），导致 Output Handler 无法从 text 流切换到音频模式。

下面的计划用于缩小范围并验证修复。

## 1. 基线信息
- 关注任务 ID：通过前端 console 的 `Task ID assigned` 日志获得。
- 使用以下 docker 服务日志：
  - `docker logs aivtuber-dialog-engine-dev`
  - `docker logs aivtuber-input-handler-dev`
  - `docker logs aivtuber-output-handler-dev`
  - `docker logs aivtuber-gateway-dev`
- 前端 console 日志查看：Chrome DevTools MCP `list_console_messages`。

## 2. 测试用例流程
### 2.1 正常语音输入（前端）
1. 刷新前端，点击麦克风，录制 5 秒。
2. 观察 console：记录 Task ID、`Audio is present` 等日志。
3. 保持页面不刷新，等待音频播放事件或报错。

### 2.2 脚本模拟（可重复）
1. 运行 `scripts/...` 或自定义 Python 脚本，向 `/ws/input` 推送 demo/sauc_python/input.webm。
2. 同时连接 `/ws/output/{task_id}`，捕获所有 text/binary 帧；确认是否收到 `audio_chunk` 元数据和二进制帧。
3. 保存输出到本地文件，便于检查是否有实际音频数据。

## 3. 判定哪个环节出问题
| 证据 | 结论 |
| --- | --- |
| Output Handler 日志中，成功收到 `type=audio_chunk` 元数据并发送 bytes，前端却无音频 | 前端或 gateway 反代处理有问题（少见） |
| Output Handler 日志始终停在 `status=error` (peer closed connection)，且没有 `relay_speech_chunk` 字样 | dialog-engine SSE 断开 | 
| Dialog-engine 日志显示 `SPEECH_CHUNK` 大量发送，但 Output Handler 没有收到 `relay_speech_chunk` | output handler 未保持 ingest WS 连接或未匹配 session_id | 

## 4. 修复策略
### 4.1 如果是 Output Handler 缺转发
- 检查 `relay_speech_chunk` 是否命中 `active_connections`。
- 若 `active_connections` 中缺任务，可能是 output WebSocket 提前关闭 → 需延长等待逻辑。
- 若存在，添加 debug：记录每个 chunk 的大小、发送成功与否。
- 确认 `streaming_events` 触发，防止 WS 在 audio 完成前关闭。

### 4.2 如果是 Dialog-engine 提前断开 SSE
- 检查 `app.py` 中 `_schedule_tts` 是否抛异常；必要时捕获、记录。
- 在 SSE `event_generator` 完整输出后再 `return`，确保 HTTP 流保持。
- 若使用第三方 ASR/TTS，设置重试或延长 timeout。

## 5. 回归测试
1. 前端麦克风录制场景：确保 console 出现 `Received audio chunk metadata`，Live2D 播放音频。
2. Python 脚本回放：确认输出文件大小 > 0，内容可播放。
3. 多次重复，确保没有 `peer closed connection`。
4. 记录最终日志片段，归档到 docs/debug-log-*.txt 供后续参考。

## 6. 输出
- 一旦定位根因，更新本文件并记录修复步骤。
- 若调整 output handler，增加单元测试（mock Redis channel）验证音频流状态。
