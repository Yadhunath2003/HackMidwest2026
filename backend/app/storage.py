"""SQLite persistence for backtest runs. One row per run; the full result is stored as JSON."""

import json
import sqlite3
import uuid
from datetime import datetime, timezone

from . import config


def _connect() -> sqlite3.Connection:
    config.DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(config.DATABASE_PATH)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS runs (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            symbol TEXT NOT NULL,
            timeframe TEXT NOT NULL,
            result TEXT NOT NULL
        )"""
    )
    return conn


def save_run(result: dict) -> dict:
    run_id = uuid.uuid4().hex[:12]
    created_at = datetime.now(timezone.utc).isoformat()
    stored = {"id": run_id, "created_at": created_at, **result}
    with _connect() as conn:
        conn.execute(
            "INSERT INTO runs (id, created_at, symbol, timeframe, result) VALUES (?, ?, ?, ?, ?)",
            (run_id, created_at, result["strategy"]["symbol"], result["strategy"]["timeframe"], json.dumps(stored)),
        )
    return stored


def get_run(run_id: str) -> dict | None:
    with _connect() as conn:
        row = conn.execute("SELECT result FROM runs WHERE id = ?", (run_id,)).fetchone()
    return json.loads(row[0]) if row else None
