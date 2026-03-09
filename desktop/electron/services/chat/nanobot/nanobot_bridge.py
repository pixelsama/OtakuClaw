#!/usr/bin/env python3
"""Nanobot sidecar bridge for Electron main process.

Protocol: JSON Lines over stdin/stdout.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class BridgeError(Exception):
    code: str
    message: str
    status: int | None = None


AGENT_CACHE_KEY: str | None = None
AGENT_INSTANCE = None
ACTIVE_TASKS: dict[str, asyncio.Task] = {}
DESKTOP_PROMPT_PATCH_FLAG = "_openclaw_desktop_prompt_patched"
DESKTOP_SKILLS_PATCH_FLAG = "_openclaw_desktop_skills_patched"

DESKTOP_REALTIME_GUIDANCE = """## Desktop Realtime Conversation Guidance
- You are speaking inside a realtime AI companion app.
- When a user request may require tool calls or multi-step work, usually begin with one short natural reply to the user before starting tools.
- That first reply should feel like spoken conversation and stay in character. Keep it brief.
- Do not expose internal reasoning, chain-of-thought, tool names, function syntax, file paths, or execution details in user-facing progress replies.
- If no tool is needed, answer directly instead of narrating actions.
- If you send progress-style updates, keep them short, warm, and user-facing."""


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def normalize_string(value: Any, fallback: str = "") -> str:
    if not isinstance(value, str):
        return fallback
    return value.strip()


def normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    fallback_workspace = normalize_string(
        os.environ.get("NANOBOT_WORKSPACE"),
        str(Path.home() / ".nanobot" / "workspace"),
    )
    max_tokens = config.get("maxTokens")
    if not isinstance(max_tokens, int) or max_tokens <= 0:
        max_tokens = 4096

    temperature = config.get("temperature")
    if not isinstance(temperature, (float, int)):
        temperature = 0.2

    return {
        "workspace": normalize_string(config.get("workspace"), fallback_workspace) or fallback_workspace,
        "allowHighRiskTools": bool(config.get("allowHighRiskTools")),
        "provider": normalize_string(config.get("provider"), "openrouter") or "openrouter",
        "model": normalize_string(config.get("model"), "anthropic/claude-opus-4-5") or "anthropic/claude-opus-4-5",
        "apiBase": normalize_string(config.get("apiBase"), ""),
        "apiKey": normalize_string(config.get("apiKey"), ""),
        "maxTokens": max_tokens,
        "temperature": float(temperature),
        "reasoningEffort": normalize_string(config.get("reasoningEffort"), ""),
    }


def config_key(config: dict[str, Any]) -> str:
    return json.dumps(config, sort_keys=True, ensure_ascii=False)


def load_nanobot_modules() -> dict[str, Any]:
    repo_path = normalize_string(os.environ.get("NANOBOT_REPO_PATH"))
    if repo_path:
        path_obj = Path(repo_path)
        if path_obj.exists():
            sys.path.insert(0, str(path_obj))

    try:
        from nanobot.agent.loop import AgentLoop
        from nanobot.agent.context import ContextBuilder
        try:
            from nanobot.agent.skills import SkillsLoader
        except Exception:  # pragma: no cover - runtime-compat path
            SkillsLoader = None
        from nanobot.bus.events import InboundMessage
        from nanobot.bus.queue import MessageBus
        from nanobot.config.schema import ExecToolConfig
        from nanobot.providers.custom_provider import CustomProvider
        from nanobot.providers.litellm_provider import LiteLLMProvider
        from nanobot.providers.registry import find_by_name
    except Exception as exc:  # pragma: no cover - runtime-probing path
        raise BridgeError(
            code="nanobot_runtime_not_ready",
            message=f"Nanobot runtime not ready: {exc}",
        ) from exc

    return {
        "AgentLoop": AgentLoop,
        "ContextBuilder": ContextBuilder,
        "SkillsLoader": SkillsLoader,
        "InboundMessage": InboundMessage,
        "MessageBus": MessageBus,
        "ExecToolConfig": ExecToolConfig,
        "CustomProvider": CustomProvider,
        "LiteLLMProvider": LiteLLMProvider,
        "find_by_name": find_by_name,
    }


def patch_context_builder(modules: dict[str, Any]) -> None:
    context_builder_cls = modules["ContextBuilder"]
    if getattr(context_builder_cls, DESKTOP_PROMPT_PATCH_FLAG, False):
        return

    original_get_identity = context_builder_cls._get_identity

    def patched_get_identity(self):
        base = original_get_identity(self)
        if DESKTOP_REALTIME_GUIDANCE in base:
            return base
        return f"{base}\n\n{DESKTOP_REALTIME_GUIDANCE}"

    context_builder_cls._get_identity = patched_get_identity
    setattr(context_builder_cls, DESKTOP_PROMPT_PATCH_FLAG, True)


def patch_skills_loader(modules: dict[str, Any]) -> None:
    skills_loader_cls = modules.get("SkillsLoader")
    if not skills_loader_cls:
        return

    skills_root = normalize_string(os.environ.get("NANOBOT_DESKTOP_SKILLS_PATH"))
    if not skills_root:
        return

    if getattr(skills_loader_cls, DESKTOP_SKILLS_PATCH_FLAG, False):
        return

    custom_workspace_skills = Path(skills_root).expanduser().resolve()
    custom_workspace_skills.mkdir(parents=True, exist_ok=True)
    original_init = skills_loader_cls.__init__

    def patched_init(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        try:
            self.workspace_skills = custom_workspace_skills
        except Exception:
            # Runtime compatibility fallback: keep upstream default workspace skill path.
            pass

    skills_loader_cls.__init__ = patched_init
    setattr(skills_loader_cls, DESKTOP_SKILLS_PATCH_FLAG, True)


def create_provider(modules: dict[str, Any], config: dict[str, Any]):
    provider_name = config["provider"]
    model = config["model"]
    api_key = config["apiKey"]
    api_base = config["apiBase"] or None

    if provider_name == "custom":
        if not api_base:
            raise BridgeError("nanobot_missing_config", "Custom provider requires apiBase.")
        custom_provider = modules["CustomProvider"]
        return custom_provider(
            api_key=api_key or "no-key",
            api_base=api_base,
            default_model=model,
        )

    spec = modules["find_by_name"](provider_name)
    if not spec:
        raise BridgeError("nanobot_provider_unavailable", f"Unknown Nanobot provider: {provider_name}")

    if not spec.is_oauth and not api_key:
        raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

    lite_llm_provider = modules["LiteLLMProvider"]
    return lite_llm_provider(
        api_key=api_key or None,
        api_base=api_base,
        default_model=model,
        provider_name=provider_name,
    )


def create_agent(config: dict[str, Any]):
    modules = load_nanobot_modules()
    patch_context_builder(modules)
    patch_skills_loader(modules)

    workspace = Path(config["workspace"]).expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)

    provider = create_provider(modules, config)
    agent_loop_cls = modules["AgentLoop"]
    message_bus_cls = modules["MessageBus"]
    exec_tool_config_cls = modules["ExecToolConfig"]

    agent = agent_loop_cls(
        bus=message_bus_cls(),
        provider=provider,
        workspace=workspace,
        model=config["model"],
        temperature=config["temperature"],
        max_tokens=config["maxTokens"],
        max_iterations=12,
        memory_window=50,
        reasoning_effort=config["reasoningEffort"] or None,
        exec_config=exec_tool_config_cls(timeout=15),
        restrict_to_workspace=True,
    )

    if not config["allowHighRiskTools"]:
        # Keep the default desktop profile file-scoped unless the user explicitly opts in.
        for tool_name in ("exec", "spawn", "web_search", "web_fetch", "cron"):
            agent.tools.unregister(tool_name)

    return agent


def get_or_create_agent(config: dict[str, Any]):
    global AGENT_CACHE_KEY, AGENT_INSTANCE

    key = config_key(config)
    if AGENT_INSTANCE is not None and AGENT_CACHE_KEY == key:
        return AGENT_INSTANCE

    AGENT_INSTANCE = create_agent(config)
    AGENT_CACHE_KEY = key
    return AGENT_INSTANCE


def map_exception(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, BridgeError):
        payload = {
            "code": exc.code,
            "message": exc.message,
        }
        if exc.status is not None:
            payload["status"] = exc.status
        return payload

    return {
        "code": "nanobot_model_call_failed",
        "message": str(exc) or "Nanobot model call failed.",
    }


def first_progress_block(content: str) -> str:
    normalized = normalize_string(content)
    if not normalized:
        return ""

    blocks = [block.strip() for block in re.split(r"\n\s*\n", normalized) if block.strip()]
    if not blocks:
        return ""

    first_block = blocks[0]
    if first_block.lower().startswith("thinking ["):
        return ""
    return first_block


async def handle_start(
    request_id: str,
    session_id: str,
    content: str,
    media_paths: list[str],
    config: dict[str, Any],
) -> None:
    try:
        if not content:
            raise BridgeError("nanobot_missing_config", "Chat content is required.")

        normalized = normalize_config(config)
        if not normalized["apiKey"]:
            raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

        agent = get_or_create_agent(normalized)
        inbound_message_cls = load_nanobot_modules()["InboundMessage"]
        has_visible_progress = False

        async def on_progress(progress_content: str, *, tool_hint: bool = False) -> None:
            nonlocal has_visible_progress

            if tool_hint:
                hint = normalize_string(progress_content)
                if not hint:
                    return
                emit(
                    {
                        "type": "event",
                        "requestId": request_id,
                        "event": {
                            "type": "tool-hint",
                            "payload": {
                                "content": hint,
                                "source": "nanobot",
                            },
                        },
                    }
                )
                return

            visible_text = first_progress_block(progress_content)
            if not visible_text:
                return

            has_visible_progress = True
            emit(
                {
                    "type": "event",
                    "requestId": request_id,
                    "event": {
                        "type": "progress",
                        "payload": {
                            "content": visible_text,
                            "source": "nanobot",
                        },
                    },
                }
            )

        response = await agent._process_message(
            inbound_message_cls(
                channel="desktop",
                sender_id="user",
                chat_id=session_id or "default",
                content=content,
                media=list(media_paths or []),
                metadata={},
            ),
            on_progress=on_progress,
        )

        final_text = normalize_string(response.content if response is not None else "")
        if final_text:
            emit(
                {
                    "type": "event",
                    "requestId": request_id,
                    "event": {
                        "type": "text-delta",
                        "payload": {
                            "content": final_text,
                            "source": "nanobot",
                            "final": True,
                            "hadProgress": has_visible_progress,
                        },
                    },
                }
            )

        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "done",
                    "payload": {"source": "nanobot"},
                },
            }
        )
    except asyncio.CancelledError:
        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "done",
                    "payload": {"source": "nanobot", "aborted": True},
                },
            }
        )
    except Exception as exc:  # pragma: no cover - mapped runtime path
        emit(
            {
                "type": "event",
                "requestId": request_id,
                "event": {
                    "type": "error",
                    "payload": map_exception(exc),
                },
            }
        )


async def handle_test(request_id: str, config: dict[str, Any]) -> None:
    started_at = time.perf_counter()
    try:
        normalized = normalize_config(config)
        if not normalized["apiKey"]:
            raise BridgeError("nanobot_missing_config", "Nanobot API Key is required.")

        agent = get_or_create_agent(normalized)

        await asyncio.wait_for(
            agent.process_direct(
                content="ping",
                session_key=f"desktop:test:{request_id}",
                channel="desktop",
                chat_id="settings-test",
            ),
            timeout=60,
        )

        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": True,
                "latencyMs": int((time.perf_counter() - started_at) * 1000),
            }
        )
    except asyncio.CancelledError:
        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": False,
                "error": {
                    "code": "aborted",
                    "message": "aborted",
                },
            }
        )
    except Exception as exc:  # pragma: no cover - mapped runtime path
        emit(
            {
                "type": "test-result",
                "requestId": request_id,
                "ok": False,
                "error": map_exception(exc),
            }
        )


async def process_message(payload: dict[str, Any]) -> None:
    request_id = normalize_string(payload.get("requestId"))
    msg_type = normalize_string(payload.get("type"))
    if not request_id:
        return

    if msg_type == "abort":
        task = ACTIVE_TASKS.get(request_id)
        if task:
            task.cancel()
        return

    if msg_type == "start":
        session_id = normalize_string(payload.get("sessionId"), "default")
        content = normalize_string(payload.get("content"))
        media_paths = payload.get("mediaPaths") if isinstance(payload.get("mediaPaths"), list) else []
        media_paths = [normalize_string(item) for item in media_paths if normalize_string(item)]
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        task = asyncio.create_task(handle_start(request_id, session_id, content, media_paths, config))
        ACTIVE_TASKS[request_id] = task
        task.add_done_callback(lambda _: ACTIVE_TASKS.pop(request_id, None))
        return

    if msg_type == "test":
        config = payload.get("config") if isinstance(payload.get("config"), dict) else {}
        task = asyncio.create_task(handle_test(request_id, config))
        ACTIVE_TASKS[request_id] = task
        task.add_done_callback(lambda _: ACTIVE_TASKS.pop(request_id, None))


async def read_stdin_loop() -> None:
    while True:
        line = await asyncio.to_thread(sys.stdin.readline)
        if line == "":
            break

        stripped = line.strip()
        if not stripped:
            continue

        try:
            payload = json.loads(stripped)
        except json.JSONDecodeError:
            continue

        if not isinstance(payload, dict):
            continue

        await process_message(payload)


async def main() -> None:
    emit({"type": "ready"})
    await read_stdin_loop()

    for task in list(ACTIVE_TASKS.values()):
        task.cancel()

    if ACTIVE_TASKS:
        await asyncio.gather(*ACTIVE_TASKS.values(), return_exceptions=True)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
