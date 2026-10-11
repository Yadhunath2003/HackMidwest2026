"""Split-adjusted stock OHLCV from Massive's paginated custom aggregates API."""

import math
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx

from . import config
from .engine import describe_range

SOURCE = "Massive (stock aggregates)"
MINUTES = {"5m": 5, "30m": 30}
NEW_YORK = ZoneInfo("America/New_York")


def cache_period():
    return f"massive-{config.STOCK_INTRADAY_HISTORY_DAYS}d-v2"


def fetch_stocks(symbol: str, timeframe: str, *, spot_gold: bool = False) -> tuple[list[dict], dict]:
    if not config.MASSIVE_API_KEY:
        raise ValueError("Massive stock history requires MASSIVE_API_KEY in backend/.env.")
    now = datetime.now(timezone.utc)
    start = now - timedelta(days=config.STOCK_INTRADAY_HISTORY_DAYS)
    minutes = MINUTES[timeframe]
    ticker = "C:XAUUSD" if spot_gold else symbol
    # Date boundaries keep 5m/30m bars aligned to the provider's normal session grid.
    url = f"https://api.massive.com/v2/aggs/ticker/{ticker}/range/{minutes}/minute/{start.date().isoformat()}/{now.date().isoformat()}"
    params = {"adjusted": "false" if spot_gold else "true", "sort": "asc", "limit": 50000}
    by_time = {}
    visited = set()
    dropped = pages = requests = 0
    for _ in range(64):
        # Never forward the credential to an arbitrary pagination destination.
        parts = urlsplit(url)
        if parts.scheme != "https" or parts.netloc != "api.massive.com" or not parts.path.startswith("/v2/aggs/"):
            raise ValueError("Massive returned an invalid pagination URL.")
        if url in visited:
            raise ValueError("Massive pagination repeated a page; history download stopped.")
        visited.add(url)
        for attempt in range(3):
            requests += 1
            try:
                response = httpx.get(url, params=params, headers={"Authorization": f"Bearer {config.MASSIVE_API_KEY}"}, timeout=60)
            except httpx.HTTPError:
                raise ValueError("Could not reach Massive for stock history.") from None
            if response.status_code == 429 and attempt < 2:
                time.sleep(60)
                continue
            break
        if response.status_code == 401:
            raise ValueError("Massive rejected the API key (401); check MASSIVE_API_KEY.")
        if response.status_code == 403:
            raise ValueError("Massive denied this history request (403); check your plan's intraday history access.")
        if response.status_code == 429:
            raise ValueError("Massive's request quota was reached (429); wait before retrying.")
        if response.status_code >= 400:
            raise ValueError(f"Massive returned HTTP {response.status_code} for stock history.")
        try:
            data = response.json()
        except ValueError:
            raise ValueError("Massive returned an invalid response.") from None
        if not isinstance(data, dict) or data.get("status") not in ("OK", "DELAYED"):
            raise ValueError("Massive did not return a successful history response; check access and quota.")
        results = data.get("results", [])
        if not isinstance(results, list):
            raise ValueError("Massive returned invalid candle rows.")
        pages += 1
        for row in results:
            try:
                ts = int(row["t"]) // 1000
                stamp = datetime.fromtimestamp(ts, tz=timezone.utc)
                local = stamp.astimezone(NEW_YORK)
                if (stamp < start or stamp + timedelta(minutes=minutes) > now
                        or (not spot_gold and (local.weekday() >= 5 or not 570 <= local.hour * 60 + local.minute < 960))):
                    continue
                o, h, l, c = (float(row[k]) for k in ("o", "h", "l", "c"))
                v = float(row["v"]) if row.get("v") is not None else None
                if (not all(math.isfinite(x) for x in (o, h, l, c)) or min(o, h, l, c) <= 0
                        or (v is not None and (not math.isfinite(v) or v < 0))
                        or (not spot_gold and (v is None or v <= 0)) or h < max(o, c) or l > min(o, c)):
                    dropped += 1
                    continue
                by_time[ts] = {"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v}
            except (KeyError, ValueError, TypeError, OverflowError):
                dropped += 1
        url = data.get("next_url")
        if not url:
            break
        if not isinstance(url, str):
            raise ValueError("Massive returned an invalid pagination URL.")
        params = None
    else:
        raise ValueError("Massive history exceeded the pagination limit; reduce STOCK_INTRADAY_HISTORY_DAYS.")
    candles = [by_time[t] for t in sorted(by_time)]
    if not candles:
        raise ValueError("Massive returned no valid completed stock candles with volume for the requested history.")
    return candles, {"source": "Massive (XAU/USD spot gold)" if spot_gold else SOURCE, "symbol": symbol, "timeframe": timeframe,
        "requested_period": cache_period(), "requested_start": start.isoformat(), "requested_end": now.isoformat(),
        **describe_range(candles), "provider_requests": requests, "provider_pages": pages,
        "adjustment": "Spot USD per troy ounce." if spot_gold else "Split-adjusted stock aggregates requested; not dividend-adjusted.",
        "volume_type": "Quote activity (tick-volume proxy), not traded gold volume." if spot_gold else "Reported stock aggregate volume from Massive.",
        "volume_kind": "quote" if spot_gold else "traded",
        "limitations": [
            "Actual historical coverage depends on your Massive plan and the instrument; check the displayed dates.",
            "Continuous spot feed; volume is provider quote activity, not ounces/contracts traded. Missing activity stays unavailable." if spot_gold else "Regular US trading hours only. Missing candles and volume are not fabricated.",
            f"Dropped {dropped} invalid price/volume rows.",
        ], "fetched_at": now.isoformat(), "fetched_at_epoch": int(now.timestamp())}
