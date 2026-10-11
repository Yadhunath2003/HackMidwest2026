from datetime import datetime, timedelta

import pytest

from app.ai import _fallback_strategy
from app.market_data import NEW_YORK, _aggregate_four_hour, _is_incomplete
from app.schemas import GenerateRequest, SUPPORTED_TIMEFRAMES


@pytest.mark.parametrize("timeframe", SUPPORTED_TIMEFRAMES)
def test_supported_timeframes_validate(timeframe):
    assert GenerateRequest(prompt="EMA 9 crosses EMA 21", timeframe=timeframe).timeframe == timeframe


@pytest.mark.parametrize("phrase, expected", [
    ("5 minutes", "5m"), ("30-minute", "30m"), ("30m", "30m"),
    ("1 hour", "1h"), ("hourly", "1h"), ("4-hour", "4h"),
    ("4h", "4h"), ("daily", "1d"),
])
def test_fallback_reads_timeframe(phrase, expected):
    result = _fallback_strategy(f"AAPL {phrase} EMA 9 crosses EMA 21", {})
    assert result["strategy"]["timeframe"] == expected


def hourly_session(day):
    start = datetime(2026, 10, day, 9, 30, tzinfo=NEW_YORK)
    return [
        {"time": int((start + timedelta(hours=i)).timestamp()),
         "open": 100 + i, "high": 102 + i, "low": 99 + i,
         "close": 101 + i, "volume": 100}
        for i in range(7)
    ]


def test_four_hour_ohlcv_and_session_boundaries():
    candles = hourly_session(8) + hourly_session(9)
    result = _aggregate_four_hour(candles, datetime(2026, 10, 9, 17, tzinfo=NEW_YORK))
    assert len(result) == 4
    assert result[0] == {"time": candles[0]["time"], "open": 100,
                         "high": 105, "low": 99, "close": 104, "volume": 400}
    assert result[1] == {"time": candles[4]["time"], "open": 104,
                         "high": 108, "low": 103, "close": 107, "volume": 300}
    assert result[2]["time"] == candles[7]["time"]


def test_four_hour_forming_bucket_is_excluded():
    candles = hourly_session(9)
    assert _aggregate_four_hour(candles, datetime(2026, 10, 9, 13, tzinfo=NEW_YORK)) == []
    assert len(_aggregate_four_hour(candles, datetime(2026, 10, 9, 15, tzinfo=NEW_YORK))) == 1
    assert len(_aggregate_four_hour(candles, datetime(2026, 10, 9, 16, tzinfo=NEW_YORK))) == 2


def test_last_hour_completes_at_market_close():
    stamp = datetime(2026, 10, 9, 15, 30, tzinfo=NEW_YORK)
    assert _is_incomplete(stamp, "1h", datetime(2026, 10, 9, 15, 59, tzinfo=NEW_YORK))
    assert not _is_incomplete(stamp, "1h", datetime(2026, 10, 9, 16, tzinfo=NEW_YORK))
