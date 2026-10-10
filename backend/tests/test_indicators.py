import pytest

from app import indicators


def test_candle_anatomy_matches_hand_calculation():
    # range 10, body 7, upper wick 1, lower wick 2
    a = indicators.candle_anatomy(o=102, h=110, l=100, c=109)
    assert a["direction"] == "bullish"
    assert a["body_to_range"] == pytest.approx(0.7)
    assert a["upper_wick_to_range"] == pytest.approx(0.1)
    assert a["lower_wick_to_range"] == pytest.approx(0.2)


def test_zero_range_candle_is_unavailable_not_a_division_error():
    a = indicators.candle_anatomy(o=50, h=50, l=50, c=50)
    assert a["direction"] == "flat"
    assert a["body_to_range"] is None
    assert a["upper_wick_to_range"] is None


def test_relative_volume_excludes_current_candle():
    volumes = [100, 100, 100, 100, 400]
    out = indicators.relative_volume(volumes, lookback=4)
    assert out[:4] == [None, None, None, None]
    assert out[4] == pytest.approx(4.0)  # 400 / mean(100, 100, 100, 100), not 400 / mean incl. itself


def test_relative_volume_window_slides():
    out = indicators.relative_volume([10, 20, 30, 40], lookback=2)
    assert out[2] == pytest.approx(30 / 15)
    assert out[3] == pytest.approx(40 / 25)


def test_sma():
    assert indicators.sma([1, 2, 3, 4], 2) == [None, 1.5, 2.5, 3.5]


def test_ema_is_seeded_with_sma():
    out = indicators.ema([1, 2, 3, 4, 5], 3)
    assert out[:2] == [None, None]
    assert out[2] == pytest.approx(2.0)
    assert out[3] == pytest.approx(4 * 0.5 + 2.0 * 0.5)
    assert out[4] == pytest.approx(5 * 0.5 + 3.0 * 0.5)


def test_rsi_bounds():
    assert indicators.rsi([1, 2, 3, 4, 5], 3)[-1] == 100.0
    assert indicators.rsi([5, 4, 3, 2, 1], 3)[-1] == 0.0
    assert indicators.rsi([1, 2, 3], 3) == [None, None, None]


def test_indicators_do_not_look_ahead():
    closes = [10, 11, 12, 11, 13, 14, 12, 15]
    full = indicators.ema(closes, 3)
    for i in range(len(closes)):
        assert indicators.ema(closes[: i + 1], 3)[i] == full[i]
