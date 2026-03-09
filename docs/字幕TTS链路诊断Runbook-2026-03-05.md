# 字幕/TTS 链路诊断 Runbook（2026-03-05）

## 1. 目标

用于快速定位“segment 已生成但字幕不同步/漏播”的问题，重点判断卡在：

1. `segment-ready`
2. `segment-tts-started`
3. `segment-tts-finished` / `segment-tts-failed`

## 2. 快速检查顺序

1. 先确认聊天流是否发出 `segment-ready`（`chat:stream:event`）。
2. 再确认语音流是否发出 `segment-tts-started`（`voice:event`）。
3. 最后确认每个 `segmentId` 是否有终态：`finished` 或 `failed`。

## 3. Debug 开关

开启主进程日志：

```bash
VOICE_SEGMENT_DEBUG=1 pnpm run desktop:dev
```

日志会输出每个 segment 的关键信息：

1. `sessionId / turnId / segmentId`
2. `status`
3. `queueDelayMs`（ready -> started）
4. `ttsDurationMs`（started -> finished）

## 4. 诊断接口（主进程 IPC）

`voice:segment:trace:list`

请求体：

```json
{
  "sessionId": "voice-session-1",
  "limit": 20
}
```

返回：最近的 segment 生命周期快照，包含：

1. `readyAt`
2. `startedAt`
3. `finishedAt`
4. `failedAt`
5. `status`
6. `code/message`（失败时）

## 5. 常见判定

1. 仅有 `readyAt`，没有 `startedAt`：
   - 重点排查 TTS 队列消费是否被 stop/abort 打断。
2. 有 `startedAt`，无 `finishedAt/failedAt`：
   - 重点排查 TTS provider 卡住或 ACK 背压。
3. 频繁 `failed` 且 `code=voice_tts_backpressure_timeout`：
   - 前端播放 ACK 异常或播放线程阻塞。

## 6. 安全检查（Nanobot）

用户 UI 文本中不应出现以下工具调用痕迹：

1. `read_file(...)`
2. `write_file(...)`
3. `list_dir(...)`
4. `edit_file(...)`
5. `Tool call: ...`

若出现，优先检查：

1. `nanobot_bridge.py` 是否只下发最终文本。
2. `nanobotBackend` 文本净化兜底是否生效。
