from app import ai, api
from app.schemas import GenerateRequest


def test_missing_gold_basis_is_repaired_once(monkeypatch):
    draft = {"symbol": "XAUUSD", "timeframe": "30m",
             "entry": {"type": "ai_reference_breakout", "reference_breakout": {}},
             "partial_exit": {"fraction": 0.5, "profit_pct": 1, "basis": "account"}}
    calls = []

    def generate(prompt, defaults, **kwargs):
        calls.append(kwargs)
        if kwargs:
            assert "volume_basis" in kwargs["repair"]["validation_errors"][0]
        return {"strategy": {**draft, **({"volume_basis": "quote"} if kwargs else {})},
                "clarifications": ["Quote activity, not traded gold volume"],
                "unsupported": [], "source": "test"}

    monkeypatch.setattr(ai, "generate_strategy", generate)
    result = api.generate_strategy(GenerateRequest(prompt="Buy gold using reference volume"))
    assert len(calls) == 2
    assert result["strategy"]["volume_basis"] == "quote"
    assert result["strategy"]["partial_exit"]["basis"] == "account"
    assert result["issues"] == []


def test_invalid_repair_is_bounded(monkeypatch):
    calls = []

    def generate(*args, **kwargs):
        calls.append(kwargs)
        return {"strategy": {"symbol": "INVALID"}, "clarifications": [],
                "unsupported": [], "source": "test"}

    monkeypatch.setattr(ai, "generate_strategy", generate)
    result = api.generate_strategy(GenerateRequest(prompt="Buy gold"))
    assert len(calls) == 2
    assert result["strategy"] is None
    assert result["issues"]
