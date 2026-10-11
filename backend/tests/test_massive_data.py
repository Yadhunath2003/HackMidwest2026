from datetime import datetime, timezone

import httpx
import pytest

from app import massive_data, market_data


def bar(date="2026-10-09T13:30:00+00:00", **patch):
    return {"t": int(datetime.fromisoformat(date).timestamp() * 1000),
            "o": 100, "h": 102, "l": 99, "c": 101, "v": 1000, **patch}


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setattr(massive_data.time, "sleep", lambda seconds: None)
    monkeypatch.setattr(massive_data.config, "MASSIVE_API_KEY", "test-secret")
    monkeypatch.setattr(massive_data.config, "STOCK_INTRADAY_HISTORY_DAYS", 365)
    class FixedDate(datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 10, 10, 12, tzinfo=timezone.utc)
    monkeypatch.setattr(massive_data, "datetime", FixedDate)


def test_pagination_preserves_ohlcv_deduplicates_and_filters(configured, monkeypatch):
    seen = []
    pages = iter([
        {"status": "OK", "results": [bar(), bar("2026-10-09T12:00:00+00:00"), bar(v=None)],
         "next_url": "https://api.massive.com/v2/aggs/ticker/AAPL/range/5/minute/next?cursor=abc"},
        {"status": "OK", "results": [bar(), bar("2026-01-02T14:30:00+00:00"), bar("2099-01-01T14:30:00+00:00")]},
    ])
    def get(url, params, headers, timeout):
        seen.append(url)
        if len(seen) == 1:
            assert "/range/5/minute/2025-10-10/2026-10-10" in url
        assert headers["Authorization"] == "Bearer test-secret"
        assert "test-secret" not in url
        return httpx.Response(200, json=next(pages))
    monkeypatch.setattr(massive_data.httpx, "get", get)
    candles, meta = massive_data.fetch_stocks("AAPL", "5m")
    assert len(candles) == 2
    assert candles[0]["time"] < candles[1]["time"]
    assert candles[0]["volume"] == 1000
    assert meta["provider_requests"] == 2
    assert meta["source"].startswith("Massive")


def test_pagination_cannot_forward_key_to_other_host(configured, monkeypatch):
    calls = []
    def get(*args, **kwargs):
        calls.append(args)
        return httpx.Response(200, json={"status": "OK", "results": [bar()], "next_url": "https://other.example/data"})
    monkeypatch.setattr(massive_data.httpx, "get", get)
    with pytest.raises(ValueError, match="pagination URL"):
        massive_data.fetch_stocks("AAPL", "30m")
    assert len(calls) == 1


@pytest.mark.parametrize("status, message", [(401, "API key"), (403, "plan"), (429, "quota")])
def test_provider_errors_do_not_expose_credentials(configured, monkeypatch, status, message):
    monkeypatch.setattr(massive_data.httpx, "get", lambda *args, **kwargs:
                        httpx.Response(status, json={"error": "test-secret"}))
    with pytest.raises(ValueError, match=message) as error:
        massive_data.fetch_stocks("AAPL", "5m")
    assert "test-secret" not in str(error.value)


def test_massive_cache_replaces_then_reuses_yahoo_history(configured, monkeypatch, tmp_path):
    import json
    import time
    monkeypatch.setattr(market_data.config, "CANDLE_CACHE_DIR", tmp_path)
    monkeypatch.setattr(market_data.config, "STOCK_INTRADAY_PROVIDER", "massive")
    (tmp_path / "AAPL_30m.json").write_text(json.dumps({"candles": [], "meta": {
        "requested_period": "60d", "fetched_at_epoch": time.time(), "limitations": []}}))
    calls = []
    def fetch(*args):
        calls.append(args)
        return [{"time": 1}], {"requested_period": massive_data.cache_period(), "fetched_at_epoch": time.time(), "limitations": []}
    monkeypatch.setattr(massive_data, "fetch_stocks", fetch)
    market_data.get_candles("AAPL", "30m")
    market_data.get_candles("AAPL", "30m")
    assert calls == [("AAPL", "30m")]


def test_rate_limit_retries_same_page_without_losing_history(configured, monkeypatch):
    calls = []
    def get(url, **kwargs):
        calls.append(url)
        return (httpx.Response(429) if len(calls) == 1 else
                httpx.Response(200, json={"status": "OK", "results": [bar()]}))
    monkeypatch.setattr(massive_data.httpx, "get", get)
    candles, meta = massive_data.fetch_stocks("AAPL", "5m")
    assert len(candles) == 1
    assert calls[0] == calls[1]
    assert meta["provider_requests"] == 2
    assert meta["provider_pages"] == 1
