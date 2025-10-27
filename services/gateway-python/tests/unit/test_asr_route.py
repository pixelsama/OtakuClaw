# 注意：测试在模块目录下运行：cd services/gateway-python && pytest
import base64
import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def app():
    # 动态导入 main.py 内的 FastAPI app（已挂载 /api）
    main = importlib.import_module("main")
    return main.app


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


def test_asr_route_requires_absolute_path(client, monkeypatch):
    # 传递相对路径应报 400
    resp = client.post("/api/asr", json={"path": "relative.wav"})
    assert resp.status_code == 400
    data = resp.json()
    assert data.get("error") == "path_must_be_absolute"


def test_asr_route_reads_file_and_invokes_dialog_engine(client, monkeypatch, tmp_path):
    asr_routes = importlib.import_module("src.services.asr_routes")

    audio_path = tmp_path / "sample.wav"
    audio_path.write_bytes(b"audio-bytes")

    captured_payload = {}

    async def fake_invoke(payload):
        captured_payload.update(payload)
        return {"sessionId": payload["sessionId"], "reply": "hi", "transcript": "test"}

    monkeypatch.setattr(asr_routes, "_invoke_dialog_engine", fake_invoke)

    resp = client.post(
        "/api/asr",
        json={
            "path": str(audio_path),
            "sessionId": "sess-1",
            "contentType": "audio/wav",
            "options": {"lang": "zh"},
        },
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["reply"] == "hi"
    assert data["sessionId"] == "sess-1"

    assert captured_payload["sessionId"] == "sess-1"
    assert captured_payload["contentType"] == "audio/wav"
    assert captured_payload["lang"] == "zh"

    decoded_audio = base64.b64decode(captured_payload["audio"])
    assert decoded_audio == b"audio-bytes"
