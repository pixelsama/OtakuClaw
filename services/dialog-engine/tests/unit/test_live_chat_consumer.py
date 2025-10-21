import asyncio

import pytest

from dialog_engine.live_chat_consumer import (
    LiveChatConsumer,
    LiveChatConsumerSettings,
)
from utils.live_events import LiveEvent, LiveMessageType


class FakeChatService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict]] = []

    async def stream_reply(self, *, session_id: str, user_text: str, meta: dict):
        self.calls.append((session_id, user_text, meta))

        async def generator():
            yield "reply"

        async for chunk in generator():
            yield chunk


class FakeTts:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def stream(self, session_id: str, text: str) -> None:
        self.calls.append((session_id, text))


@pytest.mark.asyncio
async def test_priority_processing_order():
    chat_service = FakeChatService()
    tts = FakeTts()
    consumer = LiveChatConsumer(
        chat_service=chat_service,
        settings=LiveChatConsumerSettings(enable_tts=True),
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

    assert len(chat_service.calls) == 2
    assert chat_service.calls[0][1] == "Super!"
    assert tts.calls[0][1] == "reply"


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
