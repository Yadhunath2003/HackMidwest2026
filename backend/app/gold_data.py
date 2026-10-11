"""Spot XAU/USD OHLC from Twelve Data. No futures substitution or fabricated volume."""

import math
from datetime import datetime, timezone

import httpx

from . import config
from .engine import describe_range

INTERVALS = {"5m": "5min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1day"}
SECONDS = {"5m": 300, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400}
SOURCE = "Twelve Data (XAU/USD spot gold)"
CACHE_PERIOD = "latest-5000-spot-v1"


def fetch_gold(timeframe: str) -> tuple[list[dict], dict]:
    if not config.TWELVEDATA_API_KEY:
        raise ValueError("XAUUSD requires TWELVEDATA_API_KEY in backend/.env with access to XAU/USD commodities data.")
    try:
        response = httpx.get("https://api.twelvedata.com/time_series", params={
            "symbol": "XAU/USD", "interval": INTERVALS[timeframe], "outputsize": 5000,
            "timezone": "UTC", "order": "asc", "apikey": config.TWELVEDATA_API_KEY,
        }, timeout=60)
    except httpx.HTTPError:
        # HTTP exceptions may contain the API key in the request URL.
        raise ValueError("Could not reach the XAUUSD data provider.") from None
    if response.status_code >= 400:
        raise ValueError(f"XAUUSD data provider returned HTTP {response.status_code}; check API access and quota.")
    data = response.json()
    if data.get("status") == "error" or not data.get("values"):
        raise ValueError("XAUUSD provider returned no candles; check your key, commodity entitlement, and API quota.")
    now = datetime.now(timezone.utc)
    by_time = {}
    dropped = 0
    for row in data["values"]:
        try:
            stamp = datetime.fromisoformat(row["datetime"]).replace(tzinfo=timezone.utc)
            ts = int(stamp.timestamp())
            o, h, l, c = (float(row[k]) for k in ("open", "high", "low", "close"))
            if (not all(math.isfinite(x) and x > 0 for x in (o, h, l, c))
                    or h < max(o, c) or l > min(o, c)):
                dropped += 1
                continue
            if ts + SECONDS[timeframe] > now.timestamp():
                continue
            by_time[ts] = {"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": None}
        except (ValueError, KeyError, TypeError):
            dropped += 1
    candles = [by_time[ts] for ts in sorted(by_time)]
    if not candles:
        raise ValueError("XAUUSD provider returned no valid completed candles.")
    return candles, {
        "source": SOURCE, "symbol": "XAUUSD", "timeframe": timeframe,
        "requested_period": CACHE_PERIOD, **describe_range(candles),
        "adjustment": "Spot USD per troy ounce; no equity split/dividend adjustments.",
        "volume_type": "Unavailable for this spot feed; no volume is fabricated.",
        "limitations": [
            "Latest up to 5,000 provider candles; history and access depend on your Twelve Data plan.",
            "Spot gold feed can differ from broker XAUUSD quotes; spread, leverage, lot rules, and financing are not modeled.",
            "Native provider candle boundaries in UTC; US equity trading hours are not applied.",
            f"Dropped {dropped} invalid price row(s).",
        ],
        "fetched_at": now.isoformat(), "fetched_at_epoch": int(now.timestamp()),
    }
