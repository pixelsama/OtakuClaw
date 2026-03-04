# Free-Agent VTuber OpenClaw 语音链路开发流程规划（ASR / TTS / VAD）v2

日期：2026-03-03  
适用范围：当前 Electron + OpenClaw 文本主链路仓库（无 Python 后端依赖）

## 1. 背景与目标

当前仓库主链路已稳定在文本流式对话；语音能力（ASR/TTS/VAD）尚未落地。  
本规划目标是以最小回归风险，分阶段实现：

1. 麦克风输入 -> VAD 判定 -> ASR 转写
2. 转写文本 -> 现有聊天主链路（OpenClaw stream）
3. 回复文本 -> TTS 合成 -> Electron 内部二进制播放（非 URL 拉取）
4. 全链路支持中断、错误可观测、可测试

## 2. 设计原则

1. 不破坏当前文本主链路，语音能力先做可开关功能（feature flag）。
2. Token 与上游服务调用继续留在 Electron 主进程，不下放到 renderer。
3. TTS 音频默认走 IPC 二进制流，不走 HTTP URL 回拉。
4. 语音 MVP 直接采用高质量基线（模型 VAD + 可流式 ASR/TTS），避免重复投入低阶方案。
5. 保持可插拔 provider 结构，避免与单一云厂商强耦合。

## 3. 总体架构（建议）

### 3.1 数据流

1. Renderer 使用 `AudioWorklet`（回退 `ScriptProcessor`）采集 PCM 帧（默认 16kHz / mono / 16bit）。
2. Renderer 执行模型 VAD（WASM/ONNX 推理），按 speech start/end 事件切分音频。
3. 音频片段通过 IPC 发送给 Main。
4. Main 调用 ASR provider，回传 `asr-partial/asr-final` 事件。
5. `asr-final` 自动触发现有 `chat:stream:start`。
6. Main 接收文本回复后触发 TTS provider。
7. Main 将音频 chunk（二进制）通过 IPC 推给 Renderer，Renderer 直接解码播放并驱动口型。

说明：MVP 不采用 `MediaRecorder` 作为主链路采集，因为其编码块粒度不利于低延迟 VAD/ASR。

### 3.2 模块落点

- `desktop/electron/ipc/voiceSession.js`：语音会话 IPC 与事件分发。
- `desktop/electron/services/voice/`
  - `asrService.js` / `ttsService.js` / `providerFactory.js`
  - `providers/asr/*`、`providers/tts/*`
- `front_end/src/hooks/voice/`
  - `useVoiceCapture.js`（采集 + VAD）
  - `useVoiceSession.js`（状态机 + IPC 桥接）
- `front_end/src/components/config/ConfigDrawer.jsx`
  - 新增 Voice 标签页入口（语音开关、状态指示、错误提示）。

## 4. 技术路线（MVP -> 增强）

### 4.1 ASR 路线

- MVP：云 ASR provider（建议优先 OpenAI Whisper API 或兼容供应商）
  - 优点：落地快，维护成本低。
  - 代价：有网络与费用依赖。
- 阶段二：可选本地 ASR provider（离线/低网络依赖）
  - 作为可插拔扩展，不影响 MVP 发布。

### 4.2 TTS 路线

- MVP：云 TTS provider（返回音频 buffer 或 chunk）。
- 播放链路：Main -> Renderer IPC 二进制流 -> WebAudio 播放。
- 阶段二：流式 TTS（首音延迟优化）与句内打断。

### 4.3 VAD 路线

- MVP：直接使用模型 VAD（建议 Silero VAD WASM 或同等级方案）。
- 仅保留“按键说话”作为应急回退，不再规划阈值 VAD 版本。

### 4.4 音频采样与编解码约束（新增）

- 采集格式（Renderer -> Main）：
  - `sampleRate=16000`
  - `channels=1`
  - `sampleFormat=pcm_s16le`
  - 每帧 20ms（320 samples）
- ASR 输入要求：
  - provider 若接受 PCM 流，直接透传；
  - provider 若仅接受文件，Main 侧拼片并封装为 WAV 后提交。
- TTS 输出要求：
  - 优先 `pcm_s16le` 或 `mp3` chunk；
  - 统一通过 IPC 二进制传输，不使用 URL 回拉。

## 5. 分阶段计划（6 周建议）

### Phase 0（第 1 周）：语音基础设施骨架

1. 建立 `voiceSession` IPC 协议与状态机（idle/listening/transcribing/thinking/speaking/error）。
2. 增加 feature flags：
   - `VOICE_ENABLED`
   - `VOICE_VAD_ENABLED`
   - `VOICE_ASR_PROVIDER`
   - `VOICE_TTS_PROVIDER`
3. 增加 Mock ASR/TTS provider，先打通端到端事件流。

ASR provider 扩展约束（阶段 8 补充）：

- `VOICE_ASR_PROVIDER=mock|sherpa-onnx`（默认 `mock`）。
- 当使用 `sherpa-onnx` 时，至少配置：
  - `VOICE_ASR_SHERPA_MODEL`（当前先按 CTC 单模型接入）
  - `VOICE_ASR_SHERPA_TOKENS`
- 可选配置：
  - `VOICE_ASR_SHERPA_MODE=offline|online`（默认按模型类型自动推断）
  - `VOICE_ASR_SHERPA_MODEL_KIND`（如 `zipformerCtc` / `zipformer2Ctc` / `senseVoice`）
  - `VOICE_ASR_SHERPA_PREFER_ONLINE=0|1`
  - `VOICE_ASR_SHERPA_ENCODER` / `VOICE_ASR_SHERPA_DECODER` / `VOICE_ASR_SHERPA_JOINER`（online transducer 模型）
  - `VOICE_ASR_SHERPA_NUM_THREADS`（默认 2）
  - `VOICE_ASR_SHERPA_EXECUTION_PROVIDER=cpu|coreml|cuda`（默认 `cpu`）
  - `VOICE_ASR_SHERPA_SAMPLE_RATE`（默认 16000）
  - `VOICE_ASR_SHERPA_FEATURE_DIM`（默认 80）
  - `VOICE_ASR_SHERPA_DECODE_CHUNK_MS`（默认 160）
  - `VOICE_ASR_SHERPA_DEBUG=0|1`

TTS provider 扩展约束（阶段 9 补充）：

- `VOICE_TTS_PROVIDER=mock|sherpa-onnx`（默认 `mock`）。
- 当使用 `sherpa-onnx` 时，默认按 `kokoro` 模型类型解析，至少配置：
  - `VOICE_TTS_SHERPA_MODEL`
  - `VOICE_TTS_SHERPA_TOKENS`
  - `VOICE_TTS_SHERPA_VOICES`
- 可选配置：
  - `VOICE_TTS_SHERPA_MODEL_KIND=kokoro|vits|matcha|kitten|pocket`（默认 `kokoro`）
  - `VOICE_TTS_SHERPA_NUM_THREADS`（默认 2）
  - `VOICE_TTS_SHERPA_EXECUTION_PROVIDER=cpu|coreml|cuda`（默认 `cpu`）
  - `VOICE_TTS_SHERPA_DEBUG=0|1`
  - `VOICE_TTS_SHERPA_SID`（默认 0）
  - `VOICE_TTS_SHERPA_SPEED`（默认 1）
  - `VOICE_TTS_SHERPA_CHUNK_MS`（默认 120）
  - `VOICE_TTS_SHERPA_OUTPUT_SAMPLE_FORMAT=pcm_s16le|pcm_f32le`（默认 `pcm_s16le`）
  - `VOICE_TTS_SHERPA_ENABLE_EXTERNAL_BUFFER=0|1`
  - 各模型专用路径：
    - `kokoro|kitten`：`VOICE_TTS_SHERPA_MODEL/VOICES/TOKENS`
    - `vits`：`VOICE_TTS_SHERPA_MODEL/TOKENS`（可选 `VOICE_TTS_SHERPA_LEXICON`）
    - `matcha`：`VOICE_TTS_SHERPA_ACOUSTIC_MODEL/VOCODER/TOKENS`
    - `pocket`：`VOICE_TTS_SHERPA_LM_FLOW/LM_MAIN/ENCODER/DECODER/TEXT_CONDITIONER/VOCAB_JSON/TOKEN_SCORES_JSON`

验收：
- 不接入真实模型时，也能完成“录音 -> mock 文本 -> mock 音频播放”。
- 连续 50 次 `start/stop` 不出现未释放监听器、定时器或 AudioContext 泄漏。

### Phase 1（第 2-3 周）：ASR + 模型 VAD MVP

1. 前端接入模型 VAD（含模型加载、预热、实时推理和分段）。
2. Main 集成真实 ASR provider，支持 partial/final。
3. ASR final 自动注入现有聊天文本输入链路。

验收：
- 可通过模型 VAD 稳定触发一次对话，错误可见，支持取消。
- 在测试集（静音 5 分钟 + 噪声 5 分钟）中：
  - 误触发率 <= 0.1 次/分钟
  - 漏触发率 <= 5%
- 端到端 ASR 首字延迟 P95 <= 1200ms（本地网络）。

### Phase 2（第 4 周）：TTS MVP（二进制播放）

1. Main 集成真实 TTS provider。
2. TTS 音频通过 IPC 二进制发送到 Renderer。
3. Renderer 复用现有 lip-sync 分析逻辑，替代 `audioUrl` 播放依赖。

验收：
- 全链路“说 -> 识别 -> 回复 -> 发声”可用，且不依赖音频 URL 拉取。
- TTS 首音延迟（收到文本完成到播放首音）P95 <= 1500ms。

### Phase 3（第 5 周）：中断与并发控制

1. 统一 STOP 语义：录音中断、ASR 中断、聊天中断、TTS 中断。
2. 增加串行策略（同一会话仅允许 1 条活跃语音链路）。
3. 完善异常恢复（provider 超时、网络中断、设备占用）。

验收：
- 连续打断 20 次不出现僵死状态、资源泄漏或鬼畜播放。
- 任意阶段 STOP 后 300ms 内状态回到 `idle` 或 `listening`。

### Phase 4（第 6 周）：可观测性与优化

1. 记录关键指标：VAD 命中率、ASR 延迟、TTFT、TTS 首音延迟、错误率。
2. 增加诊断面板（最近错误、平均延迟、当前 provider）。
3. 评估模型 VAD 多方案对比结果（准确率/延迟/CPU）与流式 TTS 收益。

验收：
- 有可追踪指标并可定位主要性能瓶颈。
- 指标可按 provider、设备、模式（VAD/PTT）维度过滤。

## 6. IPC 事件草案

### 6.0 协议总则（新增）

1. 所有事件必须带 `sessionId`。  
2. 流式分片事件必须带 `seq`（从 1 递增）。  
3. 音频分片事件必须带 `chunkId`。  
4. Main 对未知 `sessionId` 或过期 `seq` 直接丢弃。  
5. `voice:event(type=error)` 必须包含 `stage` 与 `code`，用于统一错误映射。

Renderer -> Main：

1. `voice:session:start` `{ sessionId, mode }`
2. `voice:audio:chunk` `{ sessionId, seq, chunkId, pcmChunk, sampleRate, channels, sampleFormat, isSpeech }`
3. `voice:input:commit` `{ sessionId, finalSeq }`
4. `voice:session:stop` `{ sessionId, reason }`
5. `voice:tts:stop` `{ sessionId, reason }`
6. `voice:playback:ack` `{ sessionId, ackSeq, bufferedMs }`

Main -> Renderer：

1. `voice:event` `type=state` `{ sessionId, status }`
2. `voice:event` `type=asr-partial` `{ sessionId, seq, text }`
3. `voice:event` `type=asr-final` `{ sessionId, seq, text }`
4. `voice:event` `type=tts-chunk` `{ sessionId, seq, chunkId, audioChunk, codec, sampleRate }`
5. `voice:event` `type=done` `{ sessionId, stage }`
6. `voice:event` `type=error` `{ sessionId, code, message, stage, retriable }`

### 6.1 状态机约束（新增）

- `idle -> listening -> transcribing -> thinking -> speaking -> idle`
- 允许从任意状态收到 STOP 后转 `idle`
- 不允许并发 `speaking`（同 session 仅 1 条 TTS 播放链路）

### 6.2 背压与流控（新增）

1. Renderer 维护播放缓冲区 `bufferedMs`。  
2. 当 `bufferedMs > 2000` 时发送 `voice:playback:ack` 提示 Main 暂停下发。  
3. 当 `bufferedMs < 800` 时发送恢复信号，Main 继续下发。  
4. 单 chunk 上限 64KB，超限必须拆片。  
5. 同一 session 若 5 秒无 ack，Main 主动终止 TTS 并回错误 `voice_tts_backpressure_timeout`。

## 7. 测试计划

### 7.1 Desktop（`node:test`）

1. IPC 事件映射：`voice:event` 类型完整性与顺序性。
2. 中断行为：任一阶段 stop 后都能正确清理。
3. provider 异常：超时、401、429、网络断连映射为统一错误码。
4. 流控行为：高水位暂停/低水位恢复/ack 超时终止。
5. 乱序与重复包：`seq` 校验正确丢弃过期事件。

### 7.2 Frontend（`vitest`）

1. `useVoiceSession` 状态机与事件订阅生命周期测试。
2. `useVoiceSession` 与现有 `useStreamingChat` 协作测试。
3. 音频 chunk 解码失败与恢复逻辑测试。
4. STOP 与会话切换时 UI 状态回收测试（按钮状态、提示、禁用态）。

说明：VAD 质量评估不放在前端单测，放到离线音频集成测试。

### 7.3 手工回归

1. USB 麦克风 / 内置麦克风切换。
2. 无麦克风权限、设备被占用场景。
3. 长对话（>= 15 分钟）内存与句柄稳定性。
4. 多显示器、DPI 缩放环境下语音按钮与状态提示正确显示。

## 8. 风险与规避

1. 回声导致 ASR 自激：MVP 先要求耳机模式，后续评估 AEC。
2. 网络抖动导致链路卡顿：加入超时、重试和清晰错误态。
3. IPC 压力过高：限制 chunk 频率与大小，必要时批量发送。
4. 误触发率高：增加模型置信度门限、最短语音时长和场景化参数配置，并保留“按键说话”回退模式。
5. 事件串会话：统一 `sessionId + seq`，旧会话事件全部丢弃。

## 9. 里程碑 DoD（完成定义）

1. 功能可开关：关闭语音时不影响现有文本功能。
2. 关键路径可测试：新增能力有自动化回归。
3. 资源可回收：多次开始/停止不会泄漏。
4. 文档可执行：新成员可按文档在 30 分钟内跑通语音 MVP。
5. 指标可观测：至少可查看 P50/P95 的 ASR 延迟与 TTS 首音延迟。

## 10. 待确认决策（建议本周拍板）

1. ASR MVP provider 选择（OpenAI Whisper 或其他兼容服务）。
2. TTS MVP provider 选择（优先返回流式或可分片数据的服务）。
3. VAD 模型与部署方案（Silero WASM/ONNX 或其他同等级方案）。
4. 默认交互模式（自动 VAD 或按键说话）。
5. 音频标准格式（建议 16kHz mono pcm_s16le）是否全链路统一。

---

如果以上方向确认，下一步建议直接产出两份文档：
1. `voiceSession` IPC 协议定稿（字段级别）；  
2. Phase 0 的任务拆解清单（按文件与测试用例编号）。

## 附录 A：Phase 0 任务拆解清单（按文件）

1. `desktop/electron/preload.js`
   - 暴露 `desktop.voice` API：`start/stop/sendAudioChunk/commitInput/stopTts/onEvent/onFlowControl`
   - 增加参数校验，拒绝无 `sessionId` 请求。
2. `desktop/electron/ipc/voiceSession.js`（新增）
   - 注册 `voice:*` IPC handler 与 event emitter。
   - 维护 `sessionMap`，实现 `sessionId + seq` 去重与状态推进。
3. `desktop/electron/main.js`
   - 注册/释放 `voiceSession` IPC。
   - 应用退出时清理所有语音会话与 provider 连接。
4. `desktop/electron/services/voice/providerFactory.js`（新增）
   - 提供 `createAsrProvider/createTtsProvider`，支持 mock/real provider。
5. `desktop/electron/services/voice/asrService.js`（新增）
   - 接收 PCM chunk，向 provider 输出 `asr-partial/asr-final` 事件。
6. `desktop/electron/services/voice/ttsService.js`（新增）
   - 接收文本，输出 `tts-chunk`，带 `seq/chunkId`。
7. `front_end/src/hooks/voice/useVoiceCapture.js`（新增）
   - `AudioWorklet` PCM 采集，VAD 推理，按事件切片。
8. `front_end/src/hooks/voice/useVoiceSession.js`（新增）
   - 统一状态机、IPC 绑定、stop 语义与错误归一。
9. `front_end/src/components/config/ConfigDrawer.jsx`
   - 新增 `Voice` 设置标签页入口（不耦合 Live2D 控制面板）。
10. `desktop/electron/tests/voiceSessionIpc.test.js`（新增）
    - 覆盖事件顺序、中断清理、流控与错误映射。
11. `front_end/tests/useVoiceSession.test.js`（新增）
    - 覆盖状态迁移、异常恢复、会话切换。

## 附录 B：首批验收指标基线（建议）

1. ASR 首字延迟：P50 <= 700ms，P95 <= 1200ms。  
2. TTS 首音延迟：P50 <= 900ms，P95 <= 1500ms。  
3. VAD 误触发率：<= 0.1 次/分钟（静音+噪声场景）。  
4. 连续会话稳定性：15 分钟内内存增长 < 150MB，无未释放 AudioContext。  
