import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4


class Store:
    """Persist accepted turns; revision checks prevent lost session updates."""
    def __init__(self, path: Path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0,
                    question TEXT
                );
                CREATE TABLE IF NOT EXISTS turns (
                    session_id TEXT NOT NULL REFERENCES sessions(id), turn_id TEXT NOT NULL,
                    request_hash TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    PRIMARY KEY(session_id, turn_id)
                );
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:
                yield db
        finally:
            db.close()

    def create(self):
        sid, created = uuid4().hex, datetime.now(timezone.utc).isoformat()
        with self.connection() as db:
            db.execute("INSERT INTO sessions(id, created_at) VALUES (?, ?)", (sid, created))
        return {"session_id": sid, "created_at": created}

    def session(self, sid):
        with self.connection() as db:
            row = db.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
            if row is None:
                return None
            turns = db.execute("SELECT request, response FROM turns WHERE session_id=? ORDER BY sequence DESC LIMIT 6", (sid,)).fetchall()
        return {"session_id": sid, "created_at": row["created_at"], "revision": row["revision"],
                "active_question": json.loads(row["question"]) if row["question"] else None,
                "recent_turns": [{"message": json.loads(t["request"])["message"], "response": json.loads(t["response"])} for t in reversed(turns)]}

    def cached(self, sid, tid):
        with self.connection() as db:
            row = db.execute("SELECT request_hash, response FROM turns WHERE session_id=? AND turn_id=?", (sid, tid)).fetchone()
        return (row["request_hash"], json.loads(row["response"])) if row else None

    def commit(self, sid, request_hash, request, response, revision, question):
        with self.connection() as db:
            updated = db.execute("UPDATE sessions SET revision=revision+1, question=? WHERE id=? AND revision=?", (json.dumps(question) if question else None, sid, revision))
            if updated.rowcount != 1:
                raise ValueError("Session changed during this turn; submit again with the same turn ID.")
            db.execute("INSERT INTO turns VALUES (?, ?, ?, ?, ?, ?)", (sid, request["turn_id"], request_hash, json.dumps(request), json.dumps(response), revision + 1))
