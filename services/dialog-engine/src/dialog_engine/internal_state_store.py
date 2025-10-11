from __future__ import annotations

"""Internal state storage for AI emotions and affinity tracking."""

import asyncio
import os
import sqlite3
import time
from typing import Dict, Optional

import logging

logger = logging.getLogger(__name__)


class InternalStateStore:
    """SQLite-backed store for AI internal states (emotion, affinity, etc.)."""

    def __init__(self, *, db_path: str) -> None:
        self._db_path = db_path
        self._ensure_table_exists()

    def _ensure_table_exists(self) -> None:
        """Create the internal_states table if it doesn't exist."""
        if not self._db_path:
            return

        os.makedirs(os.path.dirname(self._db_path) or ".", exist_ok=True)
        conn = sqlite3.connect(self._db_path)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS internal_states (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    state_key TEXT NOT NULL,
                    state_value REAL NOT NULL,
                    updated_at INTEGER NOT NULL,
                    UNIQUE(session_id, state_key)
                )
                """,
            )
            # Create index for efficient queries
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_internal_states_session_key
                ON internal_states(session_id, state_key)
                """,
            )
            conn.commit()
        except Exception as exc:
            logger.error("Failed to create internal_states table", exc_info=True)
            raise RuntimeError("failed to create internal_states table") from exc
        finally:
            conn.close()

    async def get_state(self, session_id: str, state_key: str) -> Optional[float]:
        """Get a specific state value for a session."""
        if not self._db_path or not os.path.exists(self._db_path):
            return None

        def _query() -> Optional[float]:
            try:
                conn = sqlite3.connect(self._db_path)
                conn.row_factory = sqlite3.Row
            except Exception as exc:
                logger.debug("internal_states.connect.error", exc_info=True)
                raise RuntimeError("failed to open internal_states database") from exc

            try:
                row = conn.execute(
                    """
                    SELECT state_value
                    FROM internal_states
                    WHERE session_id = ? AND state_key = ?
                    """,
                    (session_id, state_key),
                ).fetchone()
                return float(row["state_value"]) if row else None
            except Exception as exc:
                logger.debug("internal_states.query.error", exc_info=True)
                raise RuntimeError("failed to query internal_states database") from exc
            finally:
                conn.close()

        try:
            return await asyncio.to_thread(_query)
        except (FileNotFoundError, RuntimeError):
            return None

    async def update_state(self, session_id: str, state_key: str, new_value: float) -> None:
        """Update or insert a state value for a session."""
        if not self._db_path:
            return

        def _upsert() -> None:
            os.makedirs(os.path.dirname(self._db_path) or ".", exist_ok=True)
            conn = sqlite3.connect(self._db_path)
            try:
                cur = conn.cursor()
                # Ensure table exists (defensive)
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS internal_states (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        session_id TEXT NOT NULL,
                        state_key TEXT NOT NULL,
                        state_value REAL NOT NULL,
                        updated_at INTEGER NOT NULL,
                        UNIQUE(session_id, state_key)
                    )
                    """,
                )

                # Insert or replace the state value
                cur.execute(
                    """
                    INSERT OR REPLACE INTO internal_states(session_id, state_key, state_value, updated_at)
                    VALUES(?, ?, ?, ?)
                    """,
                    (session_id, state_key, float(new_value), int(time.time())),
                )
                conn.commit()
            except Exception as exc:
                logger.error("Failed to update internal state", exc_info=True)
                raise RuntimeError("failed to update internal state") from exc
            finally:
                conn.close()

        try:
            await asyncio.to_thread(_upsert)
        except RuntimeError:
            logger.error("Failed to update internal state", exc_info=True)

    async def list_states(self, session_id: str) -> Dict[str, float]:
        """Get all state values for a session."""
        if not self._db_path or not os.path.exists(self._db_path):
            return {}

        def _query() -> Dict[str, float]:
            try:
                conn = sqlite3.connect(self._db_path)
                conn.row_factory = sqlite3.Row
            except Exception as exc:
                logger.debug("internal_states.connect.error", exc_info=True)
                raise RuntimeError("failed to open internal_states database") from exc

            try:
                rows = conn.execute(
                    """
                    SELECT state_key, state_value
                    FROM internal_states
                    WHERE session_id = ?
                    """,
                    (session_id,),
                ).fetchall()

                return {row["state_key"]: float(row["state_value"]) for row in rows}
            except Exception as exc:
                logger.debug("internal_states.query.error", exc_info=True)
                raise RuntimeError("failed to query internal_states database") from exc
            finally:
                conn.close()

        try:
            return await asyncio.to_thread(_query)
        except (FileNotFoundError, RuntimeError):
            return {}

    async def delete_state(self, session_id: str, state_key: str) -> bool:
        """Delete a specific state for a session. Returns True if deleted."""
        if not self._db_path:
            return False

        def _delete() -> bool:
            conn = sqlite3.connect(self._db_path)
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    DELETE FROM internal_states
                    WHERE session_id = ? AND state_key = ?
                    """,
                    (session_id, state_key),
                )
                conn.commit()
                return cur.rowcount > 0
            except Exception as exc:
                logger.error("Failed to delete internal state", exc_info=True)
                raise RuntimeError("failed to delete internal state") from exc
            finally:
                conn.close()

        try:
            return await asyncio.to_thread(_delete)
        except RuntimeError:
            return False

    async def clear_session(self, session_id: str) -> int:
        """Clear all states for a session. Returns number of deleted records."""
        if not self._db_path:
            return 0

        def _clear() -> int:
            conn = sqlite3.connect(self._db_path)
            try:
                cur = conn.cursor()
                cur.execute(
                    """
                    DELETE FROM internal_states
                    WHERE session_id = ?
                    """,
                    (session_id,),
                )
                conn.commit()
                return cur.rowcount
            except Exception as exc:
                logger.error("Failed to clear session states", exc_info=True)
                raise RuntimeError("failed to clear session states") from exc
            finally:
                conn.close()

        try:
            return await asyncio.to_thread(_clear)
        except RuntimeError:
            return 0


__all__ = ["InternalStateStore"]