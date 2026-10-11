from threading import Event

from fastapi.testclient import TestClient

from app import ai, api, config
from app.main import app


REQUEST = {"strategy": {"symbol": "AAPL", "timeframe": "5m", "entry": {
    "type": "ema_crossover", "fast_period": 2, "slow_period": 3}}, "execution": {}}


def test_background_backtest_returns_before_work_finishes_and_saves_result(monkeypatch, tmp_path):
    release, finished = Event(), Event()
    monkeypatch.setattr(config, "DATABASE_PATH", tmp_path / "runs.db")
    def load(*args):
        assert release.wait(5)
        return [], {}
    monkeypatch.setattr(api, "_load_candles", load)
    original = api._execute_job
    def execute(*args):
        try:
            original(*args)
        finally:
            finished.set()
    monkeypatch.setattr(api, "_execute_job", execute)
    client = TestClient(app)
    response = client.post("/api/backtest/jobs", json=REQUEST)
    assert response.status_code == 200
    job_id = response.json()["job_id"]
    try:
        assert client.get(f"/api/backtest/jobs/{job_id}").json()["status"] in ("queued", "running")
    finally:
        release.set()
        assert finished.wait(5)
    status = client.get(f"/api/backtest/jobs/{job_id}").json()
    assert status["status"] == "completed"
    result = client.get(f"/api/backtest/{status['run_id']}")
    assert result.status_code == 200
    assert result.json()["metrics"]["num_trades"] == 0


def test_background_job_preserves_ai_failure_message(monkeypatch):
    done = Event()
    monkeypatch.setattr(api, "_load_candles", lambda *args: ([], {}))
    def fail(*args):
        raise ai.AIError("Model is rate limited")
    monkeypatch.setattr(api, "run_backtest", fail)
    original = api._execute_job
    def execute(*args):
        try:
            original(*args)
        finally:
            done.set()
    monkeypatch.setattr(api, "_execute_job", execute)
    client = TestClient(app)
    job_id = client.post("/api/backtest/jobs", json=REQUEST).json()["job_id"]
    assert done.wait(5)
    status = client.get(f"/api/backtest/jobs/{job_id}").json()
    assert status["status"] == "failed"
    assert "Model is rate limited" in status["message"]


def test_invalid_strategy_does_not_start_job():
    response = TestClient(app).post("/api/backtest/jobs", json={"strategy": {}, "execution": {}})
    assert response.status_code == 422


def test_invalid_chat_response_is_readable_error(monkeypatch):
    import httpx
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai.httpx, "post", lambda *args, **kwargs: httpx.Response(200, json={"choices": []}))
    import pytest
    with pytest.raises(ai.AIError, match="invalid chat response"):
        ai.chat([])


def test_provider_length_finish_is_typed_truncation(monkeypatch):
    import httpx
    import pytest
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai.httpx, "post", lambda *args, **kwargs: httpx.Response(200, json={
        "choices": [{"finish_reason": "length", "message": {"content": '{"direction":'}}]}))
    with pytest.raises(ai.AIResponseTruncated):
        ai.chat([])
