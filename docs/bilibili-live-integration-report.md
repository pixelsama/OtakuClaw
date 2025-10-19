# Bilibili Live Integration Feasibility Report

## 1. Objective

Evaluate technical options for connecting the Free-Agent Vtuber system to live-streaming chat and Super Chat ("Super Chat" = Paid highlighted messages, a.k.a. 醒目留言/SC) on Bilibili (priority) and outline next steps for extending to other platforms.

## 2. Bilibili Live Ecosystem Overview

Bilibili exposes multiple mechanisms for accessing live room events:

- **Official Open Platform (直播开放平台)** – offers REST APIs for room management and server push callbacks. Requires developer registration, application approval, and room ownership binding. Callback events can deliver gift, guard, and SC notifications, but chat (普通弹幕) still requires WebSocket Danmaku connection.
- **Danmaku WebSocket Gateways** – public endpoints (e.g., `wss://broadcastlv.chat.bilibili.com:443/sub`) accept authenticated connections to join a room's danmaku stream. Messages include chat, gifts, Super Chats, guard, enter room, etc. Requires periodically sending heartbeats and decoding binary packets.
- **Third-party relay services** – community projects expose simplified HTTP/WebSocket APIs but have ToS and stability risks; avoid for production.

A complete integration must combine Danmaku WebSocket reception with authenticated REST interactions (e.g., replying with bot messages or triggering actions via the official APIs where possible).

## 3. Access Requirements & Constraints

| Item | Details | Notes |
| ---- | ------- | ----- |
| Developer account | Bilibili Open Platform account, verified identity, approved application. | Needed for official REST & callback APIs. |
| Room binding | The livestream room must be bound to the developer application. | For Free-Agent Vtuber, coordinate with the streamer account owner. |
| Authentication | REST APIs use `app_id`, `app_secret`, and signed requests (HMAC SHA-256). WebSocket danmaku requires `authBody` containing room ID, user ID (`uid`), and `key`. |
| Rate limits | Documented per endpoint; typically `QPS <= 1` for management APIs. | WebSocket is push-based, so ensure consumer handles bursty traffic. |
| Terms of Service | Bot interactions must respect platform policies (no spam, unauthorized automation). | Secure consent from channel owner. |

## 4. Danmaku WebSocket Integration

1. **Handshake**
   - Connect to `wss://broadcastlv.chat.bilibili.com:443/sub`.
   - Send auth packet with fields: `uid` (0 for guest or bot account ID), `roomid`, `protover`, `platform`, `clientver`, `key` (token). Official tokens can be obtained from REST API `app-start` or by logging in via Bilibili account cookies.
2. **Heartbeat**
   - Send heartbeat packet (`op=2`) every 30s to keep connection alive.
3. **Message decoding**
   - Packets are binary with header (16 bytes) and payload. Payload may be JSON or compressed (zlib/brotli). Need parser to handle `cmd` values:
     - `DANMU_MSG`: normal chat.
     - `SUPER_CHAT_MESSAGE` & `SUPER_CHAT_MESSAGE_JPN`: SC events.
     - `SEND_GIFT`, `GUARD_BUY`, etc.
4. **Scaling**
   - Use async consumers (e.g., `asyncio` + `websockets` or `aiohttp`). For high volume, shard by room or spawn multiple workers with shared message queue (Redis / RabbitMQ).
5. **Security**
   - Store auth tokens in secrets manager. Rotate if using account cookies.

### Existing Libraries
- Python: `bilibili_api`, `biliup`, `danmaku` community libs; may need adaptation for production reliability.
- Node.js: `bilibili-live-ws`, `blive-message-listener`. Could wrap via gateway service if needed.

## 5. Receiving Super Chats

SC events arrive through both WebSocket and official callbacks:

- **WebSocket** `SUPER_CHAT_MESSAGE` payload includes user info, price, message, background color, duration. Parse to internal event schema. Example fields: `price`, `message`, `background_color`, `start_time`, `end_time`.
- **Open Platform Callback**: configure callback URL to receive POST JSON for `superChatMessage`. This provides reliable delivery even if WebSocket drops, but only available after application approval.

Recommendation: consume via WebSocket for low latency and use callback as redundancy (acknowledge events, deduplicate via SC `id`).

## 6. Sending Chat Messages / Responses

Bilibili currently lacks an official public API for automated chat sending. Options:

1. **Browser automation / Headless client** – log into a bot account and send chat via headless browser (e.g., Playwright). High maintenance and risk of captcha.
2. **Reverse-engineered APIs** – community endpoints exist (`send_msg`), but may violate ToS and require human verification tokens.
3. **Use streamer tools** – integrate with OBS/Streamlabs to render agent responses on-screen instead of in chat.

Given policy risk, prefer on-screen rendering or manual moderation tools rather than automatic chat posting, unless official support becomes available.

## 7. Integration Architecture Proposal

```
[Danmaku WS Client] --events--> [Gateway Python Service] --Redis--> [Dialog Engine]
                                                 \
                                                  --> [Persistence/Analytics]
```

1. **Input Handler Extension**
   - Build a new worker (`services/input-handler-python`) module `bilibili_live.py` to manage WebSocket connection, parse events, and publish normalized messages to Redis topic (`live.chat`).
   - Normalize payload structure: `{platform, room_id, user_id, username, message_type, content, metadata}`.
2. **Dialog Engine Adaptation**
   - Add handler to subscribe to `live.chat` events, trigger agent response pipeline, and emit actions (e.g., TTS + avatar animation).
3. **SC Prioritization**
   - Mark SC events with high priority. Provide metadata `amount`, `duration`. Optionally trigger `memory` service updates (e.g., thanking supporter).
4. **Callback Receiver (optional)**
   - Deploy minimal FastAPI service to accept Bilibili callbacks for SC/gift reliability. Write dedup logic based on `id`.
5. **Monitoring & Resilience**
   - Metrics: connection uptime, message throughput, processing latency.
   - Auto-reconnect with exponential backoff.
   - Heartbeat watch: restart worker if no messages for >60s.

## 8. Security & Compliance Considerations

- Follow Bilibili automation policy; maintain separate bot account with verified phone/email.
- Rate-limit outbound requests; avoid spamming chat.
- Store credentials in `.env` / secrets vault; never commit tokens.
- Ensure callback endpoint validates signatures (`X-Bili-Signature`) using shared secret.
- Log personally identifiable information (PII) sparingly; comply with data protection laws.

## 9. Extension to Other Platforms

| Platform | Chat API | Paid Message API | Notes |
| -------- | -------- | ---------------- | ----- |
| YouTube Live | Official LiveChat API (polling via REST) | `superChatEvents` endpoint | Requires OAuth 2.0; rate-limited polling. |
| Twitch | IRC (chat) | EventSub (channel.cheer, subscriptions) | Webhook or WebSocket EventSub. |
| Kick | Unofficial WebSocket | Paid features limited documentation | Evaluate after Bilibili & YouTube. |

Common abstraction: define `LiveEvent` schema and platform-specific connectors.

## 10. Roadmap

1. **Week 1** – Obtain Bilibili developer credentials, document secrets, prototype Python WebSocket client (manual run).
2. **Week 2** – Integrate with `input-handler` service, publish normalized events to Redis, add Dialog Engine consumer.
3. **Week 3** – Implement SC prioritization, memory updates, and callback redundancy.
4. **Week 4** – QA in staging stream, add monitoring dashboards, review compliance.
5. **Future** – Explore YouTube/Twitch connectors, unify under multi-platform interface.

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Token invalidation / captchas | Stream disruption | Maintain session refresh service; alert on auth errors. |
| WebSocket disconnects | Missed events | Auto-reconnect + callback redundancy. |
| Policy changes | Loss of functionality | Monitor Bilibili announcements; keep fallback (on-screen messages). |
| High traffic bursts | Backlog in dialog engine | Implement message prioritization & rate limiting. |

## 12. Conclusion

Integration with Bilibili live chat and Super Chat is feasible using the Danmaku WebSocket combined with official callbacks. Focus on robust connection management, priority handling for SC events, and compliance with platform policies. The outlined roadmap provides concrete steps to deliver an MVP within one month, after which the architecture can expand to other platforms with similar event abstractions.
