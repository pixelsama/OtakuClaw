# 前端说明（React + Electron Renderer）

本前端默认运行在 Electron Renderer 中：
- 流式聊天优先走 `window.desktop` IPC（主进程转 OpenClaw SSE）
- 非 Electron 环境仅用于开发调试，不作为生产运行形态

## 本地开发

```bash
cd front_end
pnpm install
pnpm run dev
```

默认地址：`http://localhost:3000`

如需完整桌面联调，请在仓库根目录运行：

```bash
pnpm run desktop:dev
```

## Live2D 模型放置目录（推荐）

`front_end/public/live2d/models/<ModelName>/`

模型 JSON 路径示例：

`/live2d/models/<ModelName>/<ModelName>.model3.json`

## 环境变量（仅 Web fallback）

参考 `front_end/.env.example`：
- `VITE_API_BASE_URL`
- `VITE_STREAM_PATH`

在 Electron 模式下，OpenClaw 配置来自应用设置页，不依赖上述变量。
Web fallback 模式会使用浏览器本地存储保存配置，包含 token，仅建议开发联调使用。
