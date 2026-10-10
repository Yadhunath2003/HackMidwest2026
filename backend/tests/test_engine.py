import pytest

from app.engine import run_backtest
from app.schemas import ExecutionSettings, Strategy, validate_strategy

NO_COSTS = ExecutionSettings(commission_per_order_usd=0, slippage_bps=0)


def candle(i, o, h, l, c, v=1000):
    return {"time": 1_700_000_000 + i * 300, "open": o, "high": h, "low": l, "close": c, "volume": v}


def flat(i, price=100.0, v=1000):
    return candle(i, price, price + 0.5, price - 0.5, price, v)


def momentum_strategy(**overrides):
    raw = {
        "symbol": "AAPL",
        "timeframe": "5m",
        "entry": {
            "type": "candle_only",
            "candle_conditions": {
                "direction": "bullish",
                "body_to_range_min": 0.7,
                "upper_wick_to_range_max": 0.15,
                "relative_volume_min": 2.0,
                "relative_volume_lookback": 3,
            },
        },
        "stop_loss_pct": 2,
        "take_profit_pct": 4,
        "initial_capital": 10_000,
        "position_size_usd": 1_000,
    }
    raw.update(overrides)
    return Strategy.model_validate(raw)


def series_with_signal(after):
    """Three quiet candles, a bullish momentum candle at index 3, then `after`."""
    base = [flat(0), flat(1), flat(2), candle(3, 100, 101, 99.9, 100.9, v=5000)]
    return base + [candle(4 + n, *ohlc) for n, ohlc in enumerate(after)]


def test_entry_fills_at_next_candle_open_not_signal_close():
    candles = series_with_signal([(101.5, 102, 101, 101.8), (101.8, 102, 101.5, 101.9)])
    result = run_backtest(candles, momentum_strategy(), NO_COSTS)
    trade = result["trades"][0]
    assert trade["signal_time"] == candles[3]["time"]
    assert trade["entry_time"] == candles[4]["time"]
    assert trade["entry_price"] == 101.5
    assert trade["shares"] == 9  # floor(1000 / 101.5)
    assert trade["entry_evidence"]["relative_volume"] == pytest.approx(5.0)
    assert trade["exit_reason"] == "end_of_data"


def test_take_profit():
    candles = series_with_signal([(100, 100.5, 99.5, 100), (100, 105, 99.9, 104.5)])
    trade = run_backtest(candles, momentum_strategy(), NO_COSTS)["trades"][0]
    assert trade["exit_reason"] == "take_profit"
    assert trade["exit_price"] == pytest.approx(104.0)
    assert trade["pnl"] == pytest.approx(10 * 4.0)  # floor(1000 / 100) shares


def test_stop_fills_first_when_candle_touches_both_levels():
    candles = series_with_signal([(100, 100.5, 99.5, 100), (100, 105, 97, 104)])
    trade = run_backtest(candles, momentum_strategy(), NO_COSTS)["trades"][0]
    assert trade["exit_reason"] == "stop_loss"
    assert trade["exit_price"] == pytest.approx(98.0)
    assert trade["exit_evidence"]["both_levels_touched"] is True


def test_gap_through_stop_fills_at_open():
    candles = series_with_signal([(100, 100.5, 99.5, 100), (95, 96, 94, 95.5)])
    trade = run_backtest(candles, momentum_strategy(), NO_COSTS)["trades"][0]
    assert trade["exit_reason"] == "stop_loss"
    assert trade["exit_price"] == pytest.approx(95.0)
    assert trade["exit_evidence"]["gap"] is True


def test_signal_on_last_candle_cannot_trade():
    result = run_backtest(series_with_signal([]), momentum_strategy(), NO_COSTS)
    assert result["trades"] == []
    assert result["signals"] == [{"time": 1_700_000_000 + 3 * 300, "acted": False}]


def test_costs_reduce_pnl_and_are_tracked():
    candles = series_with_signal([(100, 100.5, 99.5, 100), (100, 105, 99.9, 104.5)])
    costs = ExecutionSettings(commission_per_order_usd=1, slippage_bps=10)
    trade = run_backtest(candles, momentum_strategy(), costs)["trades"][0]
    assert trade["entry_price"] == pytest.approx(100.1)
    assert trade["fees"] == 2.0
    assert trade["slippage_cost"] > 0
    free = run_backtest(candles, momentum_strategy(), NO_COSTS)["trades"][0]
    assert trade["pnl"] < free["pnl"]


def test_unaffordable_entry_is_rejected_and_counted():
    candles = series_with_signal([(100, 100.5, 99.5, 100)])
    result = run_backtest(candles, momentum_strategy(initial_capital=50, position_size_usd=50), NO_COSTS)
    assert result["trades"] == []
    assert result["metrics"]["rejected_trades"] == 1


def test_ema_crossover_entry_and_equity_curve():
    closes = [100] * 6 + [99, 98, 97, 96, 99, 103, 104, 104.5, 105]
    candles = [candle(i, c, c + 0.2, c - 0.2, c) for i, c in enumerate(closes)]
    strategy = Strategy.model_validate({
        "symbol": "SPY", "timeframe": "1d",
        "entry": {"type": "ema_crossover", "fast_period": 2, "slow_period": 5},
        "stop_loss_pct": 10, "take_profit_pct": 20,
    })
    result = run_backtest(candles, strategy, NO_COSTS)
    assert len(result["trades"]) == 1
    evidence = result["trades"][0]["entry_evidence"]
    assert evidence["prev_fast_ma"] <= evidence["prev_slow_ma"]
    assert evidence["fast_ma"] > evidence["slow_ma"]
    assert len(result["equity_curve"]) == len(candles)
    assert result["metrics"]["final_equity"] == result["equity_curve"][-1]["equity"]


def test_backtest_is_reproducible():
    candles = series_with_signal([(100, 100.5, 99.5, 100), (100, 105, 97, 104), (104, 104.5, 103, 104)])
    assert run_backtest(candles, momentum_strategy(), NO_COSTS) == run_backtest(candles, momentum_strategy(), NO_COSTS)


def test_schema_rejects_unknown_fields_and_bad_periods():
    _, issues = validate_strategy({
        "symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "ema_crossover", "fast_period": 21, "slow_period": 9, "code": "import os"},
        "stop_loss_pct": 2, "take_profit_pct": 4,
    })
    assert any("code" in issue for issue in issues)
    _, issues = validate_strategy({
        "symbol": "GME", "timeframe": "5m",
        "entry": {"type": "ema_crossover", "fast_period": 21, "slow_period": 9},
        "stop_loss_pct": 2, "take_profit_pct": 4,
    })
    assert any("symbol" in issue for issue in issues)
    assert any("fast_period must be smaller" in issue for issue in issues)
