# Free-Agent-Vtuber-openclaw 一步到位去 Python（Electron 方案）

## 1. 目标与边界

本方案用于当前副本项目的激进改造：**不保留 Python 后端**，一步到位改为：

- 前端：React（已迁移）
- 桌面壳：Electron
- 本地“后端适配层”：Electron 主进程（Node）
- 上游 AI：用户自部署 OpenClaw `/v1/chat/completions`

明确边界：

- 本轮不保留 `services/gateway-python` 运行路径。
- 本轮不恢复语音链路（ASR/TTS 继续下线）。
- 本轮以桌面应用为主目标，不优先 Web 独立部署。

---

## 2. 最终架构（目标态）

```text
Renderer(React UI)
  <-> preload bridge (contextBridge + IPC)
  <-> Electron Main Process (Node adapter)
  <-> OpenClaw HTTP SSE (/v1/chat/completions)
```

核心思想：

- 把原来 Python gateway 做的事情（SSE 转换、错误映射）搬到 Electron Main。
- Renderer 不直接持有 OpenClaw token，通过 IPC 请求主进程。
- 仍然对前端暴露 `text-delta / done / error` 语义，最大化复用现有 UI 逻辑。

---

## 3. 为什么这个方案适合“桌面一步到位”

1. 技术栈统一为 JS/TS（React + Electron），无 Python 运行时依赖。  
2. 打包链更简单：只打 Electron 应用，无需再启动 Python 服务。  
3. 本地凭证可由主进程管理，避免在渲染进程明文暴露。  
4. 与当前 OpenClaw-only 文本链路高度匹配，迁移风险可控。

---

## 4. 迁移范围（代码与目录）

## 4.1 新增目录（建议）

```text
desktop/
  electron/
    main.ts
    preload.ts
    ipc/
      chatStream.ts
      settings.ts
    services/
      openclawClient.ts
      sseParser.ts
      eventMapper.ts
```

## 4.2 前端改造点

- `front_end/src/hooks/useStreamingChat.js`
  - Web 模式：保留 `fetch('/chat/stream')`（可选）
  - Electron 模式：改走 `window.desktop.chatStream(...)` IPC
- 新增 `front_end/src/services/desktopBridge.js`（或 TS）
  - 统一封装 renderer->main 调用
- 增加设置页（或配置弹窗）
  - `OPENCLAW_BASE_URL`
  - `OPENCLAW_TOKEN`
  - `OPENCLAW_AGENT_ID`

## 4.3 删除/下线

- `services/gateway-python/*`（功能迁移完成后删除）
- 根目录 `docker-compose*.yml` 中 gateway 相关内容（若仅桌面分发）
- Python 依赖文档与说明同步清理

---

## 5. Electron 主进程接口设计

## 5.1 IPC 合同（建议）

### `chat:stream:start`

请求：

```json
{
  "sessionId": "text-dialog",
  "content": "你好",
  "options": {
    "temperature": 0.7
  }
}
```

响应：`{ streamId: "uuid" }`

### `chat:stream:abort`

请求：

```json
{ "streamId": "uuid" }
```

响应：`{ ok: true }`

### 主进程推送事件（event channel）

`chat:stream:event`：

```json
{
  "streamId": "uuid",
  "type": "text-delta|done|error",
  "payload": {}
}
```

事件映射规则（必须与现有语义一致）：

- OpenClaw chunk `choices[0].delta.content` -> `type=text-delta`, `payload={content}`
- OpenClaw `[DONE]` -> `type=done`, `payload={source:"openclaw"}`
- 上游异常 -> `type=error`, `payload={code,message}`

---

## 6. OpenClaw 客户端实现要求（主进程）

1. 请求头：
   - `Authorization: Bearer <token>`
   - `accept: text/event-stream`
2. 请求体：
   - `model: openclaw:<agentId>`
   - `stream: true`
   - `messages: [{role:"user", content}]`
   - `user: sessionId`
3. SSE 解析：
   - 支持分片粘包
   - 容错空事件/注释行
   - 识别 `[DONE]`
4. 中断机制：
   - `AbortController` 按 `streamId` 管理
5. 统一错误码（建议）：
   - `openclaw_unreachable`
   - `openclaw_unauthorized`
   - `openclaw_rate_limited`
   - `openclaw_upstream_error`

---

## 7. 安全基线（Electron 必做）

1. `contextIsolation: true`
2. `nodeIntegration: false`
3. preload 白名单 API（仅暴露必需函数）
4. 禁止 renderer 直接读 token 文件
5. 外部 URL 访问白名单（仅 OpenClaw 配置域）
6. 关闭不必要的 shell 打开能力（`shell.openExternal` 需校验）

---

## 8. 打包与发布

建议工具：

- `electron-builder`（常见、成熟）

发布产物：

- Windows: `nsis` 安装包
- macOS: `dmg`
- Linux: `AppImage`

配置建议：

- 首次启动引导配置 OpenClaw 地址和 token
- 本地配置存储于用户目录（例如 `electron-store`）
- 提供“连接测试”按钮（调用一次非流式/短流式请求）

---

## 9. 一步到位实施清单（按执行顺序）

## Step 1：建立 Electron 基础框架

- 引入 Electron + preload + 主进程入口
- 前端可在 Electron 窗口正常加载

## Step 2：主进程实现 `chat stream` 适配

- 完成 OpenClaw 请求、SSE 解析、事件映射、abort
- 打通 IPC 事件转发

## Step 3：前端 Hook 对接 IPC

- `useStreamingChat` 改为优先走 desktop bridge
- 保持 UI 层事件语义不变（`onDelta/onDone/onError`）

## Step 4：配置与设置页

- 增加 OpenClaw 参数录入、保存、校验
- 增加连接测试与错误提示

## Step 5：删除 Python 路径

- 移除 `services/gateway-python` 相关代码与文档引用
- 清理 compose 里不再使用的服务定义

## Step 6：打包验证

- 产出安装包
- 新机器安装后开箱可用（填写 OpenClaw 配置后即可聊天）

---

## 10. 验收标准（DoD）

满足以下即完成“一步到位去 Python”：

1. 桌面应用可独立运行，无需 Python 环境。  
2. 文本流对话可稳定输出 `text-delta` 与 `done`。  
3. 中断（abort）可生效，不残留僵尸请求。  
4. OpenClaw 凭证仅在主进程可读。  
5. 安装包（至少一个目标平台）可安装并运行。  
6. 仓库文档不再要求启动 Python gateway。  

---

## 11. 风险与应对

1. SSE 解析错误导致丢字/乱序  
应对：编写分片解析单测（粘包、半包、DONE 前异常）。

2. Electron 主进程阻塞  
应对：流处理全异步；避免同步 IO。

3. 打包后路径/静态资源失效（Live2D 模型）  
应对：统一模型放在 `public/live2d/models`，仅走绝对静态路径。

4. 主进程 API 暴露过宽带来安全风险  
应对：preload 最小白名单，禁用 renderer 直接 Node 能力。

---

## 12. 建议工期（激进版）

- 单人全量：5~10 个工作日（取决于 Electron 经验）
- 双人并行：3~6 个工作日

并行拆分建议：

- A：主进程 IPC + OpenClaw stream 适配
- B：Renderer hook 改造 + 设置页 + 打包脚本

---

## 13. 备注（副本策略）

由于本仓库是副本，允许激进演进。建议在主分支前先保留一个里程碑 tag（例如 `react-migration-baseline`），再执行 Python 清理，确保可快速回退。
