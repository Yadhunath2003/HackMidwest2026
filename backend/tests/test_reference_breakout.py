import pytest

from app import ai_trends
from app.engine import run_backtest
from app.schemas import Strategy, ExecutionSettings, validate_strategy


def strategy(**settings):
    return Strategy.model_validate({"symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "ai_reference_breakout", "reference_breakout": {"volume_lookback": 3, **settings}},
        "initial_capital": 10000})


def candles(after=None):
    rows = [(100, 101, 99, 100, 1000)] * 20 + [
        (100, 102, 97, 98, 3000),  # High-volume bearish reference.
        (98, 104, 97.5, 103, 1000),  # Bullish momentum breakout.
    ] + (after if after is not None else [(104, 105, 103, 104, 1000), (104, 125, 103, 120, 1000)])
    return [{"time": 1700000000 + i * 300, "open": o, "high": h, "low": l, "close": c, "volume": v}
            for i, (o, h, l, c, v) in enumerate(rows)]


@pytest.fixture
def trends(monkeypatch):
    calls = []
    def assess(history, context):
        calls.append(history[-1]["time"])
        return {"direction": "bearish" if history[-1]["close"] < history[-1]["open"] else "bullish",
                "confidence": 0.9, "start_time": history[0]["time"], "reason": "Mock price-structure assessment", "source": "test"}
    monkeypatch.setattr(ai_trends, "assess", assess)
    return calls


@pytest.mark.parametrize("costs", [ExecutionSettings(commission_per_order_usd=0, slippage_bps=0),
                                   ExecutionSettings(commission_per_order_usd=1, slippage_bps=10)])
def test_reference_stop_risk_sizing_net_account_target_and_replay(trends, costs):
    series = candles()
    result = run_backtest(series, strategy(), costs)
    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["entry_time"] == series[22]["time"]
    assert trade["stop_price"] == 97
    assert trade["planned_stop_loss"] <= 100
    assert trade["risk_budget"] == 100
    assert trade["target_account_profit"] == 200
    assert trade["exit_reason"] == "take_profit"
    assert trade["pnl"] == pytest.approx(200, abs=0.01)
    assert trade["entry_evidence"]["reference_breakout"]["time"] == series[20]["time"]
    assert trends == [series[20]["time"], series[21]["time"]]
    replay = run_backtest(series, strategy(), costs, trend_assessments=result["trend_assessments"])
    assert replay == result
    assert len(trends) == 2


def test_gap_below_reference_stop_skips_entry(trends):
    result = run_backtest(candles([(96, 97, 95, 96, 1000)]), strategy(), ExecutionSettings())
    assert not result["trades"]
    assert "marked stop" in result["rejected_trades"][0]["reason"]


def test_stop_loss_respects_planned_risk_with_costs(trends):
    result = run_backtest(candles([(104, 105, 103, 104, 1000), (104, 105, 96, 98, 1000)]), strategy(), ExecutionSettings())
    trade = result["trades"][0]
    assert trade["exit_reason"] == "stop_loss"
    assert -trade["pnl"] <= trade["risk_budget"]


def test_touching_reference_low_invalidates_setup(trends):
    series = candles()
    series[21]["low"] = 97
    assert not run_backtest(series, strategy(), ExecutionSettings())["trades"]


def test_insufficient_volume_or_momentum_does_not_enter(trends):
    assert not run_backtest(candles(), strategy(reference_volume_min=4), ExecutionSettings())["trades"]
    assert not run_backtest(candles(), strategy(momentum_body_min=0.9), ExecutionSettings())["trades"]


def test_wrong_ai_trend_blocks_setup(monkeypatch):
    monkeypatch.setattr(ai_trends, "assess", lambda *args: {"direction": "bullish", "confidence": 0.9,
                       "start_time": None, "reason": "Bullish", "source": "test"})
    assert not run_backtest(candles(), strategy(), ExecutionSettings())["trades"]


def test_last_candle_breakout_never_fills(trends):
    result = run_backtest(candles([]), strategy(), ExecutionSettings())
    assert not result["trades"]
    assert result["signals"][-1]["acted"] is False


def test_new_reference_replaces_previous(trends):
    series = candles()
    series[21].update(open=100, high=101, low=95, close=96, volume=6000)
    series[22].update(open=96, high=104, low=95.5, close=103)
    result = run_backtest(series, strategy(), ExecutionSettings())
    assert result["trades"][0]["stop_price"] == 95
    assert result["trades"][0]["entry_evidence"]["reference_breakout"]["time"] == series[21]["time"]


def test_gold_without_volume_rejected():
    raw = strategy().model_dump()
    raw["symbol"] = "XAUUSD"
    _, issues = validate_strategy(raw)
    assert any("requires volume" in issue for issue in issues)
