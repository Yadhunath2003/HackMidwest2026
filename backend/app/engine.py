"""Deterministic long-only backtest engine.

Timeline for candle i:
  1. An entry or reverse-crossover exit decided at the close of candle i-1 fills at the open of i.
  2. Stop loss / take profit are checked against candle i's open (gap), then its low and high.
  3. At the close of candle i, signals are evaluated using data up to and including i only.
"""

import math
from datetime import datetime, timezone

from . import indicators
from .schemas import ExecutionSettings, Strategy, describe_assumptions

STRATEGY_VERSION = "1"


def compute_features(candles: list[dict], strategy: Strategy) -> dict:
    entry = strategy.entry
    closes = [c["close"] for c in candles]
    volumes = [c["volume"] for c in candles]
    none = [None] * len(candles)

    fast = slow = none
    if entry.type != "candle_only":
        average = indicators.ema if entry.type == "ema_crossover" else indicators.sma
        fast, slow = average(closes, entry.fast_period), average(closes, entry.slow_period)

    lookback = entry.candle_conditions.relative_volume_lookback if entry.candle_conditions else 20
    return {
        "fast": fast,
        "slow": slow,
        "rsi": indicators.rsi(closes, entry.rsi_period) if entry.rsi_period else none,
        "rvol": indicators.relative_volume(volumes, lookback),
        "rvol_lookback": lookback,
        "anatomy": [indicators.candle_anatomy(c["open"], c["high"], c["low"], c["close"]) for c in candles],
    }


def _crossed(features: dict, i: int, up: bool) -> bool:
    fast, slow = features["fast"], features["slow"]
    if i < 1 or None in (fast[i], slow[i], fast[i - 1], slow[i - 1]):
        return False
    if up:
        return fast[i - 1] <= slow[i - 1] and fast[i] > slow[i]
    return fast[i - 1] >= slow[i - 1] and fast[i] < slow[i]


def _candle_matches(features: dict, i: int, strategy: Strategy) -> bool:
    cond = strategy.entry.candle_conditions
    if cond is None:
        return True
    anatomy = features["anatomy"][i]
    if cond.direction and anatomy["direction"] != cond.direction:
        return False
    # An unavailable value (zero range, not enough volume history) is an explicit non-match.
    checks = (
        (cond.body_to_range_min, anatomy["body_to_range"], lambda value, limit: value >= limit),
        (cond.upper_wick_to_range_max, anatomy["upper_wick_to_range"], lambda value, limit: value <= limit),
        (cond.lower_wick_to_range_max, anatomy["lower_wick_to_range"], lambda value, limit: value <= limit),
        (cond.relative_volume_min, features["rvol"][i], lambda value, limit: value >= limit),
    )
    for limit, value, passes in checks:
        if limit is not None and (value is None or not passes(value, limit)):
            return False
    return True


def entry_signal(features: dict, i: int, strategy: Strategy) -> bool:
    entry = strategy.entry
    if entry.type != "candle_only" and not _crossed(features, i, up=True):
        return False
    if entry.rsi_below is not None or entry.rsi_above is not None:
        value = features["rsi"][i]
        if value is None:
            return False
        if entry.rsi_below is not None and not value < entry.rsi_below:
            return False
        if entry.rsi_above is not None and not value > entry.rsi_above:
            return False
    return _candle_matches(features, i, strategy)


def snapshot(candles: list[dict], features: dict, i: int) -> dict:
    """Everything known at the close of candle i. This is the evidence Trade Detective cites."""
    anatomy = features["anatomy"][i]
    return {
        "candle": candles[i],
        "direction": anatomy["direction"],
        "body_to_range": _round(anatomy["body_to_range"]),
        "upper_wick_to_range": _round(anatomy["upper_wick_to_range"]),
        "lower_wick_to_range": _round(anatomy["lower_wick_to_range"]),
        "relative_volume": _round(features["rvol"][i]),
        "relative_volume_lookback": features["rvol_lookback"],
        "fast_ma": _round(features["fast"][i]),
        "slow_ma": _round(features["slow"][i]),
        "prev_fast_ma": _round(features["fast"][i - 1]) if i > 0 else None,
        "prev_slow_ma": _round(features["slow"][i - 1]) if i > 0 else None,
        "rsi": _round(features["rsi"][i], 2),
    }


def _round(value: float | None, digits: int = 4) -> float | None:
    return None if value is None else round(value, digits)


def run_backtest(
    candles: list[dict],
    strategy: Strategy,
    execution: ExecutionSettings,
    data_meta: dict | None = None,
) -> dict:
    features = compute_features(candles, strategy)
    slip = execution.slippage_bps / 10_000
    commission = execution.commission_per_order_usd

    cash = strategy.initial_capital
    position: dict | None = None
    pending_entry: int | None = None  # index of the signal candle
    pending_exit: int | None = None  # index of the reverse-crossover candle
    trades: list[dict] = []
    rejected: list[dict] = []
    signals: list[dict] = []
    equity_curve: list[dict] = []

    def close_position(i: int, reference_price: float, reason: str, detail: dict) -> None:
        nonlocal cash, position
        fill = reference_price * (1 - slip)
        shares = position["shares"]
        cash += shares * fill - commission
        slippage_cost = position["entry_slippage"] + shares * (reference_price - fill)
        pnl = shares * (fill - position["entry_price"]) - 2 * commission
        trades.append({
            "id": len(trades) + 1,
            "signal_time": position["signal_time"],
            "entry_time": position["entry_time"],
            "entry_price": round(position["entry_price"], 4),
            "exit_time": candles[i]["time"],
            "exit_price": round(fill, 4),
            "shares": shares,
            "position_value": round(shares * position["entry_price"], 2),
            "stop_price": round(position["stop"], 4),
            "target_price": round(position["target"], 4),
            "pnl": round(pnl, 2),
            "pnl_pct": round(pnl / (shares * position["entry_price"]) * 100, 3),
            "fees": round(2 * commission, 2),
            "slippage_cost": round(slippage_cost, 2),
            "bars_held": i - position["entry_index"],
            "exit_reason": reason,
            "entry_evidence": position["entry_evidence"],
            "exit_evidence": {"candle": candles[i], **detail},
        })
        position = None

    for i, candle in enumerate(candles):
        # 1. Fill orders decided at the previous close.
        if position and pending_exit is not None:
            close_position(i, candle["open"], "reverse_crossover", {
                "trigger": "Fast average crossed below slow average on the previous candle; sold at this open.",
                "signal": snapshot(candles, features, pending_exit),
            })
        pending_exit = None

        if pending_entry is not None and position is None:
            fill = candle["open"] * (1 + slip)
            shares = math.floor(strategy.position_size_usd / fill)
            if shares < 1:
                rejected.append({"time": candle["time"], "reason": "Position size is smaller than one share."})
            elif shares * fill + commission > cash:
                rejected.append({"time": candle["time"], "reason": "Not enough cash for the position and commission."})
            else:
                cash -= shares * fill + commission
                position = {
                    "shares": shares,
                    "entry_index": i,
                    "entry_time": candle["time"],
                    "entry_price": fill,
                    "entry_slippage": shares * (fill - candle["open"]),
                    "stop": fill * (1 - strategy.stop_loss_pct / 100),
                    "target": fill * (1 + strategy.take_profit_pct / 100),
                    "signal_time": candles[pending_entry]["time"],
                    "entry_evidence": snapshot(candles, features, pending_entry),
                }
        pending_entry = None

        # 2. Protective exits inside this candle.
        if position:
            stop, target = position["stop"], position["target"]
            is_entry_candle = position["entry_index"] == i
            if not is_entry_candle and candle["open"] <= stop:
                close_position(i, candle["open"], "stop_loss", {"trigger": "Opened below the stop price (gap); sold at the open.", "gap": True})
            elif not is_entry_candle and candle["open"] >= target:
                close_position(i, candle["open"], "take_profit", {"trigger": "Opened above the target price (gap); sold at the open.", "gap": True})
            elif candle["low"] <= stop:
                both = candle["high"] >= target
                close_position(i, stop, "stop_loss", {
                    "trigger": "Candle low reached the stop price."
                    + (" The high also reached the target; the stop is assumed to fill first." if both else ""),
                    "both_levels_touched": both,
                })
            elif candle["high"] >= target:
                close_position(i, target, "take_profit", {"trigger": "Candle high reached the target price."})

        # 3. Decisions at this candle's close, acted on at the next open.
        if position is None:
            if entry_signal(features, i, strategy):
                signals.append({"time": candle["time"], "acted": i + 1 < len(candles)})
                pending_entry = i
        else:
            if entry_signal(features, i, strategy):
                signals.append({"time": candle["time"], "acted": False})
            if strategy.exit_on_reverse_crossover and _crossed(features, i, up=False):
                pending_exit = i

        if position and i == len(candles) - 1:
            close_position(i, candle["close"], "end_of_data", {"trigger": "Backtest ended with the position open; sold at the last close."})

        held_value = position["shares"] * candle["close"] if position else 0.0
        equity_curve.append({"time": candle["time"], "equity": round(cash + held_value, 2)})

    return {
        "strategy_version": STRATEGY_VERSION,
        "strategy": strategy.model_dump(),
        "execution": execution.model_dump(),
        "assumptions": describe_assumptions(strategy, execution),
        "data": data_meta or describe_range(candles),
        "metrics": compute_metrics(trades, equity_curve, strategy.initial_capital, candles, len(rejected)),
        "trades": trades,
        "rejected_trades": rejected,
        "signals": signals,
        "equity_curve": equity_curve,
        "candles": candles,
    }


def compute_metrics(
    trades: list[dict], equity_curve: list[dict], initial_capital: float, candles: list[dict], rejected: int = 0
) -> dict:
    final_equity = equity_curve[-1]["equity"] if equity_curve else initial_capital
    wins = [t for t in trades if t["pnl"] > 0]
    gross_profit = sum(t["pnl"] for t in wins)
    gross_loss = -sum(t["pnl"] for t in trades if t["pnl"] < 0)

    peak, max_drawdown = initial_capital, 0.0
    for point in equity_curve:
        peak = max(peak, point["equity"])
        max_drawdown = max(max_drawdown, (peak - point["equity"]) / peak * 100)

    buy_hold = (candles[-1]["close"] / candles[0]["open"] - 1) * 100 if candles else None
    return {
        "initial_capital": initial_capital,
        "final_equity": round(final_equity, 2),
        "net_profit": round(final_equity - initial_capital, 2),
        "total_return_pct": round((final_equity / initial_capital - 1) * 100, 3),
        "num_trades": len(trades),
        "win_rate_pct": round(len(wins) / len(trades) * 100, 2) if trades else None,
        "max_drawdown_pct": round(max_drawdown, 3),
        "total_fees": round(sum(t["fees"] for t in trades), 2),
        "total_slippage_cost": round(sum(t["slippage_cost"] for t in trades), 2),
        # Undefined (None) when there are no losing trades.
        "profit_factor": round(gross_profit / gross_loss, 3) if gross_loss > 0 else None,
        "rejected_trades": rejected,
        "buy_and_hold_return_pct": round(buy_hold, 3) if buy_hold is not None else None,
    }


def describe_range(candles: list[dict]) -> dict:
    def iso(ts: int) -> str:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()

    return {
        "candle_count": len(candles),
        "start": iso(candles[0]["time"]) if candles else None,
        "end": iso(candles[-1]["time"]) if candles else None,
    }
