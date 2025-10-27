# Bilibili 集成实地测试流程

本文档给出从本地仿真到真实直播间演练的完整测试步骤，帮助在发布前验证接入链路的稳定性。

## 1. 本地自测（无需真实房间）

1. 确认 `.env` 中 `ENABLE_BILIBILI=false`，运行最小依赖栈：
   ```bash
   docker compose -f docker-compose.dev.yml up -d redis dialog-engine input-handler
   ```
2. 在 `services/input-handler-python` 目录执行单元/集成测试，确保协议解析、回调签名、/metrics 暴露正常：
   ```bash
   source .venv/bin/activate
   PYTHONPATH=../../ pytest -q
   ```
3. 利用内置集成测试验证 WebSocket 流程（假服务器会推送示例弹幕）：
   ```bash
   PYTHONPATH=../../ pytest tests/integration/test_bilibili_client.py -q
   ```
4. 手动检验回调链路，可借助 `tests/unit/test_bilibili_callback.py` 中的 `_sign_payload` 生成签名：
   ```python
   python - <<'PY'
   import json, hmac, hashlib, time
   payload = {
       "event": "superChatMessage",
       "room_id": 1234,
       "data": {"id": "sc-test", "message": "本地测试", "price": 30, "user_info": {"uid": 42, "uname": "Tester"}},
   }
   body = json.dumps(payload, ensure_ascii=False).encode()
   headers = {
       "x-bili-timestamp": str(int(time.time())),
       "x-bili-signature-method": "HMAC-SHA256",
       "x-bili-signature-nonce": "demo-nonce",
       "x-bili-accesskeyid": "demo-key",
       "x-bili-signature-version": "1.0",
       "x-bili-content-md5": hashlib.md5(body).hexdigest(),
   }
   signature = hmac.new(b"demo-secret", "\n".join(f"{k}:{headers[k]}" for k in sorted(headers)).encode(), hashlib.sha256).hexdigest()
   headers["authorization"] = signature
   print(json.dumps(payload, ensure_ascii=False))
   print(headers)
   PY
   curl -X POST http://localhost:8010/bilibili/callback \
        -H "Content-Type: application/json" \
        -H "authorization: <生成的签名>" \
        ... \
        -d '<payload>'
   ```
   在 Redis 订阅 `live.chat` 验证消息是否写入（`redis-cli SUBSCRIBE live.chat`）。

## 2. 模拟 WebSocket 事件

1. 运行工程目录下的 demo 脚本或自写 websockets server，推送录制的弹幕 JSON。
2. 将 `BILI_WEBSOCKET_URL` 指向本地服务器地址，打开 `ENABLE_BILIBILI=true`。
3. 观察 `/metrics` 中：
   - `bilibili_connection_status=1` 表示连接就绪；
   - `bilibili_events_total{message_type="super_chat"}` 随推送增加。
4. Dialog Engine 日志应该看到自动致谢/回复，Redis `live.chat` 亦有对应消息。

## 3. 真实凭证演练（测试房间）

1. 准备开放平台凭证及测试直播房间，填写 `.env`：
   ```env
   ENABLE_BILIBILI=true
   BILI_ROOM_ID=<测试房间号>
   BILI_ACCESS_TOKEN=<auth_body key 或游客为留空>
   BILI_APP_ID=<开放平台 app_id>
   BILI_APP_KEY=<access_key>
   BILI_APP_SECRET=<access_key_secret>
   BILI_ANCHOR_CODE=<主播身份码>
   ENABLE_BILIBILI_CONSUMER=true
   ```
2. 启动整套服务：
   ```bash
   docker compose up -d redis dialog-engine input-handler bilibili-callback
   ```
3. 若使用回调，需要通过公网暴露 callback 服务（ngrok / 反向代理），在开放平台配置回调 URL，与签名密钥保持一致。
4. 开播或发送测试弹幕后，验证：
   - `/metrics` 中 `bilibili_connection_status=1`；
   - `bilibili_events_total` 的 `super_chat` / `chat` 计数上升；
   - Dialog Engine 日志出现致谢文本或 LLM 回复；
   - `docs/bilibili-live-runbook.md` 中列举的告警/看门狗指标无异常。
5. 如需测试告警，可暂时拔掉网络或降低 `BILI_WATCHDOG_SECONDS`，确认 Webhook 能收到通知。

## 4. 发布前回归

- 再次运行 `pytest`，确保代码库未出现回归。
- 保持 `/metrics` 监控持续观测，尤其是 `bilibili_reconnect_total`、`bilibili_watchdog_trigger_total` 曲线。
- 记录测试结果，附上指标截图与 Redis/日志摘录，作为验收材料。
