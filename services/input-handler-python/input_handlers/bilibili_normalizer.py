from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from utils.live_events import LiveEvent, LiveMessageType

logger = logging.getLogger(__name__)


def _safe_list_get(items: Any, index: int, default: Any = None) -> Any:
    if isinstance(items, (list, tuple)) and 0 <= index < len(items):
        return items[index]
    return default


def _normalize_super_chat(data: Dict[str, Any], room_id: int) -> Optional[LiveEvent]:
    if not isinstance(data, dict):
        return None
    user_info = data.get("user_info") or {}
    user_id = user_info.get("uid") or data.get("uid")
    username = user_info.get("uname") or data.get("uname")
    content = data.get("message") or data.get("message_jpn") or ""
    metadata = {
        "cmd": data.get("cmd") or "SUPER_CHAT_MESSAGE",
        "super_chat_id": data.get("id"),
        "price": data.get("price"),
        "rmb": data.get("rmb"),
        "background_color": data.get("background_color"),
        "start_time": data.get("start_time"),
        "end_time": data.get("end_time"),
        "medal_info": data.get("medal_info"),
    }
    return LiveEvent(
        platform="bilibili",
        room_id=str(room_id),
        user_id=str(user_id) if user_id else None,
        username=username,
        message_type=LiveMessageType.SUPER_CHAT,
        content=content,
        metadata=metadata,
    )


def _normalize_danmaku(message: Dict[str, Any], room_id: int) -> Optional[LiveEvent]:
    info = message.get("info")
    if not isinstance(info, list):
        return None
    content = _safe_list_get(info, 1, "")
    user_block = _safe_list_get(info, 2, [])
    user_id = _safe_list_get(user_block, 0)
    username = _safe_list_get(user_block, 1)
    guard_level = _safe_list_get(user_block, 10)
    medal_info = _safe_list_get(info, 3, [])
    metadata = {
        "vip": _safe_list_get(user_block, 2),
        "svip": _safe_list_get(user_block, 3),
        "guard_level": guard_level,
        "medal_name": _safe_list_get(medal_info, 1),
        "medal_level": _safe_list_get(medal_info, 0),
        "timestamp": _safe_list_get(info, 9),
    }
    return LiveEvent(
        platform="bilibili",
        room_id=str(room_id),
        user_id=str(user_id) if user_id else None,
        username=username,
        message_type=LiveMessageType.CHAT,
        content=str(content) if content is not None else "",
        metadata=metadata,
    )


def _normalize_gift(data: Dict[str, Any], room_id: int) -> Optional[LiveEvent]:
    if not isinstance(data, dict):
        return None
    content = data.get("giftName") or ""
    metadata = {
        "gift_id": data.get("giftId"),
        "num": data.get("num"),
        "coin_type": data.get("coin_type"),
        "total_coin": data.get("total_coin"),
        "price": data.get("price"),
    }
    return LiveEvent(
        platform="bilibili",
        room_id=str(room_id),
        user_id=str(data.get("uid")) if data.get("uid") else None,
        username=data.get("uname"),
        message_type=LiveMessageType.GIFT,
        content=content,
        metadata=metadata,
    )


def normalize_bilibili_message(message: Dict[str, Any], room_id: int) -> Optional[LiveEvent]:
    cmd = (message.get("cmd") or "").upper()
    if not cmd:
        return None

    if cmd in {"SUPER_CHAT_MESSAGE", "SUPER_CHAT_MESSAGE_JPN"}:
        event = _normalize_super_chat(message.get("data") or {}, room_id)
        if event:
            event.metadata["cmd"] = cmd
        return event

    if cmd == "DANMU_MSG":
        return _normalize_danmaku(message, room_id)

    if cmd == "SEND_GIFT":
        return _normalize_gift(message.get("data") or {}, room_id)

    logger.debug("Unsupported Bilibili command '%s' skipped", cmd)
    return None


__all__ = ["normalize_bilibili_message"]

