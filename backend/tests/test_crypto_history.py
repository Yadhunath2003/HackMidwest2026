import io
import json

import pytest
import httpx

from app import crypto_data, market_data
from app.import_crypto_history import parse_csv, coverage, aggregate_thirty, RemoteArchive


def test_partial_archive_reads_across_parts_and_seeks():
    parts = {'/a': b'abcde', '/b': b'fghij'}
    def respond(request):
        data = parts[request.url.path]
        start, end = map(int, request.headers['range'].removeprefix('bytes=').split('-'))
        return httpx.Response(206, content=data[start:end + 1], headers={'content-range': f'bytes {start}-{end}/{len(data)}'})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        archive = RemoteArchive(client, ['https://example.com/a', 'https://example.com/b'])
        archive.seek(3)
        assert archive.read(5) == b'defgh'
        archive.seek(-2, 2)
        assert archive.read() == b'ij'


def test_archive_validation_dedup_and_completed_window():
    text = '300,10,12,9,11,0.2,2\n300,10,13,9,12,0.3,3\n600,12,13,11,12,1,1\n900,12,13,11,12,1,1\n'
    rows = parse_csv(io.StringIO(text), 300, 950)
    assert [c['time'] for c in rows] == [300, 600]
    assert rows[0]['volume'] == .3
    with pytest.raises(ValueError):
        parse_csv(io.StringIO('300,10,9,8,11,1,1\n'), 300, 950)
    assert coverage([rows[0], {**rows[1], 'time': 1200}], 300)['missing_intervals'] == 2


def test_refresh_keeps_archive_and_uses_crypto_period_with_stock_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(market_data.config, 'CANDLE_CACHE_DIR', tmp_path)
    monkeypatch.setattr(market_data.config, 'STOCK_INTRADAY_PROVIDER', 'massive')
    candle = dict(time=300, open=10, high=12, low=9, close=11, volume=.1)
    meta = dict(source='Kraken BTC/USD', requested_period=crypto_data.CACHE_PERIOD,
                fetched_at_epoch=0, limitations=[], archive_source='archive')
    path = tmp_path / 'BTCUSD_5m.json'
    path.write_text(json.dumps(dict(candles=[candle], meta=meta)))
    monkeypatch.setattr(market_data, '_fetch', lambda *a: ([{**candle, 'time': 1200}], dict(meta)))
    rows, result = market_data.get_candles('BTCUSD', '5m', refresh=True)
    assert len(rows) == 2
    assert result['archive_source'] == 'archive'
    assert result['coverage']['missing_intervals'] == 2


def test_thirty_minute_aggregation_requires_all_six_bars():
    rows = [dict(time=i * 300, open=10, high=12, low=9, close=11, volume=.5) for i in range(12)]
    assert aggregate_thirty(rows)[0]['volume'] == 3
    assert len(aggregate_thirty(rows[1:])) == 1


def test_backtest_excludes_long_gap_without_deleting_cached_segments(monkeypatch):
    rows = [dict(time=t, open=10, high=12, low=9, close=11, volume=1) for t in (0, 3600, 7200, 900000, 903600)]
    monkeypatch.setattr(market_data, '_get_cached_candles', lambda *a: (rows, {'limitations': []}))
    selected, meta = market_data.get_candles('BTCUSD', '1h')
    assert len(selected) == 3
    assert meta['excluded_segment_candles'] == 2
    assert len(rows) == 5
