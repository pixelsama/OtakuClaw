from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, Optional

import redis.asyncio as redis
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from publisher import RedisLiveEventPublisher
from live_events import LiveEvent, LiveMessageType

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(slots=True)
class CallbackSettings:
    redis_host: str = field(default_factory=lambda: os.getenv("REDIS_HOST", "localhost"))
    redis_port: int = field(default_factory=lambda: int(os.getenv("REDIS_PORT", "6379")))
    redis_channel: str = field(default_factory=lambda: os.getenv("LIVE_CHAT_CHANNEL", "live.chat"))
    secret: str = field(default_factory=lambda: os.getenv("BILI_CALLBACK_SECRET") or os.getenv("BILI_APP_SECRET", ""))
    app_key: Optional[str] = field(default_factory=lambda: os.getenv("BILI_CALLBACK_KEY") or os.getenv("BILI_APP_KEY"))
    dedupe_prefix: str = field(default_factory=lambda: os.getenv("BILI_CALLBACK_DEDUPE_PREFIX", "callback:bili"))
    dedupe_ttl: int = field(default_factory=lambda: int(os.getenv("BILI_CALLBACK_DEDUPE_TTL", "43200")))
    default_room_id: Optional[str] = field(default_factory=lambda: os.getenv("BILI_ROOM_ID"))
    allow_missing_signature: bool = field(default_factory=lambda: _env_bool("BILI_CALLBACK_ALLOW_UNSIGNED", False))

    def require_secret(self) -> None:
        if not self.secret:
            raise RuntimeError("BILI_CALLBACK_SECRET (or BILI_APP_SECRET) must be configured for callback verification")


settings = CallbackSettings()
_local_dedupe: set[str] = set()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        settings.require_secret()
    except RuntimeError as exc:
        logger.error("bili.callback.secret_missing: %s", exc)
        raise

    try:
        redis_client = redis.Redis(
            host=settings.redis_host,
            port=settings.redis_port,
            encoding="utf-8",
            decode_responses=True,
        )
        await redis_client.ping()
        publisher = RedisLiveEventPublisher(redis_client, channel=settings.redis_channel)
        app.state.redis_client = redis_client
        app.state.redis_publisher = publisher
        logger.info(
            "bili.callback.redis_connected",
            extra={"host": settings.redis_host, "port": settings.redis_port, "channel": settings.redis_channel},
        )
    except Exception as exc:  # pragma: no cover - connection errors logged
        logger.exception("bili.callback.redis_connect_failed", extra={"error": repr(exc)})
        raise
    try:
        yield
    finally:
        redis_client = getattr(app.state, "redis_client", None)
        if redis_client is not None:
            try:
                await redis_client.close()
            except Exception:  # pragma: no cover - best effort
                pass
            del app.state.redis_client
        if hasattr(app.state, "redis_publisher"):
            del app.state.redis_publisher
        _local_dedupe.clear()


app = FastAPI(title="Bilibili Callback Receiver", lifespan=lifespan)


def _compute_content_md5(body: bytes) -> str:
    return hashlib.md5(body).hexdigest()


def _build_canonical_headers(header_map: Dict[str, str]) -> str:
    return "\n".join(f"{key}:{header_map[key]}" for key in sorted(header_map))


def _verify_signature(headers: Dict[str, str], body: bytes) -> None:
    if settings.allow_missing_signature:
        return

    required_headers = [
        "x-bili-timestamp",
        "x-bili-signature-method",
        "x-bili-signature-nonce",
        "x-bili-accesskeyid",
        "x-bili-signature-version",
        "x-bili-content-md5",
    ]
    signature = headers.get("authorization") or headers.get("x-bili-signature")
    if not signature:
        raise HTTPException(status_code=403, detail="missing_signature")

    header_map: Dict[str, str] = {}
    for header in required_headers:
        value = headers.get(header)
        if value is None:
            raise HTTPException(status_code=403, detail=f"missing_header:{header}")
        header_map[header] = value

    computed_md5 = _compute_content_md5(body)
    if header_map["x-bili-content-md5"].lower() != computed_md5.lower():
        raise HTTPException(status_code=403, detail="md5_mismatch")

    canonical = _build_canonical_headers(header_map)
    expected = hmac.new(
        settings.secret.encode("utf-8"),
        canonical.encode("utf-8"),
        digestmod="sha256",
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="invalid_signature")

    if settings.app_key:
        header_key = header_map.get("x-bili-accesskeyid")
        if header_key and header_key != settings.app_key:
            raise HTTPException(status_code=403, detail="access_key_mismatch")


def _parse_event_type(payload: Dict[str, Any]) -> str:
    for key in ("event_type", "eventType", "event", "cmd", "type"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = payload.get("data")
    if isinstance(data, dict):
        nested_type = data.get("event_type") or data.get("cmd")
        if isinstance(nested_type, str):
            return nested_type
    return ""


def _extract_event_data(payload: Dict[str, Any], event_type: str) -> Dict[str, Any]:
    direct_data = payload.get("data")
    if isinstance(direct_data, dict):
        return direct_data
    if isinstance(direct_data, list) and direct_data and isinstance(direct_data[0], dict):
        return direct_data[0]

    key = event_type
    if key in payload and isinstance(payload[key], dict):
        return payload[key]
    return {}


def _first_non_empty(*values: Any) -> Optional[Any]:
    for val in values:
        if isinstance(val, str) and val.strip():
            return val
        if val not in (None, "", []):
            return val
    return None


def _normalize_super_chat(payload: Dict[str, Any], data: Dict[str, Any]) -> Optional[LiveEvent]:
    user_info = data.get("user_info") or data.get("user") or {}
    username = _first_non_empty(user_info.get("uname"), user_info.get("name"), data.get("uname"), data.get("username"))
    content = _first_non_empty(
        data.get("message"),
        data.get("message_jpn"),
        data.get("content"),
        payload.get("content"),
    ) or ""
    price = _first_non_empty(
        data.get("price"),
        data.get("rmb"),
        (data.get("price_info") or {}).get("price") if isinstance(data.get("price_info"), dict) else None,
        payload.get("price"),
    )
    room_id = _first_non_empty(
        payload.get("room_id"),
        data.get("room_id"),
        settings.default_room_id,
    )
    metadata = {
        "event": "superChatMessage",
        "super_chat_id": data.get("id") or payload.get("id"),
        "price": price,
        "rmb": data.get("rmb"),
        "currency": data.get("currency") or payload.get("currency"),
        "message": data.get("message"),
        "message_jpn": data.get("message_jpn"),
        "start_time": data.get("start_time") or data.get("startTime"),
        "end_time": data.get("end_time") or data.get("endTime"),
        "raw": data,
    }
    return LiveEvent(
        platform="bilibili",
        room_id=str(room_id or ""),
        user_id=str(_first_non_empty(user_info.get("uid"), data.get("uid"), payload.get("uid")) or ""),
        username=str(username) if username else None,
        message_type=LiveMessageType.SUPER_CHAT,
        content=str(content),
        metadata=metadata,
    )


def _normalize_gift(payload: Dict[str, Any], data: Dict[str, Any]) -> Optional[LiveEvent]:
    room_id = _first_non_empty(payload.get("room_id"), data.get("room_id"), settings.default_room_id)
    gift_name = _first_non_empty(data.get("gift_name"), data.get("giftName"), payload.get("gift_name")) or ""
    metadata = {
        "event": "gift",
        "gift_id": data.get("gift_id") or data.get("giftId"),
        "num": data.get("num") or data.get("gift_num"),
        "price": data.get("price"),
        "coin_type": data.get("coin_type"),
        "total_coin": data.get("total_coin"),
        "raw": data,
    }
    return LiveEvent(
        platform="bilibili",
        room_id=str(room_id or ""),
        user_id=str(_first_non_empty(data.get("uid"), payload.get("uid")) or ""),
        username=_first_non_empty(data.get("uname"), payload.get("uname")),
        message_type=LiveMessageType.GIFT,
        content=str(gift_name),
        metadata=metadata,
    )


def _normalize_event(payload: Dict[str, Any]) -> Optional[LiveEvent]:
    event_type = _parse_event_type(payload).lower()
    data = _extract_event_data(payload, event_type)
    if event_type in {"superchatmessage", "super_chat_message"}:
        return _normalize_super_chat(payload, data)
    if event_type in {"gift", "sendgift"}:
        return _normalize_gift(payload, data)
    logger.debug("bili.callback.event_ignored", extra={"event_type": event_type})
    return None


def _extract_event_id(payload: Dict[str, Any], data: Dict[str, Any]) -> Optional[str]:
    candidates = [
        data.get("id"),
        (data.get("gift_id") or data.get("giftId")),
        payload.get("id"),
        payload.get("event_id"),
    ]
    for value in candidates:
        if value not in (None, "", 0):
            return str(value)
    return None


async def _mark_event_seen(
    event_id: Optional[str],
    event_type: str,
    room_id: Optional[str],
    redis_client: Optional[redis.Redis],
) -> bool:
    if not event_id:
        return True
    normalized_room = (room_id or "").strip() or "unknown"
    token = f"{settings.dedupe_prefix}:{normalized_room}:{event_type}:{event_id}"

    if redis_client is not None:
        try:
            added = await redis_client.sadd(settings.dedupe_prefix, token)
            if added and settings.dedupe_ttl > 0:
                await redis_client.expire(settings.dedupe_prefix, settings.dedupe_ttl)
            if added:
                return True
            return False
        except Exception:  # pragma: no cover - fallback to local cache
            logger.warning("bili.callback.dedupe_redis_failed", exc_info=True)

    if token in _local_dedupe:
        return False
    _local_dedupe.add(token)
    return True


@app.post("/bilibili/callback", status_code=202)
async def bilibili_callback(request: Request) -> JSONResponse:
    publisher: Optional[RedisLiveEventPublisher] = getattr(request.app.state, "redis_publisher", None)
    if publisher is None:
        raise HTTPException(status_code=503, detail="callback_not_ready")
    redis_client: Optional[redis.Redis] = getattr(request.app.state, "redis_client", None)

    body = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    try:
        _verify_signature(headers, body)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("bili.callback.signature_error", exc_info=True)
        raise HTTPException(status_code=403, detail="signature_error") from exc

    try:
        payload = json.loads(body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("payload must be object")
    except Exception as exc:
        logger.warning("bili.callback.invalid_json", extra={"error": repr(exc)})
        raise HTTPException(status_code=400, detail="invalid_json") from exc

    event = _normalize_event(payload)
    if event is None:
        return JSONResponse({"status": "ignored"}, status_code=202)

    event_type = payload.get("event") or payload.get("event_type") or event.message_type
    data = _extract_event_data(payload, event_type or "")
    event_id = _extract_event_id(payload, data)
    is_new = await _mark_event_seen(event_id, event_type or "unknown", event.room_id, redis_client)
    if not is_new:
        return JSONResponse({"status": "duplicate"}, status_code=200)

    await publisher.publish(event)
    logger.info(
        "bili.callback.event_published",
        extra={
            "event_type": event.message_type,
            "room_id": event.room_id,
            "username": event.username,
            "event_id": event_id,
        },
    )
    return JSONResponse({"status": "ok"}, status_code=202)
