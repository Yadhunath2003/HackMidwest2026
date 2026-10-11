"""Run from backend/: python -m app.cache_all. No strategy or AI calls."""

import json
import time
from datetime import datetime, timezone

from . import config, market_data, massive_data, massive_gold
from .engine import describe_range
from .schemas import SUPPORTED_SYMBOLS, SUPPORTED_TIMEFRAMES


def main():
    summary = []
    original_sleep = massive_data.time.sleep
    def cooldown(seconds):
        print(json.dumps({"phase": "provider_rate_limit", "wait_seconds": seconds}), flush=True)
        original_sleep(seconds)
    massive_data.time.sleep = cooldown
    try:
        for symbol in SUPPORTED_SYMBOLS:
            base = base_meta = None
            for timeframe in SUPPORTED_TIMEFRAMES:
                print(json.dumps({"phase": "loading", "symbol": symbol, "timeframe": timeframe}), flush=True)
                try:
                    # Reuse the complete five-minute archive for a consistent 30m stock chart.
                    if (symbol != "XAUUSD" and timeframe == "30m" and base
                            and base_meta["source"] == massive_data.SOURCE):
                        series = massive_gold.aggregate(base, "30m", time.time())
                        volumes = {}
                        for candle in base:
                            bucket = candle["time"] // 1800 * 1800
                            volumes[bucket] = volumes.get(bucket, 0) + candle["volume"]
                        for candle in series:
                            candle["volume"] = volumes[candle["time"]]
                        meta = {**base_meta, **describe_range(series), "timeframe": "30m", "derived_from": "5m",
                            "limitations": base_meta["limitations"] + ["30-minute OHLCV aggregated from the cached 5-minute Massive stock bars; missing sub-bars are not fabricated."]}
                        path = config.CANDLE_CACHE_DIR / f"{symbol}_30m.json"
                        path.write_text(json.dumps({"candles": series, "meta": meta}))
                    else:
                        series, meta = market_data.get_candles(symbol, timeframe)
                    if timeframe == "5m":
                        base, base_meta = series, meta
                    status = "cached_fallback" if any("showing cached data" in n for n in meta.get("limitations", [])) else "ready"
                    item = {"symbol": symbol, "timeframe": timeframe, "status": status,
                            "candles": len(series), "source": meta["source"], "start": meta["start"], "end": meta["end"]}
                except Exception as exc:
                    item = {"symbol": symbol, "timeframe": timeframe, "status": "failed", "message": str(exc)}
                summary.append(item)
                print(json.dumps(item), flush=True)
    finally:
        massive_data.time.sleep = original_sleep
    manifest = {"created_at": datetime.now(timezone.utc).isoformat(), "charts": summary}
    config.CANDLE_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (config.CANDLE_CACHE_DIR / "chart_inventory.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps({"ready": sum(i["status"] == "ready" for i in summary), "total": len(summary)}), flush=True)
    return 0 if all(i["status"] == "ready" for i in summary) else 1


if __name__ == "__main__":
    raise SystemExit(main())
