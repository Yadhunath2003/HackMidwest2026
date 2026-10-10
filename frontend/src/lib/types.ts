// Mirrors backend/app/schemas.py. The backend is the source of truth for validation.

export type SymbolName = "AAPL" | "SPY" | "TSLA";
export type Timeframe = "5m" | "1d";
export type EntryType = "ema_crossover" | "sma_crossover" | "candle_only";

export interface CandleConditions {
  direction?: "bullish" | "bearish";
  body_to_range_min?: number;
  upper_wick_to_range_max?: number;
  lower_wick_to_range_max?: number;
  relative_volume_min?: number;
  relative_volume_lookback?: number;
}

export interface Entry {
  type: EntryType;
  fast_period?: number;
  slow_period?: number;
  rsi_period?: number;
  rsi_below?: number;
  rsi_above?: number;
  candle_conditions?: CandleConditions;
}

export interface Strategy {
  symbol: SymbolName;
  timeframe: Timeframe;
  entry: Entry;
  stop_loss_pct: number;
  take_profit_pct: number;
  exit_on_reverse_crossover?: boolean;
  initial_capital: number;
  position_size_usd: number;
}

export interface ExecutionSettings {
  commission_per_order_usd: number;
  slippage_bps: number;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Snapshot {
  candle: Candle;
  direction: string;
  body_to_range: number | null;
  upper_wick_to_range: number | null;
  lower_wick_to_range: number | null;
  relative_volume: number | null;
  relative_volume_lookback: number;
  fast_ma: number | null;
  slow_ma: number | null;
  prev_fast_ma: number | null;
  prev_slow_ma: number | null;
  rsi: number | null;
}

export interface Trade {
  id: number;
  signal_time: number;
  entry_time: number;
  entry_price: number;
  exit_time: number;
  exit_price: number;
  shares: number;
  position_value: number;
  stop_price: number;
  target_price: number;
  pnl: number;
  pnl_pct: number;
  fees: number;
  slippage_cost: number;
  bars_held: number;
  exit_reason: "stop_loss" | "take_profit" | "reverse_crossover" | "end_of_data";
  entry_evidence: Snapshot;
  exit_evidence: { candle: Candle; trigger: string; gap?: boolean; both_levels_touched?: boolean };
}

export interface Metrics {
  initial_capital: number;
  final_equity: number;
  net_profit: number;
  total_return_pct: number;
  num_trades: number;
  win_rate_pct: number | null;
  max_drawdown_pct: number;
  total_fees: number;
  total_slippage_cost: number;
  profit_factor: number | null;
  rejected_trades: number;
  buy_and_hold_return_pct: number | null;
}

export interface DataMeta {
  source?: string;
  symbol?: string;
  timeframe?: string;
  candle_count: number;
  start: string | null;
  end: string | null;
  adjustment?: string;
  volume_type?: string;
  limitations?: string[];
}

export interface BacktestRun {
  id: string;
  created_at: string;
  strategy_version: string;
  strategy: Strategy;
  execution: ExecutionSettings;
  assumptions: string[];
  data: DataMeta;
  metrics: Metrics;
  trades: Trade[];
  rejected_trades: { time: number; reason: string }[];
  signals: { time: number; acted: boolean }[];
  equity_curve: { time: number; equity: number }[];
  candles: Candle[];
}

export interface GenerateResponse {
  strategy: Strategy | null;
  draft: Record<string, unknown> | null;
  issues: string[];
  clarifications: string[];
  unsupported: string[];
  assumptions: string[];
  source: string;
}

export interface ValidateResponse {
  valid: boolean;
  strategy: Strategy | null;
  issues: string[];
  assumptions: string[];
}

export interface Explanation {
  known_facts: string[];
  summary: string;
  hypotheses: string[];
  testable_change: string | null;
  source: string;
  disclaimer: string;
}

export interface StressTestResult {
  baseline: { execution: ExecutionSettings; metrics: Metrics };
  stressed: { execution: ExecutionSettings; metrics: Metrics };
  split: Record<"in_sample" | "out_of_sample", { range: DataMeta; metrics: Metrics }> | null;
  notes: string[];
}
