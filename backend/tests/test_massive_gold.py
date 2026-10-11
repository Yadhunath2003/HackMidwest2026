import json

from app import massive_data, massive_gold


def test_aggregation_keeps_ohlc_without_fabricating_volume():
    candles = [{"time": 1800 + i * 300, "open": 100+i, "high": 102+i, "low": 99+i,
                "close": 101+i, "volume": None} for i in range(8)]
    result = massive_gold.aggregate(candles, "30m", 3900)
    assert result == [{"time": 1800, "open": 100, "high": 107, "low": 99, "close": 106, "volume": None}]


def test_all_gold_timeframes_reuse_one_download(monkeypatch, tmp_path):
    monkeypatch.setattr(massive_gold.config, "CANDLE_CACHE_DIR", tmp_path)
    calls = []
    def fetch(symbol, timeframe, **kwargs):
        import time
        calls.append((symbol, timeframe, kwargs))
        candles = [{"time": 172800 + i * 300, "open": 100, "high": 102, "low": 99, "close": 101, "volume": None}
                   for i in range(600)]
        return candles, {"source": "Massive spot", "limitations": [], "fetched_at_epoch": time.time()}
    monkeypatch.setattr(massive_data, "fetch_stocks", fetch)
    for timeframe in massive_gold.SECONDS:
        candles, meta = massive_gold.fetch_gold(timeframe)
        assert candles
        assert all(c["volume"] is None for c in candles)
        assert meta["timeframe"] == timeframe
    assert calls == [("XAUUSD", "5m", {"spot_gold": True})]
    assert json.loads((tmp_path / "XAUUSD_5m.json").read_text())["meta"]["requested_period"] == massive_gold.cache_period()


def test_quote_activity_sums_and_missing_activity_stays_unknown():
    candles = [{"time": 1800 + i * 300, "open": 100, "high": 102, "low": 99, "close": 101, "volume": 10}
               for i in range(6)]
    assert massive_gold.aggregate(candles, "30m", 4000)[0]["volume"] == 60
    candles[2]["volume"] = None
    assert massive_gold.aggregate(candles, "30m", 4000)[0]["volume"] is None
