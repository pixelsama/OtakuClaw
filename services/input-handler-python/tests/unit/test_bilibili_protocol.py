import json
import struct
import zlib

from input_handlers.bilibili_protocol import (
    BilibiliOperation,
    parse_messages,
)


def build_packet(operation: int, version: int, body: bytes, sequence: int = 1) -> bytes:
    header_len = 16
    packet_len = header_len + len(body)
    return struct.pack(">IHHII", packet_len, header_len, version, operation, sequence) + body


def test_parse_single_message_packet():
    body = json.dumps({"cmd": "SUPER_CHAT_MESSAGE", "data": {"price": 30}}).encode("utf-8")
    packet = build_packet(BilibiliOperation.SEND_MESSAGE, 0, body)

    messages = parse_messages(packet)

    assert len(messages) == 1
    assert messages[0]["cmd"] == "SUPER_CHAT_MESSAGE"
    assert messages[0]["data"]["price"] == 30


def test_parse_heartbeat_reply():
    body = (1234).to_bytes(4, byteorder="big")
    packet = build_packet(BilibiliOperation.HEARTBEAT_REPLY, 0, body)

    messages = parse_messages(packet)

    assert messages == [{"cmd": "HEARTBEAT_REPLY", "value": 1234}]


def test_parse_zlib_compressed_messages():
    inner_body_1 = json.dumps({"cmd": "SUPER_CHAT_MESSAGE"}).encode("utf-8")
    inner_body_2 = json.dumps({"cmd": "SUPER_CHAT_MESSAGE_JPN"}).encode("utf-8")
    nested_packets = (
        build_packet(BilibiliOperation.SEND_MESSAGE, 0, inner_body_1, sequence=1)
        + build_packet(BilibiliOperation.SEND_MESSAGE, 0, inner_body_2, sequence=2)
    )
    compressed = zlib.compress(nested_packets)
    outer_packet = build_packet(BilibiliOperation.SEND_MESSAGE, 2, compressed)

    messages = parse_messages(outer_packet)

    assert len(messages) == 2
    cmds = {msg["cmd"] for msg in messages}
    assert cmds == {"SUPER_CHAT_MESSAGE", "SUPER_CHAT_MESSAGE_JPN"}


def test_parse_invalid_payload_gracefully():
    garbage_packet = build_packet(BilibiliOperation.SEND_MESSAGE, 0, b"not-json")
    messages = parse_messages(garbage_packet)

    assert messages == []
