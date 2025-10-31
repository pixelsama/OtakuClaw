from __future__ import annotations

import logging
from typing import Optional

import redis.asyncio as redis

from live_events import LiveEvent

logger = logging.getLogger(__name__)


class RedisLiveEventPublisher:
    """Publish live events to a Redis Pub/Sub channel."""

    def __init__(self, client: Optional[redis.Redis], channel: str = "live.chat") -> None:
        self._client = client
        self._channel = channel

    async def publish(self, event: LiveEvent) -> None:
        if not self._client:
            logger.warning("Cannot publish live event; Redis client not ready")
            return
        try:
            await self._client.publish(self._channel, event.to_json())
            logger.debug("Published live event to %s", self._channel)
        except Exception as exc:  # pragma: no cover - network/redis errors
            logger.error("Failed to publish live event: %s", exc, exc_info=True)
