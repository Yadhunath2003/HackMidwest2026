from datetime import datetime, timezone

import httpx
import pytest

from app import market_data, stock_data


class FixedDate(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 10, 10, 12, tzinfo=timezone.utc)


def row(stamp, volume="1000"):
    return {"datetime": stamp, "open": "100", "high": "102", "low": "99", "close": "101", "volume": volume}


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(stock_data.config, "TWELVEDATA_API_KEY", "test-secret")
    monkeypatch.setattr(stock_data.config, "STOCK_INTRADAY_HISTORY_DAYS", 365)
    monkeypatch.setattr(stock_data, "datetime", FixedDate)


def replies(monkeypatch, pages):
    seen = []
    def get(url, params, timeout):
        seen.append(dict(params))
        return httpx.Response(200, json=pages[len(seen) - 1])
    monkeypatch.setattr(stock_data.httpx, "get", get)
    return seen


def test_pagination_downloads_beyond_60_days_and_filters_requested_range(provider, monkeypatch):
    monkeypatch.setattr(stock_data, "PAGE_SIZE", 2)
    seen = replies(monkeypatch, [
        {"values": [row("2026-10-09 14:00:00"), row("2026-10-09 13:30:00")]},
        {"values": [row("2026-01-02 15:00:00"), row("2026-01-02 14:30:00")]},
        {"values": [row("2025-10-10 13:30:00"), row("2025-09-01 13:30:00")]},
    ])
    candles, meta = stock_data.fetch_stocks("AAPL", "5m")
    assert len(candles) == 5
    assert meta["provider_requests"] == 3
    assert seen[1]["end_date"] == "2026-10-09 13:29:59"
    assert seen[2]["end_date"] == "2026-01-02 14:29:59"
    assert seen[0]["interval"] == "5min"
    assert candles == sorted(candles, key=lambda c: c["time"])
    assert all(c["volume"] == 1000 for c in candles)
    assert "less than" not in " ".join(meta["limitations"])


def test_invalid_volume_outside_hours_and_forming_rows_are_not_fabricated(provider, monkeypatch):
    replies(monkeypatch, [{"values": [row("2026-10-09 13:30:00"), row("2026-10-09 14:00:00", None),
                                    row("2026-10-09 12:00:00"), row("2026-10-10 13:30:00")]}])
    candles, meta = stock_data.fetch_stocks("AAPL", "30m")
    assert len(candles) == 1
    assert any("less than" in note for note in meta["limitations"])


def test_invalid_key_error_does_not_expose_key_or_provider_message(provider, monkeypatch):
    replies(monkeypatch, [{"status": "error", "code": 401, "message": "Bad key test-secret"}])
    with pytest.raises(ValueError, match="code 401") as error:
        stock_data.fetch_stocks("AAPL", "5m")
    assert "test-secret" not in str(error.value)


def test_network_error_does_not_expose_key(provider, monkeypatch):
    def fail(*args, **kwargs):
        raise httpx.ConnectError("URL apikey=test-secret")
    monkeypatch.setattr(stock_data.httpx, "get", fail)
    with pytest.raises(ValueError) as error:
        stock_data.fetch_stocks("AAPL", "5m")
    assert "test-secret" not in str(error.value)


def test_provider_switch_refreshes_yahoo_cache(provider, monkeypatch, tmp_path):
    import json
    import time
    monkeypatch.setattr(market_data.config, "CANDLE_CACHE_DIR", tmp_path)
    monkeypatch.setattr(market_data.config, "STOCK_INTRADAY_PROVIDER", "twelvedata")
    old = {"candles": [], "meta": {"requested_period": "60d", "fetched_at_epoch": time.time(), "limitations": []}}
    (tmp_path / "AAPL_5m.json").write_text(json.dumps(old))
    calls = []
    def fetch(symbol, timeframe):
        calls.append((symbol, timeframe))
        return [{"time": 1}], {"requested_period": stock_data.cache_period(), "fetched_at_epoch": time.time(), "limitations": []}
    monkeypatch.setattr(stock_data, "fetch_stocks", fetch)
    market_data.get_candles("AAPL", "5m")
    market_data.get_candles("AAPL", "5m")
    assert calls == [("AAPL", "5m")]
