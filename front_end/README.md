# 前端本地开发（OpenClaw 文本版，React）

该副本前端当前是文本链路：
- React 18 + MUI + Vite
- 使用 `POST /chat/stream` 获取流式字幕
- 语音入口已禁用（Phase 1 不接 TTS/ASR）

## 环境要求
- Node.js 18+
- npm

## 安装与启动

```bash
cd front_end
npm install
npm run dev
```

默认地址：`http://localhost:3000`

## Live2D 模型放置目录（推荐）

请将模型资源放到：

`front_end/public/live2d/models/<ModelName>/`

并在前端使用路径：

`/live2d/models/<ModelName>/<ModelName>.model3.json`

这样在 `npm run dev` 与 `npm run build` 后的生产静态部署都能一致访问，避免 `src/` 路径在构建后失效。

## 环境变量

参考 `front_end/.env.example`：
- `VITE_API_BASE_URL=http://127.0.0.1:8000`
- `VITE_STREAM_PATH=chat/stream`

## 联调要求

先启动网关（`docker compose up gateway` 或单独运行 `services/gateway-python/main.py`），并确保网关可访问到用户部署的 OpenClaw。
