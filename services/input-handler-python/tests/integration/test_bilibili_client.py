import asyncio
import json
import struct

import pytest
import websockets

from input_handlers.bilibili_live import BilibiliDanmakuClient, BilibiliDanmakuConfig
from input_handlers.bilibili_protocol import BilibiliOperation
from publisher import RedisLiveEventPublisher
from live_events import LiveEvent


def build_packet(operation: int, version: int, body: bytes, sequence: int = 1) -> bytes:
    header_len = 16
    packet_len = header_len + len(body)
    return struct.pack(
        ">IHHII",
        packet_len,
        header_len,
        version,
        operation,
        sequence,
    ) + body


class DummyPublisher(RedisLiveEventPublisher):
    def __init__(self) -> None:
        super().__init__(client=None)
        self.events = []
        self.published = asyncio.Event()

    async def publish(self, event: LiveEvent) -> None:
        self.events.append(event)
        self.published.set()


@pytest.mark.asyncio
async def test_bilibili_client_publishes_super_chat(unused_tcp_port: int):
    publisher = DummyPublisher()

    async def handler(websocket):
        auth_packet = await websocket.recv()
        assert isinstance(auth_packet, (bytes, bytearray))
        reply_body = json.dumps({"code": 0}).encode("utf-8")
        await websocket.send(build_packet(BilibiliOperation.AUTH_REPLY, 0, reply_body))

        message = {
            "cmd": "SUPER_CHAT_MESSAGE",
            "data": {
                "id": 123,
                "uid": 456,
                "message": "Thanks!",
                "price": 50,
                "user_info": {"uid": 456, "uname": "Tester"},
            },
        }
        body = json.dumps(message).encode("utf-8")
        await websocket.send(build_packet(BilibiliOperation.SEND_MESSAGE, 0, body))
        try:
            await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            pass

    server = await websockets.serve(handler, "127.0.0.1", unused_tcp_port)
    ws_url = f"ws://127.0.0.1:{unused_tcp_port}"

    config = BilibiliDanmakuConfig(
        room_id=98765,
        websocket_endpoint=ws_url,
        heartbeat_interval=1,
        reconnect_initial=0.1,
        reconnect_max=0.2,
    )

    client = BilibiliDanmakuClient(config, publisher)
    await client.start()

    await asyncio.wait_for(publisher.published.wait(), timeout=2)
    assert publisher.events
    event = publisher.events[0]
    assert event.platform == "bilibili"
    assert event.room_id == str(config.room_id)
    assert event.content == "Thanks!"
    assert event.metadata["price"] == 50
    assert event.message_type == "super_chat"
    assert event.priority and event.priority >= 100

    await client.stop()
    server.close()
    await server.wait_closed()
