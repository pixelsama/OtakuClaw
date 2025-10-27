# Bilibili Live Runbook

本手册汇总 Bilibili 弹幕接入在生产环境的常见运维动作。

## 监控指标

服务 `services/input-handler-python` 暴露 `/metrics` Prometheus 端点，关键指标如下：

- `bilibili_connection_status{room_id="..."}`：当前 WebSocket 在线状态（1=已连接，0=断开）。
- `bilibili_events_total{room_id, message_type}`：按类型统计的事件吞吐量，可结合 `super_chat`、`chat` 关注突发流量。
- `bilibili_watchdog_trigger_total{room_id}`：看门狗触发重连的次数，一旦上升需排查网络或平台侧异常。
- `bilibili_reconnect_total{room_id}`：重连次数，配合时间窗口判断是否进入异常抖动。

建议在 Grafana 中绘制连接状态、事件吞吐和看门狗次数的折线图，并设置告警阈值。

## 看门狗与告警

- `BILI_WATCHDOG_SECONDS` 控制看门狗超时（默认 60s）。若长时间无心跳或弹幕会触发重连并递增 `bilibili_watchdog_trigger_total`。
- 若配置 `BILI_ALERT_WEBHOOK`，在连续 `BILI_ALERT_THRESHOLD` 次连接失败或看门狗触发时会向该 Webhook 发送告警，告警之间至少间隔 `BILI_ALERT_COOLDOWN_SECONDS`（默认 5 分钟）。
- 推荐将 Webhook 接入 Slack / Feishu / PagerDuty 等渠道。

## 常见操作

### 手动重启弹幕客户端

1. 登录到运行 input-handler 的主机。
2. 设置 `ENABLE_BILIBILI=true` 并确认 `.env` 中 `BILI_ROOM_ID`、凭证等正确。
3. 通过 `docker compose restart input-handler` 或对应容器编排命令重启服务。
4. 观察 `/metrics` 中 `bilibili_connection_status` 是否恢复为 1。

### 验证回调链路

1. 确认 `bilibili-callback` 服务已在公网可访问（ngrok / 反向代理）。
2. 向 `/bilibili/callback` 发送带签名的测试事件（可利用 `tests/unit/test_bilibili_callback.py` 中的签名逻辑）。
3. 检查 Redis `live.chat` 通道是否收到对应事件，并确认 Dialog Engine 侧有响应。

### 故障排查

- **频繁重连**：查看 `/metrics` 的 `bilibili_reconnect_total` 是否快速累加，并结合日志排查网络、防火墙或凭证是否过期。
- **看门狗告警**：检查 Bilibili 平台状态、WebSocket 是否长时间无推送，可使用官方直播工具验证房间事件。
- **Webhook 失败**：确认 `BILI_ALERT_WEBHOOK` 目标可访问且返回 2xx，必要时在日志中搜索 `Bilibili alert webhook failed`。

## 变更前检查清单

- 发布前确认：`BILI_WATCHDOG_SECONDS`、`BILI_ALERT_WEBHOOK` 等参数已在生产环境配置。
- 更新后通过 `/metrics` 以及实际弹幕事件（可用测试房间）验证链路。
- 若调整模板/告警阈值，记得告知值班同学并更新本 Runbook。

