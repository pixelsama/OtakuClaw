import asyncio

import pytest

from dialog_engine.live_chat_consumer import (
    LiveChatConsumer,
    LiveChatConsumerSettings,
)
from dialog_engine.live_events import LiveEvent, LiveMessageType


class FakeChatService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.remembered: list[tuple[str, str, str]] = []

    async def stream_reply(self, *, session_id: str, user_text: str, meta: dict):
        self.calls.append((session_id, user_text, meta))

        async def generator():
            yield "reply"

        async for chunk in generator():
            yield chunk

    async def remember_turn(self, session_id: str, *, role: str, content: str) -> None:
        self.remembered.append((session_id, role, content))


class FakeTts:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def stream(self, session_id: str, text: str) -> None:
        self.calls.append((session_id, text))


@pytest.mark.asyncio
async def test_super_chat_processed_before_chat(monkeypatch: pytest.MonkeyPatch):
    chat_service = FakeChatService()
    tts = FakeTts()
    recorded_events: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "dialog_engine.live_chat_consumer.outbox_add_event",
        lambda event_type, payload: recorded_events.append((event_type, payload)),
    )
    consumer = LiveChatConsumer(
        chat_service=chat_service,
        settings=LiveChatConsumerSettings(
            enable_tts=True,
            auto_thanks_enabled=True,
            super_chat_use_llm=False,
            thanks_dedupe_prefix="test.thanks",
        ),
        tts_streamer=tts.stream,
    )

    sc_event = LiveEvent(
        platform="bilibili",
        room_id="1",
        user_id="10",
        username="vip",
        message_type=LiveMessageType.SUPER_CHAT,
        content="Super!",
        metadata={"price": 100},
    )
    chat_event = LiveEvent(
        platform="bilibili",
        room_id="1",
        user_id="11",
        username="user",
        message_type=LiveMessageType.CHAT,
        content="hello",
        metadata={},
    )

    await consumer.enqueue_event(chat_event)
    await consumer.enqueue_event(sc_event)

    await consumer.drain_once_for_test()
    await consumer.drain_once_for_test()
    await asyncio.sleep(0)

    # Super Chat processed before the regular chat message
    assert len(chat_service.calls) == 1
    assert chat_service.calls[0][1] == "hello"

    assert len(chat_service.remembered) >= 3
    assert chat_service.remembered[0][1] == "user"
    assert chat_service.remembered[0][2] == "Super!"
    assert chat_service.remembered[1][1] == "assistant"
    assert "感谢" in chat_service.remembered[1][2]

    assert len(tts.calls) == 2
    assert "感谢" in tts.calls[0][1]
    assert tts.calls[1][1] == "reply"

    assert recorded_events and recorded_events[0][0] == "LtmLiveSuperChat"


@pytest.mark.asyncio
async def test_non_chat_events_ignored():
    chat_service = FakeChatService()
    tts = FakeTts()
    consumer = LiveChatConsumer(
        chat_service=chat_service,
        settings=LiveChatConsumerSettings(enable_tts=True),
        tts_streamer=tts.stream,
    )

    gift_event = LiveEvent(
        platform="bilibili",
        room_id="2",
        user_id="22",
        username="gifter",
        message_type=LiveMessageType.GIFT,
        content="gift",
        metadata={"total_coin": 200},
    )

    await consumer.enqueue_event(gift_event)
    await consumer.drain_once_for_test()
    await asyncio.sleep(0)

    assert chat_service.calls == []
    assert tts.calls == []


@pytest.mark.asyncio
async def test_super_chat_dedupe_skips_repeat(monkeypatch: pytest.MonkeyPatch):
    chat_service = FakeChatService()
    tts = FakeTts()
    recorded_events: list[tuple[str, dict]] = []
    monkeypatch.setattr(
        "dialog_engine.live_chat_consumer.outbox_add_event",
        lambda event_type, payload: recorded_events.append((event_type, payload)),
    )

    consumer = LiveChatConsumer(
        chat_service=chat_service,
        settings=LiveChatConsumerSettings(
            enable_tts=True,
            auto_thanks_enabled=True,
            super_chat_use_llm=False,
            thanks_dedupe_prefix="test.thanks",
        ),
        tts_streamer=tts.stream,
    )

    event = LiveEvent(
        platform="bilibili",
        room_id="9",
        user_id="100",
        username="fan",
        message_type=LiveMessageType.SUPER_CHAT,
        content="Nice stream!",
        metadata={"super_chat_id": "abc", "price": 50},
    )

    await consumer.enqueue_event(event)
    await consumer.enqueue_event(event)
    await consumer.drain_once_for_test()
    await consumer.drain_once_for_test()
    await asyncio.sleep(0)

    assert len(tts.calls) == 1
    assert len(chat_service.remembered) == 2
    assert len(recorded_events) == 1
