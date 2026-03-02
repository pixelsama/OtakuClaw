# Free-Agent-Vtuber OpenClaw Desktop（Electron）

本仓库当前主目标是桌面端：
- 前端：React 18 + Vite
- 桌面壳：Electron
- 本地适配层：Electron Main（Node）
- 上游 AI：OpenClaw `/v1/chat/completions`

当前默认链路已不再依赖 Python gateway。

## 快速开始（桌面开发）

1. 安装依赖

```bash
npm install
cd front_end && npm install && cd ..
```

2. 启动 Electron + 前端开发服务器

```bash
npm run desktop:dev
```

3. 在应用内打开“设置”面板，填写：
- `OpenClaw Base URL`
- `OpenClaw Token`
- `OpenClaw Agent ID`

4. 点击“连接测试”成功后即可发送文本消息。

## 打包发布

```bash
npm run desktop:build
```

默认会先构建前端，再用 `electron-builder` 生成安装包（Win/macOS/Linux）。

## 测试

```bash
npm run test:desktop
npm run test:frontend
```

`desktop` 测试覆盖设置存储、IPC 流式映射与中断行为。

## 目录说明

- `desktop/electron/`：Electron 主进程、preload、IPC、OpenClaw 适配
- `front_end/`：React UI
- `services/`：历史 Python 服务代码（不再是桌面主链路依赖）

## 关键特性

- Renderer 通过 IPC 请求流式聊天，不直接持有 OpenClaw token
- 桌面端优先使用系统密钥链存储 OpenClaw token（`keytar`）
- 主进程把 OpenClaw SSE 映射为 `text-delta / done / error`
- 支持 `chat:stream:abort` 中断流式请求
