import asyncio
import contextlib
import json
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.wsgi import WSGIMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from flask import Flask as _Flask  # shim for mounting Flask blueprint
from src.services.asr_routes import bp_asr as _flask_bp  # type: ignore

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 后端服务配置
BACKEND_SERVICES = {
    "input": os.getenv("INPUT_HANDLER_URL", "ws://localhost:8001"),
    "output": os.getenv("OUTPUT_HANDLER_URL", "ws://localhost:8002")
}

OPENCLAW_BASE_URL = os.getenv("OPENCLAW_BASE_URL", "http://127.0.0.1:18789").rstrip("/")
OPENCLAW_TOKEN = os.getenv("OPENCLAW_TOKEN", "").strip()
OPENCLAW_AGENT_ID = os.getenv("OPENCLAW_AGENT_ID", "main").strip() or "main"
OPENCLAW_HTTP_TIMEOUT = float(os.getenv("OPENCLAW_HTTP_TIMEOUT", "60.0"))
OPENCLAW_CONNECT_TIMEOUT = float(os.getenv("OPENCLAW_CONNECT_TIMEOUT", "5.0"))
OPENCLAW_WRITE_TIMEOUT = float(os.getenv("OPENCLAW_WRITE_TIMEOUT", "10.0"))
SSE_TIMEOUT = httpx.Timeout(
    OPENCLAW_HTTP_TIMEOUT,
    connect=OPENCLAW_CONNECT_TIMEOUT,
    read=None,
    write=OPENCLAW_WRITE_TIMEOUT,
)
AUDIO_STREAM_IDLE_TIMEOUT = float(os.getenv("AUDIO_STREAM_IDLE_TIMEOUT", "20.0"))
AUDIO_STREAM_MAX_CHUNK_BYTES = int(os.getenv("AUDIO_STREAM_MAX_CHUNK_BYTES", str(1 * 1024 * 1024)))

# 活跃连接跟踪
active_connections: Dict[str, WebSocket] = {}


@dataclass
class AudioStreamSession:
    """Tracks state for a single inbound audio streaming connection."""

    codec: Optional[str] = None
    sample_rate: Optional[int] = None
    chunk_duration_ms: Optional[int] = None
    started: bool = False
    last_chunk_id: int = -1
    total_bytes: int = 0
    last_activity: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_activity = time.monotonic()

    def mark_started(self, *, codec: Optional[str], sample_rate: Optional[int], chunk_duration_ms: Optional[int]) -> None:
        self.started = True
        self.codec = codec
        self.sample_rate = sample_rate
        self.chunk_duration_ms = chunk_duration_ms
        self.last_chunk_id = -1
        self.total_bytes = 0
        self.touch()

    def register_chunk(self, chunk_id: int, size: int) -> None:
        self.last_chunk_id = chunk_id
        self.total_bytes += size
        self.touch()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 启动时执行
    logger.info("API Gateway started on port 8000")
    logger.info(f"Routing to: {BACKEND_SERVICES}")
    yield
    # 关闭时执行
    logger.info("API Gateway shutdown")

app = FastAPI(lifespan=lifespan)
# 将 Flask Blueprint 包装为一个最小 Flask 应用并挂载到 FastAPI
_flask_app = _Flask("gateway_asr_mount")
_flask_app.register_blueprint(_flask_bp)
# 挂载到 /api 前缀（最终路由为 /api/asr）
app.mount("/api", WSGIMiddleware(_flask_app))

# 配置CORS
origins = [
    "http://localhost",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class WebSocketProxy:
    def __init__(self):
        self.connection_id = 0
    
    async def proxy_websocket(self, client_ws: WebSocket, backend_url: str, endpoint_type: str):
        """代理WebSocket连接到后端服务"""
        self.connection_id += 1
        conn_id = f"{endpoint_type}_{self.connection_id}"
        
        try:
            # 接受客户端连接
            await client_ws.accept()
            active_connections[conn_id] = client_ws
            logger.info(f"Client connected to {endpoint_type} (ID: {conn_id})")
            
            # 连接到后端服务
            async with websockets.connect(backend_url) as backend_ws:
                logger.info(f"Connected to backend: {backend_url}")
                
                # 创建双向代理任务
                client_to_backend = asyncio.create_task(
                    self._forward_messages(client_ws, backend_ws, f"{conn_id} -> backend")
                )
                backend_to_client = asyncio.create_task(
                    self._forward_messages(backend_ws, client_ws, f"backend -> {conn_id}")
                )
                
                # 等待任一方向的连接断开
                done, pending = await asyncio.wait(
                    [client_to_backend, backend_to_client],
                    return_when=asyncio.FIRST_COMPLETED
                )
                
                # 取消未完成的任务
                for task in pending:
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                        
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Backend connection closed for {conn_id}")
        except Exception as e:
            logger.error(f"Error in proxy for {conn_id}: {e}")
            try:
                await client_ws.close(code=1011, reason=f"Proxy error: {str(e)}")
            except:
                pass
        finally:
            if conn_id in active_connections:
                del active_connections[conn_id]
            logger.info(f"Connection {conn_id} cleaned up")
    
    async def _forward_messages(self, source, destination, direction: str):
        """转发消息从source到destination"""
        try:
            if hasattr(source, 'receive'):
                # FastAPI WebSocket
                while True:
                    message = await source.receive()
                    if message["type"] == "websocket.disconnect":
                        logger.info(f"WebSocket disconnect: {direction}")
                        break
                    elif message["type"] == "websocket.receive":
                        if "text" in message:
                            await destination.send(message["text"])
                        elif "bytes" in message:
                            await destination.send(message["bytes"])
            else:
                # websockets library WebSocket
                async for message in source:
                    if isinstance(message, str):
                        await destination.send_text(message)
                    else:
                        await destination.send_bytes(message)
                        
        except WebSocketDisconnect:
            logger.info(f"Client disconnected: {direction}")
        except websockets.exceptions.ConnectionClosed:
            logger.info(f"Connection closed: {direction}")
        except Exception as e:
            logger.error(f"Error forwarding message ({direction}): {e}")
            raise

class StreamingInputProxy:
    """Handles frontend -> input-handler WebSocket traffic with audio stream awareness."""

    def __init__(
        self,
        *,
        idle_timeout: float = AUDIO_STREAM_IDLE_TIMEOUT,
        max_chunk_bytes: int = AUDIO_STREAM_MAX_CHUNK_BYTES,
    ) -> None:
        self._idle_timeout = idle_timeout
        self._max_chunk_bytes = max_chunk_bytes
        self._connection_id = 0

    async def handle(self, client_ws: WebSocket, backend_url: str) -> None:
        conn_id = self._next_connection_id()
        session = AudioStreamSession()
        await client_ws.accept()
        active_connections[conn_id] = client_ws
        logger.info("Client connected to input stream (ID: %s)", conn_id)

        try:
            async with websockets.connect(backend_url, max_size=None) as backend_ws:
                logger.info("Connected to input-handler backend: %s (ID: %s)", backend_url, conn_id)
                backend_logid = backend_ws.response_headers.get("X-Tt-Logid") if hasattr(backend_ws, "response_headers") else None
                if backend_logid:
                    logger.info("gateway.input_stream.logid conn_id=%s logid=%s", conn_id, backend_logid)
                tasks = [
                    asyncio.create_task(self._forward_client_to_backend(client_ws, backend_ws, session, conn_id)),
                    asyncio.create_task(self._forward_backend_to_client(client_ws, backend_ws, session, conn_id)),
                    asyncio.create_task(self._monitor_idle(client_ws, backend_ws, session, conn_id)),
                ]
                done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for task in pending:
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
                for task in done:
                    exc = task.exception()
                    if exc:
                        raise exc
        except websockets.exceptions.ConnectionClosed as exc:
            logger.info("Backend connection closed for %s (code=%s, reason=%s)", conn_id, exc.code, exc.reason)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Streaming proxy error (%s): %s", conn_id, exc, exc_info=True)
            await self._send_error(client_ws, f"gateway_error: {exc}")
            with contextlib.suppress(Exception):
                await client_ws.close(code=1011, reason="gateway_error")
        finally:
            active_connections.pop(conn_id, None)
            logger.info("Input stream connection %s cleaned up", conn_id)

    async def _forward_client_to_backend(
        self,
        client_ws: WebSocket,
        backend_ws: websockets.WebSocketClientProtocol,
        session: AudioStreamSession,
        conn_id: str,
    ) -> None:
        try:
            while True:
                message = await client_ws.receive()
                msg_type = message.get("type")
                if msg_type == "websocket.disconnect":
                    logger.info("Client requested disconnect (%s)", conn_id)
                    await backend_ws.close(code=1000)
                    break

                if msg_type != "websocket.receive":
                    continue

                if "text" in message:
                    if not await self._handle_text_message(client_ws, backend_ws, session, message["text"], conn_id):
                        break
                elif "bytes" in message:
                    if not await self._handle_binary_message(client_ws, backend_ws, session, message["bytes"], conn_id):
                        break
        except WebSocketDisconnect:
            logger.info("Client WebSocket disconnect raised (%s)", conn_id)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Error forwarding client -> backend (%s): %s", conn_id, exc, exc_info=True)
            raise

    async def _forward_backend_to_client(
        self,
        client_ws: WebSocket,
        backend_ws: websockets.WebSocketClientProtocol,
        session: AudioStreamSession,
        conn_id: str,
    ) -> None:
        try:
            async for message in backend_ws:
                session.touch()
                if isinstance(message, str):
                    await client_ws.send_text(message)
                else:
                    await client_ws.send_bytes(message)
        except websockets.exceptions.ConnectionClosed:
            logger.info("Backend closed output stream (%s)", conn_id)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Error forwarding backend -> client (%s): %s", conn_id, exc, exc_info=True)
            raise

    async def _monitor_idle(
        self,
        client_ws: WebSocket,
        backend_ws: websockets.WebSocketClientProtocol,
        session: AudioStreamSession,
        conn_id: str,
    ) -> None:
        try:
            while True:
                await asyncio.sleep(self._idle_timeout / 2)
                if not session.started:
                    continue
                idle_for = time.monotonic() - session.last_activity
                if idle_for >= self._idle_timeout:
                    warn = f"audio_stream_idle_timeout ({idle_for:.1f}s)"
                    logger.warning("Idle audio stream detected (%s): %s", conn_id, warn)
                    await self._send_error(client_ws, warn)
                    await backend_ws.close(code=1011, reason="idle_timeout")
                    with contextlib.suppress(Exception):
                        await client_ws.close(code=4000, reason="idle_timeout")
                    break
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.error("Idle monitor error (%s): %s", conn_id, exc, exc_info=True)

    async def _handle_text_message(
        self,
        client_ws: WebSocket,
        backend_ws: websockets.WebSocketClientProtocol,
        session: AudioStreamSession,
        payload: str,
        conn_id: str,
    ) -> bool:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError:
            await backend_ws.send(payload)
            session.touch()
            return True

        msg_type = data.get("type")
        action = str(data.get("action") or "").lower()
        session.touch()

        if msg_type != "audio":
            await backend_ws.send(json.dumps(data, ensure_ascii=False))
            return True

        if action == "start":
            if session.started:
                await self._send_error(client_ws, "audio_stream_already_started")
                return False
            session.mark_started(
                codec=data.get("codec"),
                sample_rate=self._safe_int(data.get("sample_rate")),
                chunk_duration_ms=self._safe_int(data.get("chunk_duration_ms")),
            )
            logger.info(
                "Audio stream started (%s): codec=%s sample_rate=%s chunk=%sms",
                conn_id,
                session.codec,
                session.sample_rate,
                session.chunk_duration_ms,
            )
            start_forward = dict(data)
            start_forward["action"] = "stream_start"
            await backend_ws.send(json.dumps(start_forward, ensure_ascii=False))
            return True

        if action == "data_chunk":
            if not session.started:
                await self._send_error(client_ws, "audio_stream_not_started")
                return False
            chunk_id = self._safe_int(data.get("chunk_id"))
            if chunk_id is None:
                await self._send_error(client_ws, "missing_chunk_id")
                return False
            expected_next = session.last_chunk_id + 1
            if chunk_id != expected_next:
                warn = f"chunk_id_mismatch expected={expected_next} got={chunk_id}"
                logger.warning("Chunk mismatch (%s): %s", conn_id, warn)
                await self._send_error(client_ws, warn)
                return False
            enriched = dict(data)
            if session.codec:
                enriched.setdefault("codec", session.codec)
            if session.sample_rate:
                enriched.setdefault("sample_rate", session.sample_rate)
            if session.chunk_duration_ms:
                enriched.setdefault("chunk_duration_ms", session.chunk_duration_ms)
            await backend_ws.send(json.dumps(enriched, ensure_ascii=False))
            return True

        if action in {"stop", "upload_complete"}:
            if not session.started:
                await self._send_error(client_ws, "audio_stream_not_started")
                return False
            stop_payload: Dict[str, Any] = dict(data)
            stop_payload["action"] = "upload_complete"
            stop_payload["total_chunks"] = session.last_chunk_id + 1
            if session.codec:
                stop_payload.setdefault("codec", session.codec)
            if session.sample_rate:
                stop_payload.setdefault("sample_rate", session.sample_rate)
            await backend_ws.send(json.dumps(stop_payload, ensure_ascii=False))
            session.started = False
            logger.info(
                "Audio stream completed (%s): total_chunks=%s total_bytes=%s",
                conn_id,
                stop_payload["total_chunks"],
                session.total_bytes,
            )
            return True

        if action == "cancel":
            logger.info("Audio stream canceled by client (%s)", conn_id)
            cancel_payload = dict(data)
            await backend_ws.send(json.dumps(cancel_payload, ensure_ascii=False))
            session.started = False
            await client_ws.close(code=4001, reason="client_cancel")
            await backend_ws.close(code=1000, reason="client_cancel")
            return False

        await backend_ws.send(json.dumps(data, ensure_ascii=False))
        return True

    async def _handle_binary_message(
        self,
        client_ws: WebSocket,
        backend_ws: websockets.WebSocketClientProtocol,
        session: AudioStreamSession,
        payload: bytes,
        conn_id: str,
    ) -> bool:
        size = len(payload)
        if size > self._max_chunk_bytes:
            await self._send_error(client_ws, f"chunk_too_large ({size} > {self._max_chunk_bytes})")
            return False
        if not session.started:
            await self._send_error(client_ws, "audio_stream_not_started")
            return False

        session.register_chunk(session.last_chunk_id + 1, size)
        await backend_ws.send(payload)
        return True

    async def _send_error(self, client_ws: WebSocket, message: str) -> None:
        payload = json.dumps({"type": "error", "message": message})
        with contextlib.suppress(Exception):
            await client_ws.send_text(payload)

    def _safe_int(self, value: Any) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None

    def _next_connection_id(self) -> str:
        self._connection_id += 1
        return f"stream_input_{self._connection_id}"

# 初始化代理
proxy = WebSocketProxy()
audio_proxy = StreamingInputProxy()


@app.websocket("/ws/input")
async def proxy_input(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_text(json.dumps({"error": "not_supported", "detail": "legacy ws/input is disabled"}))
    await websocket.close(code=1008)

@app.websocket("/ws/output/{task_id}")
async def proxy_output(websocket: WebSocket, task_id: str):
    await websocket.accept()
    await websocket.send_text(json.dumps({"error": "not_supported", "detail": "legacy ws/output is disabled"}))
    await websocket.close(code=1008)


def _format_sse(event: str, payload: Dict[str, Any]) -> bytes:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


def _parse_sse_events(buffer: str) -> Tuple[List[Tuple[str, str]], str]:
    events: List[Tuple[str, str]] = []
    cursor = 0

    while True:
        boundary = buffer.find("\n\n", cursor)
        if boundary == -1:
            break
        raw_event = buffer[cursor:boundary]
        cursor = boundary + 2
        if not raw_event.strip():
            continue

        event_type = "message"
        data_lines: List[str] = []
        for line in raw_event.splitlines():
            if line.startswith(":"):
                continue
            if line.startswith("event:"):
                event_type = line[6:].strip() or "message"
            elif line.startswith("data:"):
                data_lines.append(line[5:].lstrip())

        events.append((event_type, "\n".join(data_lines)))

    return events, buffer[cursor:]


def _extract_openclaw_delta(chunk_json: Dict[str, Any]) -> str:
    choices = chunk_json.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""

    first = choices[0]
    if not isinstance(first, dict):
        return ""

    delta = first.get("delta")
    if not isinstance(delta, dict):
        return ""

    content = delta.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: List[str] = []
        for item in content:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str):
                parts.append(text)
        return "".join(parts)
    return ""


async def _build_openclaw_payload(request: Request) -> Dict[str, Any]:
    try:
        incoming = await request.json()
    except Exception:
        incoming = {}

    if not isinstance(incoming, dict):
        incoming = {}

    content = incoming.get("content")
    if not isinstance(content, str) or not content.strip():
        raise HTTPException(status_code=400, detail="content is required")

    session_id = incoming.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        session_id = incoming.get("sessionId")
    if not isinstance(session_id, str) or not session_id.strip():
        session_id = "default"

    agent_id = incoming.get("agent_id")
    if not isinstance(agent_id, str) or not agent_id.strip():
        agent_id = OPENCLAW_AGENT_ID

    payload: Dict[str, Any] = {
        "model": f"openclaw:{agent_id}",
        "stream": True,
        "messages": [{"role": "user", "content": content}],
        "user": session_id,
    }

    for key in ("temperature", "max_tokens", "top_p", "frequency_penalty", "presence_penalty"):
        if key in incoming:
            payload[key] = incoming[key]

    return payload


@app.post("/chat/stream")
async def proxy_chat_stream(request: Request):
    """Map frontend stream contract to OpenClaw chat-completions SSE."""
    upstream_payload = await _build_openclaw_payload(request)
    target_url = f"{OPENCLAW_BASE_URL}/v1/chat/completions"
    headers = {
        "accept": "text/event-stream",
        "content-type": "application/json",
    }
    if OPENCLAW_TOKEN:
        headers["authorization"] = f"Bearer {OPENCLAW_TOKEN}"

    client = httpx.AsyncClient(timeout=SSE_TIMEOUT, follow_redirects=False)
    try:
        upstream_response = await client.send(
            client.build_request("POST", target_url, json=upstream_payload, headers=headers),
            stream=True,
        )
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"openclaw unreachable: {exc}") from exc

    if upstream_response.status_code >= 400:
        detail_bytes = await upstream_response.aread()
        await upstream_response.aclose()
        await client.aclose()
        detail = detail_bytes.decode("utf-8", errors="replace") or upstream_response.reason_phrase
        return JSONResponse(
            {"error": "openclaw_error", "detail": detail},
            status_code=upstream_response.status_code,
        )

    async def event_stream():
        done_sent = False
        sse_buffer = ""
        try:
            async for chunk in upstream_response.aiter_text():
                if not chunk:
                    continue
                sse_buffer += chunk
                parsed_events, sse_buffer = _parse_sse_events(sse_buffer)
                for _event_type, data in parsed_events:
                    if not data:
                        continue
                    if data.strip() == "[DONE]":
                        if not done_sent:
                            done_sent = True
                            yield _format_sse("done", {"source": "openclaw"})
                        continue

                    try:
                        parsed = json.loads(data)
                    except json.JSONDecodeError:
                        logger.warning("Skipping malformed OpenClaw SSE chunk: %s", data)
                        continue

                    delta = _extract_openclaw_delta(parsed)
                    if delta:
                        yield _format_sse("text-delta", {"content": delta})
        finally:
            if not done_sent:
                yield _format_sse("done", {"source": "openclaw"})
            await upstream_response.aclose()
            await client.aclose()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"cache-control": "no-cache"},
    )


@app.post("/chat/audio/stream")
async def proxy_chat_audio_stream():
    """Audio stream is intentionally removed in OpenClaw text-only phase."""
    return JSONResponse(
        {"error": "not_supported", "detail": "audio stream is disabled in openclaw text-only phase"},
        status_code=410,
    )


@app.post("/control/stop")
async def control_stop_proxy():
    return JSONResponse(
        {"error": "not_supported", "detail": "control stop is disabled in openclaw text-only phase"},
        status_code=410,
    )


@app.get("/internal/output/health")
async def output_health_proxy():
    return JSONResponse(
        {"error": "not_supported", "detail": "output health proxy is disabled in openclaw text-only phase"},
        status_code=410,
    )

@app.get("/")
async def get():
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head>
        <title>AIVtuber OpenClaw Gateway</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .status { margin: 20px 0; }
            .endpoint { background: #f5f5f5; padding: 10px; margin: 5px 0; border-radius: 5px; }
        </style>
    </head>
    <body>
        <h1>AIVtuber OpenClaw Gateway</h1>
        <p>文本链路已切换为 OpenClaw 适配（/chat/stream）。</p>
        
        <div class="status">
            <h2>文本接口</h2>
            <div class="endpoint">
                <strong>POST /chat/stream</strong> → OpenClaw /v1/chat/completions
            </div>
            <div class="endpoint">
                <strong>WS /ws/input, /ws/output/*</strong> 已禁用（Phase 1 文本版）
            </div>
        </div>
        
        <div class="status">
            <h2>当前状态</h2>
            <p>活跃连接数: """ + str(len(active_connections)) + """</p>
            <p>OpenClaw: """ + OPENCLAW_BASE_URL + """</p>
        </div>
        
        <div class="status">
            <h2>使用说明</h2>
            <p>前端只需调用 /chat/stream，网关会做 SSE 事件映射。</p>
        </div>
    </body>
    </html>
    """)

@app.get("/health")
async def health_check():
    """健康检查端点"""
    return {
        "status": "ok",
        "gateway": "running",
        "active_connections": len(active_connections),
        "openclaw_base_url": OPENCLAW_BASE_URL,
        "openclaw_agent_id": OPENCLAW_AGENT_ID,
    }

@app.get("/connections")
async def get_connections():
    """获取当前连接状态"""
    return {
        "total_connections": len(active_connections),
        "connections": list(active_connections.keys())
    }

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        log_level="info",
        reload=True
    )
