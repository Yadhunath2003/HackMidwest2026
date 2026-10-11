// Turns API values into text, following docs/Data-display.md of the design system.
import type { AIUsage, Entry, ExecutionSettings, Strategy, SymbolName, Timeframe } from "./types";

const MINUS = "−";

/** Signed number with a real minus sign, e.g. +14.24 or −2.24. */
export function signed(value: number, digits = 2): string {
  const text = Math.abs(value).toFixed(digits);
  return value > 0 ? `+${text}` : value < 0 ? `${MINUS}${text}` : text;
}

export function signedMoney(value: number): string {
  const text = Math.abs(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return value > 0 ? `+${text}` : value < 0 ? `${MINUS}${text}` : text;
}

export function signedPercent(value: number, digits = 2): string {
  return `${signed(value, digits)}%`;
}

/** Max drawdown arrives positive; display it negated, e.g. −0.37%. */
export const drawdownText = (pct: number) => (pct > 0 ? `${MINUS}${pct.toFixed(2)}%` : "0.00%");

/** Win rate or profit factor can be null; say n/a. */
export const percentOrNA = (value: number | null | undefined, digits = 1) => (value == null ? "n/a" : `${Number(value.toFixed(digits))}%`);

export const shortId = (id: string) => id.slice(0, 4);

export const SYMBOL_NAMES: Record<SymbolName, string> = {
  AAPL: "AAPL", SPY: "SPY", TSLA: "TSLA", XAUUSD: "XAU/USD", BTCUSD: "BTC/USD",
};
export const symbolName = (symbol: string) => SYMBOL_NAMES[symbol as SymbolName] ?? symbol;

export const SYMBOLS = Object.keys(SYMBOL_NAMES) as SymbolName[];
export const TIMEFRAMES: Timeframe[] = ["5m", "30m", "1h", "4h", "1d"];

/** Column / label for the traded quantity. */
export function quantityUnit(symbol: string): string {
  return symbol === "XAUUSD" ? "Troy oz" : symbol === "BTCUSD" ? "BTC" : "Shares";
}

export function volumeMeaning(symbol: string): string {
  return symbol === "XAUUSD" ? "Quote activity (tick volume)" : symbol === "BTCUSD" ? "Traded BTC" : "Volume";
}

export const EXIT_LABELS: Record<string, string> = {
  stop_loss: "Stop loss",
  take_profit: "Take profit",
  reverse_crossover: "Reverse crossover",
  end_of_data: "End of data",
  partial_take_profit: "Partial take profit",
};
export const exitLabel = (reason: string) => EXIT_LABELS[reason] ?? reason.replaceAll("_", " ");

export const ENTRY_LABELS: Record<Entry["type"], string> = {
  ema_crossover: "EMA crossover",
  sma_crossover: "SMA crossover",
  candle_only: "Candle conditions",
  bullish_pullback_breakout: "Rally, pullback, breakout",
  bearish_pullback_breakout: "Bearish rally, pullback, breakdown",
  ai_reference_breakout: "AI reference breakout",
};

/** 0-1 ratio as a percent, or "Not used". */
export const ratioText = (value: number | undefined) =>
  value == null ? "Not used" : `${Number((value * 100).toFixed(2))}%`;

/** "34 AI checks · 12 cached · 48,210 tokens". Empty string when the run used no AI. */
export function usageText(usage: AIUsage | null | undefined): string {
  if (!usage || (usage.requests === 0 && usage.cache_hits === 0)) return "";
  const parts = [`${usage.requests.toLocaleString()} AI checks`, `${usage.cache_hits.toLocaleString()} cached`];
  parts.push(`${usage.total_tokens.toLocaleString()} tokens`);
  return parts.join(" · ");
}

export interface RuleSection {
  title: string;
  rows: [string, string][];
}

/** The plain-rule text per entry type, as listed in Data display. */
export function entryRule(entry: Entry, direction: Strategy["direction"] = "long"): string {
  const short = direction === "short";
  switch (entry.type) {
    case "ema_crossover":
      return `EMA ${entry.fast_period} crosses ${short ? "below" : "above"} EMA ${entry.slow_period}`;
    case "sma_crossover":
      return `SMA ${entry.fast_period} crosses ${short ? "below" : "above"} SMA ${entry.slow_period}`;
    case "candle_only": {
      const c = entry.candle_conditions;
      const parts = [c?.direction === "bearish" ? "Bearish candle" : c?.direction === "bullish" ? "Bullish candle" : "Candle"];
      if (c?.body_to_range_min != null) parts.push(`body ≥ ${ratioText(c.body_to_range_min)}`);
      if (c?.upper_wick_to_range_max != null) parts.push(`upper wick ≤ ${ratioText(c.upper_wick_to_range_max)}`);
      if (c?.lower_wick_to_range_max != null) parts.push(`lower wick ≤ ${ratioText(c.lower_wick_to_range_max)}`);
      if (c?.relative_volume_min != null) parts.push(`volume ≥ ${c.relative_volume_min}× previous ${c.relative_volume_lookback ?? 20}`);
      return parts.join(", ");
    }
    case "bearish_pullback_breakout": {
      const p = entry.pullback_breakout;
      return p ? `${p.rally_min_candles}+ red candles, then ${p.pullback_min_candles}-${p.pullback_max_candles} green, then red ${p.breakout_by === "close" ? "close" : "low"} below first green low` : "Bearish pullback breakdown";
    }
    case "bullish_pullback_breakout": {
      const p = entry.pullback_breakout;
      if (!p) return "Rally, pullback, breakout";
      return `≥ ${p.rally_min_candles} green candles, then ${p.pullback_min_candles}–${p.pullback_max_candles} red, then a green ${p.breakout_by} above the first red high`;
    }
    case "ai_reference_breakout": {
      const r = entry.reference_breakout;
      if (!r) return "AI reference breakout";
      if (short) return `Green reference with ${r.reference_volume_min}x volume in AI bullish trend; red momentum ${r.breakout_by === "close" ? "close" : "low"} below marked low in AI bearish trend. Sell short at next open; stop at marked high, risk ${r.risk_account_pct}% and target ${r.target_account_pct}% net account.`;
      return `Red candle with ≥ ${r.reference_volume_min}× volume in an AI-detected bearish trend marks a high/low; buy when a green momentum candle ${r.breakout_by === "close" ? "closes" : "trades"} above the high in a bullish trend. Stop at the marked low; risk ≤ ${r.risk_account_pct}% of account; target +${r.target_account_pct}% net account.`;
    }
  }
}

/** Sections shown in the draft card's Rules view: Market, Entry, Exit, Costs. */
export function ruleSections(strategy: Strategy, execution: ExecutionSettings): RuleSection[] {
  const entry = strategy.entry;
  const reference = entry.type === "ai_reference_breakout";
  const money = (v: number) => v.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const entryRows: [string, string][] = [["Rule", entryRule(entry, strategy.direction)]];
  if (entry.rsi_period != null) {
    const bounds = [entry.rsi_below != null ? `below ${entry.rsi_below}` : "", entry.rsi_above != null ? `above ${entry.rsi_above}` : ""].filter(Boolean).join(", ");
    entryRows.push(["Filter", `RSI ${entry.rsi_period} ${bounds}`.trim()]);
  }
  if (entry.ai_trend) {
    entryRows.push(["AI trend", `${entry.ai_trend.direction === "bullish" ? "Bullish" : "Bearish"}, confidence ≥ ${Math.round(entry.ai_trend.min_confidence * 100)}%, up to ${entry.ai_trend.context_candles} past candles`]);
  }
  if (entry.type !== "candle_only" && entry.candle_conditions) {
    entryRows.push(["Candle", entryRule({ ...entry, type: "candle_only" })]);
  }

  const exitRows: [string, string][] = [];
  if (reference) {
    exitRows.push(["Stop", strategy.direction === "short" ? "The marked green candle high" : "The marked red candle low"]);
  } else {
    exitRows.push(["Stop / target", `${strategy.stop_loss_pct}% · ${strategy.take_profit_pct}%`]);
    if (strategy.exit_on_reverse_crossover) exitRows.push(["Also exit", "On a reverse crossover"]);
  }
  if (strategy.partial_exit) {
    const p = strategy.partial_exit;
    exitRows.push(["Partial exit", `Close ${Math.round(p.fraction * 100)}% at +${p.profit_pct}% ${p.basis === "account" ? "net account gain" : strategy.direction === "short" ? "price fall" : "price rise"}; the rest keeps the stop and final target`]);
  }

  return [
    {
      title: "Market",
      rows: [
        ["Symbol", `${symbolName(strategy.symbol)} · ${strategy.timeframe}`],
        ["Direction", strategy.direction === "short" ? "Short (sell to open, buy to cover)" : "Long (buy to open, sell to close)"],
        ["Balance", money(strategy.initial_capital)],
        ["Position", reference ? (strategy.direction === "short" ? "Account risk and marked high" : "Account risk and marked low") : money(strategy.position_size_usd)],
      ],
    },
    { title: "Entry", rows: entryRows },
    { title: "Exit", rows: exitRows },
    {
      title: "Costs",
      rows: [
        ["Commission", `${money(execution.commission_per_order_usd)} per order`],
        ["Slippage", `${execution.slippage_bps} bps`],
      ],
    },
  ];
}
