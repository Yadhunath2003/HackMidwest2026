import httpx
import pytest

from app import massive_data, ai_trends
from app.engine import run_backtest
from app.schemas import Strategy, ExecutionSettings, validate_strategy


def test_only_gold_can_request_quote_activity():
    raw = {"symbol": "XAUUSD", "timeframe": "5m", "volume_basis": "quote",
           "entry": {"type": "candle_only", "candle_conditions": {"relative_volume_min": 2}}}
    assert validate_strategy(raw)[0]
    raw["symbol"] = "AAPL"
    assert validate_strategy(raw)[0] is None


def test_gold_reference_risk_uses_fractional_ounces_and_account_target(monkeypatch):
    def assess(history, context, **kwargs):
        assert kwargs["volume_kind"] == "quote"
        return {"direction": "bearish" if history[-1]["close"] < history[-1]["open"] else "bullish",
                "confidence": 0.9, "start_time": history[0]["time"], "reason": "Test", "source": "test"}
    monkeypatch.setattr(ai_trends, "assess", assess)
    rows = [(3000, 3010, 2990, 3000, 1000)] * 20 + [
        (3000, 3020, 2970, 2980, 3000), (2980, 3040, 2975, 3030, 1000),
        (3040, 3200, 3030, 3150, 1000)]
    candles = [{"time": 1700000000+i*300, "open": o,"high": h,"low": l,"close": c,"volume": v}
               for i,(o,h,l,c,v) in enumerate(rows)]
    strategy = Strategy.model_validate({"symbol":"XAUUSD", "timeframe":"5m", "volume_basis":"quote",
        "entry":{"type":"ai_reference_breakout","reference_breakout":{"volume_lookback":3}}})
    result = run_backtest(candles, strategy, ExecutionSettings())
    trade = result["trades"][0]
    assert trade["shares"] != int(trade["shares"])
    assert trade["planned_stop_loss"] <= 100
    assert trade["pnl"] == pytest.approx(200, abs=0.01)
    no_activity = [{**c, "volume": None} for c in candles]
    with pytest.raises(ValueError, match="no quote-activity"):
        run_backtest(no_activity, strategy, ExecutionSettings())


def test_massive_gold_keeps_quote_counts_without_changing_stock_counts(monkeypatch):
    from datetime import datetime, timezone
    monkeypatch.setattr(massive_data.config, "MASSIVE_API_KEY", "test")
    stamp = int(datetime(2026,10,9,13,30,tzinfo=timezone.utc).timestamp()*1000)
    monkeypatch.setattr(massive_data.httpx, "get", lambda *args, **kwargs: httpx.Response(200,json={
        "status":"OK", "results":[{"t":stamp,"o":3000,"h":3010,"l":2990,"c":3005,"v":515}]}))
    gold,meta = massive_data.fetch_stocks("XAUUSD","5m",spot_gold=True)
    stock,stock_meta = massive_data.fetch_stocks("AAPL","5m")
    assert gold[0]["volume"] == stock[0]["volume"] == 515
    assert meta["volume_kind"] == "quote"
    assert stock_meta["volume_kind"] == "traded"
