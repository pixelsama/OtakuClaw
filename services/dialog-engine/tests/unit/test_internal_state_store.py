"""Tests for InternalStateStore."""

import os
import tempfile
import pytest
import asyncio
from dialog_engine.internal_state_store import InternalStateStore


@pytest.fixture
def temp_db_path():
    """Create a temporary database file path."""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    yield db_path
    # Cleanup
    if os.path.exists(db_path):
        os.unlink(db_path)


@pytest.fixture
def state_store(temp_db_path):
    """Create an InternalStateStore instance with temporary database."""
    store = InternalStateStore(db_path=temp_db_path)
    yield store
    # No explicit cleanup needed as temp file will be deleted


@pytest.mark.asyncio
async def test_update_and_get_state(state_store):
    """Test updating and retrieving a single state."""
    session_id = "test_session"
    state_key = "emotion"
    state_value = 75.5

    # Update state
    await state_store.update_state(session_id, state_key, state_value)

    # Get state
    retrieved_value = await state_store.get_state(session_id, state_key)
    assert retrieved_value == state_value


@pytest.mark.asyncio
async def test_get_nonexistent_state(state_store):
    """Test getting a state that doesn't exist."""
    session_id = "nonexistent_session"
    state_key = "nonexistent_state"

    retrieved_value = await state_store.get_state(session_id, state_key)
    assert retrieved_value is None


@pytest.mark.asyncio
async def test_list_states(state_store):
    """Test listing all states for a session."""
    session_id = "test_session"
    states = {
        "emotion": 75.5,
        "affinity": 60.0,
        "energy": 80.2
    }

    # Update multiple states
    for key, value in states.items():
        await state_store.update_state(session_id, key, value)

    # List all states
    retrieved_states = await state_store.list_states(session_id)
    assert retrieved_states == states


@pytest.mark.asyncio
async def test_list_states_empty(state_store):
    """Test listing states for a session with no states."""
    session_id = "empty_session"

    retrieved_states = await state_store.list_states(session_id)
    assert retrieved_states == {}


@pytest.mark.asyncio
async def test_update_existing_state(state_store):
    """Test updating an existing state value."""
    session_id = "test_session"
    state_key = "emotion"
    initial_value = 50.0
    updated_value = 80.0

    # Set initial value
    await state_store.update_state(session_id, state_key, initial_value)
    assert await state_store.get_state(session_id, state_key) == initial_value

    # Update to new value
    await state_store.update_state(session_id, state_key, updated_value)
    assert await state_store.get_state(session_id, state_key) == updated_value


@pytest.mark.asyncio
async def test_delete_state(state_store):
    """Test deleting a specific state."""
    session_id = "test_session"
    state_key = "emotion"
    state_value = 75.5

    # Set initial state
    await state_store.update_state(session_id, state_key, state_value)
    assert await state_store.get_state(session_id, state_key) == state_value

    # Delete state
    deleted = await state_store.delete_state(session_id, state_key)
    assert deleted is True
    assert await state_store.get_state(session_id, state_key) is None


@pytest.mark.asyncio
async def test_delete_nonexistent_state(state_store):
    """Test deleting a state that doesn't exist."""
    session_id = "test_session"
    state_key = "nonexistent_state"

    # Try to delete nonexistent state
    deleted = await state_store.delete_state(session_id, state_key)
    assert deleted is False


@pytest.mark.asyncio
async def test_clear_session(state_store):
    """Test clearing all states for a session."""
    session_id = "test_session"
    states = {
        "emotion": 75.5,
        "affinity": 60.0,
        "energy": 80.2
    }

    # Set up states
    for key, value in states.items():
        await state_store.update_state(session_id, key, value)
    assert await state_store.list_states(session_id) == states

    # Clear session
    deleted_count = await state_store.clear_session(session_id)
    assert deleted_count == len(states)
    assert await state_store.list_states(session_id) == {}


@pytest.mark.asyncio
async def test_clear_empty_session(state_store):
    """Test clearing a session with no states."""
    session_id = "empty_session"

    deleted_count = await state_store.clear_session(session_id)
    assert deleted_count == 0


@pytest.mark.asyncio
async def test_multiple_sessions_isolation(state_store):
    """Test that different sessions don't interfere with each other."""
    session1_id = "session1"
    session2_id = "session2"

    # Set different states for different sessions
    await state_store.update_state(session1_id, "emotion", 70.0)
    await state_store.update_state(session2_id, "emotion", 80.0)
    await state_store.update_state(session1_id, "affinity", 60.0)

    # Verify isolation
    session1_states = await state_store.list_states(session1_id)
    session2_states = await state_store.list_states(session2_id)

    assert session1_states == {"emotion": 70.0, "affinity": 60.0}
    assert session2_states == {"emotion": 80.0}


@pytest.mark.asyncio
async def test_invalid_db_path():
    """Test behavior with invalid database path."""
    # Store with None path should not crash
    store = InternalStateStore(db_path=None)

    # Operations should safely return defaults
    assert await store.get_state("session", "key") is None
    assert await store.list_states("session") == {}
    assert await store.delete_state("session", "key") is False
    assert await store.clear_session("session") == 0

    # Update should not crash
    await store.update_state("session", "key", 50.0)  # Should not raise exception


if __name__ == "__main__":
    pytest.main([__file__])