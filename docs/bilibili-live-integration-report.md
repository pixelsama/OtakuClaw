# Bilibili直播集成可行性报告

## 1. 目标

评估将 Free-Agent Vtuber 系统与哔哩哔哩直播间醒目留言（“Super Chat”=付费高亮消息，亦称醒目留言/SC）优先对接、随后扩展至普通弹幕的技术方案，使 AI 能够接收消息并触发语音播报、虚拟形象动作和叠加层等即时反馈，同时梳理扩展到其他平台的下一步计划。

## 2. Bilibili 直播生态概览

哔哩哔哩提供多种机制来获取直播间事件：

- **官方直播开放平台**——提供房间管理和服务器推送回调的 REST API。需要开发者注册、应用审核以及房间绑定。回调事件可覆盖礼物、舰长、醒目留言等，但普通弹幕仍需通过弹幕 WebSocket 获取。
- **弹幕 WebSocket 网关**——公共端点（如 `wss://broadcastlv.chat.bilibili.com:443/sub`）允许认证连接加入指定房间的弹幕流。消息包括普通弹幕、礼物、醒目留言、舰长、进场等，需要定期发送心跳并解码二进制数据包。
- **第三方中继服务**——社区项目提供简化的 HTTP/WebSocket 接口，但存在服务条款和稳定性风险，生产环境不建议使用。

完整的集成需要结合弹幕 WebSocket 接入以及官方 REST/回调接口（例如获取房间状态、领取 SC 签名或协调回调）。

## 3. 接入要求与限制

| 项目 | 详情 | 备注 |
| ---- | ---- | ---- |
| 开发者账号 | 需要哔哩哔哩开放平台账号、实名认证和应用审核通过。 | 用于访问官方 REST 与回调接口。 |
| 房间绑定 | 必须将直播间绑定至开发者应用。 | Free-Agent Vtuber 需与主播账号协调。 |
| 鉴权 | REST 接口使用 `app_id`、`app_secret` 以及 HMAC SHA-256 签名；弹幕 WebSocket 需要包含房间号、`uid`、`key` 的 `authBody`。 |  |
| 频率限制 | 每个接口有不同的 QPS 限制，管理类接口通常 `QPS <= 1`。 | WebSocket 为推送式，需要处理突发流量。 |
| 使用条款 | 机器人交互需遵守平台规则（禁止垃圾信息和未授权自动化）。 | 需获得房主同意。 |

## 4. 弹幕 WebSocket 集成

为降低集成复杂度，我们计划分阶段实现：阶段一仅通过 WebSocket 捕获并处理与醒目留言相关的事件（如 `SUPER_CHAT_MESSAGE`），确保 SC 优先上线；阶段二再在同一通道上扩展到普通弹幕（`DANMU_MSG`）及其他互动类型。

1. **握手**
   - 连接 `wss://broadcastlv.chat.bilibili.com:443/sub`。
   - 发送认证数据包，字段包括：`uid`（游客填 0 或机器人账号 ID）、`roomid`、`protover`、`platform`、`clientver`、`key`（令牌）。官方令牌可通过 REST 接口 `app-start` 或登录账号获取。
2. **心跳**
   - 每 30 秒发送一次心跳包（`op=2`）保持连接。
3. **消息解码**
   - 数据包为 16 字节头部 + 负载，负载可能是 JSON 或 zlib/brotli 压缩。需要解析 `cmd` 字段，阶段一聚焦：
     - `SUPER_CHAT_MESSAGE` 与 `SUPER_CHAT_MESSAGE_JPN`：醒目留言事件（阶段一必须支持）。
     - `DANMU_MSG`：普通弹幕（阶段二扩展）。
     - `SEND_GIFT`、`GUARD_BUY` 等：礼物与舰长事件（阶段二视优先级规划）。
4. **扩展性**
   - 采用异步消费者（如 `asyncio` + `websockets` 或 `aiohttp`）。高流量场景可按房间分片或启动多个 worker，经 Redis/RabbitMQ 分发。
5. **安全**
   - 将令牌存储在安全的密钥管理系统中。如使用账号 Cookie，需要定期轮换。

### 现有库
- Python: `bilibili_api`、`biliup`、`danmaku` 等社区库，可能需增强以满足生产可靠性。
- Node.js: `bilibili-live-ws`、`blive-message-listener`，可在网关服务中封装使用。

## 5. 接收醒目留言

醒目留言事件可通过 WebSocket 与官方回调同步获取：

- **WebSocket**：`SUPER_CHAT_MESSAGE` 负载包含用户信息、价格、留言内容、背景色、持续时间等，可解析为内部事件结构，例如 `price`、`message`、`background_color`、`start_time`、`end_time`。
- **开放平台回调**：配置回调 URL 接收 `superChatMessage` 的 POST JSON。该渠道在 WebSocket 异常时可提供冗余，但仅在应用审核通过后可用。

建议优先使用 WebSocket 以获得低延迟，同时利用回调冗余并基于 SC `id` 去重。完成这一链路后，再将同样的消息分发机制拓展到普通弹幕事件。

## 6. 出站反馈（不在范围内）

Free-Agent Vtuber 通过语音合成、虚拟形象动作和屏幕叠加层来表达反应，因此此次集成不包含自动向 Bilibili 聊天发送消息。我们会关注平台未来是否发布官方支持，但不会采用逆向接口或浏览器自动化方案。

## 7. 集成架构方案

```
[Danmaku WS Client] --events--> [Gateway Python Service] --Redis--> [Dialog Engine]
                                                \
                                                 --> [Persistence/Analytics]
```

1. **输入处理扩展**
   - 在 `services/input-handler-python` 中新增模块 `bilibili_live.py`，负责维护 WebSocket 连接、解析事件，并将标准化消息发布到 Redis 主题 `live.chat`。阶段一仅订阅并处理醒目留言相关 `cmd`，为后续扩展弹幕奠定架构基础。
   - 标准化结构示例：`{platform, room_id, user_id, username, message_type, content, metadata}`，阶段一主要使用 `message_type="super_chat"`。
2. **对话引擎适配**
   - 订阅 `live.chat` 事件，触发智能体响应流程，并输出语音、虚拟形象动画等内部动作，无需出站聊天。阶段一仅处理醒目留言消息，阶段二再解锁普通弹幕。
3. **醒目留言优先级**
   - 对 SC 事件打上高优先级标签，附带 `amount`、`duration` 等元数据，可选地触发记忆服务更新（例如感谢支持者）。
4. **回调接收（可选）**
   - 部署轻量 FastAPI 服务接收 Bilibili 回调，基于事件 `id` 去重并确认交付。
5. **监控与韧性**
   - 指标：连接在线率、消息吞吐、处理延迟。
   - 自动重连并使用指数退避。
   - 心跳监测：超过 60 秒未收到消息时重启 worker。

## 8. 安全与合规注意事项

- 遵守 Bilibili 自动化政策，为机器人准备独立的认证账号。
- 对官方 API 的出站请求进行速率控制，避免被判定为滥用或垃圾行为。
- 在 `.env`/密钥管理中保存凭证，禁止将令牌写入代码库。
- 回调接口需使用共享密钥验证 `X-Bili-Signature`。
- 尽量减少记录可识别个人信息（PII），并遵循数据保护法规。

## 8.1 配置与密钥管理

| 环境变量 | 说明 | 默认值/示例 |
| -------- | ---- | ----------- |
| `ENABLE_BILIBILI` | 是否启用 Bilibili 弹幕采集 | `false` |
| `BILI_ROOM_ID` | 目标直播间房间号（必填） | `123456` |
| `BILI_ACCESS_TOKEN` | WebSocket 接入令牌，来自开放平台 `auth_body.key` | — |
| `BILI_UID` | 机器人或游客 UID，没绑定账号时填 `0` | `0` |
| `BILI_HEARTBEAT_INTERVAL` | WebSocket 心跳间隔（秒） | `30` |
| `BILI_WEBSOCKET_URL` | 弹幕 WebSocket 地址 | `wss://broadcastlv.chat.bilibili.com/sub` |
| `BILI_PROTO_VERSION` | 协议版本（2=zlib，3=brotli） | `3` |
| `BILI_RECONNECT_INITIAL` / `BILI_RECONNECT_MAX` | 重连退避窗口（秒） | `5.0` / `60.0` |
| `BILI_APP_ID`/`BILI_APP_KEY`/`BILI_APP_SECRET` | 开放平台凭证（可选，但用于拉取 `auth_body`） | — |
| `BILI_ANCHOR_CODE` | 主播身份码，用于 `app/start` 握手 | — |
| `BILI_APP_HEARTBEAT_INTERVAL` | 开放平台心跳间隔（秒） | `20` |
| `BILI_API_BASE` | 开放平台 API 基址 | `https://live-open.biliapi.com` |
| `BILI_CREDENTIALS_PATH` | 以 JSON 存储的凭证文件路径，优先级高于单独环境变量 | `/run/secrets/bili_credentials.json` |

### 安全建议

1. 在本地开发使用 `.env` 文件，生产环境改用容器秘密卷或云密钥管理服务（如 AWS Secrets Manager / GCP Secret Manager）。
2. 若使用文件挂载凭证，推荐以 JSON 格式保存，并通过 `BILI_CREDENTIALS_PATH` 指向只读路径。
3. 定期轮换访问令牌，尤其在检测到登录态刷新或平台通知时立刻更新。
4. 仅在授权的运维流水线中注入环境变量，避免在日志、监控或错误信息中输出原始凭证内容。

### 事件规范化 Schema

| 字段 | 类型 | 说明 |
| ---- | ---- | ---- |
| `platform` | `str` | 来源平台标识，Bilibili 固定为 `"bilibili"` |
| `room_id` | `str` | 直播间房间号 |
| `user_id` | `str \| None` | 触发事件的用户 ID，游客时为 `None` |
| `username` | `str \| None` | 用户昵称 |
| `message_type` | `"chat" \| "super_chat" \| "gift" \| ...` | 统一的事件类型枚举 |
| `content` | `str` | 文本内容或礼物名称等主体描述 |
| `metadata` | `dict` | 平台特有字段（如价格、粉丝牌信息、礼物数量） |
| `priority` | `int` | 调度优先级，自动根据类型及元数据计算（Super Chat > 礼物 > 普通弹幕） |

### 醒目留言致谢策略

- Dialog Engine 默认根据 `LIVE_CHAT_THANK_TEMPLATE` 对每条醒目留言生成致谢语，并通过 Redis Set (`LIVE_CHAT_THANK_PREFIX`) 去重，避免重复播报。
- 支持设置最低金额阈值 (`LIVE_CHAT_THANK_MIN_AMOUNT`) 以及是否继续调用 LLM 衍生回复 (`LIVE_CHAT_SUPERCHAT_USE_LLM`)。
- 致谢语及原始元数据会异步写入 LTM Outbox（`LtmLiveSuperChat` 事件），便于记忆服务持久化醒目留言记录。

## 9. 拓展其他平台

| 平台 | 聊天接口 | 付费消息接口 | 备注 |
| ---- | -------- | ------------ | ---- |
| YouTube Live | 官方 LiveChat REST 轮询 | `superChatEvents` 端点 | 需要 OAuth 2.0，存在轮询频率限制。 |
| Twitch | IRC（聊天） | EventSub（cheer、订阅等） | 支持 Webhook 或 WebSocket EventSub。 |
| Kick | 非官方 WebSocket | 付费功能文档有限 | 在完成 Bilibili 与 YouTube 后评估。 |

通用做法：定义 `LiveEvent` 抽象，并针对平台实现对应的连接器。

## 10. 路线图

1. **第 1 周**——获取 Bilibili 开发者凭证，完善密钥文档，针对醒目留言建立 WebSocket 客户端原型并完成 SC 数据解析。
2. **第 2 周**——将 SC 事件集成到 `input-handler` 服务，发布标准化 SC 消息到 Redis，并新增对话引擎消费者完成端到端播报。
3. **第 3 周**——完善醒目留言优先级、记忆服务更新与官方回调冗余，完成 SC MVP。
4. **第 4 周**——在预演直播中验证 SC 流程，补充监控看板并完成合规审查，同时制定普通弹幕扩展方案。
5. **第 5 周及以后**——按计划扩展普通弹幕（`DANMU_MSG`）处理，随后探索 YouTube/Twitch 等多平台接口。

## 11. 风险与缓解

| 风险 | 影响 | 缓解措施 |
| ---- | ---- | -------- |
| 令牌失效/验证码 | 直播中断 | 搭建会话刷新机制并在鉴权失败时告警。 |
| WebSocket 断连 | 漏收事件 | 自动重连并结合回调冗余。 |
| 平台政策变动 | 功能受限 | 持续关注官方公告，并保留屏幕叠加等兜底方案。 |
| 高并发突发 | 对话引擎积压 | 实施消息优先级和速率限制。 |

## 12. 结论

通过弹幕 WebSocket 与官方回调的组合，并将回应限制在语音、虚拟形象和叠加层范围内，可以实现与 Bilibili 醒目留言的高优先级集成，并为后续扩展到普通弹幕奠定基础。重点在于稳定的连接管理、醒目留言优先处理以及合规要求。本路线图预计在一个月内完成 SC MVP，随后平滑拓展到其他消息类型与直播平台。
