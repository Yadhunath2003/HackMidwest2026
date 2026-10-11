import json

import pytest

from app import ai, api
from app.schemas import StressTestRequest


def test_strategy_generation_requires_api_not_keyword_fallback(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: False)
    with pytest.raises(ai.AIError, match="OPENAI_API_KEY"):
        ai.generate_strategy("Buy AAPL EMA 9 crosses EMA 21", {})


def test_strategy_generation_sends_original_language_and_defaults(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    seen = []
    def chat(messages, **kwargs):
        seen.extend(messages)
        return json.dumps({"strategy": {"symbol": "SPY"}, "clarifications": [], "unsupported": []})
    monkeypatch.setattr(ai, "chat", chat)
    result = ai.generate_strategy("Use the slower average crossing setup on SPY", {"timeframe": "4h"})
    assert "slower average crossing" in seen[1]["content"]
    assert '"4h"' in seen[1]["content"]
    assert result["source"].startswith("akamai-inference:")


def test_report_is_generated_from_evidence(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    evidence = {"metrics": {"num_trades": 0, "profit_factor": None}}
    def chat(messages, **kwargs):
        assert json.loads(messages[1]["content"]) == evidence
        return json.dumps({"summary": "No trades were executed.", "findings": [],
                           "limitations": ["No evidence of profitability."], "next_tests": []})
    monkeypatch.setattr(ai, "chat", chat)
    assert ai.generate_report(evidence)["summary"] == "No trades were executed."


def test_empty_report_is_error(monkeypatch):
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "chat", lambda *args, **kwargs: '{}')
    with pytest.raises(ai.AIError, match="summary"):
        ai.generate_report({})


def test_ai_failure_keeps_stress_metrics(monkeypatch):
    from app.engine import run_backtest
    from app.schemas import Strategy, ExecutionSettings
    strategy = Strategy.model_validate({"symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "ema_crossover", "fast_period": 2, "slow_period": 3},
        "stop_loss_pct": 2, "take_profit_pct": 4})
    run = run_backtest([], strategy, ExecutionSettings())
    monkeypatch.setattr(api, "_require_run", lambda run_id: run)
    def fail(evidence):
        raise ai.AIError("Model unavailable")
    monkeypatch.setattr(ai, "generate_report", fail)
    result = api.stress_test(StressTestRequest(run_id="test", in_sample_fraction=0.7))
    assert result["baseline"]["metrics"]["num_trades"] == 0
    assert result["stressed"]["metrics"]["num_trades"] == 0
    assert result["ai_report"] is None
    assert result["ai_error"] == "Model unavailable"
