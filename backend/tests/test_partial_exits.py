import pytest

from app import ai_trends
from app.engine import run_backtest
from app.schemas import ExecutionSettings, Strategy, validate_strategy

NO_COSTS = ExecutionSettings(commission_per_order_usd=0, slippage_bps=0)


def rows(values):
    return [{"time": 1700000000 + i * 300, "open": o, "high": h, "low": l, "close": c, "volume": v}
            for i, (o, h, l, c, v) in enumerate(values)]


def strategy(**patch):
    return Strategy.model_validate({"symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "candle_only", "candle_conditions": {"direction": "bullish"}},
        "initial_capital": 10000, "position_size_usd": 1000,
        "stop_loss_pct": 2, "take_profit_pct": 4,
        "partial_exit": {"fraction": 0.5, "profit_pct": 1, "basis": "price"}, **patch})


def run(after, settings=None, costs=NO_COSTS):
    return run_backtest(rows([(99, 100, 98, 100, 1000)] + after), settings or strategy(), costs)


def test_partial_then_final_target_counts_one_trade_and_all_cash_fills():
    result = run([(100, 102, 99, 101, 1000), (102, 105, 100, 103, 1000)])
    trade = result["trades"][0]
    assert len(result["trades"]) == 1
    assert [(e["shares"], e["price"]) for e in trade["exits"]] == [(5, 101), (5, 104)]
    assert trade["exit_price"] == 102.5
    assert trade["final_exit_price"] == 104
    assert trade["pnl"] == 25
    assert result["metrics"]["final_equity"] == 10025


def test_partial_and_final_on_same_candle():
    trade = run([(100, 105, 99, 103, 1000)])["trades"][0]
    assert [e["reason"] for e in trade["exits"]] == ["partial_take_profit", "take_profit"]


def test_stop_first_when_intrabar_partial_and_stop_both_touched():
    trade = run([(100, 105, 97, 99, 1000)])["trades"][0]
    assert len(trade["exits"]) == 1
    assert trade["exit_reason"] == "stop_loss"
    assert trade["pnl"] == -20


def test_gap_partial_precedes_later_stop_and_fills_at_open():
    result = run([(100, 100.5, 99, 100, 1000), (102, 103, 97, 99, 1000)])
    trade = result["trades"][0]
    assert [(e["shares"], e["price"]) for e in trade["exits"]] == [(5, 102), (5, 98)]
    assert trade["exits"][0]["gap"] is True
    assert trade["pnl"] == 0


def test_odd_share_quantity_rounds_down_and_one_share_skips_partial():
    trade = run([(100, 105, 99, 103, 1000)], strategy(position_size_usd=500))["trades"][0]
    assert [e["shares"] for e in trade["exits"]] == [2, 3]
    trade = run([(100, 105, 99, 103, 1000)], strategy(position_size_usd=100))["trades"][0]
    assert len(trade["exits"]) == 1
    assert trade["partial_exit_skipped"]


def test_fractional_gold_partial_and_end_of_data_commissions():
    result = run([(100, 102, 99, 101, 1000)], strategy(symbol="XAUUSD", position_size_usd=105),
                 ExecutionSettings(commission_per_order_usd=1, slippage_bps=0))
    trade = result["trades"][0]
    assert [e["shares"] for e in trade["exits"]] == [0.52, 0.53]
    assert trade["fees"] == 3
    assert trade["exit_reason"] == "end_of_data"
    assert result["metrics"]["net_profit"] == trade["pnl"]


def test_account_partial_preserves_risk_and_final_net_account_target(monkeypatch):
    def assess(history, context):
        return {"direction": "bearish" if history[-1]["close"] < history[-1]["open"] else "bullish",
                "confidence": 0.9, "start_time": history[0]["time"], "reason": "Test", "source": "test"}
    monkeypatch.setattr(ai_trends, "assess", assess)
    series = rows([(100, 101, 99, 100, 1000)] * 20 + [
        (100, 102, 97, 98, 3000), (98, 104, 97.5, 103, 1000),
        (104, 112, 103, 110, 1000), (110, 150, 103, 120, 1000)])
    settings = strategy(entry={"type": "ai_reference_breakout", "reference_breakout": {"volume_lookback": 3}},
                        partial_exit={"fraction": 0.5, "profit_pct": 1, "basis": "account"})
    costs = ExecutionSettings(commission_per_order_usd=1, slippage_bps=10)
    result = run_backtest(series, settings, costs)
    trade = result["trades"][0]
    assert len(trade["exits"]) == 2
    assert trade["exits"][0]["reason"] == "partial_take_profit"
    assert trade["planned_stop_loss"] <= 100
    assert trade["fees"] == 3
    assert trade["pnl"] == pytest.approx(200, abs=0.01)
    assert result["metrics"]["net_profit"] == pytest.approx(200, abs=0.01)
    replay = run_backtest(series, settings, costs, trend_assessments=result["trend_assessments"])
    assert replay == result


@pytest.mark.parametrize("partial", [
    {"fraction": 1, "profit_pct": 1}, {"fraction": 0, "profit_pct": 1},
    {"fraction": 0.5, "profit_pct": 4}, {"fraction": 0.5, "profit_pct": 1, "basis": "account"},
])
def test_invalid_partial_settings_are_rejected(partial):
    raw = strategy().model_dump()
    raw["partial_exit"] = partial
    validated, issues = validate_strategy(raw)
    assert validated is None
    assert issues
