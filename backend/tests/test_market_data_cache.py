import json
import time

import pytest

from app import market_data


@pytest.mark.parametrize("timeframe", ["1h", "4h"])
@pytest.mark.parametrize("old_period", [None, "60d"])
def test_short_history_cache_refreshes_then_reuses_expanded_history(tmp_path, monkeypatch, timeframe, old_period):
    monkeypatch.setattr(market_data.config, "CANDLE_CACHE_DIR", tmp_path)
    old_meta = {"fetched_at_epoch": time.time(), "limitations": []}
    if old_period:
        old_meta["requested_period"] = old_period
    cache_file = tmp_path / f"AAPL_{timeframe}.json"
    cache_file.write_text(json.dumps({"candles": [], "meta": old_meta}))
    calls = []
    candles = [{"time": 123, "close": 100}]
    meta = {"fetched_at_epoch": time.time(), "requested_period": "2y", "limitations": []}

    def fetch(symbol, requested_timeframe):
        calls.append((symbol, requested_timeframe))
        return candles, meta

    monkeypatch.setattr(market_data, "_fetch", fetch)
    assert market_data.get_candles("AAPL", timeframe) == (candles, meta)
    assert market_data.get_candles("AAPL", timeframe) == (candles, meta)
    assert calls == [("AAPL", timeframe)]


def test_refresh_failure_preserves_cached_history_with_warning(tmp_path, monkeypatch):
    monkeypatch.setattr(market_data.config, "CANDLE_CACHE_DIR", tmp_path)
    old = {"candles": [{"time": 123}], "meta": {
        "fetched_at_epoch": time.time(), "requested_period": "60d", "limitations": []}}
    (tmp_path / "AAPL_1h.json").write_text(json.dumps(old))

    def fetch(*args):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(market_data, "_fetch", fetch)
    candles, meta = market_data.get_candles("AAPL", "1h")
    assert candles == old["candles"]
    assert meta["requested_period"] == "60d"
    assert "showing cached data" in meta["limitations"][-1]
