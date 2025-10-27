from input_handlers.bilibili_normalizer import normalize_bilibili_message
from utils.live_events import LiveMessageType


def test_normalize_super_chat_message():
    message = {
        "cmd": "SUPER_CHAT_MESSAGE",
        "data": {
            "id": 1,
            "message": "Hello!",
            "price": 150,
            "user_info": {"uid": 321, "uname": "Alice"},
        },
    }
    event = normalize_bilibili_message(message, room_id=987)
    assert event is not None
    assert event.message_type == LiveMessageType.SUPER_CHAT.value
    assert event.room_id == "987"
    assert event.priority and event.priority >= 100
    assert event.metadata["super_chat_id"] == 1


def test_normalize_danmaku_message():
    message = {
        "cmd": "DANMU_MSG",
        "info": [
            [],
            "普通弹幕",
            [654, "Bob", 0, 0, 0, 0, 0, "", 0, 0, 2],
            [15, "粉丝牌", "主播昵称", 9988, 1, 16777215, 0, 0],
            0,
            0,
            0,
            0,
            "",
            "",
            1700000000,
        ],
    }
    event = normalize_bilibili_message(message, room_id=555)
    assert event is not None
    assert event.message_type == LiveMessageType.CHAT.value
    assert event.content == "普通弹幕"
    assert event.metadata["guard_level"] == 2


def test_normalize_send_gift_message():
    message = {
        "cmd": "SEND_GIFT",
        "data": {
            "uid": 777,
            "uname": "Carol",
            "giftName": "花束",
            "total_coin": 400,
        },
    }
    event = normalize_bilibili_message(message, room_id=101)
    assert event is not None
    assert event.message_type == LiveMessageType.GIFT.value
    assert event.metadata["total_coin"] == 400
    assert event.content == "花束"
