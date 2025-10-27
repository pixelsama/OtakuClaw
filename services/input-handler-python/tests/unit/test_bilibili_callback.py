import hashlib
import hmac
import importlib
import json
import time
from typing import Any, Dict

import pytest
from fastapi.testclient import TestClient


class FakeRedis:
    def __init__(self) -> None:
        self.sets: Dict[str, set[str]] = {}
        self.published: list[tuple[str, str]] = []
        self.expire_calls: Dict[str, int] = {}

    async def ping(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def sadd(self, key: str, member: str) -> int:
        current = self.sets.setdefault(key, set())
        if member in current:
            return 0
        current.add(member)
        return 1

    async def expire(self, key: str, ttl: int) -> None:
        self.expire_calls[key] = ttl

    async def publish(self, channel: str, message: str) -> None:
        self.published.append((channel, message))
        return None


def _sign_payload(body: bytes, secret: str, headers: Dict[str, str]) -> Dict[str, str]:
    md5_value = hashlib.md5(body).hexdigest()
    header_map = {
        "x-bili-timestamp": headers.get("x-bili-timestamp") or str(int(time.time())),
        "x-bili-signature-method": "HMAC-SHA256",
        "x-bili-signature-nonce": headers.get("x-bili-signature-nonce") or "nonce123",
        "x-bili-accesskeyid": headers.get("x-bili-accesskeyid") or "test-key",
        "x-bili-signature-version": headers.get("x-bili-signature-version") or "1.0",
        "x-bili-content-md5": md5_value,
    }
    canonical = "\n".join(f"{k}:{header_map[k]}" for k in sorted(header_map))
    signature = hmac.new(secret.encode("utf-8"), canonical.encode("utf-8"), hashlib.sha256).hexdigest()
    header_map["authorization"] = signature
    return header_map


@pytest.fixture()
def callback_module(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BILI_CALLBACK_SECRET", "test-secret")
    monkeypatch.setenv("BILI_CALLBACK_KEY", "test-key")
    monkeypatch.setenv("LIVE_CHAT_CHANNEL", "test.live.chat")
    monkeypatch.setenv("BILI_CALLBACK_ALLOW_UNSIGNED", "false")
    monkeypatch.setenv("BILI_CALLBACK_DEDUPE_PREFIX", "test:callback")
    module = importlib.reload(importlib.import_module("callbacks.bilibili"))
    yield module
    importlib.reload(module)


def _setup_test_client(module, monkeypatch: pytest.MonkeyPatch, fake_redis: FakeRedis) -> TestClient:
    monkeypatch.setattr(module.redis, "Redis", lambda **kwargs: fake_redis)
    app = module.app
    return TestClient(app)


def test_super_chat_callback_publishes_event(callback_module, monkeypatch: pytest.MonkeyPatch):
    fake_redis = FakeRedis()
    client = _setup_test_client(callback_module, monkeypatch, fake_redis)

    payload = {
        "event": "superChatMessage",
        "room_id": 1234,
        "data": {
            "id": "sc-1",
            "message": "这是醒目留言",
            "price": 50,
            "user_info": {"uid": 999, "uname": "Alice"},
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = _sign_payload(body, "test-secret", {})

    with client:
        response = client.post("/bilibili/callback", data=body, headers=headers)
        assert response.status_code == 202
        assert response.json()["status"] == "ok"

        assert len(fake_redis.published) == 1
        channel, message = fake_redis.published[0]
        assert channel == "test.live.chat"
        event_data = json.loads(message)
        assert event_data["message_type"] == "super_chat"
        assert event_data["username"] == "Alice"


def test_duplicate_event_returns_duplicate(callback_module, monkeypatch: pytest.MonkeyPatch):
    fake_redis = FakeRedis()
    client = _setup_test_client(callback_module, monkeypatch, fake_redis)

    payload = {
        "event": "superChatMessage",
        "room_id": 1234,
        "data": {
            "id": "duplicate-1",
            "message": "醒目留言",
            "price": 80,
            "user_info": {"uid": 888, "uname": "Bob"},
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = _sign_payload(body, "test-secret", {})

    with client:
        response1 = client.post("/bilibili/callback", data=body, headers=headers)
        assert response1.status_code == 202
        response2 = client.post("/bilibili/callback", data=body, headers=headers)
        assert response2.status_code == 200
        assert response2.json()["status"] == "duplicate"
        assert len(fake_redis.published) == 1


def test_duplicate_event_isolated_by_room(callback_module, monkeypatch: pytest.MonkeyPatch):
    fake_redis = FakeRedis()
    client = _setup_test_client(callback_module, monkeypatch, fake_redis)

    payload_room_a = {
        "event": "superChatMessage",
        "room_id": 1001,
        "data": {
            "id": "shared-id",
            "message": "First room",
            "price": 10,
            "user_info": {"uid": 1, "uname": "RoomA"},
        },
    }
    payload_room_b = {
        "event": "superChatMessage",
        "room_id": 2002,
        "data": {
            "id": "shared-id",
            "message": "Second room",
            "price": 10,
            "user_info": {"uid": 2, "uname": "RoomB"},
        },
    }

    body_a = json.dumps(payload_room_a, ensure_ascii=False).encode("utf-8")
    body_b = json.dumps(payload_room_b, ensure_ascii=False).encode("utf-8")
    headers_a = _sign_payload(body_a, "test-secret", {})
    headers_b = _sign_payload(body_b, "test-secret", {})

    with client:
        response_a = client.post("/bilibili/callback", data=body_a, headers=headers_a)
        response_b = client.post("/bilibili/callback", data=body_b, headers=headers_b)

        assert response_a.status_code == 202
        assert response_b.status_code == 202
        assert len(fake_redis.published) == 2

def test_invalid_signature_rejected(callback_module, monkeypatch: pytest.MonkeyPatch):
    fake_redis = FakeRedis()
    client = _setup_test_client(callback_module, monkeypatch, fake_redis)

    payload = {"event": "superChatMessage", "data": {"id": "bad-1"}}
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "x-bili-timestamp": str(int(time.time())),
        "x-bili-signature-method": "HMAC-SHA256",
        "x-bili-signature-nonce": "nonce",
        "x-bili-accesskeyid": "test-key",
        "x-bili-signature-version": "1.0",
        "x-bili-content-md5": "deadbeef",
        "authorization": "invalid",
    }

    with client:
        response = client.post("/bilibili/callback", data=body, headers=headers)
        assert response.status_code == 403
