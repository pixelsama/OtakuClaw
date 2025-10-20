from __future__ import annotations

import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict


class LiveMessageType(str, Enum):
    CHAT = "chat"
    SUPER_CHAT = "super_chat"
    GIFT = "gift"
    NOTICE = "notice"
    SYSTEM = "system"
    UNKNOWN = "unknown"


_PRIORITY_BASE = {
    LiveMessageType.SUPER_CHAT: 100,
    LiveMessageType.GIFT: 50,
    LiveMessageType.CHAT: 10,
    LiveMessageType.NOTICE: 5,
    LiveMessageType.SYSTEM: 1,
    LiveMessageType.UNKNOWN: 0,
}


def compute_priority(message_type: LiveMessageType, metadata: Dict[str, Any]) -> int:
    base = _PRIORITY_BASE.get(message_type, 0)
    if message_type is LiveMessageType.SUPER_CHAT:
        price = metadata.get("price") or metadata.get("rmb") or metadata.get("total_price")
        try:
            boost = int(float(price))
        except (TypeError, ValueError):
            boost = 0
        return base + max(0, min(boost, 1000))

    if message_type is LiveMessageType.GIFT:
        total_coin = metadata.get("total_coin") or metadata.get("coin")
        try:
            boost = int(total_coin) // 100
        except (TypeError, ValueError):
            boost = 0
        return base + max(0, boost)

    if message_type is LiveMessageType.CHAT:
        guard_level = metadata.get("guard_level")
        try:
            guard_bonus = int(guard_level) * 2
        except (TypeError, ValueError):
            guard_bonus = 0
        return base + guard_bonus

    return base


def _coerce_message_type(value: str | LiveMessageType) -> LiveMessageType:
    if isinstance(value, LiveMessageType):
        return value
    try:
        return LiveMessageType(value)
    except ValueError:
        return LiveMessageType.UNKNOWN


@dataclass(slots=True)
class LiveEvent:
    """Standard representation for live streaming events across platforms."""

    platform: str
    room_id: str
    user_id: str | None
    username: str | None
    message_type: str | LiveMessageType
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    priority: int | None = None

    def __post_init__(self) -> None:
        message_type = _coerce_message_type(self.message_type)
        self.message_type = message_type.value
        if self.user_id == "":
            self.user_id = None
        if self.username == "":
            self.username = None
        if self.priority is None:
            self.priority = compute_priority(message_type, self.metadata)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "platform": self.platform,
            "room_id": self.room_id,
            "user_id": self.user_id,
            "username": self.username,
            "message_type": self.message_type,
            "content": self.content,
            "metadata": self.metadata,
            "priority": self.priority,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)


__all__ = [
    "LiveEvent",
    "LiveMessageType",
    "compute_priority",
]
