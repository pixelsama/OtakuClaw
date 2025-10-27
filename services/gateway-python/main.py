import asyncio
import logging
import os
from contextlib import asynccontextmanager
from typing import Dict
from urllib.parse import urlparse, urlunparse

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

DIALOG_ENGINE_URL = os.getenv("DIALOG_ENGINE_URL", "http://dialog-engine:8100")
SSE_TIMEOUT = httpx.Timeout(60.0, connect=5.0, read=None, write=10.0)

# 活跃连接跟踪
active_connections: Dict[str, WebSocket] = {}

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

# 初始化代理
proxy = WebSocketProxy()

@app.websocket("/ws/input")
async def proxy_input(websocket: WebSocket):
    """代理输入WebSocket连接到input-handler服务"""
    backend_url = f"{BACKEND_SERVICES['input']}/ws/input"
    await proxy.proxy_websocket(websocket, backend_url, "input")

@app.websocket("/ws/output/{task_id}")
async def proxy_output(websocket: WebSocket, task_id: str):
    """代理输出WebSocket连接到output-handler服务"""
    backend_url = f"{BACKEND_SERVICES['output']}/ws/output/{task_id}"
    await proxy.proxy_websocket(websocket, backend_url, "output")


def _output_http_base() -> str:
    """Derive HTTP base URL for output-handler from WS URL env.

    Converts ws://host:port -> http://host:port, wss:// -> https://
    """
    ws_url = BACKEND_SERVICES.get("output", "ws://localhost:8002")
    parsed = urlparse(ws_url)
    scheme = "https" if parsed.scheme == "wss" else "http"
    http_parsed = parsed._replace(scheme=scheme, path="", params="", query="", fragment="")
    return urlunparse(http_parsed).rstrip("/")


def _dialog_engine_http_base() -> str:
    return DIALOG_ENGINE_URL.rstrip("/")


def _build_forward_headers(request: Request) -> Dict[str, str]:
    excluded = {"host", "content-length"}
    headers: Dict[str, str] = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in excluded
    }
    headers.setdefault("accept", "text/event-stream")
    headers.setdefault("content-type", "application/json")
    return headers


async def _proxy_dialog_engine_stream(request: Request, path: str) -> StreamingResponse:
    """Generic helper to proxy SSE POST endpoints to dialog-engine."""
    target_url = f"{_dialog_engine_http_base()}{path}"
    body = await request.body()
    if not body:
        body = b"{}"

    headers = _build_forward_headers(request)

    client = httpx.AsyncClient(timeout=SSE_TIMEOUT, follow_redirects=False)
    try:
        upstream_response = await client.send(
            client.build_request(
                "POST",
                target_url,
                content=body,
                headers=headers,
            ),
            stream=True,
        )
    except httpx.RequestError as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"dialog-engine unreachable: {exc}") from exc

    if upstream_response.status_code >= 400:
        detail_bytes = await upstream_response.aread()
        await upstream_response.aclose()
        await client.aclose()
        detail = detail_bytes.decode("utf-8", errors="replace") or upstream_response.reason_phrase
        return JSONResponse(
            {"error": "dialog_engine_error", "detail": detail},
            status_code=upstream_response.status_code,
        )

    async def event_stream():
        try:
            async for chunk in upstream_response.aiter_raw():
                if chunk:
                    yield chunk
        finally:
            await upstream_response.aclose()
            await client.aclose()

    response_headers = {}
    for header_name in ("cache-control", "content-language"):
        if header_name in upstream_response.headers:
            response_headers[header_name] = upstream_response.headers[header_name]

    media_type = upstream_response.headers.get("content-type", "text/event-stream")
    return StreamingResponse(
        event_stream(),
        status_code=upstream_response.status_code,
        media_type=media_type,
        headers=response_headers,
    )


@app.post("/chat/stream")
async def proxy_chat_stream(request: Request):
    """Proxy SSE chat stream to dialog-engine."""
    return await _proxy_dialog_engine_stream(request, "/chat/stream")


@app.post("/chat/audio/stream")
async def proxy_chat_audio_stream(request: Request):
    """Proxy SSE audio stream to dialog-engine."""
    return await _proxy_dialog_engine_stream(request, "/chat/audio/stream")


@app.post("/control/stop")
async def control_stop_proxy(payload: Dict[str, str]):
    """Proxy STOP control to output-handler's /control/stop.

    Body: {"sessionId": "<uuid>"}
    """
    session_id = payload.get("sessionId") if isinstance(payload, dict) else None
    if not session_id:
        raise HTTPException(status_code=400, detail="sessionId required")

    target = f"{_output_http_base()}/control/stop"
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.post(target, json={"sessionId": session_id})
            resp.raise_for_status()
        except httpx.HTTPStatusError as exc:
            try:
                detail = exc.response.json()
            except ValueError:
                detail = exc.response.text or "output handler error"
            raise HTTPException(status_code=exc.response.status_code, detail=detail)
        except httpx.RequestError as exc:
            raise HTTPException(status_code=502, detail=f"proxy error: {exc}")
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"proxy error: {exc}")

    try:
        return resp.json()
    except ValueError:
        return JSONResponse(status_code=resp.status_code, content={"status_code": resp.status_code, "body": resp.text})


@app.get("/internal/output/health")
async def output_health_proxy():
    """Proxy Output Handler's /health for diagnostics via the gateway."""
    target = f"{_output_http_base()}/health"
    async with httpx.AsyncClient(timeout=5.0) as client:
        try:
            resp = await client.get(target)
            # Try parse JSON; fallback to text
            try:
                data = resp.json()
            except ValueError:
                data = {"status_code": resp.status_code, "body": resp.text}
            return JSONResponse(status_code=resp.status_code, content=data)
        except Exception as e:
            from fastapi import HTTPException
            raise HTTPException(status_code=502, detail=f"proxy error: {e}")

@app.get("/")
async def get():
    return HTMLResponse("""
    <!DOCTYPE html>
    <html>
    <head>
        <title>AIVtuber API Gateway</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            .status { margin: 20px 0; }
            .endpoint { background: #f5f5f5; padding: 10px; margin: 5px 0; border-radius: 5px; }
        </style>
    </head>
    <body>
        <h1>AIVtuber API Gateway</h1>
        <p>统一入口，路由到后端微服务</p>
        
        <div class="status">
            <h2>WebSocket端点</h2>
            <div class="endpoint">
                <strong>输入:</strong> /ws/input → input-handler:8001
            </div>
            <div class="endpoint">
                <strong>输出:</strong> /ws/output/{task_id} → output-handler:8002
            </div>
        </div>
        
        <div class="status">
            <h2>当前状态</h2>
            <p>活跃连接数: """ + str(len(active_connections)) + """</p>
            <p>后端服务: input-handler(8001), output-handler(8002)</p>
        </div>
        
        <div class="status">
            <h2>使用说明</h2>
            <p>前端只需连接8000端口，网关会自动路由到相应的后端服务。</p>
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
        "backend_services": BACKEND_SERVICES
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
