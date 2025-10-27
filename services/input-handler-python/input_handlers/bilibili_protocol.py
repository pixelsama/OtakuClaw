"""Utilities for parsing Bilibili live WebSocket packets."""

from __future__ import annotations

import json
import logging
import struct
import zlib
from dataclasses import dataclass
from enum import IntEnum
from typing import Iterator, List

try:
    import brotli  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - fallback when dependency missing
    brotli = None  # type: ignore

logger = logging.getLogger(__name__)

MAX_PACKET_LENGTH = 8 * 1024 * 1024  # 8 MB safety guard
HEADER_LENGTH = 16


class BilibiliProtocolError(RuntimeError):
    """Raised when incoming data violates the expected Bilibili protocol."""


class BilibiliProtocolVersion(IntEnum):
    NORMAL = 0
    INT32 = 1
    ZLIB = 2
    BROTLI = 3


class BilibiliOperation(IntEnum):
    HEARTBEAT = 2
    HEARTBEAT_REPLY = 3
    SEND_MESSAGE = 5
    AUTH = 7
    AUTH_REPLY = 8


@dataclass(slots=True)
class BilibiliPacket:
    packet_len: int
    header_len: int
    version: int
    operation: int
    sequence: int
    body: bytes

    @property
    def is_compressed(self) -> bool:
        return self.version in (
            BilibiliProtocolVersion.ZLIB,
            BilibiliProtocolVersion.BROTLI,
        )


def _iter_packets(buffer: bytes) -> Iterator[BilibiliPacket]:
    offset = 0
    buffer_len = len(buffer)
    while offset + HEADER_LENGTH <= buffer_len:
        packet_len = struct.unpack_from(">I", buffer, offset)[0]
        header_len = struct.unpack_from(">H", buffer, offset + 4)[0]
        version = struct.unpack_from(">H", buffer, offset + 6)[0]
        operation = struct.unpack_from(">I", buffer, offset + 8)[0]
        sequence = struct.unpack_from(">I", buffer, offset + 12)[0]

        if packet_len < header_len or packet_len <= 0:
            raise BilibiliProtocolError(
                f"Invalid packet length {packet_len} (header {header_len})"
            )
        if packet_len > MAX_PACKET_LENGTH:
            raise BilibiliProtocolError(
                f"Packet length {packet_len} exceeds safety cap {MAX_PACKET_LENGTH}"
            )

        packet_end = offset + packet_len
        if packet_end > buffer_len:
            raise BilibiliProtocolError(
                f"Incomplete packet: expected {packet_len} bytes, "
                f"only {buffer_len - offset} available"
            )
        body = buffer[offset + header_len : packet_end]
        yield BilibiliPacket(
            packet_len=packet_len,
            header_len=header_len,
            version=version,
            operation=operation,
            sequence=sequence,
            body=body,
        )
        offset = packet_end


def _decompress(packet: BilibiliPacket) -> bytes:
    if packet.version == BilibiliProtocolVersion.ZLIB:
        return zlib.decompress(packet.body)
    if packet.version == BilibiliProtocolVersion.BROTLI:
        if brotli is None:
            raise BilibiliProtocolError(
                "Received brotli compressed payload but 'brotli' package is missing"
            )
        return brotli.decompress(packet.body)
    raise BilibiliProtocolError(f"Unsupported compression version {packet.version}")


def parse_messages(buffer: bytes) -> List[dict]:
    """Parse a WebSocket payload into a list of JSON message dictionaries."""
    try:
        packets = list(_iter_packets(buffer))
    except BilibiliProtocolError:
        decoded = _decode_json_payload(buffer)
        return [decoded] if decoded is not None else []

    messages: List[dict] = []
    for packet in packets:
        if packet.operation == BilibiliOperation.HEARTBEAT_REPLY:
            value = int.from_bytes(packet.body, "big", signed=False) if packet.body else 0
            messages.append({"cmd": "HEARTBEAT_REPLY", "value": value})
            continue

        if packet.operation != BilibiliOperation.SEND_MESSAGE:
            messages.append(
                {
                    "cmd": f"OP_{packet.operation}",
                    "body": packet.body.decode("utf-8", errors="ignore"),
                }
            )
            continue

        if packet.is_compressed:
            try:
                decompressed = _decompress(packet)
            except BilibiliProtocolError as exc:
                logger.warning("Failed to decompress packet: %s", exc)
                continue
            messages.extend(parse_messages(decompressed))
            continue

        decoded = _decode_json_payload(packet.body)
        if decoded is not None:
            messages.append(decoded)
    return messages


def _decode_json_payload(payload: bytes) -> dict | None:
    text = payload.decode("utf-8", errors="ignore").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        logger.debug("Ignoring non-JSON payload: %s", text[:200])
        return None


__all__ = [
    "BilibiliPacket",
    "BilibiliProtocolError",
    "BilibiliProtocolVersion",
    "BilibiliOperation",
    "parse_messages",
]
