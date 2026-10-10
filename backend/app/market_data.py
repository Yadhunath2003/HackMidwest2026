"""Historical OHLCV from Yahoo Finance, cached on disk so reruns are reproducible."""

import json
import math
import time
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from . import config
from .engine import describe_range
from .schemas import SUPPORTED_SYMBOLS, SUPPORTED_TIMEFRAMES

SOURCE = "Yahoo Finance (yfinance)"
# Yahoo serves at most the last 60 days of 5-minute candles.
FETCH_WINDOW = {"5m": "60d", "1d": "2y"}
CANDLE_SECONDS = {"5m": 300, "1d": 86_400}
CACHE_MAX_AGE_SECONDS = {"5m": 3_600, "1d": 12 * 3_600}
NEW_YORK = ZoneInfo("America/New_York")


class MarketDataError(Exception):
    pass


def get_candles(symbol: str, timeframe: str, refresh: bool = False) -> tuple[list[dict], dict]:
    if symbol not in SUPPORTED_SYMBOLS:
        raise MarketDataError(f"Unsupported symbol '{symbol}'. Supported: {', '.join(SUPPORTED_SYMBOLS)}.")
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise MarketDataError(f"Unsupported timeframe '{timeframe}'. Supported: {', '.join(SUPPORTED_TIMEFRAMES)}.")

    cache_file = config.CANDLE_CACHE_DIR / f"{symbol}_{timeframe}.json"
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else None
    if cached and not refresh and time.time() - cached["meta"]["fetched_at_epoch"] < CACHE_MAX_AGE_SECONDS[timeframe]:
        return cached["candles"], cached["meta"]

    try:
        candles, meta = _fetch(symbol, timeframe)
    except Exception as exc:
        if cached:
            meta = dict(cached["meta"])
            meta["limitations"] = meta["limitations"] + [f"Provider refresh failed ({exc}); showing cached data."]
            return cached["candles"], meta
        raise MarketDataError(f"Could not load {symbol} {timeframe} candles from {SOURCE}: {exc}") from exc

    config.CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({"meta": meta, "candles": candles}))
    return candles, meta


def _fetch(symbol: str, timeframe: str) -> tuple[list[dict], dict]:
    import yfinance as yf

    frame = yf.Ticker(symbol).history(
        period=FETCH_WINDOW[timeframe], interval=timeframe, auto_adjust=False, prepost=False
    )
    if frame.empty:
        raise MarketDataError("provider returned no rows")

    now = datetime.now(timezone.utc)
    candles_by_time: dict[int, dict] = {}
    dropped_invalid = dropped_incomplete = 0
    for stamp, row in frame.iterrows():
        o, h, l, c, v = (float(row[k]) for k in ("Open", "High", "Low", "Close", "Volume"))
        if any(math.isnan(x) for x in (o, h, l, c, v)) or v <= 0 or min(o, h, l, c) <= 0 or h < max(o, c) or l > min(o, c):
            dropped_invalid += 1
            continue
        if _is_incomplete(stamp, timeframe, now):
            dropped_incomplete += 1
            continue
        ts = int(stamp.timestamp())
        candles_by_time[ts] = {
            "time": ts, "open": round(o, 4), "high": round(h, 4), "low": round(l, 4),
            "close": round(c, 4), "volume": int(v),
        }
    candles = [candles_by_time[ts] for ts in sorted(candles_by_time)]
    if not candles:
        raise MarketDataError("no valid candles with volume after cleaning")

    limitations = [
        "Yahoo Finance is an unofficial, best-effort source; candles may differ slightly from exchange records.",
        "Regular trading hours only; pre-market and after-hours candles are excluded.",
    ]
    if timeframe == "5m":
        limitations.append("The provider only serves about the last 60 days of 5-minute candles.")
    if dropped_invalid:
        limitations.append(f"{dropped_invalid} candle(s) with missing/zero volume or invalid prices were dropped, not filled in.")

    meta = {
        "source": SOURCE,
        "symbol": symbol,
        "timeframe": timeframe,
        **describe_range(candles),
        "timezone": "Timestamps are candle open times as UTC epoch seconds.",
        "adjustment": "Split-adjusted by the provider; not adjusted for dividends.",
        "volume_type": "Reported share volume from the provider (not tick or proxy volume).",
        "dropped_invalid_candles": dropped_invalid,
        "dropped_incomplete_candles": dropped_incomplete,
        "limitations": limitations,
        "fetched_at": now.isoformat(),
        "fetched_at_epoch": int(now.timestamp()),
    }
    return candles, meta


def _is_incomplete(stamp, timeframe: str, now: datetime) -> bool:
    """A candle still forming would leak future information into signals, so it is excluded."""
    if timeframe == "1d":
        local_now = now.astimezone(NEW_YORK)
        return stamp.date() == local_now.date() and (local_now.hour, local_now.minute) < (16, 5)
    return stamp.timestamp() + CANDLE_SECONDS[timeframe] > now.timestamp()
