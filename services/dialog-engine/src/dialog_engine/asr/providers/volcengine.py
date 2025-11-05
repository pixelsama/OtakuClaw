from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
import uuid
from typing import AsyncIterable, AsyncGenerator, Iterable, List, Optional, Tuple

import websockets
from websockets.exceptions import ConnectionClosed, ConnectionClosedError, ConnectionClosedOK

from ..types import AsrOptions, AsrPartial, AsrResult
from .base import AsrProvider

logger = logging.getLogger(__name__)


class VolcengineAsrError(RuntimeError):
    """Raised when Volcengine streaming encounters a fatal error."""

    def __init__(self, message: str, *, code: Optional[str] = None, log_id: Optional[str] = None) -> None:
        super().__init__(message)
        self.code = code
        self.log_id = log_id


class VolcengineAsrProvider(AsrProvider):
    """ASR provider backed by Volcengine streaming ASR WebSocket API."""

    name = "volcengine"

    _DEFAULT_ENDPOINT = "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async"
    _PROTOCOL_VERSION = 0x01
    _HEADER_UNITS = 0x01  # 4 bytes
    _MESSAGE_TYPE_CONFIG = 0x01
    _MESSAGE_TYPE_AUDIO = 0x02
    _MESSAGE_TYPE_RESPONSE = 0x09
    _MESSAGE_TYPE_ERROR = 0x0F
    _SERIALIZATION_NONE = 0x00
    _SERIALIZATION_JSON = 0x01
    _COMPRESSION_NONE = 0x00
    _FLAG_LAST_PACKET = 0x02

    def __init__(
        self,
        *,
        endpoint: Optional[str],
        app_key: Optional[str],
        access_key: Optional[str],
        resource_id: Optional[str],
        connect_id_prefix: Optional[str] = None,
        default_sample_rate: int = 16000,
        request_timeout: float = 15.0,
    ) -> None:
        self._endpoint = (endpoint or self._DEFAULT_ENDPOINT).strip()
        self._app_key = (app_key or "").strip()
        self._access_key = (access_key or "").strip()
        self._resource_id = (resource_id or "").strip()
        self._connect_id_prefix = (connect_id_prefix or "dialog-engine").strip()
        self._default_sample_rate = default_sample_rate
        self._request_timeout = request_timeout

        if not self._app_key or not self._access_key or not self._resource_id:
            raise RuntimeError("Volcengine credentials must be configured to use volcengine ASR provider")

        self._last_log_id: Optional[str] = None
        self._last_error_code: Optional[str] = None

    async def transcribe(self, *, audio: bytes, options: AsrOptions) -> AsrResult:
        async def audio_iter() -> AsyncGenerator[bytes, None]:
            if audio:
                yield audio

        partials: List[AsrPartial] = []
        async for partial in self.stream(audio=audio_iter(), options=options):
            partials.append(partial)

        final_text = partials[-1].text if partials else ""
        if not partials or not partials[-1].is_final:
            final_partial = AsrPartial(text=final_text, is_final=True)
            partials.append(final_partial)

        return AsrResult(
            text=partials[-1].text if partials else "",
            partials=partials,
            duration_seconds=None,
            provider=self.name,
        )

    async def stream(self, *, audio: AsyncIterable[bytes], options: AsrOptions) -> AsyncGenerator[AsrPartial, None]:
        endpoint = self._endpoint or self._DEFAULT_ENDPOINT
        headers = self._build_headers()
        params_payload = self._build_request_params(options)
        connect_id = headers.get("X-Api-Connect-Id")
        start_time = time.perf_counter()
        self._last_log_id = None
        self._last_error_code = None

        try:
            async with websockets.connect(
                endpoint,
                extra_headers=headers,
                max_size=None,
                ping_interval=None,
                ping_timeout=None,
                close_timeout=self._request_timeout,
            ) as ws:
                self._last_log_id = ws.response_headers.get("X-Tt-Logid") if hasattr(ws, "response_headers") else None
                logger.info(
                    "volcengine.asr.connected connect_id=%s logid=%s sample_rate=%s",
                    connect_id,
                    self._last_log_id,
                    params_payload.get("transcription", {}).get("sample_rate"),
                )
                await self._send_config(ws, params_payload)

                sequence = 0
                async for chunk in audio:
                    if not chunk:
                        continue
                    await self._send_audio_chunk(ws, chunk, seq=sequence)
                    sequence += 1

                await self._send_audio_done(ws, seq=sequence)

                async for partial in self._receive_results(ws):
                    yield partial
                self._last_error_code = None
        except (ConnectionClosedError, ConnectionClosedOK, ConnectionClosed) as exc:
            code = str(getattr(exc, "code", "")) or None
            reason = getattr(exc, "reason", "")
            logger.error(
                "volcengine.asr.connection_closed code=%s reason=%s connect_id=%s logid=%s",
                code,
                reason,
                connect_id,
                self._last_log_id,
            )
            self._last_error_code = code or "connection_closed"
            raise VolcengineAsrError(reason or "volcengine_connection_closed", code=self._last_error_code, log_id=self._last_log_id) from exc
        except VolcengineAsrError:
            raise
        except Exception as exc:
            logger.exception("volcengine.asr.stream_failed connect_id=%s logid=%s", connect_id, self._last_log_id)
            self._last_error_code = "stream_failed"
            raise VolcengineAsrError(str(exc) or "volcengine_stream_failed", code=self._last_error_code, log_id=self._last_log_id) from exc
        finally:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            logger.info(
                "asr.volcengine.latency_ms=%.1f connect_id=%s logid=%s error_code=%s",
                latency_ms,
                connect_id,
                self._last_log_id,
                self._last_error_code,
            )

    def _build_headers(self) -> dict[str, str]:
        connect_suffix = secrets.token_hex(4)
        connect_id = f"{self._connect_id_prefix}-{uuid.uuid4()}-{connect_suffix}" if self._connect_id_prefix else str(uuid.uuid4())
        return {
            "X-Api-App-Key": self._app_key,
            "X-Api-Access-Key": self._access_key,
            "X-Api-Resource-Id": self._resource_id,
            "X-Api-Connect-Id": connect_id,
        }

    def _build_request_params(self, options: AsrOptions) -> dict[str, object]:
        sample_rate = options.sample_rate or self._default_sample_rate
        payload = {
            "transcription": {
                "language": options.lang or "auto",
                "enable_intermediate_result": True,
                "enable_timestamp": bool(options.enable_timestamps),
                "sample_rate": sample_rate,
            }
        }
        return payload

    async def _send_config(self, ws: websockets.WebSocketClientProtocol, payload: dict[str, object]) -> None:
        message = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        frame = self._encode_frame(
            message_type=self._MESSAGE_TYPE_CONFIG,
            flags=0,
            serialization=self._SERIALIZATION_JSON,
            payload=message,
        )
        await ws.send(frame)

    async def _send_audio_chunk(self, ws: websockets.WebSocketClientProtocol, chunk: bytes, *, seq: int) -> None:
        frame = self._encode_frame(
            message_type=self._MESSAGE_TYPE_AUDIO,
            flags=0,
            serialization=self._SERIALIZATION_NONE,
            payload=chunk,
        )
        await ws.send(frame)

    async def _send_audio_done(self, ws: websockets.WebSocketClientProtocol, *, seq: int) -> None:
        frame = self._encode_frame(
            message_type=self._MESSAGE_TYPE_AUDIO,
            flags=self._FLAG_LAST_PACKET,
            serialization=self._SERIALIZATION_NONE,
            payload=b"",
        )
        await ws.send(frame)

    async def _receive_results(self, ws: websockets.WebSocketClientProtocol) -> AsyncGenerator[AsrPartial, None]:
        async for message in ws:
            try:
                for partial in self._parse_message(message):
                    yield partial
            except VolcengineAsrError:
                raise
            except Exception as exc:
                logger.exception("volcengine.asr.parse_failed logid=%s", self._last_log_id)
                raise VolcengineAsrError(str(exc) or "volcengine_parse_failed", log_id=self._last_log_id) from exc

    def _parse_message(self, message: object) -> Iterable[AsrPartial]:
        if isinstance(message, bytes):
            return self._parse_binary_message(message)
        if isinstance(message, str):
            return self._extract_partials_from_json(message)
        return []

    def _parse_binary_message(self, data: bytes) -> Iterable[AsrPartial]:
        if len(data) < 8:
            return []
        header = data[:4]
        payload_size = int.from_bytes(data[4:8], "big", signed=False)
        payload = data[8 : 8 + payload_size] if payload_size else b""

        message_type = (header[1] >> 4) & 0x0F
        serialization = (header[2] >> 4) & 0x0F

        if message_type == self._MESSAGE_TYPE_ERROR:
            message, code = self._extract_error(payload)
            if code in {"13", 13} or (isinstance(message, str) and "stream is done" in message.lower()):
                logger.info(
                    "volcengine.asr.stream_done code=%s logid=%s message=%s",
                    code,
                    self._last_log_id,
                    message,
                )
                return []
            raise VolcengineAsrError(message, code=code, log_id=self._last_log_id)

        if message_type != self._MESSAGE_TYPE_RESPONSE:
            return []

        if serialization == self._SERIALIZATION_JSON:
            text = payload.decode("utf-8", errors="ignore")
            return self._extract_partials_from_json(text)

        return []

    def _extract_partials_from_json(self, text: str) -> Iterable[AsrPartial]:
        if not text:
            return []
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            logger.debug("volcengine.asr.json_decode_failed: %s", text[:200])
            return []

        results: List[AsrPartial] = []

        if isinstance(payload, dict):
            if self._is_error_payload(payload):
                raise VolcengineAsrError(str(payload), log_id=self._last_log_id)

            data_candidates = []
            for key in ("data", "res", "result", "response"):
                value = payload.get(key)
                if value is not None:
                    data_candidates.append(value)
            if not data_candidates:
                data_candidates.append(payload)

            for candidate in data_candidates:
                results.extend(self._extract_partials_from_candidate(candidate))
        elif isinstance(payload, list):
            for item in payload:
                results.extend(self._extract_partials_from_candidate(item))

        return results

    def _extract_partials_from_candidate(self, candidate: object) -> List[AsrPartial]:
        partials: List[AsrPartial] = []
        if isinstance(candidate, dict):
            if "result" in candidate and isinstance(candidate["result"], list):
                for item in candidate["result"]:
                    partials.extend(self._extract_partials_from_candidate(item))
                return partials

            text_value = (
                candidate.get("text")
                or candidate.get("sentence")
                or candidate.get("transcript")
                or candidate.get("display_text")
            )
            if isinstance(text_value, list):
                text_value = " ".join(str(x) for x in text_value if x)
            if isinstance(text_value, str):
                text_value = text_value.strip()
            if text_value:
                confidence = candidate.get("confidence") or candidate.get("score")
                is_final = bool(
                    candidate.get("is_final")
                    or candidate.get("final")
                    or candidate.get("finish")
                    or candidate.get("type") in {"final", "final_result"}
                    or candidate.get("event") in {"result", "finish"}
                )
                partials.append(AsrPartial(text=text_value, confidence=_safe_float(confidence), is_final=is_final))

        return partials

    def _encode_frame(self, *, message_type: int, flags: int, serialization: int, payload: bytes) -> bytes:
        header = bytearray(4)
        header[0] = ((self._PROTOCOL_VERSION & 0x0F) << 4) | (self._HEADER_UNITS & 0x0F)
        header[1] = ((message_type & 0x0F) << 4) | (flags & 0x0F)
        header[2] = ((serialization & 0x0F) << 4) | (self._COMPRESSION_NONE & 0x0F)
        header[3] = 0x00
        payload_size = len(payload).to_bytes(4, "big", signed=False)
        return bytes(header) + payload_size + payload

    def _extract_error(self, payload: bytes) -> Tuple[str, Optional[str]]:
        message = payload.decode("utf-8", errors="ignore") if payload else ""
        code: Optional[str] = None
        if message:
            try:
                obj = json.loads(message)
                if isinstance(obj, dict):
                    code_val = obj.get("code") or obj.get("error_code")
                    if code_val is not None:
                        code = str(code_val)
                    msg_val = obj.get("message") or obj.get("msg")
                    if isinstance(msg_val, str) and msg_val.strip():
                        message = msg_val.strip()
            except json.JSONDecodeError:
                pass
        return message or "volcengine_error", code

    @staticmethod
    def _is_error_payload(payload: dict) -> bool:
        error_code = payload.get("code") or payload.get("error_code")
        if error_code is None:
            return False
        try:
            error_code = int(error_code)
        except (TypeError, ValueError):
            return True
        return error_code not in {0, 1000, 20000000}

    @property
    def last_log_id(self) -> Optional[str]:
        return self._last_log_id

    @property
    def last_error_code(self) -> Optional[str]:
        return self._last_error_code


def _safe_float(value: object) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
