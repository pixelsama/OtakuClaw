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
        self._chunks = list(chunks or ([] if detail_text else []))
        if detail_text and not self._chunks:
            self._chunks.append(detail_text.encode("utf-8"))
        self.reason_phrase = "OK"
        self.closed = False

    async def aiter_raw(self):
        for chunk in self._chunks:
            yield chunk

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

    def build_request(self, method: str, url: str, *, headers: Dict[str, str], content: bytes) -> httpx.Request:
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


@pytest.mark.parametrize(
    ("endpoint", "expected_path"),
    [
        ("/chat/stream", "/chat/stream"),
        ("/chat/audio/stream", "/chat/audio/stream"),
    ],
)
def test_sse_proxy_success(monkeypatch, client: TestClient, endpoint: str, expected_path: str) -> None:
    chunks = [b"event: text-delta\n", b"data: hello\n\n"]
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

    monkeypatch.setattr(main, "httpx", main.httpx)
    monkeypatch.setattr(main.httpx, "AsyncClient", fake_async_client)

    response = client.post(endpoint, json={"sessionId": "sess"}, headers={"X-Test": "1"})

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert response.content == b"".join(chunks)

    assert captured["url"] == f"{main.DIALOG_ENGINE_URL.rstrip('/')}{expected_path}"
    assert captured["headers"]["x-test"] == "1"
    assert captured["headers"]["content-type"] == "application/json"
    parsed_body = json.loads(captured["content"].decode("utf-8"))
    assert parsed_body == {"sessionId": "sess"}

    client_instance = created_clients[0]
    assert client_instance.closed is True
    assert client_instance._response is not None
    assert client_instance._response.closed is True


def test_sse_proxy_error(monkeypatch, client: TestClient) -> None:
    def factory(request: httpx.Request) -> FakeResponse:
        return FakeResponse(status_code=503, headers={"content-type": "text/event-stream"}, detail_text="fail")

    created_clients: List[DummyAsyncClient] = []

    def fake_async_client(*args, **kwargs):
        instance = DummyAsyncClient(factory)
        created_clients.append(instance)
        return instance

    monkeypatch.setattr(main, "httpx", main.httpx)
    monkeypatch.setattr(main.httpx, "AsyncClient", fake_async_client)

    response = client.post("/chat/stream", json={"sessionId": "s"})

    assert response.status_code == 503
    assert response.json() == {"error": "dialog_engine_error", "detail": "fail"}

    client_instance = created_clients[0]
    assert client_instance.closed is True
    assert client_instance._response is not None
    assert client_instance._response.closed is True
