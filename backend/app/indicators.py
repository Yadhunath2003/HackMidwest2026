"""Indicator and candle-anatomy calculations.

Every function returns a list aligned with its input, where index i uses only data up to and
including candle i. Values that cannot be computed are None, never 0 or NaN.
"""


def sma(values: list[float], period: int) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    total = 0.0
    for i, value in enumerate(values):
        total += value
        if i >= period:
            total -= values[i - period]
        if i >= period - 1:
            out[i] = total / period
    return out


def ema(values: list[float], period: int) -> list[float | None]:
    """EMA seeded with the SMA of the first `period` values."""
    out: list[float | None] = [None] * len(values)
    if len(values) < period:
        return out
    alpha = 2 / (period + 1)
    current = sum(values[:period]) / period
    out[period - 1] = current
    for i in range(period, len(values)):
        current = values[i] * alpha + current * (1 - alpha)
        out[i] = current
    return out


def rsi(closes: list[float], period: int) -> list[float | None]:
    """Wilder's RSI."""
    out: list[float | None] = [None] * len(closes)
    if len(closes) <= period:
        return out
    gains = losses = 0.0
    for i in range(1, period + 1):
        change = closes[i] - closes[i - 1]
        gains += max(change, 0.0)
        losses += max(-change, 0.0)
    avg_gain, avg_loss = gains / period, losses / period
    out[period] = _rsi_value(avg_gain, avg_loss)
    for i in range(period + 1, len(closes)):
        change = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(change, 0.0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-change, 0.0)) / period
        out[i] = _rsi_value(avg_gain, avg_loss)
    return out


def _rsi_value(avg_gain: float, avg_loss: float) -> float:
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    return 100 - 100 / (1 + avg_gain / avg_loss)


def relative_volume(volumes: list[float], lookback: int) -> list[float | None]:
    """current volume / mean of the previous `lookback` completed candles (current excluded)."""
    out: list[float | None] = [None] * len(volumes)
    total = 0.0
    for i, volume in enumerate(volumes):
        if i >= lookback:
            baseline = total / lookback
            if baseline > 0:
                out[i] = volume / baseline
            total -= volumes[i - lookback]
        total += volume
    return out


def candle_anatomy(o: float, h: float, l: float, c: float) -> dict:
    """Body and wick measurements. Ratios are None for a zero-range candle."""
    rng = h - l
    body = abs(c - o)
    upper_wick = h - max(o, c)
    lower_wick = min(o, c) - l
    direction = "bullish" if c > o else "bearish" if c < o else "flat"
    if rng <= 0:
        return {
            "direction": direction, "range": 0.0, "body": body,
            "upper_wick": upper_wick, "lower_wick": lower_wick,
            "body_to_range": None, "upper_wick_to_range": None, "lower_wick_to_range": None,
        }
    return {
        "direction": direction, "range": rng, "body": body,
        "upper_wick": upper_wick, "lower_wick": lower_wick,
        "body_to_range": body / rng,
        "upper_wick_to_range": upper_wick / rng,
        "lower_wick_to_range": lower_wick / rng,
    }
