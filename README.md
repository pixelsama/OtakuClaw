# Free-Agent-Vtuber OpenClaw Fork（Phase 1 文本版）

这是基于 `Free-Agent-Vtuber` 的实验副本，目标是：
- 删除原有 `dialog-engine` 主链路
- 用 OpenClaw 作为文本 AI 引擎
- 前端保留现有字幕流协议（`text-delta` / `done`）

## 本副本改动重点
- 已移除：`services/dialog-engine`
- 已改造：`services/gateway-python/main.py`
  - `/chat/stream` -> OpenClaw `/v1/chat/completions`
  - OpenAI SSE -> 前端事件映射
- 已下线：`/chat/audio/stream`（返回 `410`）
- 已调整：`docker-compose*.yml` 为最小 OpenClaw 测试编排
- 已禁用：前端麦克风入口（仅文本测试）
- 前端已迁移：React 18 + MUI（不再依赖 Vue/Vuetify）

## 快速开始

1. 准备 OpenClaw（由用户自行部署）
- 启用 `/v1/chat/completions`
- 准备 Bearer Token

2. 启动本项目网关

```bash
cp .env.example .env
docker compose up --build gateway
```

3. 启动前端

```bash
cd front_end
npm install
npm run dev
```

4. 在前端发送文本，观察字幕流是否返回。

## 关键环境变量
- `OPENCLAW_BASE_URL`
- `OPENCLAW_TOKEN`
- `OPENCLAW_AGENT_ID`

详见根目录 `.env.example`。
