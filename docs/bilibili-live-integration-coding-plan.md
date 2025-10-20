# Bilibili 直播集成编码计划

## 1. 背景与目标
- 基础范围：按照 `docs/bilibili-live-integration-report.md` 中的调研结论，完成对 Bilibili 直播弹幕与醒目留言事件的可靠采集，并接入 Free-Agent Vtuber 的处理流水线。
- 成功标准：
  - Input-handler 服务能够采集弹幕与醒目留言事件，并将规范化后的消息发布到 Redis。
  - Dialog Engine 消费新的事件流，对醒目留言优先生成回复并更新记忆。
  - 可选的回调接收端为醒目留言事件提供冗余保障。

## 2. 高层架构
```
[Bilibili 弹幕 WebSocket 客户端] --LiveEvent--> [services/input-handler-python]
                                                     \
                                                      --> Redis channel: live.chat
                                                                        \
                                                                         --> [services/dialog-engine]
                                                                         --> [analytics persistence (future)]
```
- 配置键：`BILI_ROOM_ID`、`BILI_APP_ID`、`BILI_APP_SECRET`、`BILI_ACCESS_TOKEN`、`BILI_APP_KEY`、`BILI_HEARTBEAT_INTERVAL`。
- 共享数据结构：在 `utils/live_events.py` 中定义 `LiveEvent` 数据类，统一抽象跨平台字段（`platform`、`room_id`、`user_id`、`username`、`message_type`、`content`、`metadata`、`priority`）。

## 3. 迭代计划

### 迭代 0 —— 基础与凭证
1. 在 `.env.example` 及 `docs` 中记录环境变量，并补充安全存储说明。
2. 如无现成能力，新增机密加载辅助模块，支持从环境变量或密钥管理服务读取 Bilibili 凭证。
3. 评估 WebSocket 客户端依赖（`aiohttp` 或 `websockets`），并更新 `services/input-handler-python/requirements.txt` 及相关锁定文件。
4. 编写最小单元测试，确保配置加载器校验必要的键值。

### 迭代 1 —— 弹幕 WebSocket 连接器（Input Handler）
1. 在 `services/input-handler-python/input_handlers/bilibili_live.py` 新建模块：
   - 实现异步客户端类 `BilibiliDanmakuClient`，负责握手、心跳（默认 30 秒）、重连退避、数据包解码。
   - 使用结构解析处理包头，支持 zlib/brotli 压缩负载。
2. 在现有 worker 启动流程（`main.py` 或调度器）中集成该客户端，并通过特性开关 `ENABLE_BILIBILI` 控制。
3. 通过 `services/input-handler-python/publisher.py` 将解码后的事件以 `LiveEvent` 形式发布到 Redis。
4. 测试：
   - 针对数据包解析编写单元测试，使用录制的样本。
   - 编写基于 `pytest-asyncio` 的集成式异步测试，模拟 WebSocket 服务器。

### 迭代 2 —— 事件规范化与路由
1. 增加规范化层，将 Bilibili `cmd` 映射为内部枚举（`chat`、`super_chat`、`gift` 等）。
2. 扩展 `utils` 包，新增 `live_events.py` 数据类及优先级计算助手（醒目留言 > 礼物 > 弹幕）。
3. 确保可序列化为 JSON（使用 `.model_dump()` 或自定义字典）以便推送到 Redis。
4. 在 `docs/` 中补充事件 schema 参考表格。

### 迭代 3 —— Dialog Engine 消费
1. 在 `services/dialog-engine` 中新增订阅模块 `live_chat_consumer.py`，监听 `live.chat` 渠道。
2. 与现有编排器集成，当消息类型为 `chat` 或 `super_chat` 时触发响应流水线。
3. 实现醒目留言优先策略，例如基于权重的队列或即时调度。
4. 更新日志与指标，记录事件接收量及响应延迟。
5. 编写单元测试，使用 Redis 订阅者 mock，验证醒目留言绕过积压。

### 迭代 4 —— 醒目留言增强与记忆更新
1. 扩展 dialog engine，将醒目留言元数据通过现有 gRPC/HTTP 客户端转发至记忆服务。
2. 实现模板化的醒目留言致谢回复（可配置），并通过醒目留言 `id` + Redis Set 去重避免重复感谢。
3. 增加配置项以控制自动致谢行为。
4. 编写测试覆盖去重逻辑与元数据传递。

### 迭代 5 —— 回调接收端（可选但推荐）
1. 在 `services/input-handler-python/callbacks/bilibili.py` 搭建 FastAPI 应用，接收开放平台回调（`superChatMessage`、`gift`）。
2. 根据共享密钥校验签名（`X-Bili-Signature`）。
3. 校验通过后，将事件发送至相同 Redis 渠道，并与 WebSocket 事件进行去重。
4. 在 `docker-compose` 中新增服务项，并记录公网访问要求（ngrok、反向代理等）。
5. 编写测试验证签名校验与去重链路。

### 迭代 6 —— 可观测性与运维
1. 增加 Prometheus 指标（若缺乏监控，可先使用日志）以跟踪连接状态、事件吞吐、心跳失败等。
2. 实现看门狗机制，若超过 60 秒未收到事件则重启 WebSocket 客户端。
3. 新增告警钩子（Slack/Webhook），在多次重连失败时通知值班人员。
4. 在 `docs/bilibili-live-runbook.md` 中编写运维手册（新建文件），总结常见操作流程。

## 4. 测试与质保策略
- **单元测试**：数据包解析、事件规范化、优先级计算、回调签名校验。
- **集成测试**：模拟 WebSocket 推送录制弹幕，验证事件流水线至 Redis 与 dialog engine 的端到端表现。
- **压测**：使用回放脚本模拟消息突发，确保无丢包且延迟可接受。
- **预发布验证**：使用真实 Bilibili 直播间与测试凭证进行预演，确保上线前体验。

## 5. 部署检查清单
- 更新 CI 以运行新增测试套件（针对 input-handler 与 dialog-engine）。
- 确认 Docker 镜像包含新依赖与环境变量。
- 在部署环境中配置凭证（Kubernetes Secret、Docker Compose 覆盖等）。
- 与主播协调预发布直播，完成验收测试。
- 正式上线后监控指标并收集反馈，为后续迭代提供依据。

## 6. 时间表（4 周 MVP）
| 周次 | 里程碑 |
| ---- | ------ |
| 1 | 完成迭代 0-1，实现开发环境中的 WebSocket 事件采集。 |
| 2 | 完成迭代 2-3，使对弹幕与醒目留言的响应链路打通。 |
| 3 | 完成迭代 4-5，补充醒目留言增强与回调冗余。 |
| 4 | 完成迭代 6，执行预发布验证并准备上线。 |

## 7. 待确认问题
- 是否可以使用官方 REST 接口发送机器人消息？如获批准需重新评估自动回复策略。
- Redis 采用何种模式（Pub/Sub 还是 Streams）更适合？当前方案基于 Pub/Sub，可视现有基础设施调整。
- MVP 阶段是否需要落地分析存储？如需要，应额外规划存储模块范围。
