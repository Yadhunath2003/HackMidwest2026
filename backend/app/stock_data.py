"""Paged Twelve Data stock OHLCV with explicit coverage and no invented volume."""

import math
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from . import config
from .engine import describe_range

PAGE_SIZE = 5000
SOURCE = "Twelve Data (stocks)"
INTERVALS = {"5m": "5min", "30m": "30min"}
NEW_YORK = ZoneInfo("America/New_York")


def cache_period():
    return f"twelvedata-{config.STOCK_INTRADAY_HISTORY_DAYS}d-v1"


def fetch_stocks(symbol: str, timeframe: str) -> tuple[list[dict], dict]:
    if not config.TWELVEDATA_API_KEY:
        raise ValueError("Twelve Data stock history requires TWELVEDATA_API_KEY in backend/.env.")
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=config.STOCK_INTRADAY_HISTORY_DAYS)
    end = now
    by_time = {}
    dropped = pages = 0
    covered = False
    for _ in range(64):
        try:
            response = httpx.get("https://api.twelvedata.com/time_series", params={
                "symbol": symbol, "interval": INTERVALS[timeframe], "outputsize": PAGE_SIZE,
                "timezone": "UTC", "order": "desc", "prepost": "false",
                "end_date": end.strftime("%Y-%m-%d %H:%M:%S"), "apikey": config.TWELVEDATA_API_KEY,
            }, timeout=60)
        except httpx.HTTPError:
            raise ValueError("Could not reach Twelve Data for stock history.") from None
        if response.status_code >= 400:
            raise ValueError(f"Twelve Data returned HTTP {response.status_code}; check the key, stock-history access, and quota.")
        try:
            data = response.json()
        except ValueError:
            raise ValueError("Twelve Data returned an invalid response.") from None
        if not isinstance(data, dict):
            raise ValueError("Twelve Data returned an invalid response.")
        if data.get("status") == "error":
            # Provider messages and request URLs can contain credentials; never expose them.
            raise ValueError(f"Twelve Data rejected stock history (code {data.get('code', 'unknown')}); check your key, access, and quota.")
        values = data.get("values", [])
        if not isinstance(values, list):
            raise ValueError("Twelve Data returned invalid candle rows.")
        if not values:
            break
        pages += 1
        stamps = []
        for row in values:
            try:
                stamp = datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc)
                stamps.append(stamp)
                if stamp < start or stamp + timedelta(minutes=5 if timeframe == "5m" else 30) > now:
                    continue
                local = stamp.astimezone(NEW_YORK)
                if local.weekday() >= 5 or not (9 * 60 + 30 <= local.hour * 60 + local.minute < 16 * 60):
                    continue
                o, h, l, c, v = (float(row[k]) for k in ("open", "high", "low", "close", "volume"))
                if (not all(math.isfinite(x) for x in (o, h, l, c, v)) or min(o, h, l, c) <= 0
                        or v <= 0 or h < max(o, c) or l > min(o, c)):
                    dropped += 1
                    continue
                ts = int(stamp.timestamp())
                by_time[ts] = {"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": int(v)}
            except (KeyError, ValueError, TypeError):
                dropped += 1
        if not stamps:
            raise ValueError("Twelve Data returned no usable candle timestamps.")
        oldest = min(stamps)
        if oldest >= end:
            raise ValueError("Twelve Data pagination did not advance; history download stopped.")
        if oldest <= start:
            covered = True
            break
        if len(values) < PAGE_SIZE:
            break
        end = oldest - timedelta(seconds=1)
    candles = [by_time[t] for t in sorted(by_time)]
    if not candles:
        raise ValueError("Twelve Data returned no valid completed stock candles with volume.")
    limitations = [
        "Requested history depends on Twelve Data plan access and instrument availability; actual dates are shown below.",
        "Regular US trading hours only; no missing candles or volume are fabricated.",
        "Prices and volume are supplied by Twelve Data; adjustment behavior is not independently verified.",
    ]
    if not covered:
        limitations.append("The provider returned less than the requested history or the pagination limit was reached.")
    if dropped:
        limitations.append(f"Dropped {dropped} invalid price/volume rows.")
    return candles, {"source": SOURCE, "symbol": symbol, "timeframe": timeframe,
        "requested_period": cache_period(), "requested_start": start.isoformat(), "requested_end": now.isoformat(),
        **describe_range(candles), "provider_requests": pages,
        "adjustment": "Provider-supplied prices; adjustment behavior is not independently verified.",
        "volume_type": "Reported share volume from Twelve Data.", "limitations": limitations,
        "fetched_at": now.isoformat(), "fetched_at_epoch": int(now.timestamp())}
