"""Historical OHLCV from Yahoo Finance, cached on disk so reruns are reproducible."""

import json
import math
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import config
from .engine import describe_range
from .schemas import SUPPORTED_SYMBOLS, SUPPORTED_TIMEFRAMES

SOURCE = "Yahoo Finance (yfinance)"
# Short intraday bars use 60 days; hourly data also supplies the 4-hour history.
FETCH_WINDOW = {"5m": "60d", "30m": "60d", "1h": "2y", "4h": "2y", "1d": "2y"}
PROVIDER_INTERVAL = {"5m": "5m", "30m": "30m", "1h": "1h", "4h": "1h", "1d": "1d"}
CANDLE_SECONDS = {"5m": 300, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86_400}
CACHE_MAX_AGE_SECONDS = {"5m": 3_600, "30m": 3_600, "1h": 3_600, "4h": 3_600, "1d": 12 * 3_600}
NEW_YORK = ZoneInfo("America/New_York")


class MarketDataError(Exception):
    pass


def get_candles(symbol: str, timeframe: str, refresh: bool = False) -> tuple[list[dict], dict]:
    if symbol not in SUPPORTED_SYMBOLS:
        raise MarketDataError(f"Unsupported symbol '{symbol}'. Supported: {', '.join(SUPPORTED_SYMBOLS)}.")
    if timeframe not in SUPPORTED_TIMEFRAMES:
        raise MarketDataError(f"Unsupported timeframe '{timeframe}'. Supported: {', '.join(SUPPORTED_TIMEFRAMES)}.")

    cache_file = config.CANDLE_CACHE_DIR / f"{symbol}_{timeframe}.json"
    from .gold_data import CACHE_PERIOD
    requested_period = CACHE_PERIOD if symbol == "XAUUSD" else FETCH_WINDOW[timeframe]
    if symbol == "BTCUSD":
        from .crypto_data import CACHE_PERIOD as CRYPTO_PERIOD
        requested_period = CRYPTO_PERIOD
    if symbol == "XAUUSD" and config.GOLD_PROVIDER == "massive":
        from .massive_gold import cache_period
        requested_period = cache_period()
    if symbol != "XAUUSD" and timeframe in ("5m", "30m") and config.STOCK_INTRADAY_PROVIDER == "massive":
        from .massive_data import cache_period
        requested_period = cache_period()
    if symbol != "XAUUSD" and timeframe in ("5m", "30m") and config.STOCK_INTRADAY_PROVIDER == "twelvedata":
        from .stock_data import cache_period
        requested_period = cache_period()
    cached = json.loads(cache_file.read_text()) if cache_file.exists() else None
    if (cached and not refresh
            and cached["meta"].get("requested_period") == requested_period
            and time.time() - cached["meta"]["fetched_at_epoch"] < CACHE_MAX_AGE_SECONDS[timeframe]):
        return cached["candles"], cached["meta"]

    try:
        candles, meta = _fetch(symbol, timeframe)
    except Exception as exc:
        if cached:
            meta = dict(cached["meta"])
            meta["limitations"] = meta["limitations"] + [f"Provider refresh failed ({exc}); showing cached data."]
            return cached["candles"], meta
        raise MarketDataError(f"Could not load {symbol} {timeframe} candles: {exc}") from exc

    if symbol == "BTCUSD" and cached and cached['meta'].get('requested_period') == requested_period:
        candles = sorted({c['time']:c for c in cached['candles'] + candles}.values(),key=lambda c:c['time'])
        meta.update(describe_range(candles))
    config.CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(json.dumps({"meta": meta, "candles": candles}))
    return candles, meta


def _fetch(symbol: str, timeframe: str) -> tuple[list[dict], dict]:
    if symbol == "BTCUSD":
        from .crypto_data import fetch_history
        return fetch_history(timeframe)
    if symbol == "XAUUSD":
        if config.GOLD_PROVIDER == "massive":
            from .massive_gold import fetch_gold
            return fetch_gold(timeframe)
        from .gold_data import fetch_gold
        return fetch_gold(timeframe)
    if timeframe in ("5m", "30m") and config.STOCK_INTRADAY_PROVIDER == "massive":
        from .massive_data import fetch_stocks
        return fetch_stocks(symbol, timeframe)
    if timeframe in ("5m", "30m") and config.STOCK_INTRADAY_PROVIDER == "twelvedata":
        from .stock_data import fetch_stocks
        return fetch_stocks(symbol, timeframe)
    import yfinance as yf

    frame = yf.Ticker(symbol).history(
        period=FETCH_WINDOW[timeframe], interval=PROVIDER_INTERVAL[timeframe], auto_adjust=False, prepost=False
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
        if _is_incomplete(stamp, PROVIDER_INTERVAL[timeframe], now):
            dropped_incomplete += 1
            continue
        ts = int(stamp.timestamp())
        candles_by_time[ts] = {
            "time": ts, "open": round(o, 4), "high": round(h, 4), "low": round(l, 4),
            "close": round(c, 4), "volume": int(v),
        }
    candles = [candles_by_time[ts] for ts in sorted(candles_by_time)]
    if timeframe == "4h":
        candles = _aggregate_four_hour(candles, now)
    if not candles:
        raise MarketDataError("no valid candles with volume after cleaning")

    limitations = [
        "Yahoo Finance is an unofficial, best-effort source; candles may differ slightly from exchange records.",
        "Regular trading hours only; pre-market and after-hours candles are excluded.",
    ]
    if timeframe in ("5m", "30m"):
        limitations.append("This app requests the last 60 days of intraday candles.")
    elif timeframe in ("1h", "4h"):
        limitations.append("This app requests up to 2 years of hourly history; available coverage depends on the provider.")
    if timeframe == "4h":
        limitations.append("4-hour candles aggregate hourly bars from 09:30 New York time within each trading day; the final session candle is shorter. Forming candles are excluded until their scheduled end (16:00 for the final candle).")
    if dropped_invalid:
        limitations.append(f"{dropped_invalid} candle(s) with missing/zero volume or invalid prices were dropped, not filled in.")

    meta = {
        "source": SOURCE,
        "symbol": symbol,
        "timeframe": timeframe,
        "requested_period": FETCH_WINDOW[timeframe],
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


def _aggregate_four_hour(candles: list[dict], now: datetime) -> list[dict]:
    """Session-aligned OHLCV buckets, never combining different trading days."""
    buckets: dict[int, dict] = {}
    for candle in candles:
        local = datetime.fromtimestamp(candle["time"], tz=NEW_YORK)
        session_open = local.replace(hour=9, minute=30, second=0, microsecond=0)
        session_close = local.replace(hour=16, minute=0, second=0, microsecond=0)
        if not session_open <= local < session_close:
            continue
        offset = int((local - session_open).total_seconds()) // CANDLE_SECONDS["4h"]
        start = session_open + timedelta(hours=4 * offset)
        end = min(start + timedelta(hours=4), session_close)
        if end > now.astimezone(NEW_YORK):
            continue
        key = int(start.timestamp())
        if key not in buckets:
            buckets[key] = {**candle, "time": key}
        else:
            bucket = buckets[key]
            bucket["high"] = max(bucket["high"], candle["high"])
            bucket["low"] = min(bucket["low"], candle["low"])
            bucket["close"] = candle["close"]
            bucket["volume"] += candle["volume"]
    return [buckets[key] for key in sorted(buckets)]


def _is_incomplete(stamp, timeframe: str, now: datetime) -> bool:
    """A candle still forming would leak future information into signals, so it is excluded."""
    if timeframe == "1d":
        local_now = now.astimezone(NEW_YORK)
        return stamp.date() == local_now.date() and (local_now.hour, local_now.minute) < (16, 5)
    local = datetime.fromtimestamp(stamp.timestamp(), tz=NEW_YORK)
    session_close = local.replace(hour=16, minute=0, second=0, microsecond=0)
    end = min(local + timedelta(seconds=CANDLE_SECONDS[timeframe]), session_close)
    return end > now.astimezone(NEW_YORK)
