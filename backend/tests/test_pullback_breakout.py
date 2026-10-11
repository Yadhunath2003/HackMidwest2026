import pytest

from app.ai import _fallback_strategy, generate_strategy
from app import ai
from app.engine import run_backtest
from app.detective import build_evidence, known_facts
from app.schemas import ExecutionSettings, Strategy, validate_strategy


def strategy(**settings):
    return Strategy.model_validate({
        "symbol": "AAPL", "timeframe": "5m",
        "entry": {"type": "bullish_pullback_breakout", "pullback_breakout": settings},
        "stop_loss_pct": 10, "take_profit_pct": 20,
    })


def candles(rows):
    return [{"time": 1700000000 + i * 300, "open": o, "high": h, "low": l,
             "close": c, "volume": 1000} for i, (o, h, l, c) in enumerate(rows)]


ROWS = [
    (100, 102, 99, 101), (101, 103, 100, 102), (102, 105, 101, 104),
    (104, 106, 102, 103), (103, 104, 101, 102),
    (102, 108, 101, 107), (108, 109, 107, 108),
]
FREE = ExecutionSettings(commission_per_order_usd=0, slippage_bps=0)


def test_breakout_fills_next_open_and_records_reference_evidence():
    series = candles(ROWS)
    result = run_backtest(series, strategy(), FREE)
    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["signal_time"] == series[5]["time"]
    assert trade["entry_time"] == series[6]["time"]
    assert trade["entry_price"] == 108
    pattern = trade["entry_evidence"]["pattern"]
    assert pattern["first_red_time"] == series[3]["time"]
    assert pattern["first_red_high"] == 106
    assert pattern["pullback_candles"] == 2
    assert any("First red candle" in fact for fact in known_facts(build_evidence(result, trade)))


def test_high_crossing_requires_explicit_high_mode():
    rows = ROWS[:5] + [(102, 107, 101, 105), ROWS[6]]
    assert not run_backtest(candles(rows), strategy(), FREE)["trades"]
    assert len(run_backtest(candles(rows), strategy(breakout_by="high"), FREE)["trades"]) == 1


@pytest.mark.parametrize("rows", [
    ROWS[1:],  # Only two green candles.
    ROWS[:3] + [ROWS[3]] * 4 + ROWS[5:],  # Pullback too long.
    ROWS[:4] + [(103, 104, 102, 103)] + ROWS[5:],  # Flat candle breaks sequence.
    ROWS[:5] + [(102, 106, 101, 106), ROWS[6]],  # Equality is not breakout.
    ROWS[:5] + [(102, 104, 101, 103)] + ROWS[5:],  # First green failed; later green cannot trigger.
])
def test_invalid_sequences_do_not_trade(rows):
    assert not run_backtest(candles(rows), strategy(), FREE)["trades"]


def test_future_candles_do_not_change_past_signals():
    full = run_backtest(candles(ROWS), strategy(), FREE)
    prefix = run_backtest(candles(ROWS[:6]), strategy(), FREE)
    assert prefix["signals"][0]["time"] == full["signals"][0]["time"]
    assert not prefix["trades"]


def test_pattern_parameters_and_reverse_exit_are_validated():
    raw = strategy().model_dump()
    raw["entry"]["pullback_breakout"]["pullback_min_candles"] = 5
    assert validate_strategy(raw)[0] is None
    raw = strategy().model_dump()
    raw["exit_on_reverse_crossover"] = True
    assert validate_strategy(raw)[0] is None


def test_original_description_generates_runnable_pattern_through_api(monkeypatch):
    import json
    monkeypatch.setattr(ai, "is_configured", lambda: True)
    monkeypatch.setattr(ai, "chat", lambda messages, **kwargs: json.dumps({
        "strategy": {**strategy().model_dump(), "timeframe": "1h"},
        "clarifications": ["Defaults: 3 green, 1-3 red, close breakout."], "unsupported": [],
    }))
    description = "Buy AAPL when there is a rally of green candle which switches to a short rally red candle and then switches back to a green candle which breaks the the top of the first candle of the previous red candle rally"
    result = generate_strategy(description, {"timeframe": "1h"})
    parsed, issues = validate_strategy(result["strategy"])
    assert not issues
    assert parsed.entry.type == "bullish_pullback_breakout"
    assert parsed.timeframe == "1h"
    assert result["clarifications"]


def test_fallback_respects_explicit_counts():
    result = _fallback_strategy("Buy AAPL after 5 green candles then 2-4 red candles and a green candle whose high crosses the first red candle high", {})
    settings = result["strategy"]["entry"]["pullback_breakout"]
    assert settings == {"rally_min_candles": 5, "pullback_min_candles": 2,
                        "pullback_max_candles": 4, "breakout_by": "high"}
