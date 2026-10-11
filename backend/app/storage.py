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
    conn.execute('CREATE TABLE IF NOT EXISTS saved_strategies (id TEXT PRIMARY KEY, name TEXT NOT NULL, run_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, definition TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS paper_sessions (id TEXT PRIMARY KEY, strategy_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL)')
    conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_paper_session ON paper_sessions(status) WHERE status='running'")
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


def recent_runs():
    with _connect() as conn:
        return [dict(zip(('id','created_at','symbol','timeframe'),row)) for row in conn.execute('SELECT id,created_at,symbol,timeframe FROM runs ORDER BY created_at DESC LIMIT 50')]


def save_strategy(run_id: str, name: str) -> dict:
    run = get_run(run_id)
    if run is None:
        raise ValueError('Completed backtest not found.')
    record = {'id': uuid.uuid4().hex[:12], 'name':name.strip(), 'run_id':run_id,
              'created_at':datetime.now(timezone.utc).isoformat(), 'strategy':run['strategy'], 'execution':run['execution']}
    with _connect() as conn:
        existing=conn.execute('SELECT definition FROM saved_strategies WHERE run_id=?',(run_id,)).fetchone()
        if existing:return json.loads(existing[0])
        conn.execute('INSERT INTO saved_strategies VALUES (?,?,?,?,?)',(record['id'],record['name'],run_id,record['created_at'],json.dumps(record)))
    return record


def list_strategies():
    with _connect() as conn:
        return [json.loads(row[0]) for row in conn.execute('SELECT definition FROM saved_strategies ORDER BY created_at DESC')]


def delete_strategy(strategy_id):
    with _connect() as conn:
        if conn.execute("SELECT 1 FROM paper_sessions WHERE strategy_id=? AND status='running'",(strategy_id,)).fetchone():
            raise ValueError('Stop the paper session before deleting its strategy.')
        return conn.execute('DELETE FROM saved_strategies WHERE id=?',(strategy_id,)).rowcount > 0


def delete_run(run_id):
    with _connect() as conn:
        if conn.execute('SELECT 1 FROM saved_strategies WHERE run_id=?',(run_id,)).fetchone():
            raise ValueError('Delete the saved strategy first. Its completed backtest is still linked.')
        return conn.execute('DELETE FROM runs WHERE id=?',(run_id,)).rowcount > 0


def create_paper_session(record):
    with _connect() as conn:
        try:
            conn.execute('INSERT INTO paper_sessions VALUES (?,?,?,?,?,?)',(record['id'],record['strategy_id'],'running',record['created_at'],record['created_at'],json.dumps(record)))
        except sqlite3.IntegrityError:
            raise ValueError('A paper session is already running. Stop it before starting another.') from None


def paper_sessions(active_only=False):
    with _connect() as conn:
        query='SELECT payload,status FROM paper_sessions' + (" WHERE status='running'" if active_only else '') + ' ORDER BY created_at DESC'
        return [{**json.loads(row[0]),'status':row[1]} for row in conn.execute(query)]


def update_paper_session(record):
    record['updated_at']=datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute("UPDATE paper_sessions SET payload=?,updated_at=? WHERE id=? AND status='running'",(json.dumps(record),record['updated_at'],record['id']))


def stop_paper_session(session_id):
    with _connect() as conn:
        return conn.execute("UPDATE paper_sessions SET status='stopped' WHERE id=? AND status='running'",(session_id,)).rowcount>0
