"""Tests for LLM function calling functionality."""

import pytest
import json
from unittest.mock import AsyncMock, MagicMock
from dialog_engine.llm_functions import (
    FUNCTION_DEFINITIONS,
    handle_tool_call,
    format_state_for_context,
    create_state_system_message
)


@pytest.mark.asyncio
async def test_handle_tool_call_update_internal_state_success():
    """Test successful internal state update via tool call."""
    # Setup
    mock_state_store = AsyncMock()
    mock_state_store.get_state.return_value = 75.5

    tool_call = {
        "name": "update_internal_state",
        "arguments": json.dumps({
            "state_key": "emotion",
            "value": 75.5
        })
    }

    session_id = "test_session"

    # Execute
    result = await handle_tool_call(tool_call, session_id, mock_state_store)

    # Verify
    assert result["success"] is True
    assert result["state_key"] == "emotion"
    assert result["new_value"] == 75.5
    assert result["session_id"] == session_id
    mock_state_store.update_state.assert_called_once_with(session_id, "emotion", 75.5)
    mock_state_store.get_state.assert_called_once_with(session_id, "emotion")


@pytest.mark.asyncio
async def test_handle_tool_call_invalid_json():
    """Test handling of invalid JSON in tool call arguments."""
    mock_state_store = AsyncMock()

    tool_call = {
        "name": "update_internal_state",
        "arguments": "invalid json"
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "Invalid arguments" in result["error"]


@pytest.mark.asyncio
async def test_handle_tool_call_missing_state_key():
    """Test handling of missing state_key parameter."""
    mock_state_store = AsyncMock()

    tool_call = {
        "name": "update_internal_state",
        "arguments": json.dumps({
            "value": 75.5
        })
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "Missing required parameter: state_key" in result["error"]


@pytest.mark.asyncio
async def test_handle_tool_call_missing_value():
    """Test handling of missing value parameter."""
    mock_state_store = AsyncMock()

    tool_call = {
        "name": "update_internal_state",
        "arguments": json.dumps({
            "state_key": "emotion"
        })
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "Missing required parameter: value" in result["error"]


@pytest.mark.asyncio
async def test_handle_tool_call_invalid_value_type():
    """Test handling of invalid value type."""
    mock_state_store = AsyncMock()

    tool_call = {
        "name": "update_internal_state",
        "arguments": json.dumps({
            "state_key": "emotion",
            "value": "not_a_number"
        })
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "must be a number" in result["error"]


@pytest.mark.asyncio
async def test_handle_tool_call_unknown_function():
    """Test handling of unknown function name."""
    mock_state_store = AsyncMock()

    tool_call = {
        "name": "unknown_function",
        "arguments": json.dumps({
            "state_key": "emotion",
            "value": 75.5
        })
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "Unknown function: unknown_function" in result["error"]


@pytest.mark.asyncio
async def test_handle_tool_call_store_exception():
    """Test handling of exceptions from state store."""
    mock_state_store = AsyncMock()
    mock_state_store.update_state.side_effect = Exception("Database error")

    tool_call = {
        "name": "update_internal_state",
        "arguments": json.dumps({
            "state_key": "emotion",
            "value": 75.5
        })
    }

    result = await handle_tool_call(tool_call, "test_session", mock_state_store)

    assert result["success"] is False
    assert "Internal error" in result["error"]


def test_format_state_for_context_empty():
    """Test formatting empty states."""
    result = format_state_for_context({})
    assert result == "暂无内部状态数据"


def test_format_state_for_context_basic():
    """Test formatting basic states."""
    states = {
        "emotion": 75.5,
        "affinity": 60.0
    }
    result = format_state_for_context(states)
    assert "情绪: 75.5" in result
    assert "好感度: 60.0" in result
    assert "当前内部状态：" in result


def test_format_state_for_context_unknown_keys():
    """Test formatting states with unknown keys."""
    states = {
        "unknown_state": 50.0,
        "another_unknown": 80.0
    }
    result = format_state_for_context(states)
    assert "unknown_state: 50.0" in result
    assert "another_unknown: 80.0" in result


def test_create_state_system_message():
    """Test creating system message with states."""
    states = {
        "emotion": 75.5,
        "affinity": 60.0
    }

    result = create_state_system_message(states)

    assert result["role"] == "system"
    assert "情绪: 75.5" in result["content"]
    assert "好感度: 60.0" in result["content"]
    assert "语气和表达方式" in result["content"]


def test_create_state_system_message_empty():
    """Test creating system message with empty states."""
    result = create_state_system_message({})

    assert result["role"] == "system"
    assert "暂无内部状态数据" in result["content"]


def test_function_definitions_structure():
    """Test that function definitions have the correct structure."""
    assert len(FUNCTION_DEFINITIONS) == 1

    func_def = FUNCTION_DEFINITIONS[0]
    assert func_def["name"] == "update_internal_state"
    assert "description" in func_def
    assert "parameters" in func_def

    params = func_def["parameters"]
    assert params["type"] == "object"
    assert "properties" in params
    assert "required" in params

    properties = params["properties"]
    assert "state_key" in properties
    assert "value" in properties
    assert properties["state_key"]["type"] == "string"
    assert properties["value"]["type"] == "number"

    required = params["required"]
    assert "state_key" in required
    assert "value" in required


if __name__ == "__main__":
    pytest.main([__file__])