from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from .text import lexical_score


class MemoryStore:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._initialize()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_messages_session
                    ON messages(session_id, id);
                CREATE TABLE IF NOT EXISTS memories (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    content TEXT NOT NULL UNIQUE,
                    metadata TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS documents (
                    url TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                """
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def add_message(self, session_id: str, role: str, content: str) -> None:
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO messages(session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
                (session_id, role, content, self._now()),
            )

    def recent_messages(self, session_id: str, limit: int = 8) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT role, content, created_at FROM messages WHERE session_id=? ORDER BY id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def remember(self, content: str, metadata: dict | None = None) -> bool:
        content = content.strip()
        if not content:
            return False
        with self._lock, self._connect() as connection:
            cursor = connection.execute(
                "INSERT OR IGNORE INTO memories(content, metadata, created_at) VALUES (?, ?, ?)",
                (content, json.dumps(metadata or {}, ensure_ascii=False), self._now()),
            )
        return cursor.rowcount > 0

    def forget(self, memory_id: int) -> bool:
        with self._lock, self._connect() as connection:
            cursor = connection.execute("DELETE FROM memories WHERE id=?", (memory_id,))
        return cursor.rowcount > 0

    def list_memories(self) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT id, content, metadata, created_at FROM memories ORDER BY id DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def relevant_memories(self, query: str, limit: int = 4) -> list[dict]:
        ranked = [
            (lexical_score(query, row["content"]), row)
            for row in self.list_memories()
        ]
        return [row for score, row in sorted(ranked, key=lambda item: item[0], reverse=True)[:limit] if score > 0.12]

    def cache_document(self, url: str, title: str, content: str, provider: str) -> None:
        if not url or not content:
            return
        with self._lock, self._connect() as connection:
            connection.execute(
                """
                INSERT INTO documents(url, title, content, provider, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(url) DO UPDATE SET
                    title=excluded.title, content=excluded.content,
                    provider=excluded.provider, created_at=excluded.created_at
                """,
                (url, title, content, provider, self._now()),
            )

    def search_cached_documents(self, query: str, limit: int = 4) -> list[dict]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT url, title, content, provider, created_at FROM documents ORDER BY created_at DESC LIMIT 200"
            ).fetchall()
        ranked = [(lexical_score(query, row["title"] + " " + row["content"]), dict(row)) for row in rows]
        return [row for score, row in sorted(ranked, key=lambda item: item[0], reverse=True)[:limit] if score > 0.14]
