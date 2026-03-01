from __future__ import annotations

import json
from typing import Any, Callable, Dict, List

import httpx
import pytest
from fastapi.testclient import TestClient

import main


class FakeResponse:
    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: Dict[str, str] | None = None,
        chunks: List[bytes] | None = None,
        detail_text: str | None = None,
    ) -> None:
        self.status_code = status_code
        self.headers = headers or {"content-type": "text/event-stream"}
        self._chunks = list(chunks or ([] if detail_text is None else [detail_text.encode("utf-8")]))
        self.reason_phrase = "OK"
        self.closed = False

    async def aiter_text(self):
        for chunk in self._chunks:
            yield chunk.decode("utf-8")

    async def aread(self) -> bytes:
        return b"".join(self._chunks)

    async def aclose(self) -> None:
        self.closed = True


class DummyAsyncClient:
    def __init__(self, response_factory: Callable[[httpx.Request], FakeResponse]) -> None:
        self._response_factory = response_factory
        self.last_request: httpx.Request | None = None
        self.closed = False
        self._response: FakeResponse | None = None

    def build_request(
        self,
        method: str,
        url: str,
        *,
        headers: Dict[str, str] | None = None,
        json: Dict[str, Any] | None = None,
        content: bytes | None = None,
    ) -> httpx.Request:
        if json is not None:
            self.last_request = httpx.Request(method, url, headers=headers, json=json)
        else:
            self.last_request = httpx.Request(method, url, headers=headers, content=content)
        return self.last_request

    async def send(self, request: httpx.Request, stream: bool = False) -> FakeResponse:
        self.last_request = request
        self._response = self._response_factory(request)
        return self._response

    async def aclose(self) -> None:
        self.closed = True


@pytest.fixture
def client():
    with TestClient(main.app) as test_client:
        yield test_client


def test_chat_stream_maps_openclaw_events(monkeypatch, client: TestClient) -> None:
    chunks = [
        b'data: {"id":"1","choices":[{"delta":{"content":"hello"}}]}\n\n',
        b'data: {"id":"1","choices":[{"delta":{"content":" world"}}]}\n\n',
        b"data: [DONE]\n\n",
    ]
    captured: Dict[str, Any] = {}

    def factory(request: httpx.Request) -> FakeResponse:
        captured["url"] = str(request.url)
        captured["headers"] = dict(request.headers)
        captured["content"] = request.content
        return FakeResponse(
            status_code=200,
            headers={"content-type": "text/event-stream", "cache-control": "no-cache"},
            chunks=chunks,
        )

    created_clients: List[DummyAsyncClient] = []

    def fake_async_client(*args, **kwargs):
        client_instance = DummyAsyncClient(factory)
        created_clients.append(client_instance)
        return client_instance

    monkeypatch.setattr(main, "OPENCLAW_BASE_URL", "http://openclaw.local:18789")
    monkeypatch.setattr(main, "OPENCLAW_TOKEN", "secret-token")
    monkeypatch.setattr(main, "OPENCLAW_AGENT_ID", "main")
    monkeypatch.setattr(main, "httpx", main.httpx)
    monkeypatch.setattr(main.httpx, "AsyncClient", fake_async_client)

    response = client.post("/chat/stream", json={"session_id": "sess-1", "content": "你好"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")

    body = response.content.decode("utf-8")
    assert "event: text-delta" in body
    assert '"content": "hello"' in body
    assert '"content": " world"' in body
    assert "event: done" in body

    assert captured["url"] == "http://openclaw.local:18789/v1/chat/completions"
    assert captured["headers"]["authorization"] == "Bearer secret-token"
    payload = json.loads(captured["content"].decode("utf-8"))
    assert payload["stream"] is True
    assert payload["model"] == "openclaw:main"
    assert payload["user"] == "sess-1"
    assert payload["messages"] == [{"role": "user", "content": "你好"}]

    client_instance = created_clients[0]
    assert client_instance.closed is True
    assert client_instance._response is not None
    assert client_instance._response.closed is True


def test_chat_stream_requires_content(client: TestClient) -> None:
    response = client.post("/chat/stream", json={"session_id": "sess-1"})
    assert response.status_code == 400
    assert response.json()["detail"] == "content is required"


def test_chat_stream_upstream_error(monkeypatch, client: TestClient) -> None:
    def factory(request: httpx.Request) -> FakeResponse:
        return FakeResponse(status_code=401, headers={"content-type": "application/json"}, detail_text="unauthorized")

    created_clients: List[DummyAsyncClient] = []

    def fake_async_client(*args, **kwargs):
        instance = DummyAsyncClient(factory)
        created_clients.append(instance)
        return instance

    monkeypatch.setattr(main, "httpx", main.httpx)
    monkeypatch.setattr(main.httpx, "AsyncClient", fake_async_client)

    response = client.post("/chat/stream", json={"session_id": "s", "content": "hello"})

    assert response.status_code == 401
    assert response.json() == {"error": "openclaw_error", "detail": "unauthorized"}

    client_instance = created_clients[0]
    assert client_instance.closed is True
    assert client_instance._response is not None
    assert client_instance._response.closed is True


def test_chat_audio_stream_removed(client: TestClient) -> None:
    response = client.post("/chat/audio/stream", json={"sessionId": "x"})
    assert response.status_code == 410
    assert response.json()["error"] == "not_supported"
