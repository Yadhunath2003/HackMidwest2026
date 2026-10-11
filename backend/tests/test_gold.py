import pytest

from app import gold_data
from app.ai import _fallback_strategy
from app.engine import run_backtest
from app.schemas import ExecutionSettings, Strategy, validate_strategy


def test_gold_requires_key(monkeypatch):
    monkeypatch.setattr(gold_data.config, "TWELVEDATA_API_KEY", "")
    with pytest.raises(ValueError, match="TWELVEDATA_API_KEY"):
        gold_data.fetch_gold("1h")


@pytest.mark.parametrize("timeframe, interval", gold_data.INTERVALS.items())
def test_gold_native_intervals_and_missing_volume(monkeypatch, timeframe, interval):
    monkeypatch.setattr(gold_data.config, "TWELVEDATA_API_KEY", "test-key")
    class Response:
        status_code = 200
        def json(self):
            return {"values": [
                {"datetime": "2020-01-02 00:00:00", "open": "1500", "high": "1510", "low": "1490", "close": "1505"},
                {"datetime": "2020-01-01 20:00:00", "open": "1500", "high": "1510", "low": "1490", "close": "1505"},
                {"datetime": "2099-01-01 00:00:00", "open": "1500", "high": "1510", "low": "1490", "close": "1505"},
            ]}
    def get(url, params, timeout):
        assert params["symbol"] == "XAU/USD"
        assert params["interval"] == interval
        assert params["timezone"] == "UTC"
        return Response()
    monkeypatch.setattr(gold_data.httpx, "get", get)
    candles, meta = gold_data.fetch_gold(timeframe)
    assert len(candles) == 2
    assert candles[0]["time"] < candles[1]["time"]
    assert all(c["volume"] is None for c in candles)
    assert meta["symbol"] == "XAUUSD"


def test_gold_generation_fractional_position_and_volume_validation():
    generated = _fallback_strategy("Buy XAU/USD EMA 2 crosses EMA 3 with 2% stop loss and 4% target", {})
    strategy = Strategy.model_validate(generated["strategy"])
    closes = [2000, 2000, 1990, 1980, 2010, 2020, 2020]
    candles = [{"time": 1700000000 + i * 3600, "open": c, "high": c + 1,
                "low": c - 1, "close": c, "volume": None} for i, c in enumerate(closes)]
    result = run_backtest(candles, strategy, ExecutionSettings(commission_per_order_usd=0, slippage_bps=0))
    assert result["trades"]
    assert 0 < result["trades"][0]["shares"] < 1
    assert result["trades"][0]["entry_evidence"]["relative_volume"] is None
    raw = strategy.model_dump()
    raw["entry"]["candle_conditions"] = {"relative_volume_min": 2}
    _, issues = validate_strategy(raw)
    assert any("spot volume" in issue for issue in issues)


def test_gold_fallback_does_not_invent_volume():
    result = _fallback_strategy("Buy XAUUSD on a bullish momentum candle with high volume", {})
    assert result["strategy"]["symbol"] == "XAUUSD"
    assert "relative_volume_min" not in result["strategy"]["entry"]["candle_conditions"]
    assert result["unsupported"]
