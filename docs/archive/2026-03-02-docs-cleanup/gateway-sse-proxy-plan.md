# Gateway 层新增 `/chat/stream` 与 `/chat/audio/stream` SSE 转发计划

## 背景
- 现状：前端只通过 WebSocket 与 `output-handler` 通信，最终收到的是整段文本；`dialog-engine` 已提供 `POST /chat/stream` 与 `POST /chat/audio/stream` 的 SSE 流式接口，但未经 Gateway 暴露。
- 目标：在 Gateway（FastAPI）统一暴露文本与音频 SSE 端点，集中处理 CORS、鉴权、速率限制及日志监控，使前端只需访问 Gateway。

## 范围
1. Gateway 新增 `POST /chat/stream` 与 `POST /chat/audio/stream`。
2. 请求透传至 `dialog-engine` 对应 SSE 接口，响应体保持原始 SSE 事件顺序与格式。
3. 统一处理 CORS、鉴权、错误响应与观测性。
4. 提供最少的前端调整指导（URL、Header）。
5. 不在本阶段处理输出层 WebSocket 协议变更。

## 设计要点

### 1. HTTP/SSE 代理实现
- **请求封装**：复用现有 httpx AsyncClient；`timeout` 设为较大值或 `None`，避免流式超时。
- **流式转发**：使用 `httpx.AsyncClient.stream()` 获取响应 `aiter_raw()`，通过 `StreamingResponse` 将字节块原样写回客户端；保持 `text/event-stream`、`cache-control: no-cache`、`connection: keep-alive` 等头部。
- **头部与重写**：保留必要的 `Authorization`/`sessionId`；可根据需要新增 `X-Forwarded-*`。
- **错误处理**：上游返回非 2xx 时，终止流并返回 JSON 错误；请求阶段异常（连接失败、超时）转换为 5xx 并记录。
- **可取消性**：客户端断开时及时关闭 httpx 流，避免资源泄漏。

### 2. CORS 与鉴权
- **CORS**：复用 FastAPI CORS 中间件配置；确认需要暴露 SSE 特定头（如 `content-type`）。
- **鉴权策略**：
  - 支持现有 JWT/Token 验证（若尚未实现，至少保留钩子供后续扩展）。
  - 将用户身份或 session 信息透传至 `dialog-engine`，用于上下文关联。
- **速率限制/配额**：预留集成点，例如基于 Redis 的速率限制器；本阶段可先记录需求。

### 3. 日志与监控
- **日志**：记录请求入口、sessionId、目标 URL、状态码、耗时；对异常进行结构化日志。
- **指标**：埋点统计活跃 SSE 连接数、平均持续时间、错误率；可写入 Prometheus exporter（若无可先准备接口）。
- **Tracing**：如启用 OpenTelemetry，确保上下文跨服务传递。

### 4. 配置与部署
- 新增环境变量：`DIALOG_ENGINE_BASE_HTTP`（或沿用已有 URL 推导）。
- 更新 docker-compose/Helm 等部署文件，确保 Gateway 能访问 `dialog-engine` HTTP 端口。
- 文档更新 `.env.example` 说明新的可配置项。

### 5. 测试策略
- **单元测试**：对 Gateway 新增路由编写测试，验证：
  - 请求体透传
  - SSE 头部正确
  - 上游错误转换（4xx/5xx）
- **集成测试**：本地 compose 启动后，使用测试客户端命中 `/chat/stream`，确认 `text-delta`、`done` 事件完整。
- **回归测试**：验证现有 `/api/asr`、WebSocket 代理功能不受影响。
- **手动验证**：前端或 curl `-N` 命令连接 Gateway，观察流式输出；模拟网络中断确保资源释放。

### 6. 推广步骤
1. **开发阶段**：在 feature 分支实现并通过本地测试。
2. **代码审查**：重点关注资源释放、超时、错误映射。
3. **预发布环境验证**：与前端联调，确认字幕/音频流实际可用。
4. **灰度发布**：按环境依次上线，监控连接数与错误率。
5. **文档更新**：README / 接口文档补充新的 Gateway 端点说明。

### 7. 前端配合
- 将 SSE 连接目标改为 Gateway `/chat/stream` 或 `/chat/audio/stream`。
- 如果依赖 `Authorization` 头，确保在请求中发送；匹配 Gateway 新增的鉴权策略。
- 处理连接断开时的重试与 UI 反馈。

## 风险与缓解
- **SSE 与 ASGI 兼容性**：FastAPI + Uvicorn 需使用 `--http=httptools` 或 `--http=h11`；如遇服务器缓存问题，需配置 `proxy_set_header Connection keep-alive` 等反向代理设置。
- **长连接资源占用**：评估并调整 Gateway worker 数、连接池大小（httpx `limits`）；必要时采用负载均衡分流。
- **鉴权未就绪**：若短期内无法实现 Token 校验，至少在接口说明中标记风险，规划后续迭代。
- **跨域设置不足**：若前端来源不止 3000 端口，需要同步更新 `allow_origins` 列表或改为通配策略。

## 里程碑（预估）
| 阶段 | 内容 | 负责人 | 预估耗时 |
| --- | --- | --- | --- |
| 设计确认 | 评审本方案、确认鉴权需求 | 后端、前端 | 0.5 天 |
| 开发实现 | Gateway 新增端点 + 配置 | 后端 | 1.5 天 |
| 测试联调 | 单元/集成/前端联调 | 后端 + 前端 | 1 天 |
| 上线与监控 | 发布到生产、监控稳定性 | DevOps | 0.5 天 |

## 产出
- Gateway 新增 SSE 代理代码与测试。
- 更新后的配置文件、Docker/Helm。
- 接口文档及使用指南。
- （可选）监控仪表盘或报警规则。
