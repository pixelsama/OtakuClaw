from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import random
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx
import hmac
import websockets
from websockets import WebSocketClientProtocol
from websockets.exceptions import ConnectionClosed

from config.bilibili_credentials import (
    CredentialError,
    load_bilibili_credentials,
)
from .bilibili_normalizer import normalize_bilibili_message
from .bilibili_protocol import BilibiliOperation, BilibiliProtocolError, parse_messages
from publisher import RedisLiveEventPublisher
from prometheus_client import Counter, Gauge

logger = logging.getLogger(__name__)

_CONNECTION_STATUS = Gauge(
    "bilibili_connection_status",
    "Connection state for Bilibili danmaku client (1=connected,0=disconnected)",
    ["room_id"],
)
_RECONNECT_COUNTER = Counter(
    "bilibili_reconnect_total",
    "Number of reconnect attempts for Bilibili danmaku client",
    ["room_id"],
)
_EVENT_COUNTER = Counter(
    "bilibili_events_total",
    "Total Bilibili events processed",
    ["room_id", "message_type"],
)
_WATCHDOG_COUNTER = Counter(
    "bilibili_watchdog_trigger_total",
    "Times the Bilibili watchdog forced a reconnect",
    ["room_id"],
)
_LAST_EVENT_GAUGE = Gauge(
    "bilibili_last_event_timestamp",
    "Unix timestamp of the last Bilibili event received",
    ["room_id"],
)


@dataclass(slots=True)
class BilibiliDanmakuConfig:
    room_id: int
    uid: int = 0
    access_token: Optional[str] = None
    websocket_endpoint: str = "wss://broadcastlv.chat.bilibili.com/sub"
    heartbeat_interval: int = 30
    reconnect_initial: float = 5.0
    reconnect_max: float = 60.0
    proto_version: int = 3
    platform: str = "web"
    client_version: str = "2.8.10"
    http_timeout: float = 10.0
    app_id: Optional[int] = None
    app_key: Optional[str] = None
    app_secret: Optional[str] = None
    anchor_code: Optional[str] = None
    app_heartbeat_interval: int = 20
    api_base: str = "https://live-open.biliapi.com"
    watchdog_timeout: float = 60.0
    alert_webhook: Optional[str] = None
    alert_threshold: int = 3
    alert_cooldown_seconds: int = 300

    @classmethod
    def from_env(cls) -> "BilibiliDanmakuConfig":
        def _get_int(name: str) -> Optional[int]:
            raw = os.getenv(name)
            if not raw:
                return None
            try:
                return int(raw)
            except ValueError:
                logger.warning("Invalid integer for %s: %s", name, raw)
                return None

        def _get_float(name: str, default: float) -> float:
            raw = os.getenv(name)
            if not raw:
                return default
            try:
                return float(raw)
            except ValueError:
                logger.warning("Invalid float for %s: %s", name, raw)
                return default

        try:
            creds = load_bilibili_credentials()
        except CredentialError as exc:
            logger.warning("Failed to load Bilibili credentials: %s", exc)
            creds = None

        room_id = _get_int("BILI_ROOM_ID") or 0
        uid = _get_int("BILI_UID") or 0
        access_token = os.getenv("BILI_ACCESS_TOKEN") or (creds.access_token if creds else None)
        heartbeat = _get_int("BILI_HEARTBEAT_INTERVAL") or 30
        websocket_endpoint = os.getenv("BILI_WEBSOCKET_URL") or cls.websocket_endpoint  # type: ignore[attr-defined]
        reconnect_initial = _get_float("BILI_RECONNECT_INITIAL", 5.0)
        reconnect_max = _get_float("BILI_RECONNECT_MAX", 60.0)
        proto_version = _get_int("BILI_PROTO_VERSION") or 3
        platform = os.getenv("BILI_PLATFORM", "web")
        client_version = os.getenv("BILI_CLIENT_VERSION", "2.8.10")
        http_timeout = _get_float("BILI_HTTP_TIMEOUT", 10.0)
        app_id = _get_int("BILI_APP_ID") or (creds.app_id if creds else None)
        app_key = os.getenv("BILI_APP_KEY") or (creds.app_key if creds else None)
        app_secret = os.getenv("BILI_APP_SECRET") or (creds.app_secret if creds else None)
        anchor_code = os.getenv("BILI_ANCHOR_CODE") or (creds.anchor_code if creds else None)
        app_heartbeat_interval = _get_int("BILI_APP_HEARTBEAT_INTERVAL") or 20
        api_base = os.getenv("BILI_API_BASE", "https://live-open.biliapi.com")
        watchdog_timeout = _get_float("BILI_WATCHDOG_SECONDS", 60.0)
        alert_webhook = os.getenv("BILI_ALERT_WEBHOOK")
        alert_threshold = _get_int("BILI_ALERT_THRESHOLD") or 3
        alert_cooldown = _get_int("BILI_ALERT_COOLDOWN_SECONDS") or 300

        return cls(
            room_id=room_id,
            uid=uid,
            access_token=access_token,
            websocket_endpoint=websocket_endpoint,
            heartbeat_interval=heartbeat,
            reconnect_initial=reconnect_initial,
            reconnect_max=reconnect_max,
            proto_version=proto_version,
            platform=platform,
            client_version=client_version,
            http_timeout=http_timeout,
            app_id=app_id,
            app_key=app_key,
            app_secret=app_secret,
            anchor_code=anchor_code,
            app_heartbeat_interval=app_heartbeat_interval,
            api_base=api_base,
            watchdog_timeout=watchdog_timeout,
            alert_webhook=alert_webhook,
            alert_threshold=alert_threshold,
            alert_cooldown_seconds=alert_cooldown,
        )

    @property
    def use_open_api(self) -> bool:
        return all([self.app_id, self.app_key, self.app_secret, self.anchor_code])


class BilibiliDanmakuClient:
    def __init__(
        self,
        config: BilibiliDanmakuConfig,
        publisher: RedisLiveEventPublisher,
    ) -> None:
        self._config = config
        self._publisher = publisher
        self._running = False
        self._http_client: Optional[httpx.AsyncClient] = None
        self._game_id: Optional[str] = None
        self._task: Optional[asyncio.Task[None]] = None
        self._current_websocket: Optional[WebSocketClientProtocol] = None
        self._last_event_ts: float = time.monotonic()
        self._watchdog_task: Optional[asyncio.Task[None]] = None
        self._metrics_labels = {"room_id": str(config.room_id)}
        self._consecutive_failures = 0
        self._last_alert_ts: float = 0.0

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        _CONNECTION_STATUS.labels(**self._metrics_labels).set(0)
        _LAST_EVENT_GAUGE.labels(**self._metrics_labels).set(time.time())
        self._task = asyncio.create_task(self._run_loop(), name="bilibili-danmaku-loop")

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        if self._config.use_open_api and self._game_id:
            with contextlib.suppress(Exception):
                await self._signed_post("/v2/app/end", {"game_id": self._game_id, "app_id": self._config.app_id})
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None
        _CONNECTION_STATUS.labels(**self._metrics_labels).set(0)

    async def _run_loop(self) -> None:
        backoff = self._config.reconnect_initial
        while self._running:
            labels = self._metrics_labels
            _RECONNECT_COUNTER.labels(**labels).inc()
            try:
                await self._connect_once()
                self._consecutive_failures = 0
                backoff = self._config.reconnect_initial
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.exception("Bilibili client error: %s", exc)
                self._consecutive_failures += 1
                self._schedule_alert(f"connect_failure:{exc.__class__.__name__}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, self._config.reconnect_max)

    async def _connect_once(self) -> None:
        ws_url, auth_body = await self._prepare_connection()
        logger.info("Connecting to Bilibili danmaku at %s", ws_url)
        async with websockets.connect(
            ws_url,
            ping_interval=None,
            max_queue=None,
            compression=None,
        ) as websocket:
            self._current_websocket = websocket
            labels = self._metrics_labels
            _CONNECTION_STATUS.labels(**labels).set(1)
            self._last_event_ts = time.monotonic()
            _LAST_EVENT_GAUGE.labels(**labels).set(time.time())
            try:
                await self._authenticate(websocket, auth_body)
                await self._consume(websocket)
            finally:
                _CONNECTION_STATUS.labels(**labels).set(0)
                self._current_websocket = None

    async def _prepare_connection(self) -> Tuple[str, str]:
        if self._config.use_open_api:
            return await self._start_app_session()
        handshake = {
            "uid": self._config.uid,
            "roomid": self._config.room_id,
            "protover": self._config.proto_version,
            "platform": self._config.platform,
            "clientver": self._config.client_version,
        }
        if self._config.access_token:
            handshake["key"] = self._config.access_token
        return self._config.websocket_endpoint, json.dumps(handshake, ensure_ascii=False)

    async def _authenticate(self, websocket: WebSocketClientProtocol, auth_body: str) -> None:
        await websocket.send(self._pack(auth_body.encode("utf-8"), BilibiliOperation.AUTH))
        response = await websocket.recv()
        if isinstance(response, str):
            response = response.encode("utf-8")
        messages = parse_messages(response)
        success = any(msg.get("cmd") == "OP_8" for msg in messages)
        if not success:
            raise RuntimeError("Bilibili auth failed")
        logger.info("Bilibili auth success")
        self._last_event_ts = time.monotonic()
        _LAST_EVENT_GAUGE.labels(**self._metrics_labels).set(time.time())

    async def _consume(self, websocket: WebSocketClientProtocol) -> None:
        heartbeat_task = asyncio.create_task(
            self._heartbeat_loop(websocket), name="bilibili-heartbeat"
        )
        recv_task = asyncio.create_task(self._receiver_loop(websocket), name="bilibili-recv")
        app_heartbeat_task = None
        if self._config.use_open_api and self._game_id:
            app_heartbeat_task = asyncio.create_task(
                self._app_heartbeat_loop(), name="bilibili-app-heartbeat"
            )

        tasks = [heartbeat_task, recv_task]
        if app_heartbeat_task:
            tasks.append(app_heartbeat_task)
        watchdog_task = None
        if self._config.watchdog_timeout > 0:
            watchdog_task = asyncio.create_task(self._watchdog_loop(), name="bilibili-watchdog")
            tasks.append(watchdog_task)
            self._watchdog_task = watchdog_task
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_EXCEPTION)
        for task in pending:
            task.cancel()
        for task in done:
            try:
                task.result()
            except asyncio.CancelledError:
                pass
        self._watchdog_task = None

    async def _heartbeat_loop(self, websocket: WebSocketClientProtocol) -> None:
        interval = max(self._config.heartbeat_interval, 5)
        try:
            while True:
                await asyncio.sleep(interval)
                await websocket.send(self._pack(b"", BilibiliOperation.HEARTBEAT))
        except asyncio.CancelledError:
            raise
        except ConnectionClosed:
            logger.info("Bilibili heartbeat stopped: connection closed")
        except Exception as exc:
            logger.warning("Bilibili heartbeat error: %s", exc)

    async def _receiver_loop(self, websocket: WebSocketClientProtocol) -> None:
        try:
            async for message in websocket:
                if isinstance(message, str):
                    payload = message.encode("utf-8")
                else:
                    payload = message
                try:
                    decoded_messages = parse_messages(payload)
                except BilibiliProtocolError as exc:
                    logger.debug("Failed to parse danmaku packet: %s", exc)
                    continue
                for msg in decoded_messages:
                    await self._handle_message(msg)
        except asyncio.CancelledError:
            raise
        except ConnectionClosed:
            logger.info("Bilibili connection closed by server")
        except Exception as exc:
            logger.exception("Bilibili receiver loop error: %s", exc)
            raise

    async def _handle_message(self, message: Dict[str, Any]) -> None:
        self._last_event_ts = time.monotonic()
        _LAST_EVENT_GAUGE.labels(**self._metrics_labels).set(time.time())
        cmd = message.get("cmd")
        if cmd == "HEARTBEAT_REPLY":
            logger.debug("Heartbeat reply: %s", message.get("value"))
            return

        event = normalize_bilibili_message(message, self._config.room_id)
        if not event:
            return
        _EVENT_COUNTER.labels(room_id=self._metrics_labels["room_id"], message_type=event.message_type).inc()
        await self._publisher.publish(event)

    async def _start_app_session(self) -> Tuple[str, str]:
        payload = {"code": self._config.anchor_code, "app_id": self._config.app_id}
        data = await self._signed_post("/v2/app/start", payload)
        if data.get("code") != 0:
            raise RuntimeError(f"Bilibili app/start failed: {data}")
        inner = data["data"]
        self._game_id = str(inner["game_info"]["game_id"])
        ws_info = inner["websocket_info"]
        auth_body = ws_info["auth_body"]
        return ws_info["wss_link"][0], auth_body

    async def _app_heartbeat_loop(self) -> None:
        assert self._game_id
        interval = max(self._config.app_heartbeat_interval, 10)
        try:
            while True:
                await asyncio.sleep(interval)
                await self._signed_post("/v2/app/heartbeat", {"game_id": self._game_id})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("Bilibili app heartbeat error: %s", exc)

    async def _watchdog_loop(self) -> None:
        timeout = float(self._config.watchdog_timeout)
        if timeout <= 0:
            return
        interval = max(timeout / 2.0, 1.0)
        labels = self._metrics_labels
        try:
            while True:
                await asyncio.sleep(interval)
                if not self._running:
                    return
                elapsed = time.monotonic() - self._last_event_ts
                if elapsed >= timeout:
                    _WATCHDOG_COUNTER.labels(**labels).inc()
                    logger.warning(
                        "Bilibili watchdog triggered after %.1fs without events (room %s)",
                        elapsed,
                        self._config.room_id,
                    )
                    self._schedule_alert("watchdog_timeout", force=True)
                    await self._trigger_reconnect("watchdog_timeout")
                    self._last_event_ts = time.monotonic()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Bilibili watchdog loop failed")

    async def _trigger_reconnect(self, reason: str) -> None:
        websocket = self._current_websocket
        if websocket is None:
            return
        self._current_websocket = None
        try:
            await websocket.close(code=4000, reason=reason)
        except Exception:
            pass

    def _schedule_alert(self, reason: str, *, force: bool = False) -> None:
        webhook = self._config.alert_webhook
        if not webhook:
            return
        threshold = max(1, self._config.alert_threshold)
        if not force and self._consecutive_failures < threshold:
            return
        now = time.time()
        cooldown = max(0, self._config.alert_cooldown_seconds)
        if now - self._last_alert_ts < cooldown:
            return
        self._last_alert_ts = now
        asyncio.create_task(self._send_alert(reason))

    async def _send_alert(self, reason: str) -> None:
        webhook = self._config.alert_webhook
        if not webhook:
            return
        payload = {
            "reason": reason,
            "room_id": self._config.room_id,
            "failures": self._consecutive_failures,
        }
        if reason == "watchdog_timeout":
            payload["elapsed_seconds"] = self._config.watchdog_timeout
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(webhook, json=payload)
        except Exception:
            logger.warning("Bilibili alert webhook failed", exc_info=True)

    async def _ensure_http_client(self) -> httpx.AsyncClient:
        if self._http_client:
            return self._http_client
        timeout = httpx.Timeout(self._config.http_timeout)
        self._http_client = httpx.AsyncClient(
            base_url=self._config.api_base,
            timeout=timeout,
        )
        return self._http_client

    async def _signed_post(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not self._config.use_open_api:
            raise RuntimeError("Bilibili open API credentials not configured")
        client = await self._ensure_http_client()
        payload_str = json.dumps(payload, separators=(",", ":"))
        headers = self._make_signed_headers(payload_str)
        response = await client.post(path, content=payload_str, headers=headers)
        response.raise_for_status()
        return response.json()

    def _make_signed_headers(self, payload: str) -> Dict[str, str]:
        if not self._config.use_open_api:
            raise RuntimeError("Bilibili open API credentials not configured")
        timestamp = str(int(time.time()))
        nonce = f"{timestamp}{random.randint(1000, 9999)}"
        md5_hash = hashlib.md5(payload.encode("utf-8")).hexdigest()
        header_map = {
            "x-bili-timestamp": timestamp,
            "x-bili-signature-method": "HMAC-SHA256",
            "x-bili-signature-nonce": nonce,
            "x-bili-accesskeyid": str(self._config.app_key),
            "x-bili-signature-version": "1.0",
            "x-bili-content-md5": md5_hash,
        }
        canonical = "\n".join(f"{key}:{header_map[key]}" for key in sorted(header_map))
        signature = hmac.new(
            str(self._config.app_secret).encode("utf-8"),
            canonical.encode("utf-8"),
            digestmod="sha256",
        ).hexdigest()
        header_map["Authorization"] = signature
        header_map["Content-Type"] = "application/json"
        header_map["Accept"] = "application/json"
        return header_map

    def _pack(self, body: bytes, operation: BilibiliOperation) -> bytes:
        header_len = 16
        packet_len = header_len + len(body)
        return (
            packet_len.to_bytes(4, "big")
            + header_len.to_bytes(2, "big")
            + (1).to_bytes(2, "big")
            + int(operation).to_bytes(4, "big")
            + (1).to_bytes(4, "big")
            + body
        )
