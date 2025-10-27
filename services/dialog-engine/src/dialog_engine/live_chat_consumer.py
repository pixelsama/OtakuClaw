from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from itertools import count
from typing import Awaitable, Callable, Optional, Tuple

import redis.asyncio as redis

from .chat_service import ChatService
from .tts_streamer import stream_text as default_tts_streamer
from .ltm_outbox import add_event as outbox_add_event
from utils.live_events import LiveEvent, LiveMessageType

logger = logging.getLogger(__name__)


LiveReplyStreamer = Callable[[str, str], Awaitable[None]]


@dataclass(slots=True)
class LiveChatConsumerSettings:
    channel: str = field(default_factory=lambda: os.getenv("LIVE_CHAT_CHANNEL", "live.chat"))
    redis_host: str = field(default_factory=lambda: os.getenv("REDIS_HOST", "localhost"))
    redis_port: int = field(default_factory=lambda: int(os.getenv("REDIS_PORT", "6379")))
    enable_tts: bool = field(default_factory=lambda: os.getenv("LIVE_CHAT_ENABLE_TTS", "true").lower() in {"1", "true", "yes", "on"})
    session_prefix: str = field(default_factory=lambda: os.getenv("LIVE_CHAT_SESSION_PREFIX", "bili"))
    auto_thanks_enabled: bool = field(default_factory=lambda: os.getenv("LIVE_CHAT_AUTO_THANKS", "true").lower() in {"1", "true", "yes", "on"})
    auto_thanks_template: str = field(default_factory=lambda: os.getenv("LIVE_CHAT_THANK_TEMPLATE", "感谢 {username} 的支持！"))
    auto_thanks_min_amount: float = field(default_factory=lambda: float(os.getenv("LIVE_CHAT_THANK_MIN_AMOUNT", "0")))
    thanks_dedupe_prefix: str = field(default_factory=lambda: os.getenv("LIVE_CHAT_THANK_PREFIX", "live.chat.superchat"))
    thanks_dedupe_ttl: int = field(default_factory=lambda: int(os.getenv("LIVE_CHAT_THANK_TTL", "43200")))
    super_chat_use_llm: bool = field(default_factory=lambda: os.getenv("LIVE_CHAT_SUPERCHAT_USE_LLM", "false").lower() in {"1", "true", "yes", "on"})


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
        self._local_thanks_cache: set[str] = set()

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
        if event.message_type == LiveMessageType.SUPER_CHAT.value:
            handled = await self._handle_super_chat_event(event)
            if handled:
                self._processed += 1
            else:
                self._ignored += 1
            return

        if event.message_type != LiveMessageType.CHAT.value:
            self._ignored += 1
            logger.debug("live.chat.event_skipped", extra={"message_type": event.message_type})
            return

        session_id = f"{self._settings.session_prefix}:{event.room_id}"
        await self._chat_service.remember_turn(session_id=session_id, role="user", content=event.content)
        reply_text = await self._generate_reply(event=event, session_id=session_id)
        if reply_text:
            await self._chat_service.remember_turn(
                session_id=session_id,
                role="assistant",
                content=reply_text,
            )
        self._processed += 1

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

    def _build_meta(self, event: LiveEvent) -> dict:
        return {
            "live": {
                "platform": event.platform,
                "room_id": event.room_id,
                "message_type": event.message_type,
                "priority": event.priority,
                "user": {"id": event.user_id, "name": event.username},
                "metadata": event.metadata,
            }
        }

    async def _generate_reply(self, *, event: LiveEvent, session_id: str) -> str:
        meta = self._build_meta(event)
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
            return ""

        reply_text = "".join(deltas).strip()
        elapsed_ms = (time.perf_counter() - start) * 1000.0

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
        return reply_text

    async def _handle_super_chat_event(self, event: LiveEvent) -> bool:
        session_id = f"{self._settings.session_prefix}:{event.room_id}"
        is_new = await self._mark_super_chat_seen(event)
        if not is_new:
            logger.debug("live.chat.super_chat_duplicate", extra={"super_chat_id": event.metadata.get("super_chat_id")})
            return False

        await self._chat_service.remember_turn(session_id=session_id, role="user", content=event.content)
        self._publish_super_chat_memory(event, session_id=session_id)

        thanks_text: Optional[str] = None
        if self._settings.auto_thanks_enabled:
            thanks_text = self._render_auto_thanks(event)
            if thanks_text:
                await self._chat_service.remember_turn(
                    session_id=session_id,
                    role="assistant",
                    content=thanks_text,
                )
                if self._settings.enable_tts and not self._settings.super_chat_use_llm and self._tts_streamer:
                    task = asyncio.create_task(
                        self._invoke_tts(session_id=session_id, reply_text=thanks_text),
                        name=f"live-chat-thanks-{session_id}",
                    )
                    self._pending_tts.add(task)
                    task.add_done_callback(self._pending_tts.discard)
                logger.info(
                    "live.chat.super_chat_thanked",
                    extra={
                        "room_id": event.room_id,
                        "username": event.username,
                        "super_chat_id": event.metadata.get("super_chat_id"),
                    },
                )

        needs_llm = self._settings.super_chat_use_llm or not thanks_text
        if needs_llm:
            reply_text = await self._generate_reply(event=event, session_id=session_id)
            if reply_text:
                await self._chat_service.remember_turn(
                    session_id=session_id,
                    role="assistant",
                    content=reply_text,
                )

        return True

    def _render_auto_thanks(self, event: LiveEvent) -> Optional[str]:
        template = (self._settings.auto_thanks_template or "").strip()
        if not template:
            return None

        price_value = self._extract_price(event.metadata)
        if price_value is not None and price_value < self._settings.auto_thanks_min_amount:
            return None

        username = event.username or "朋友"
        price_display = ""
        if price_value is not None:
            if price_value >= 100:
                price_display = f"{price_value:.0f}"
            else:
                price_display = f"{price_value:.2f}".rstrip("0").rstrip(".")
        metadata = event.metadata or {}
        duration = None
        start_time = metadata.get("start_time")
        end_time = metadata.get("end_time")
        if isinstance(start_time, (int, float)) and isinstance(end_time, (int, float)) and end_time >= start_time:
            duration = end_time - start_time

        template_args = {
            "username": username,
            "content": event.content,
            "price": price_value if price_value is not None else "",
            "amount": price_value if price_value is not None else "",
            "price_display": price_display,
            "currency": metadata.get("currency") or "CNY",
            "room_id": event.room_id,
            "platform": event.platform,
            "duration": duration if duration is not None else "",
            "priority": event.priority or 0,
        }
        template_args.update({k: v for k, v in metadata.items() if k not in template_args})

        try:
            rendered = template.format(**template_args).strip()
        except Exception:
            logger.warning("live.chat.super_chat_template_error", exc_info=True)
            return None
        return rendered

    def _extract_price(self, metadata: dict) -> Optional[float]:
        keys = ("price", "rmb", "total_price", "amount", "value")
        for key in keys:
            value = metadata.get(key)
            if value is None:
                continue
            try:
                return float(value)
            except (TypeError, ValueError):
                continue
        return None

    async def _mark_super_chat_seen(self, event: LiveEvent) -> bool:
        metadata = event.metadata or {}
        raw_id = metadata.get("super_chat_id") or metadata.get("id")
        if raw_id is None:
            return True
        sc_id = str(raw_id)
        key = f"{self._settings.thanks_dedupe_prefix}:{event.room_id}"
        token = f"{key}:{sc_id}"

        client = self._redis
        if client is not None:
            try:
                added = await client.sadd(key, sc_id)
                if added and self._settings.thanks_dedupe_ttl > 0:
                    await client.expire(key, self._settings.thanks_dedupe_ttl)
                if added:
                    return True
                return False
            except Exception:
                logger.warning("live.chat.super_chat_dedupe_error", exc_info=True)

        if token in self._local_thanks_cache:
            return False
        self._local_thanks_cache.add(token)
        return True

    def _publish_super_chat_memory(self, event: LiveEvent, *, session_id: str) -> None:
        try:
            outbox_add_event(
                "LtmLiveSuperChat",
                {
                    "ts": int(time.time()),
                    "sessionId": session_id,
                    "roomId": event.room_id,
                    "platform": event.platform,
                    "user": {"id": event.user_id, "name": event.username},
                    "message": event.content,
                    "metadata": event.metadata,
                    "priority": event.priority,
                },
            )
        except Exception:
            logger.warning("live.chat.super_chat_memory_error", exc_info=True)


__all__ = ["LiveChatConsumer", "LiveChatConsumerSettings"]
