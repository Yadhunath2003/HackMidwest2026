"""Builds the evidence package for one trade. Facts come from the stored run, never from the model."""

from datetime import datetime, timezone

CONTEXT_CANDLES_BEFORE = 5
MAX_CANDLES_DURING = 30


def _when(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _pct(value: float | None) -> str:
    return "unavailable" if value is None else f"{value * 100:.1f}%"


def build_evidence(run: dict, trade: dict) -> dict:
    candles = run["candles"]
    index = {c["time"]: i for i, c in enumerate(candles)}
    signal_i, entry_i, exit_i = index[trade["signal_time"]], index[trade["entry_time"]], index[trade["exit_time"]]
    during = candles[entry_i : exit_i + 1]
    return {
        "strategy": run["strategy"],
        "execution": run["execution"],
        "data_source": {k: run["data"].get(k) for k in ("source", "symbol", "timeframe", "adjustment", "volume_type")},
        "trade": {k: v for k, v in trade.items() if k not in ("entry_evidence", "exit_evidence")},
        "signal_candle": trade["entry_evidence"],
        "exit": trade["exit_evidence"],
        "candles_before_signal": candles[max(0, signal_i - CONTEXT_CANDLES_BEFORE) : signal_i],
        "candles_during_trade": during[:MAX_CANDLES_DURING],
        "candles_during_trade_truncated": len(during) > MAX_CANDLES_DURING,
        "highest_high_during_trade": max(c["high"] for c in during),
        "lowest_low_during_trade": min(c["low"] for c in during),
    }


def known_facts(evidence: dict) -> list[str]:
    """Plain-language statements of recorded execution facts, each traceable to the run."""
    trade, signal, exit_ = evidence["trade"], evidence["signal_candle"], evidence["exit"]
    candle = signal["candle"]
    facts = [
        f"Signal candle {_when(candle['time'])}: open {candle['open']}, high {candle['high']}, low {candle['low']}, "
        f"close {candle['close']}, volume {format(candle['volume'], ',') if candle['volume'] is not None else 'unavailable'}.",
        f"Signal candle shape: {signal['direction']}, body {_pct(signal['body_to_range'])} of range, "
        f"upper wick {_pct(signal['upper_wick_to_range'])}, lower wick {_pct(signal['lower_wick_to_range'])}.",
    ]
    if signal.get("pattern"):
        pattern = signal["pattern"]
        facts.append(
            f"Pattern: at least {pattern['rally_min_candles']} green candles followed by {pattern['pullback_candles']} red candles. "
            f"First red candle {_when(pattern['first_red_time'])} had high {pattern['first_red_high']}; "
            f"the first following green candle's {pattern['breakout_by']} was {pattern['breakout_value']}, above that level."
        )
    if signal.get("ai_trend"):
        trend = signal["ai_trend"]
        facts.append(f"Recorded AI trend judgment at the signal: {trend['direction']}, model confidence {trend['confidence']}. "
                     f"Reasoning (model interpretation, not verified cause): {trend['reason']}")
    if signal.get("reference_breakout"):
        ref = signal["reference_breakout"]
        facts.append(f"Marked red candle {_when(ref['time'])}: high {ref['high']}, low {ref['low']}, relative volume {ref['relative_volume']:.2f}x. "
                     f"Its recorded AI trend was {ref['ai_trend']['direction']}. "
                     f"Planned stop loss ${trade['planned_stop_loss']:.2f} versus risk budget ${trade['risk_budget']:.2f}; "
                     f"net account-profit target ${trade['target_account_profit']:.2f}.")
    if signal["relative_volume"] is not None:
        facts.append(
            f"Relative volume {signal['relative_volume']:.2f}x the mean of the previous "
            f"{signal['relative_volume_lookback']} candles."
        )
    if signal["fast_ma"] is not None:
        facts.append(
            f"Fast average {signal['fast_ma']} vs slow average {signal['slow_ma']} "
            f"(previous candle: {signal['prev_fast_ma']} vs {signal['prev_slow_ma']})."
        )
    if signal["rsi"] is not None:
        facts.append(f"RSI on the signal candle: {signal['rsi']}.")
    facts += [
        f"Entered at the next candle's open, {_when(trade['entry_time'])}: {trade['shares']} "
        f"{'troy ounces' if evidence['strategy']['symbol'] == 'XAUUSD' else 'shares'} at "
        f"{trade['entry_price']} (${trade['position_value']:,.2f}) including slippage.",
        f"Stop price {trade['stop_price']}, target price {trade['target_price']}.",
        f"Final exit {_when(trade['exit_time'])} at {trade.get('final_exit_price', trade['exit_price'])} after {trade['bars_held']} candle(s). "
        f"Reason: {trade['exit_reason'].replace('_', ' ')}. {exit_['trigger']}",
        f"While open, price ranged from {evidence['lowest_low_during_trade']} to {evidence['highest_high_during_trade']}.",
        f"Result: ${trade['pnl']:,.2f} ({trade['pnl_pct']}%) after ${trade['fees']:.2f} commission; "
        f"slippage cost ${trade['slippage_cost']:.2f} is already in the fill prices.",
    ]
    for fill in trade.get("exits", []):
        if fill["reason"] == "partial_take_profit":
            facts.append(f"Partial sale {_when(fill['time'])}: {fill['shares']} units at {fill['price']}; commission ${fill['fee']:.2f}. "
                         "The remaining position kept its original stop.")
    if len(trade.get("exits", [])) > 1:
        facts.append(f"Quantity-weighted average exit price across all sell fills: {trade['exit_price']}.")
    return facts
