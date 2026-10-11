// Mirrors backend/app/schemas.py. The backend is the source of truth for validation.

export type SymbolName = "AAPL" | "SPY" | "TSLA" | "XAUUSD" | "BTCUSD";
export type Timeframe = "5m" | "30m" | "1h" | "4h" | "1d";
export type EntryType = "ema_crossover" | "sma_crossover" | "candle_only" | "bullish_pullback_breakout" | "bearish_pullback_breakout" | "ai_reference_breakout";

export interface ReferenceBreakout {
  reference_volume_min: number; volume_lookback: number; momentum_body_min: number;
  breakout_by: "close" | "high"; context_candles: number; min_confidence: number;
  risk_account_pct: number; target_account_pct: number;
}

export interface CandleConditions {
  direction?: "bullish" | "bearish";
  body_to_range_min?: number;
  upper_wick_to_range_max?: number;
  lower_wick_to_range_max?: number;
  relative_volume_min?: number;
  relative_volume_lookback?: number;
}

export interface Entry {
  reference_breakout?: ReferenceBreakout;
  ai_trend?: { direction: "bullish" | "bearish"; context_candles: number; min_confidence: number };
  type: EntryType;
  fast_period?: number;
  slow_period?: number;
  rsi_period?: number;
  rsi_below?: number;
  rsi_above?: number;
  candle_conditions?: CandleConditions;
  pullback_breakout?: {
    rally_min_candles: number;
    pullback_min_candles: number;
    pullback_max_candles: number;
    breakout_by: "close" | "high";
  };
}

export interface Strategy {
  direction?: "long" | "short";
  volume_basis?: "traded" | "quote";
  partial_exit?: { fraction: number; profit_pct: number; basis: "price" | "account" } | null;
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

export interface SavedStrategy {
  id: string; name: string; run_id: string; created_at: string;
  strategy: Strategy; execution: ExecutionSettings;
}
export interface PaperSignal {
  direction?: "long" | "short"; action?: "entry" | "exit";
  id: string; side: "BUY" | "SELL"; time: number; detected_at: string;
  quantity: number; price: number; reason: string; stop: number | null; target: number | null;
}
export interface FeedStatus { configured: boolean; provider: string; notice: string; required: string[] }
export interface PaperSession {
  candles: Candle[];
  id: string; name: string; strategy_id: string; status: "running" | "stopped";
  strategy: Strategy; cash: number; updated_at: string; last_candle: number | null;
  position: { quantity: number; entry_price: number; stop: number; target: number } | null;
  signals: PaperSignal[]; feed: FeedStatus; error: string | null; message: string;
}

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface Snapshot {
  reference_breakout?: { time: number; high: number; low: number; relative_volume: number; ai_trend: TrendAssessment } | null;
  ai_trend?: TrendAssessment | null;
  pattern?: {
    rally_min_candles: number;
    pullback_candles: number;
    first_green_time?: number;
    first_green_low?: number;
    first_red_time?: number;
    first_red_high?: number;
    breakout_by: "close" | "high";
    breakout_value: number;
  } | null;
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
  direction?: "long" | "short";
  final_exit_price?: number;
  partial_exit_skipped?: string | null;
  exits?: { time: number; price: number; shares: number; reason: string; fee: number; trigger: string; gap?: boolean }[];
  risk_budget?: number | null;
  planned_stop_loss?: number | null;
  target_account_profit?: number | null;
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
  ai_usage?: AIUsage;
  trend_assessments?: Record<string, TrendAssessment>;
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

export interface AIUsage {
  requests: number;
  reported_requests: number;
  unreported_requests: number;
  cache_hits: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface TrendAssessment {
  direction: "bullish" | "bearish" | "sideways" | "uncertain";
  confidence: number;
  start_time: number | null;
  reason: string;
  source: string;
  context_start_time?: number;
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
  ai_report: AIReport | null;
  ai_error: string | null;
  baseline: { execution: ExecutionSettings; metrics: Metrics };
  stressed: { execution: ExecutionSettings; metrics: Metrics };
  split: Record<"in_sample" | "out_of_sample", { range: DataMeta; metrics: Metrics }> | null;
  notes: string[];
}

export interface AIReport {
  summary: string;
  findings: string[];
  limitations: string[];
  next_tests: string[];
  source: string;
}
