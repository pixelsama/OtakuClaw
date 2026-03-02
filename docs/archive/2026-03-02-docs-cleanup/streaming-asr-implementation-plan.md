# 流式 ASR 改造计划

## 目标
- 前端录音时实时推送音频块至后端，避免“录完再上传”的延迟。
- 在 `dialog-engine` 中接入真正的流式 ASR provider，让 `/chat/audio/stream` 能在音频到达时立即输出部分转写。
- 保留现有批处理识别路径，便于回退或作为离线兜底方案。

## 现状差距
- 前端 `MediaRecorder` 录音后一次性上传，缺乏实时发送和恢复机制。
- 后端 ASR 服务以完整 `AudioBundle` 为单位，仅提供 `transcribe_bundle`。
- SSE 层只是按顺序回放已完成的 partial，没有真正的增量推理。

## 工作流拆解

### 1. 前端实时采集与上传
- 调整 `useApi.js`：`ondataavailable` 触发时即刻通过 WebSocket 发送音频块，维护 chunk 序号与会话状态。
- 处理网络抖动与回压：必要时增加缓冲区、重传/丢弃策略，并在 UI 上反馈录音状态。
- 与后端协商编码格式（例如 `audio/webm;codecs=opus` 或 PCM），并提供能力检测与降级路径。
- 更新界面提示，包括实时录音、断线重连、错误提示等。

### 2. 网关/入口协议
- 明确流式音频入站协议：WebSocket（当前基础）、HTTP chunked 或 gRPC，保持消息结构一致（开始/数据/结束）。
- 在 gateway 层对接流式音频：转发 chunk、维护会话超时、处理取消/失败并通知前端。
- 确保安全控制与限速，避免恶意长连接占用。

### 3. Dialog Engine 流式 ASR
- 扩展 `AsrProvider`：将 `stream()` 作为一等接口，允许 provider 返回增量 `AsrPartial`。
- 引入支持流式推理的实现（如 Whisper streaming wrapper、VAD+增量解码），管理模型加载与资源。
- 重构 `/chat/audio/stream`：在音频块到达时驱动 provider stream，并立即通过 SSE 推送 `asr-partial` / `asr-final`；同时保留 LLM 回复流。
- 兼容现有 `transcribe_bundle`：根据配置或输入模式动态选择流式/批处理路径。

**当前进展**：
- 新增 `VolcengineAsrProvider`，基于豆包语音 WebSocket API 实现分片上传和增量转写，支持 `ASR_VOLC_*` 环境变量配置凭证。
- `AsrProvider` / `AsrService` 支持真正的流式生成，`chat_audio_stream` 在 SSE 中实时发送 `asr-partial` 事件后再进入 LLM 回复阶段。
- 为向后兼容，`transcribe_bundle` 仍可返回批量结果，且在被 monkeypatch 时作为流式路径的最终兜底。
- `input-handler` 通过 `/chat/audio/stream` 建立 SSE，边上传音频边转发 `asr-partial`、`text-delta` 事件到 Redis，`output-handler` 与前端 WebSocket 即时展示转写与回复增量。
- 火山引擎凭证通过 `ASR_VOLC_APP_KEY/ACCESS_KEY/RESOURCE_ID` 环境变量注入，服务端记录 `X-Tt-Logid` 并在日志/统计中追加 `asr.volcengine.latency_ms`、`error_code` 等信息，连续失败后自动回退本地 Mock ASR。

### 4. 基础设施与性能
- 评估流式模型的 CPU/GPU 占用，调整部署拓扑、容器资源、自动扩缩容策略。
- 建立可观测性：记录每个会话的 chunk 处理时延、缓冲深度、ASR 延迟等指标。
- 优化 Redis/消息队列等依赖，确保流式事件不会阻塞现有通路。

### 5. 测试与质量保障
- 单元测试：覆盖新的 provider stream 逻辑、音频块协议解析、错误分支。
- 集成测试：模拟真实 chunk 流（例如使用 pytest-asyncio + WebSocket 客户端）验证端到端延迟与鲁棒性。
- 前端 E2E：利用 Playwright/Cypress 验证不同浏览器、网络条件下的录音与实时转写体验。
- 手工验收清单：双语测试、长时会话、断网恢复、设备权限处理等。

### 6. 发布与运维
- 通过特性开关（如 `STREAMING_ASR_ENABLED`）控制流式路径，支持灰度发布。
- 制定分阶段上线计划（开发 → 测试 → 预发布 → 生产），每阶段监控核心指标并准备回滚方案。
- 更新文档：README、运维手册、故障排查指南；同步团队培训与支持流程。

## 时间与优先级建议
1. **基础设施准备（前端上传 + 网关协议）**：解决数据流动路径，是开启流式的前提。
2. **ASR provider 与服务改造**：实现实时转写核心能力。
3. **观测与测试强化**：确保稳定性与可维护性。
4. **灰度上线与优化**：在真实流量下验证表现，迭代调优。

## 里程碑检查
- ✅ 可在本地环境完成端到端实时转写示例。
- ✅ SSE 客户端在 500ms 内收到第一条 `asr-partial`。
- ✅ 监控面板显示每条会话的 ASR 延迟与错误率。
- ✅ 回退机制验证通过（关闭特性开关恢复到批处理模式）。
