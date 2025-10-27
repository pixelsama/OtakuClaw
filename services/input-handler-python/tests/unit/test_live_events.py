from utils.live_events import LiveEvent, LiveMessageType, compute_priority


def test_live_event_priority_defaults_from_message_type():
    event = LiveEvent(
        platform="bilibili",
        room_id="123",
        user_id="1",
        username="tester",
        message_type=LiveMessageType.SUPER_CHAT,
        content="hello",
        metadata={"price": 120},
    )
    assert event.priority and event.priority >= 100


def test_compute_priority_handles_chat_guard_bonus():
    priority = compute_priority(
        LiveMessageType.CHAT,
        {"guard_level": 3},
    )
    assert priority == 16  # base 10 + guard bonus 6


def test_live_event_normalizes_empty_user_fields():
    event = LiveEvent(
        platform="bilibili",
        room_id="123",
        user_id="",
        username="",
        message_type="unknown",
        content="",
    )
    assert event.user_id is None
    assert event.username is None
    assert event.priority == 0
