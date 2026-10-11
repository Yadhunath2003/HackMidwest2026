"""Import Kraken's public BTC/USD archive: python -m app.import_crypto_history."""
import csv
import io
import json
import math
import os
import time
import zipfile
from datetime import datetime, timezone

import httpx

from . import config, crypto_data
from .engine import describe_range

ARCHIVE = 'https://assets.kraken.com/marketing/institutions/Kraken_OHLCVT_Full_2026Q2.zip'
ARCHIVE_END = int(datetime(2026, 7, 1, tzinfo=timezone.utc).timestamp())


class RemoteArchive(io.RawIOBase):
    """Seek across split ZIP parts using HTTP ranges; never download other pairs."""
    def __init__(self, client, urls):
        self.client, self.urls, self.position = client, urls, 0
        self.block = None
        self.sizes = []
        for url in urls:
            response = client.get(url, headers={'Range': 'bytes=0-0'})
            response.raise_for_status()
            if response.status_code != 206:
                raise ValueError('Archive host must support partial downloads.')
            self.sizes.append(int(response.headers['content-range'].split('/')[-1]))

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset + (self.position if whence == 1 else sum(self.sizes) if whence == 2 else 0)
        if self.position < 0:
            raise ValueError('Negative archive offset')
        return self.position

    def read(self, size=-1):
        remaining = min(size if size >= 0 else sum(self.sizes), sum(self.sizes) - self.position)
        chunks = []
        offset = self.position
        for url, length in zip(self.urls, self.sizes):
            if offset >= length:
                offset -= length
                continue
            while remaining > 0 and offset < length:
                count = min(remaining, length - offset, 4 * 1024 * 1024)
                if self.block and self.block[0] == url and self.block[1] <= offset < self.block[1] + len(self.block[2]):
                    start = offset - self.block[1]
                    data = self.block[2][start:start + count]
                    count = len(data)
                else:
                    download = min(max(count, 1024 * 1024), length - offset)
                    response = self.client.get(url, headers={'Range': f'bytes={offset}-{offset + download - 1}'})
                    response.raise_for_status()
                    expected = f'bytes {offset}-{offset + download - 1}/{length}'
                    if response.status_code != 206 or response.headers.get('content-range') != expected or len(response.content) != download:
                        raise ValueError('Archive returned an incorrect byte range')
                    self.block = (url, offset, response.content)
                    data = response.content[:count]
                chunks.append(data)
                remaining -= count
                offset += count
                self.position += count
            offset = 0
            if remaining == 0:
                break
        return b''.join(chunks)


def parse_csv(stream, seconds, now, cutoff=None):
    cutoff = now - 2 * 365 * 86400 if cutoff is None else cutoff
    rows = {}
    for raw in csv.reader(stream):
        if not raw:
            continue
        stamp = int(raw[0])
        if stamp < cutoff or stamp + seconds > now:
            continue
        values = list(map(float, raw[1:6]))
        o, h, l, c, v = values
        if (not all(map(math.isfinite, values)) or min(o, h, l, c) <= 0 or v < 0
                or h < max(o, c, l) or l > min(o, c) or stamp % seconds):
            raise ValueError(f'Invalid archived BTC/USD candle at {stamp}')
        rows[stamp] = dict(time=stamp, open=o, high=h, low=l, close=c, volume=v)
    return [rows[t] for t in sorted(rows)]


def coverage(rows, seconds):
    gaps = [{'after': a['time'], 'before': b['time'], 'missing_intervals': (b['time'] - a['time']) // seconds - 1}
            for a, b in zip(rows, rows[1:]) if b['time'] - a['time'] > seconds]
    return {'gap_count': len(gaps), 'missing_intervals': sum(g['missing_intervals'] for g in gaps), 'gaps': gaps}


def aggregate_thirty(rows):
    buckets = {}
    for candle in rows:
        buckets.setdefault(candle['time'] // 1800 * 1800, []).append(candle)
    result = []
    for stamp, group in sorted(buckets.items()):
        if [c['time'] for c in group] != [stamp + i * 300 for i in range(6)]:
            continue
        result.append(dict(time=stamp, open=group[0]['open'], high=max(c['high'] for c in group),
                           low=min(c['low'] for c in group), close=group[-1]['close'], volume=sum(c['volume'] for c in group)))
    return result


def main():
    now = int(time.time())
    cutoff = min(now, ARCHIVE_END) - 2 * 365 * 86400
    config.CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    with httpx.Client(timeout=60, follow_redirects=True) as client:
        remote = RemoteArchive(client, [f'{ARCHIVE}.part{i:02}' for i in range(5)])
        with zipfile.ZipFile(remote) as archive:
            names = archive.namelist()
            for timeframe, minutes in crypto_data.INTERVALS.items():
                matches = [name for name in names if name.rsplit('/', 1)[-1] in
                           (f'XBTUSD_{minutes}.csv', f'XXBTZUSD_{minutes}.csv', f'BTCUSD_{minutes}.csv')]
                if timeframe == '30m' and not matches:
                    matches = ['XBTUSD_5.csv (complete six-bar aggregation)']
                    cached_five = json.loads((config.CANDLE_CACHE_DIR / 'BTCUSD_5m.json').read_text())
                    rows = aggregate_thirty(cached_five['candles'])
                elif len(matches) != 1:
                    raise ValueError(f'Expected one BTC/USD {timeframe} archive member; found {matches}')
                else:
                    print(f'Importing {matches[0]}', flush=True)
                    with archive.open(matches[0]) as member:
                        rows = parse_csv(io.TextIOWrapper(member), minutes * 60, now, cutoff)
                if not rows:
                    raise ValueError('Archive contained no candles in the requested two-year window')
                path = config.CANDLE_CACHE_DIR / f'BTCUSD_{timeframe}.json'
                existing = json.loads(path.read_text()) if path.exists() else None
                if existing and existing['meta'].get('source') == 'Kraken BTC/USD':
                    rows += [c for c in existing['candles'] if cutoff <= c['time'] and c['time'] + minutes * 60 <= now]
                recent, meta = crypto_data.fetch_history(timeframe)
                rows = sorted({c['time']: c for c in rows + recent}.values(), key=lambda c: c['time'])
                gaps = coverage(rows, minutes * 60)
                meta.update(describe_range(rows))
                meta.update(archive_source=ARCHIVE, archive_member=matches[0], history_window_days=730, coverage=gaps)
                if gaps['gap_count']:
                    meta['limitations'].append(f"History has {gaps['gap_count']} gap(s), totaling {gaps['missing_intervals']} absent intervals. Archives and recent API candles do not establish continuous coverage.")
                temp = path.with_suffix('.import.tmp')
                temp.write_text(json.dumps({'meta': meta, 'candles': rows}))
                os.replace(temp, path)
                print(json.dumps({'timeframe': timeframe, **describe_range(rows), 'gap_count': gaps['gap_count'],
                                  'missing_intervals': gaps['missing_intervals']}), flush=True)


if __name__ == '__main__':
    main()
