# 后端接口总览（OpenClaw Text-Only Fork）

该副本已切换到 **Phase 1 文本链路**：
- 保留网关 `services/gateway-python` 作为轻量 BFF
- 网关上游改为 OpenClaw `/v1/chat/completions`
- 语音相关能力（ASR/TTS）在本副本中不提供

## 1. 网关服务

默认端口：`8000`

### 1.1 文本流接口

`POST /chat/stream`

- 请求体（最小）
```json
{
  "session_id": "demo",
  "content": "你好"
}
```

- 网关上游请求（OpenClaw）
  - `POST <OPENCLAW_BASE_URL>/v1/chat/completions`
  - `Authorization: Bearer <OPENCLAW_TOKEN>`（若配置）
  - `model: openclaw:<OPENCLAW_AGENT_ID>`
  - `stream: true`

- 前端收到的 SSE 事件
  - `event: text-delta` -> `{"content":"..."}`
  - `event: done` -> `{"source":"openclaw"}`

### 1.2 已下线接口

- `POST /chat/audio/stream` -> `410 not_supported`
- `POST /control/stop` -> `410 not_supported`
- `GET /internal/output/health` -> `410 not_supported`

### 1.3 诊断接口

- `GET /health`
- `GET /connections`
- `GET /`（简易状态页）

## 2. 环境变量

- `OPENCLAW_BASE_URL`（默认 `http://127.0.0.1:18789`）
- `OPENCLAW_TOKEN`
- `OPENCLAW_AGENT_ID`（默认 `main`）
- `OPENCLAW_HTTP_TIMEOUT`
- `OPENCLAW_CONNECT_TIMEOUT`
- `OPENCLAW_WRITE_TIMEOUT`

## 3. 说明

- 本副本已删除 `services/dialog-engine`，用于验证“Free-Agent 前端 + OpenClaw 后端”文本链路。
- 若要恢复原架构，请回到原项目目录 `Free-Agent-Vtuber`。
