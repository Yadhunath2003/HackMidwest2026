import json

import pytest

from app import ai, ai_trends, ai_usage
from app.engine import run_backtest
from app.schemas import Strategy, ExecutionSettings


def series(count=24):
    return [{"time": 1700000000 + i * 300, "open": 100 + i, "high": 102 + i,
             "low": 99 + i, "close": 101 + i, "volume": 1000} for i in range(count)]


def strategy():
    return Strategy.model_validate({"symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "candle_only", "candle_conditions": {"direction": "bullish"},
                  "ai_trend": {"direction": "bullish", "context_candles": 20, "min_confidence": 0.6}},
        "stop_loss_pct": 10, "take_profit_pct": 20})


def test_ai_sees_only_past_context_and_cache_reuses_judgment(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(messages, **kwargs):
        observations = json.loads(messages[1]["content"])
        calls.append(observations)
        assert len(observations["candles"]) == 20
        assert observations["columns"] == ["open", "high", "low", "close", "volume"]
        assert observations["candles"][-1][3] == series()[21]["close"]
        return json.dumps({"direction": "bullish", "confidence": 0.8, "start_index": 3, "reason": "Rising structure."})
    monkeypatch.setattr(ai, "chat", chat)
    context = series()[:22]
    first = ai_trends.assess(context, 20)
    second = ai_trends.assess(context, 20)
    assert first == second
    assert len(calls) == 1
    assert first["start_time"] == context[5]["time"]


@pytest.mark.parametrize("reply", [
    {"direction": "bullish", "confidence": 0.8, "start_index": 100, "reason": "Invalid start"},
    {"direction": "bullish", "confidence": 0.8, "start_index": None, "reason": "Missing start"},
    {"direction": "bullish", "confidence": 2, "start_index": 0, "reason": "Invalid confidence"},
])
def test_invalid_ai_judgments_rejected(tmp_path, monkeypatch, reply):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    monkeypatch.setattr(ai, "chat", lambda *args, **kwargs: json.dumps(reply))
    with pytest.raises(ai.AIError):
        ai_trends.assess(series(), 20)


def test_out_of_range_start_is_corrected_with_same_history(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(messages, **kwargs):
        calls.append(json.loads(messages[1]["content"]))
        assert calls[-1]["index_range"] == [0, 19]
        if len(calls) == 2:
            assert "do not clamp" in messages[-1]["content"]
        return json.dumps({"direction": "bullish", "confidence": 0.8,
                           "start_index": 200 if len(calls) == 1 else 4, "reason": "Rising structure"})
    monkeypatch.setattr(ai, "chat", chat)
    result = ai_trends.assess(series(), 20)
    assert calls[0] == calls[1]
    assert result["start_time"] == series()[8]["time"]
    assert ai_trends.assess(series(), 20) == result
    assert len(calls) == 2


def test_invalid_start_correction_is_bounded_and_not_cached(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(*args, **kwargs):
        calls.append(1)
        return json.dumps({"direction": "bearish", "confidence": 0.8,
                           "start_index": 20, "reason": "Invalid start"})
    monkeypatch.setattr(ai, "chat", chat)
    with pytest.raises(ai.AIError, match="one correction attempt"):
        ai_trends.assess(series(), 20)
    assert len(calls) == 2
    assert not list(tmp_path.rglob("*.json"))


@pytest.mark.parametrize("direction, confidence, expected", [
    ("bullish", 0.8, True), ("bearish", 0.9, False), ("sideways", 0.9, False),
    ("uncertain", 0, False), ("bullish", 0.5, False),
])
def test_ai_filter_gates_entry_and_records_past_evidence(monkeypatch, direction, confidence, expected):
    observed = []
    def assess(candles, context_candles):
        observed.append(candles[-1]["time"])
        return {"direction": direction, "confidence": confidence, "start_time": candles[0]["time"],
                "reason": "Test judgment", "source": "test"}
    monkeypatch.setattr(ai_trends, "assess", assess)
    candles = series()
    result = run_backtest(candles, strategy(), ExecutionSettings())
    assert bool(result["trades"]) == expected
    assert len(result["trend_assessments"]) == len(observed)
    if expected:
        assert result["trades"][0]["entry_time"] == candles[1]["time"]
        assert result["trades"][0]["entry_evidence"]["ai_trend"]["direction"] == "bullish"
    replay = run_backtest(candles, strategy(), ExecutionSettings(), trend_assessments=result["trend_assessments"])
    assert replay == result
    assert len(observed) == len(result["trend_assessments"])


def test_insufficient_history_never_calls_model(monkeypatch):
    monkeypatch.setattr(ai, "chat", lambda *args, **kwargs: pytest.fail("No model call expected"))
    assert ai_trends.assess(series(10), 200)["direction"] == "uncertain"


def test_truncated_response_retries_same_context_and_caches_only_complete_judgment(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(messages, **kwargs):
        calls.append((messages, kwargs["max_tokens"]))
        if len(calls) < 3:
            assert not list(tmp_path.rglob("*.json"))
            raise ai.AIResponseTruncated("cut off")
        return json.dumps({"direction": "bearish", "confidence": 0.8, "start_index": 2, "reason": "Falling structure."})
    monkeypatch.setattr(ai, "chat", chat)
    result = ai_trends.assess(series(), 20)
    assert [budget for _, budget in calls] == [700, 1400, 2800]
    assert all(messages == calls[0][0] for messages, _ in calls)
    assert result["direction"] == "bearish"
    assert ai_trends.assess(series(), 20) == result
    assert len(calls) == 3


def test_repeated_truncation_fails_cleanly_without_caching(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(*args, **kwargs):
        calls.append(kwargs["max_tokens"])
        raise ai.AIResponseTruncated("cut off")
    monkeypatch.setattr(ai, "chat", chat)
    with pytest.raises(ai.AIError, match="3 attempts"):
        ai_trends.assess(series(), 20)
    assert len(calls) == 3
    assert not list(tmp_path.rglob("*.json"))


def test_other_ai_errors_are_not_retried(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def chat(*args, **kwargs):
        calls.append(kwargs)
        raise ai.AIError("Authentication failed")
    monkeypatch.setattr(ai, "chat", chat)
    with pytest.raises(ai.AIError, match="Authentication failed"):
        ai_trends.assess(series(), 20)
    assert len(calls) == 1


def test_custom_token_caps_are_respected(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    monkeypatch.setattr(ai_trends.config, "AI_TREND_INITIAL_TOKENS", 500)
    monkeypatch.setattr(ai_trends.config, "AI_TREND_MAX_TOKENS", 900)
    budgets = []
    def chat(*args, **kwargs):
        budgets.append(kwargs["max_tokens"])
        raise ai.AIResponseTruncated("cut off")
    monkeypatch.setattr(ai, "chat", chat)
    with pytest.raises(ai.AIError, match="output cap 900"):
        ai_trends.assess(series(), 20)
    assert budgets == [500, 900]


def test_legacy_cache_is_reused_without_new_requests(tmp_path, monkeypatch):
    import hashlib
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    context = series()[-20:]
    key = hashlib.sha256(json.dumps({"version": "trend-v1", "model": ai_trends.config.CHAT_MODEL,
        "endpoint": ai_trends.config.OPENAI_BASE_URL, "candles": context}, sort_keys=True).encode()).hexdigest()
    path = tmp_path / "ai_trends" / f"{key}.json"
    path.parent.mkdir()
    judgment = {"direction": "bearish", "confidence": 0.8, "reason": "Cached judgment", "version": "trend-v1"}
    path.write_text(json.dumps(judgment))
    monkeypatch.setattr(ai, "chat", lambda *args, **kwargs: pytest.fail("Cache must avoid new requests"))
    with ai_usage.track() as usage:
        assert ai_trends.assess(series(), 20) == judgment
        assert usage.snapshot()["cache_hits"] == 1
        assert usage.snapshot()["requests"] == 0


def test_missing_replay_judgment_blocks_entry_without_model(monkeypatch):
    monkeypatch.setattr(ai_trends, "assess", lambda *args: pytest.fail("Replay must not call AI"))
    result = run_backtest(series(), strategy(), ExecutionSettings(), trend_assessments={})
    assert result["trades"] == []
    assert all(a["source"] == "replay_missing" for a in result["trend_assessments"].values())


def test_quote_activity_is_disclosed_to_model_and_cached_separately(tmp_path, monkeypatch):
    monkeypatch.setattr(ai_trends.config, "CANDLE_CACHE_DIR", tmp_path)
    prompts = []
    def chat(messages, **kwargs):
        prompts.append(messages[0]["content"])
        return json.dumps({"direction": "bullish", "confidence": 0.8, "start_index": 0, "reason": "Test"})
    monkeypatch.setattr(ai, "chat", chat)
    ai_trends.assess(series(), 20)
    ai_trends.assess(series(), 20, volume_kind="quote")
    ai_trends.assess(series(), 20, volume_kind="quote")
    assert len(prompts) == 2
    assert "quote activity" not in prompts[0]
    assert "quote activity" in prompts[1]
