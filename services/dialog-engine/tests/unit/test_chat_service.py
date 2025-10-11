import asyncio
import base64
from typing import Iterable, List, Optional, Dict

import pytest

from dialog_engine.chat_service import ChatService
from dialog_engine.llm_client import LLMStreamEmptyError
from dialog_engine.memory_store import MemoryTurn
from dialog_engine.settings import (
    AsrSettings,
    LLMSettings,
    LTMInlineSettings,
    PromptSettings,
    OpenAISettings,
    Settings,
    ShortTermMemorySettings,
)


def _make_settings(
    *,
    enabled: bool,
    stm_enabled: bool = False,
    ltm_enabled: bool = False,
    base_url: Optional[str] = None,
    system_prompt: str = "你是一位后端定义的虚拟主播助手。",
) -> Settings:
    return Settings(
        openai=OpenAISettings(api_key=None, organization=None, base_url=None),
        llm=LLMSettings(
            enabled=enabled,
            model="dummy",
            temperature=0.0,
            max_tokens=128,
            top_p=1.0,
            frequency_penalty=0.0,
            presence_penalty=0.0,
            timeout=1.0,
            retry_limit=0,
            retry_backoff_seconds=0.0,
        ),
        prompts=PromptSettings(system_prompt=system_prompt),
        short_term=ShortTermMemorySettings(
            enabled=stm_enabled,
            db_path=":memory:",
            context_turns=5,
        ),
        ltm_inline=LTMInlineSettings(
            enabled=ltm_enabled,
            base_url=base_url,
            retrieve_path="/ltm",
            timeout=1.0,
            max_snippets=3,
        ),
        asr=AsrSettings(
            enabled=True,
            provider="mock",
            max_bytes=1024 * 1024,
            max_duration_seconds=60.0,
            target_sample_rate=16000,
            target_channels=1,
            default_lang="zh",
            whisper_model="base",
            whisper_device="auto",
            whisper_compute_type="int8",
            whisper_beam_size=1,
            whisper_cache_dir=None,
        ),
    )


class _StubLLMClient:
    def __init__(self, responses: Iterable[str], *, vision_reply: str = "Vision response") -> None:
        self._responses = list(responses)
        self.calls: List[list[dict[str, str]]] = []
        self.vision_calls: List[list[dict[str, object]]] = []
        self._vision_reply = vision_reply

    async def stream_chat(self, messages, **kwargs):
        self.calls.append(list(messages))
        for token in self._responses:
            await asyncio.sleep(0)
            yield token

    async def generate_vision_reply(self, messages, **kwargs):
        self.vision_calls.append(list(messages))
        await asyncio.sleep(0)
        return self._vision_reply


class _FailingLLMClient:
    async def stream_chat(self, messages, **kwargs):
        if False:
            yield ""  # pragma: no cover - ensure object is async generator
        raise RuntimeError("boom")

    async def generate_vision_reply(self, messages, **kwargs):
        raise RuntimeError("vision boom")


class _EmptyLLMClient:
    async def stream_chat(self, messages, **kwargs):
        if False:
            yield ""  # pragma: no cover
        raise LLMStreamEmptyError("no content", tool_calls=[{"name": "dummy"}])

    async def generate_vision_reply(self, messages, **kwargs):
        raise LLMStreamEmptyError("no content")


class _StubMemoryStore:
    def __init__(self, turns: Iterable[MemoryTurn]) -> None:
        self.turns = list(turns)
        self.calls: List[tuple[str, Optional[int]]] = []

    async def fetch_recent(self, session_id: str, limit: Optional[int] = None):
        self.calls.append((session_id, limit))
        return list(self.turns)


class _StubLTMClient:
    def __init__(self, snippets: Iterable[str]) -> None:
        self.snippets = list(snippets)
        self.calls: List[tuple[str, str, dict]] = []

    def is_configured(self) -> bool:
        return True

    async def retrieve(self, *, session_id: str, user_text: str, meta, limit=None):
        self.calls.append((session_id, user_text, dict(meta)))
        return list(self.snippets)


class _ToolCallLLMClient:
    def __init__(self, responses: Iterable[str]) -> None:
        self._responses = list(responses)
        self.calls: List[list[Dict[str, object]]] = []
        self.invocations = 0

    async def stream_chat(self, messages, **kwargs):
        self.calls.append(list(messages))
        self.invocations += 1
        if self.invocations == 1:
            if False:
                yield ""  # pragma: no cover
            raise LLMStreamEmptyError(
                "tool",
                tool_calls=[
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "update_internal_state",
                            "arguments": '{"state_key":"emotion","value":80}',
                        },
                    }
                ],
            )
        for token in self._responses:
            await asyncio.sleep(0)
            yield token

    async def generate_vision_reply(self, messages, **kwargs):
        if False:
            return ""  # pragma: no cover
        raise RuntimeError("not used")


class _StubStateStore:
    def __init__(self):
        self.states: Dict[str, Dict[str, float]] = {}

    async def update_state(self, session_id: str, state_key: str, new_value: float):
        self.states.setdefault(session_id, {})[state_key] = new_value

    async def get_state(self, session_id: str, state_key: str):
        return self.states.get(session_id, {}).get(state_key)

    async def list_states(self, session_id: str):
        return self.states.get(session_id, {})


@pytest.mark.asyncio
async def test_stream_reply_mock_path():
    service = ChatService(settings=_make_settings(enabled=False))

    chunks = []
    async for delta in service.stream_reply("session", "你好", meta={"lang": "zh"}):
        chunks.append(delta)

    text = "".join(chunks).strip()
    assert "你说「你好」" in text
    assert service.last_source == "mock"
    assert service.last_ttft_ms is not None
    assert service.last_token_count > 0
    assert service.last_error is None


@pytest.mark.asyncio
async def test_stream_reply_llm_path():
    stub = _StubLLMClient(["Hello", " world"])
    service = ChatService(
        settings=_make_settings(enabled=True),
        llm_client_factory=lambda: stub,
    )

    chunks = []
    async for delta in service.stream_reply("live-1", "hello", meta={}):
        chunks.append(delta)

    assert "".join(chunks) == "Hello world"
    assert service.last_source == "llm"
    assert service.last_token_count >= 2
    assert stub.calls
    assert stub.calls[0][-1]["content"] == "hello"


@pytest.mark.asyncio
async def test_stream_reply_llm_failure_fallback():
    service = ChatService(
        settings=_make_settings(enabled=True),
        llm_client_factory=_FailingLLMClient,
    )

    chunks = []
    async for delta in service.stream_reply("live-err", "test", meta={"lang": "en"}):
        chunks.append(delta)

    assert "You said: 'test'" in "".join(chunks)
    assert service.last_source == "mock"
    assert service.last_error == "RuntimeError"
    assert service.last_token_count > 0


@pytest.mark.asyncio
async def test_stream_reply_llm_empty_stream_fallback():
    service = ChatService(
        settings=_make_settings(enabled=True),
        llm_client_factory=_EmptyLLMClient,
    )

    chunks = []
    async for delta in service.stream_reply("live-empty", "test", meta={"lang": "en"}):
        chunks.append(delta)

    assert "You said: 'test'" in "".join(chunks)
    assert service.last_source == "mock"
    assert service.last_error == "llm_empty_stream"


@pytest.mark.asyncio
async def test_stream_reply_llm_includes_short_term_context():
    stub_llm = _StubLLMClient(["Done"])
    memory_turns = [
        MemoryTurn(role="user", content="之前的提问"),
        MemoryTurn(role="assistant", content="之前的回答"),
    ]
    memory_store = _StubMemoryStore(memory_turns)
    service = ChatService(
        settings=_make_settings(enabled=True, stm_enabled=True),
        llm_client_factory=lambda: stub_llm,
        memory_store=memory_store,
    )

    async for _ in service.stream_reply("sess-ctx", "新的问题", meta={}):
        pass

    assert memory_store.calls
    sent_messages = stub_llm.calls[0]
    assert sent_messages[0]["role"] == "user" or sent_messages[0]["role"] == "system"
    assert any(msg["content"] == "之前的提问" for msg in sent_messages)
    assert any(msg["content"] == "之前的回答" for msg in sent_messages)


@pytest.mark.asyncio
async def test_stream_reply_llm_includes_ltm_snippets():
    stub_llm = _StubLLMClient(["Done"])
    ltm_client = _StubLTMClient(["记忆片段一", "记忆片段二"])
    service = ChatService(
        settings=_make_settings(enabled=True, ltm_enabled=True, base_url="http://ltm"),
        llm_client_factory=lambda: stub_llm,
        ltm_client=ltm_client,
    )

    async for _ in service.stream_reply("sess-ltm", "当前问题", meta={"lang": "zh"}):
        pass

    assert ltm_client.calls
    sent_messages = stub_llm.calls[0]
    system_blocks = [m for m in sent_messages if m["role"] == "system"]
    assert any("Relevant memories" in m["content"] for m in system_blocks)


@pytest.mark.asyncio
async def test_stream_reply_llm_handles_tool_call_then_continues():
    stub_llm = _ToolCallLLMClient(["情绪已经同步调整，感谢你的分享！"])
    state_store = _StubStateStore()
    service = ChatService(
        settings=_make_settings(enabled=True),
        llm_client_factory=lambda: stub_llm,
        state_store=state_store,
    )

    chunks: List[str] = []
    async for delta in service.stream_reply(
        "sess-tool",
        "我今天特别开心，你也调整一下情绪吧",
        meta={},
    ):
        chunks.append(delta)

    reply = "".join(chunks)
    assert "情绪" in reply
    assert state_store.states["sess-tool"]["emotion"] == 80
    assert stub_llm.invocations == 2
    assert any(
        isinstance(msg, dict) and msg.get("tool_calls")
        for msg in stub_llm.calls[1]
    )


@pytest.mark.asyncio
async def test_stream_reply_llm_uses_backend_system_prompt():
    backend_prompt = "后端维护的系统提示词。"
    stub_llm = _StubLLMClient(["Hi"])
    service = ChatService(
        settings=_make_settings(enabled=True, system_prompt=backend_prompt),
        llm_client_factory=lambda: stub_llm,
    )

    async for _ in service.stream_reply(
        "sess-system",
        "hello",
        meta={"system_prompt": "前端尝试覆盖"},
    ):
        pass

    sent_messages = stub_llm.calls[0]
    assert sent_messages[0]["role"] == "system"
    assert sent_messages[0]["content"] == backend_prompt
    assert all(msg.get("content") != "前端尝试覆盖" for msg in sent_messages if isinstance(msg, dict))


@pytest.mark.asyncio
async def test_stream_reply_llm_logs_context_counts(caplog):
    stub_llm = _StubLLMClient(["Done"])
    memory_turns = [MemoryTurn(role="user", content="Q1"), MemoryTurn(role="assistant", content="A1")]
    memory_store = _StubMemoryStore(memory_turns)
    ltm_client = _StubLTMClient(["记忆片段"])
    service = ChatService(
        settings=_make_settings(enabled=True, stm_enabled=True, ltm_enabled=True, base_url="http://ltm"),
        llm_client_factory=lambda: stub_llm,
        memory_store=memory_store,
        ltm_client=ltm_client,
    )

    with caplog.at_level("INFO"):
        async for _ in service.stream_reply("sess-log", "新的问题", meta={}):
            pass

    records = [record for record in caplog.records if record.msg == "chat.context.loaded"]
    assert records
    assert records[0].stm_turns == 2
    assert records[0].ltm_snippets == 1


@pytest.mark.asyncio
async def test_describe_image_with_llm():
    stub = _StubLLMClient(["ignored"], vision_reply="这是一只可爱的猫咪。")
    service = ChatService(
        settings=_make_settings(enabled=True),
        llm_client_factory=lambda: stub,
    )

    image_b64 = base64.b64encode(b"fake-bytes").decode("ascii")
    result = await service.describe_image(
        "sess-vision",
        image_b64=image_b64,
        prompt="请描述这张图片",
        mime_type="image/png",
        meta={"lang": "zh"},
    )

    assert result["reply"].startswith("这是一只可爱的猫咪")
    assert result["prompt"] == "请描述这张图片"
    assert service.last_source == "llm"
    assert stub.vision_calls
    last_message = stub.vision_calls[0][-1]
    assert last_message["role"] == "user"
    content_items = last_message["content"]
    assert any(item.get("type") == "image_url" for item in content_items)


@pytest.mark.asyncio
async def test_describe_image_mock_fallback_when_llm_disabled():
    service = ChatService(settings=_make_settings(enabled=False))
    image_b64 = base64.b64encode(b"fake-bytes").decode("ascii")

    result = await service.describe_image(
        "sess-vision-mock",
        image_b64=image_b64,
        prompt=None,
        mime_type="image/jpeg",
        meta={"lang": "en"},
    )

    assert "imagine" in result["reply"].lower()
    assert result["prompt"] == "请描述这张图片。"
    assert service.last_source == "mock"
    assert service.last_token_count > 0
