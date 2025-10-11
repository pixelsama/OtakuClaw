"""Function calling definitions and handlers for AI internal state management."""

import json
import logging
from typing import Dict, Any

logger = logging.getLogger(__name__)

# State value constraints
STATE_MIN_VALUE = 0
STATE_MAX_VALUE = 100

# Function definitions for OpenAI function calling
FUNCTION_DEFINITIONS = [
    {
        "name": "update_internal_state",
        "description": "更新 AI 的内部状态，如情绪值或好感度。可以用来表达当前的情感状态或对用户的态度变化。",
        "parameters": {
            "type": "object",
            "properties": {
                "state_key": {
                    "type": "string",
                    "description": "状态名，如 'emotion'（情绪）、'affinity'（好感度）、'energy'（能量）等"
                },
                "value": {
                    "type": "number",
                    "description": "新的数值，通常范围在 0-100 之间。数值越高表示正面情绪或好感度越高"
                }
            },
            "required": ["state_key", "value"]
        }
    }
]

# Tool definitions for modern OpenAI/DeepSeek tools format
TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "update_internal_state",
            "description": "更新 AI 的内部状态，如情绪值或好感度。可以用来表达当前的情感状态或对用户的态度变化。",
            "parameters": {
                "type": "object",
                "properties": {
                    "state_key": {
                        "type": "string",
                        "description": "状态名，如 'emotion'（情绪）、'affinity'（好感度）、'energy'（能量）等"
                    },
                    "value": {
                        "type": "number",
                        "description": "新的数值，通常范围在 0-100 之间。数值越高表示正面情绪或好感度越高"
                    }
                },
                "required": ["state_key", "value"]
            }
        }
    }
]

async def handle_tool_call(tool_call: Dict[str, Any], session_id: str, state_store) -> Dict[str, Any]:
    """
    Handle a tool call from the LLM.

    Args:
        tool_call: The tool call object from the LLM
        session_id: The current session ID
        state_store: The InternalStateStore instance

    Returns:
        Dict containing the result of the tool call
    """
    try:
        function_name = tool_call.get("name")
        arguments_str = tool_call.get("arguments", "{}")

        if function_name == "update_internal_state":
            # Parse arguments
            try:
                args = json.loads(arguments_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse tool call arguments: {arguments_str}", exc_info=True)
                return {
                    "success": False,
                    "error": f"Invalid arguments: {str(e)}"
                }

            # Validate required parameters
            state_key = args.get("state_key")
            value = args.get("value")

            if state_key is None:
                return {
                    "success": False,
                    "error": "Missing required parameter: state_key"
                }

            if value is None:
                return {
                    "success": False,
                    "error": "Missing required parameter: value"
                }

            # Convert value to float
            try:
                value = float(value)
            except (ValueError, TypeError):
                return {
                    "success": False,
                    "error": f"Invalid value type: {value} must be a number"
                }

            # Add boundary check for state values
            if not STATE_MIN_VALUE <= value <= STATE_MAX_VALUE:
                return {
                    "success": False,
                    "error": f"Value {value} out of valid range ({STATE_MIN_VALUE}-{STATE_MAX_VALUE}). State values should be between {STATE_MIN_VALUE} and {STATE_MAX_VALUE}."
                }

            # Update the state
            await state_store.update_state(session_id, state_key, value)

            # Get updated value for confirmation
            updated_value = await state_store.get_state(session_id, state_key)

            logger.info(f"Updated internal state: session={session_id}, key={state_key}, value={value}")

            return {
                "success": True,
                "message": f"Successfully updated {state_key} to {value}",
                "session_id": session_id,
                "state_key": state_key,
                "old_value": None,  # We could track this if needed
                "new_value": updated_value
            }

        else:
            return {
                "success": False,
                "error": f"Unknown function: {function_name}"
            }

    except Exception as exc:
        logger.error(f"Error handling tool call: {exc}", exc_info=True)
        return {
            "success": False,
            "error": f"Internal error: {str(exc)}"
        }


def format_state_for_context(states: Dict[str, float]) -> str:
    """
    Format internal states for inclusion in LLM context.

    Args:
        states: Dictionary of state key -> value

    Returns:
        Formatted string describing current states
    """
    if not states:
        return "暂无内部状态数据"

    # Define some common state descriptions
    state_descriptions = {
        "emotion": "情绪",
        "affinity": "好感度",
        "energy": "能量",
        "mood": "心情",
        "trust": "信任度",
        "engagement": "参与度"
    }

    formatted_states = []
    for key, value in states.items():
        description = state_descriptions.get(key, key)
        formatted_states.append(f"{description}: {value:.1f}")

    return "当前内部状态：" + "，".join(formatted_states)


def create_state_system_message(states: Dict[str, float]) -> Dict[str, str]:
    """
    Create a system message that includes current internal states.

    Args:
        states: Dictionary of state key -> value

    Returns:
        System message dict for inclusion in conversation
    """
    state_summary = format_state_for_context(states)

    return {
        "role": "system",
        "content": f"{state_summary}。请根据这些内部状态调整你的语气和表达方式。例如：情绪值高时可以更热情友好，情绪值低时可以更冷静克制。好感度高时可以更亲近自然，好感度低时可以保持适当距离。"
    }


__all__ = [
    "FUNCTION_DEFINITIONS",
    "TOOL_DEFINITIONS",
    "handle_tool_call",
    "format_state_for_context",
    "create_state_system_message"
]