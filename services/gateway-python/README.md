# AIVtuber Gateway (OpenClaw Text-Only)

该副本网关已改造成 OpenClaw 文本适配层：
- 前端入口保持 `POST /chat/stream`
- 上游改为 OpenClaw `POST /v1/chat/completions`
- 将 OpenAI SSE chunk 映射为前端既有事件：`text-delta` / `done`

## 当前接口

### 文本流（启用）
- `POST /chat/stream`
- 请求体示例：
```json
{
  "session_id": "demo",
  "content": "你好"
}
```
- 返回：`text/event-stream`
  - `event: text-delta` + `{"content":"..."}`
  - `event: done` + `{"source":"openclaw"}`

### 语音流（已下线）
- `POST /chat/audio/stream` -> `410 not_supported`

### 保留诊断接口
- `GET /health`
- `GET /connections`

## 环境变量

- `OPENCLAW_BASE_URL`：OpenClaw 网关地址（例：`http://127.0.0.1:18789`）
- `OPENCLAW_TOKEN`：OpenClaw Bearer Token
- `OPENCLAW_AGENT_ID`：默认 Agent（映射为 `model=openclaw:<agent>`）
- `OPENCLAW_HTTP_TIMEOUT`
- `OPENCLAW_CONNECT_TIMEOUT`
- `OPENCLAW_WRITE_TIMEOUT`

## 本地运行

```bash
cd services/gateway-python
pip install -r requirements.txt
python main.py
```

## 测试

```bash
cd services/gateway-python
pip install -r requirements-test.txt
pytest tests/unit/test_sse_routes.py -q
```
