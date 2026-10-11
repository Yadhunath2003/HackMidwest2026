import json
from datetime import datetime, timedelta, timezone

from app import config, crypto_data, ensure_history, import_crypto_history


def write_cache(directory, timeframe, days_of_history):
    start = datetime.now(timezone.utc) - timedelta(days=days_of_history)
    (directory / f"BTCUSD_{timeframe}.json").write_text(json.dumps({"meta": {"start": start.isoformat()}, "candles": []}))


def test_empty_cache_needs_every_timeframe(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CANDLE_CACHE_DIR", tmp_path)
    assert ensure_history.missing_timeframes() == list(crypto_data.INTERVALS)


def test_recent_only_or_unreadable_cache_counts_as_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CANDLE_CACHE_DIR", tmp_path)
    for timeframe in crypto_data.INTERVALS:
        write_cache(tmp_path, timeframe, days_of_history=700)
    write_cache(tmp_path, "1h", days_of_history=30)  # what Kraken's live API alone provides
    (tmp_path / "BTCUSD_4h.json").write_text("not json")
    assert ensure_history.missing_timeframes() == ["1h", "4h"]


def test_import_is_skipped_when_history_is_present(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "CANDLE_CACHE_DIR", tmp_path)
    for timeframe in crypto_data.INTERVALS:
        write_cache(tmp_path, timeframe, days_of_history=700)
    monkeypatch.setattr(import_crypto_history, "main", lambda: (_ for _ in ()).throw(AssertionError("should not import")))
    ensure_history.main()


def test_failed_import_does_not_stop_startup(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(config, "CANDLE_CACHE_DIR", tmp_path)

    def unreachable():
        raise ValueError("archive unreachable")

    monkeypatch.setattr(import_crypto_history, "main", unreachable)
    ensure_history.main()
    assert "import failed" in capsys.readouterr().out
