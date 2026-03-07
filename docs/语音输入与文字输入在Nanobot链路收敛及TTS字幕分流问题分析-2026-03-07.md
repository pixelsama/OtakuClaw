# 语音输入与文字输入在 Nanobot 链路收敛及 TTS/字幕分流问题分析（2026-03-07）

## 1. 分析范围与结论摘要

本次仅做架构与问题成因分析，不涉及任何代码修改。

核心结论：

1. 对 Nanobot 而言，语音输入与文字输入最终都会收敛为 `content` 文本，通过同一条 `chat:stream` 主链路发送。
2. “文字输入不触发 TTS”是当前架构的直接结果：TTS 播放依赖 `voice session` 存在，而文字发送本身不会自动创建/保持 `voice session`。
3. “语音输入触发了 TTS 但字幕不显示”的根因是前端 `chat:stream:event` 监听器采用懒初始化，仅在文本发送路径中初始化。纯语音场景下该监听未建立，导致字幕桥拿不到 `segment-ready/text-delta/done`，从而无法驱动字幕显示。

---

## 2. 当前架构（按输入源拆解）

### 2.1 文字输入路径（Text Composer）

```mermaid
flowchart LR
  A[EdgeComposer 文本提交] --> B[useTextComposerController.submitTextComposer]
  B --> C[useStreamingChat.startStreaming]
  C --> D[desktopBridge.chat.start]
  D --> E[IPC chat:stream:start]
  E --> F[registerChatStreamIpc.runStream]
  F --> G[ChatBackendManager.startStream]
  G --> H[NanobotBackendAdapter.startStream]
  H --> I[nanobotBridgeClient.start]
```

关键代码：

- 文本提交固定会话：`sessionId: 'text-composer'`  
  `front_end/src/hooks/chat/useTextComposerController.js:34-38`
- 文本流启动：`desktopBridge.chat.start(...)`  
  `front_end/src/hooks/useStreamingChat.js:260-264`

### 2.2 语音输入路径（ASR -> Chat）

```mermaid
flowchart LR
  A[Mic/VAD] --> B[voice:audio:chunk]
  B --> C[voice:input:commit]
  C --> D[ASR transcribe]
  D --> E[voice:event asr-final]
  E --> F[main.onAsrFinal]
  F --> G[chatStreamControl.start options.source=voice-asr]
  G --> H[registerChatStreamIpc.runStream]
  H --> I[ChatBackendManager.startStream]
  I --> J[NanobotBackendAdapter.startStream]
  J --> K[nanobotBridgeClient.start]
```

关键代码：

- ASR 完成后回调 `onAsrFinal`：  
  `desktop/electron/ipc/voiceSession.js:1200-1204`
- 主进程自动起 chat stream，标记 `source: 'voice-asr'`：  
  `desktop/electron/main.js:406-419`

### 2.3 收敛点

收敛发生在 `registerChatStreamIpc.runStream`：无论上游来自文本提交还是 ASR，最终都变成：

- `sessionId`
- `content`
- `options`

然后走 `backendManager.startStream(...)`，最终进入 Nanobot bridge。  
参考：

- `desktop/electron/ipc/chatStream.js:59-67,110-116`
- `desktop/electron/services/chat/backendManager.js:62-73`
- `desktop/electron/services/chat/backends/nanobotBackend.js:152-165`
- `desktop/electron/services/chat/nanobot/nanobotBridgeClient.js:428-479`

---

## 3. TTS 与字幕的当前职责分层

### 3.1 TTS 触发职责在 `voiceSession`

`chat:stream` 产生 `segment-ready` 后，主进程会尝试把分段喂给 `voiceSession` 进行 TTS：

- 主进程桥接 `segment-ready -> enqueueSegmentReady`：  
  `desktop/electron/main.js:342-347`
- `enqueueSegmentReady` 若找不到 `sessionState` 直接返回 `session_not_found`：  
  `desktop/electron/ipc/voiceSession.js:857-871`
- 找到会话后触发队列播放与 `segment-tts-started/finished`：  
  `desktop/electron/ipc/voiceSession.js:883-890,913,954`

### 3.2 字幕职责在前端 `useStreamingSubtitleBridge`

字幕桥主要依赖 `chat:stream:event` 的：

- `segment-ready`
- `text-delta`
- `done`

同时用 `voice:event` 的 `segment-tts-*` 做时序同步。  
关键点：当收到 `segment-tts-started` 但当前没有对应 `pending segment` 时，只会暂存到 `startedBeforeReady`，不会立即展示文本。  
`front_end/src/hooks/chat/useStreamingSubtitleBridge.js:326-332`

---

## 4. 问题一：文字输入不触发 TTS 的原因

现象：文本输入能出字幕，但不播报语音。

原因链路：

1. 文本输入只会走 `chat:stream:start`，不会自动启动 `voice:session:start`。
2. `main` 虽会把 `segment-ready` 尝试喂给 `voiceSession`，但若没有活动 `voice session`，`enqueueSegmentReady` 返回 `session_not_found`。
3. 因此文字回包只能走字幕展示，不会进入 TTS 队列。

这属于当前架构行为，不是单点异常。

---

## 5. 问题二：语音输入触发 TTS 但字幕不显示的原因

现象：语音输入后，TTS 在播，但字幕不出现。

根因是“监听器初始化时机冲突”：

1. 前端 `chat:stream:event` 监听器在 `ensureDesktopEventListener()` 内创建。  
2. 该函数只在 `startDesktopStreaming()` 被调用时执行。  
3. `startDesktopStreaming()` 只会在文本发送 `startStreaming()` 时走到。  
4. 纯语音自动流（由主进程 `onAsrFinal` 触发）不会调用 `startStreaming()`，因此监听器可能根本没建立。  
5. 结果：字幕桥拿不到 `segment-ready/text-delta/done`；虽然 `voice:event segment-tts-started` 能收到，但因为缺少对应 `pending segment`，被缓存后不显示。

关键代码：

- 监听器懒初始化与唯一调用点：  
  `front_end/src/hooks/useStreamingChat.js:219-247,249-250`
- 语音自动收养依赖 `inputSource=voice-asr`（前提是监听器已存在）：  
  `front_end/src/hooks/useStreamingChat.js:126-152`
- 仅语音事件且无 segment entry 时只缓存不显示：  
  `front_end/src/hooks/chat/useStreamingSubtitleBridge.js:326-332`

这解释了“有 TTS（主进程 voiceSession 正常）但无字幕（前端 chat 事件未接入）”的分离现象。

---

## 6. 架构冲突点（组件级）

冲突发生在以下组件之间：

1. `useStreamingChat`（前端 chat 事件接入）  
2. `onAsrFinal -> chatStreamControl.start`（主进程自动语音转 chat）  
3. `useStreamingSubtitleBridge`（字幕渲染依赖 chat 分段事件）  

冲突本质：

- 语音自动流在主进程发起；
- 但前端 chat 事件监听的生命周期绑在“文本发送动作”上；
- 导致语音与文本在后端收敛，但在前端事件入口没有完全收敛。

---

## 7. 复现矩阵（基于当前实现）

1. 冷启动后不发任何文本，直接语音输入：高概率出现“有 TTS、无字幕”。
2. 先发一条文本（触发前端 chat 监听建立），再语音输入：字幕可恢复概率提高。
3. 不开启语音会话时仅文本输入：稳定“有字幕、无 TTS”。

---

## 8. 分析结论（不含改动）

当前系统在“发送给 Nanobot”的层面已完成语音/文字收敛；  
但在“前端事件消费 + TTS 会话依赖”的层面仍是两套不同入口和生命周期约束，导致你观察到：

- 文本回包默认只走字幕；
- 语音回包可能只走 TTS（在特定监听初始化条件下字幕丢失）。

以上即本次问题的架构级成因。
