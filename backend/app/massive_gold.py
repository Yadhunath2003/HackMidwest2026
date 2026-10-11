"""Spot-gold charts derived from a shared Massive five-minute archive."""

import json
import time
from datetime import datetime, timezone

from . import config, massive_data
from .engine import describe_range

SECONDS = {"5m": 300, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}


def cache_period():
    return f"massive-{config.STOCK_INTRADAY_HISTORY_DAYS}d-spot-quote-v2"


def aggregate(candles, timeframe, now):
    if timeframe == "5m":
        return candles
    seconds = SECONDS[timeframe]
    buckets = {}
    for candle in candles:
        start = candle["time"] // seconds * seconds
        if start < candles[0]["time"] or start + seconds > now:
            continue
        if start not in buckets:
            buckets[start] = {**candle, "time": start}
        else:
            bucket = buckets[start]
            bucket["high"] = max(bucket["high"], candle["high"])
            bucket["low"] = min(bucket["low"], candle["low"])
            bucket["close"] = candle["close"]
            bucket["volume"] = (bucket["volume"] + candle["volume"]
                                if bucket["volume"] is not None and candle["volume"] is not None else None)
    return [buckets[key] for key in sorted(buckets)]


def fetch_gold(timeframe):
    path = config.CANDLE_CACHE_DIR / "XAUUSD_5m.json"
    cached = json.loads(path.read_text()) if path.exists() else None
    if (cached and cached["meta"].get("requested_period") == cache_period()
            and time.time() - cached["meta"]["fetched_at_epoch"] < 3600):
        candles, meta = cached["candles"], cached["meta"]
    else:
        candles, meta = massive_data.fetch_stocks("XAUUSD", "5m", spot_gold=True)
        meta["requested_period"] = cache_period()
        config.CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"candles": candles, "meta": meta}))
    result = aggregate(candles, timeframe, datetime.now(timezone.utc).timestamp())
    if not result:
        raise ValueError("No completed spot-gold candles available for this timeframe.")
    notes = list(meta["limitations"])
    if timeframe != "5m":
        notes.append("Aggregated from completed Massive 5-minute spot candles in UTC clock-aligned buckets; incomplete boundary buckets are omitted. Missing sub-bars are not fabricated, and trading-day boundaries may differ from broker charts.")
    return result, {**meta, **describe_range(result), "timeframe": timeframe, "limitations": notes,
                    "derived_from": "5m" if timeframe != "5m" else None}
