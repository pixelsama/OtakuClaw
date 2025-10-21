from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass
from itertools import count
from typing import Awaitable, Callable, Optional, Tuple

import redis.asyncio as redis

from .chat_service import ChatService
from .tts_streamer import stream_text as default_tts_streamer
from utils.live_events import LiveEvent, LiveMessageType

logger = logging.getLogger(__name__)


LiveReplyStreamer = Callable[[str, str], Awaitable[None]]


@dataclass(slots=True)
class LiveChatConsumerSettings:
    channel: str = os.getenv("LIVE_CHAT_CHANNEL", "live.chat")
    redis_host: str = os.getenv("REDIS_HOST", "localhost")
    redis_port: int = int(os.getenv("REDIS_PORT", "6379"))
    enable_tts: bool = os.getenv("LIVE_CHAT_ENABLE_TTS", "true").lower() in {"1", "true", "yes", "on"}
    session_prefix: str = os.getenv("LIVE_CHAT_SESSION_PREFIX", "bili")


class LiveChatConsumer:
    """Consume normalized live chat events and trigger dialog responses."""

    def __init__(
        self,
        *,
        chat_service: ChatService,
        settings: Optional[LiveChatConsumerSettings] = None,
        tts_streamer: Callable[[str, str], Awaitable[None]] = default_tts_streamer,
    ) -> None:
        self._chat_service = chat_service
        self._settings = settings or LiveChatConsumerSettings()
        self._tts_streamer = tts_streamer

        self._redis: Optional[redis.Redis] = None
        self._pubsub: Optional[redis.client.PubSub] = None
        self._reader_task: Optional[asyncio.Task[None]] = None
        self._worker_task: Optional[asyncio.Task[None]] = None

        self._queue: asyncio.PriorityQueue[Tuple[int, int, LiveEvent]] = asyncio.PriorityQueue()
        self._sequence = count()
        self._running = False
        self._pending_tts: set[asyncio.Task[None]] = set()
        self._processed = 0
        self._ignored = 0

    async def start(self) -> None:
        if self._running:
            return
        self._redis = redis.Redis(
            host=self._settings.redis_host,
            port=self._settings.redis_port,
            encoding="utf-8",
            decode_responses=True,
        )
        try:
            await self._redis.ping()
        except Exception as exc:
            await self._redis.close()
            self._redis = None
            raise RuntimeError(f"live.chat.consumer.redis_unavailable:{exc!r}") from exc

        self._pubsub = self._redis.pubsub(ignore_subscribe_messages=True)
        await self._pubsub.subscribe(self._settings.channel)
        self._running = True
        self._reader_task = asyncio.create_task(self._reader_loop(), name="live-chat-reader")
        self._worker_task = asyncio.create_task(self._worker_loop(), name="live-chat-worker")
        logger.info(
            "live.chat.consumer_started",
            extra={"channel": self._settings.channel, "host": self._settings.redis_host},
        )

    async def stop(self) -> None:
        self._running = False
        tasks = [t for t in (self._reader_task, self._worker_task) if t is not None]
        for task in tasks:
            task.cancel()
        for task in tasks:
            try:
                await task
            except asyncio.CancelledError:
                pass
            except Exception:
                logger.warning("live.chat.consumer_stop_task_error", exc_info=True)
        self._reader_task = None
        self._worker_task = None

        if self._pubsub is not None:
            try:
                await self._pubsub.unsubscribe(self._settings.channel)
                await self._pubsub.close()
            except Exception:
                logger.warning("live.chat.consumer_pubsub_close_failed", exc_info=True)
            self._pubsub = None

        if self._redis is not None:
            try:
                await self._redis.close()
            except Exception:
                logger.warning("live.chat.consumer_redis_close_failed", exc_info=True)
            self._redis = None

        pending = list(self._pending_tts)
        for task in pending:
            task.cancel()
        self._pending_tts.clear()
        logger.info("live.chat.consumer_stopped", extra={"processed": self._processed, "ignored": self._ignored})

    async def enqueue_event(self, event: LiveEvent) -> None:
        priority = -int(event.priority or 0)
        seq = next(self._sequence)
        await self._queue.put((priority, seq, event))

    async def _reader_loop(self) -> None:
        assert self._pubsub is not None
        try:
            async for message in self._pubsub.listen():
                if not self._running:
                    break
                if message is None or message.get("type") != "message":
                    continue
                raw = message.get("data")
                event = self._parse_event(raw)
                if event is None:
                    continue
                await self.enqueue_event(event)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("live.chat.reader_failed")
        finally:
            logger.debug("live.chat.reader_exit")

    async def _worker_loop(self) -> None:
        while self._running:
            try:
                priority, _, event = await self._queue.get()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("live.chat.worker_queue_error")
                continue
            try:
                await self._handle_event(event)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("live.chat.worker_handle_failed", extra={"message_type": event.message_type})
            finally:
                self._queue.task_done()
        logger.debug("live.chat.worker_exit")

    async def _handle_event(self, event: LiveEvent) -> None:
        if event.message_type not in {LiveMessageType.CHAT.value, LiveMessageType.SUPER_CHAT.value}:
            self._ignored += 1
            logger.debug("live.chat.event_skipped", extra={"message_type": event.message_type})
            return

        session_id = f"{self._settings.session_prefix}:{event.room_id}"
        meta = {
            "live": {
                "platform": event.platform,
                "room_id": event.room_id,
                "message_type": event.message_type,
                "priority": event.priority,
                "user": {"id": event.user_id, "name": event.username},
                "metadata": event.metadata,
            }
        }
        start = time.perf_counter()
        deltas: list[str] = []
        try:
            async for delta in self._chat_service.stream_reply(
                session_id=session_id,
                user_text=event.content,
                meta=meta,
            ):
                deltas.append(delta)
        except Exception:
            logger.exception("live.chat.stream_reply_failed", extra={"session_id": session_id})
            return

        reply_text = "".join(deltas).strip()
        elapsed_ms = (time.perf_counter() - start) * 1000.0
        self._processed += 1

        logger.info(
            "live.chat.event_processed",
            extra={
                "message_type": event.message_type,
                "priority": event.priority,
                "room_id": event.room_id,
                "username": event.username,
                "elapsed_ms": round(elapsed_ms, 1),
                "reply_length": len(reply_text),
            },
        )

        if reply_text and self._settings.enable_tts and self._tts_streamer:
            task = asyncio.create_task(
                self._invoke_tts(session_id=session_id, reply_text=reply_text),
                name=f"live-chat-tts-{session_id}",
            )
            self._pending_tts.add(task)
            task.add_done_callback(self._pending_tts.discard)

    async def _invoke_tts(self, *, session_id: str, reply_text: str) -> None:
        try:
            await self._tts_streamer(session_id, reply_text)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("live.chat.tts_failed", extra={"session_id": session_id})

    def _parse_event(self, raw: object) -> LiveEvent | None:
        try:
            if isinstance(raw, bytes):
                payload = raw.decode("utf-8")
            else:
                payload = str(raw)
            data = json.loads(payload)
            if not isinstance(data, dict):
                raise ValueError("event payload must be object")
            return LiveEvent(
                platform=str(data.get("platform") or "bilibili"),
                room_id=str(data.get("room_id") or ""),
                user_id=(str(data["user_id"]) if data.get("user_id") not in {None, ""} else None),
                username=(str(data["username"]) if data.get("username") not in {None, ""} else None),
                message_type=str(data.get("message_type") or "unknown"),
                content=str(data.get("content") or ""),
                metadata=data.get("metadata") or {},
                priority=int(data.get("priority") or 0),
            )
        except Exception as exc:
            logger.warning("live.chat.event_parse_failed", extra={"error": repr(exc)})
            return None

    async def drain_once_for_test(self) -> None:
        """Process a single queued event (testing helper)."""
        if self._queue.empty():
            return
        _, _, event = await self._queue.get()
        try:
            await self._handle_event(event)
        finally:
            self._queue.task_done()


__all__ = ["LiveChatConsumer", "LiveChatConsumerSettings"]
