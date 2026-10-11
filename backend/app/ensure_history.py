"""Container start-up step: python -m app.ensure_history.

Imports the extended BTC/USD history when the candle cache does not have it yet, so a fresh
server backtests the same period as a machine where the importer was run by hand. It never
stops the backend from starting: on failure the app falls back to Kraken's recent candles.
"""

import json
from datetime import datetime, timedelta, timezone

from . import config, crypto_data, import_crypto_history

# Kraken's live API alone reaches back 720 candles (30 days at 1h); the archive covers two years.
MIN_HISTORY = timedelta(days=365)


def missing_timeframes() -> list[str]:
    oldest_allowed = datetime.now(timezone.utc) - MIN_HISTORY
    missing = []
    for timeframe in crypto_data.INTERVALS:
        path = config.CANDLE_CACHE_DIR / f"BTCUSD_{timeframe}.json"
        try:
            start = datetime.fromisoformat(json.loads(path.read_text())["meta"]["start"])
        except (OSError, ValueError, KeyError, TypeError):
            missing.append(timeframe)
            continue
        if start > oldest_allowed:
            missing.append(timeframe)
    return missing


def main() -> None:
    missing = missing_timeframes()
    if not missing:
        print("BTC/USD extended history already cached; skipping import.", flush=True)
        return
    print(f"BTC/USD extended history missing for {', '.join(missing)}; importing.", flush=True)
    try:
        import_crypto_history.main()
    except Exception as exc:
        print(f"BTC/USD history import failed ({type(exc).__name__}: {exc}). "
              "Starting with recent candles only; run python -m app.import_crypto_history to retry.", flush=True)


if __name__ == "__main__":
    main()
