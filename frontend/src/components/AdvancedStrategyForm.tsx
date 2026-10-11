"use client";

import type { CandleConditions, Entry, ReferenceBreakout, Strategy } from "@/lib/types";

interface Props {
  strategy: Strategy;
  disabled: boolean;
  onChange: (strategy: Strategy) => void;
}

function NumberField({ label, value, onChange, min = 0, max, step = 1 }: {
  label: string; value: number | undefined; onChange: (value: number | undefined) => void;
  min?: number; max?: number; step?: number;
}) {
  return <label>{label}<input type="number" value={value ?? ""} min={min} max={max} step={step}
    onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></label>;
}

function RatioField({ label, value, onChange }: {
  label: string; value: number | undefined; onChange: (value: number | undefined) => void;
}) {
  return <label>
    <span><input type="checkbox" checked={value != null} onChange={(e) => onChange(e.target.checked ? 0.5 : undefined)} /> {label}: {value == null ? "Not used" : `${Math.round(value * 100)}%`}</span>
    {value != null && <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))} />}
  </label>;
}

export default function AdvancedStrategyForm({ strategy, disabled, onChange }: Props) {
  const entry = strategy.entry;
  const candle = entry.candle_conditions;
  const isCrossover = entry.type === "ema_crossover" || entry.type === "sma_crossover";
  const isReference = entry.type === "ai_reference_breakout";
  const set = (patch: Partial<Strategy>) => onChange({ ...strategy, ...patch, volume_basis: strategy.symbol === "XAUUSD" ? "quote" : "traded" });
  const setEntry = (patch: Partial<Entry>) => set({ entry: { ...entry, ...patch } });
  const setCandle = (patch: Partial<CandleConditions>) => setEntry({ candle_conditions: { ...candle, ...patch } });
  const preset: CandleConditions = {
    direction: "bullish", body_to_range_min: 0.7, upper_wick_to_range_max: 0.15,
    relative_volume_min: 2, relative_volume_lookback: 20,
  };

  function setType(type: Entry["type"]) {
    const next: Entry = { ...entry, type };
    if (type !== "ai_reference_breakout") delete next.reference_breakout;
    if (type === "ema_crossover" || type === "sma_crossover") {
      next.fast_period = entry.fast_period ?? 9;
      next.slow_period = entry.slow_period ?? 21;
      delete next.pullback_breakout;
    } else {
      delete next.fast_period;
      delete next.slow_period;
      if (type === "candle_only") {
        next.candle_conditions = candle ?? preset;
        delete next.pullback_breakout;
      } else if (type === "bullish_pullback_breakout") {
        next.pullback_breakout = entry.pullback_breakout ?? {
          rally_min_candles: 3, pullback_min_candles: 1, pullback_max_candles: 3, breakout_by: "close",
        };
      } else {
        delete next.ai_trend;
        delete next.candle_conditions;
        delete next.pullback_breakout;
        next.reference_breakout = entry.reference_breakout ?? {
          reference_volume_min: 2, volume_lookback: 20, momentum_body_min: 0.7,
          breakout_by: "close", context_candles: 200, min_confidence: 0.6,
          risk_account_pct: 1, target_account_pct: 2,
        };
      }
    }
    set({ entry: next, exit_on_reverse_crossover: type === "ema_crossover" || type === "sma_crossover" ? strategy.exit_on_reverse_crossover : false,
      ...(type !== "ai_reference_breakout" && strategy.partial_exit?.basis === "account" ? { partial_exit: { ...strategy.partial_exit, basis: "price" } } : {}) });
  }

  return <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <h3>Market</h3>
    <div className="grid">
      <label>Symbol<select value={strategy.symbol} onChange={(e) => {
        const symbol = e.target.value as Strategy["symbol"];
        const next = { ...strategy, symbol };
        next.volume_basis = symbol === "XAUUSD" ? "quote" : "traded";
        onChange(next);
      }}><option>AAPL</option><option>SPY</option><option>TSLA</option><option value="XAUUSD">XAUUSD (spot gold)</option><option value="BTCUSD">BTC/USD (Bitcoin)</option></select></label>
      <label>Timeframe<select value={strategy.timeframe} onChange={(e) => set({ timeframe: e.target.value as Strategy["timeframe"] })}>
        <option value="5m">5 minutes</option><option value="30m">30 minutes</option><option value="1h">1 hour</option><option value="4h">4 hours</option><option value="1d">1 day</option>
      </select></label>
      <NumberField label="Starting balance ($)" value={strategy.initial_capital} min={1} step={100} onChange={(v) => v != null && set({ initial_capital: v })} />
      {!isReference && <NumberField label="Position size ($)" value={strategy.position_size_usd} min={1} step={100} onChange={(v) => v != null && set({ position_size_usd: v })} />}
    </div>
    <h3>Entry</h3>
    <div className="grid">
      <label>Entry rule<select value={entry.type} onChange={(e) => setType(e.target.value as Entry["type"])}>
        <option value="ema_crossover">EMA crossover</option><option value="sma_crossover">SMA crossover</option>
        <option value="candle_only">Candle conditions only</option><option value="bullish_pullback_breakout">Bullish rally / pullback / breakout</option>
        <option value="ai_reference_breakout">AI high-volume reference breakout</option>
      </select></label>
      {isCrossover && <>
        <NumberField label="Fast period" value={entry.fast_period} min={2} max={200} onChange={(v) => setEntry({ fast_period: v })} />
        <NumberField label="Slow period" value={entry.slow_period} min={3} max={400} onChange={(v) => setEntry({ slow_period: v })} />
      </>}
    </div>
    <div className="grid" style={{ marginTop: 12 }}>
      <label className="check"><input type="checkbox" checked={entry.rsi_period != null} onChange={(e) => setEntry(e.target.checked
        ? { rsi_period: 14, rsi_below: 70 } : { rsi_period: undefined, rsi_below: undefined, rsi_above: undefined })} />RSI filter</label>
      {entry.rsi_period != null && <>
        <NumberField label="RSI period" value={entry.rsi_period} min={2} max={100} onChange={(v) => setEntry({ rsi_period: v })} />
        <NumberField label="RSI below (optional)" value={entry.rsi_below} max={100} onChange={(v) => setEntry({ rsi_below: v })} />
        <NumberField label="RSI above (optional)" value={entry.rsi_above} max={100} onChange={(v) => setEntry({ rsi_above: v })} />
      </>}
    </div>
    {entry.pullback_breakout && <>
      <h3>Rally and pullback</h3>
      <div className="grid">
        <NumberField label="Minimum green candles" value={entry.pullback_breakout.rally_min_candles} min={2} max={100} onChange={(v) => v != null && setEntry({ pullback_breakout: { ...entry.pullback_breakout!, rally_min_candles: v } })} />
        <NumberField label="Minimum red candles" value={entry.pullback_breakout.pullback_min_candles} min={1} max={50} onChange={(v) => v != null && setEntry({ pullback_breakout: { ...entry.pullback_breakout!, pullback_min_candles: v } })} />
        <NumberField label="Maximum red candles" value={entry.pullback_breakout.pullback_max_candles} min={1} max={50} onChange={(v) => v != null && setEntry({ pullback_breakout: { ...entry.pullback_breakout!, pullback_max_candles: v } })} />
        <label>Breakout above first red candle high<select value={entry.pullback_breakout.breakout_by} onChange={(e) => setEntry({ pullback_breakout: { ...entry.pullback_breakout!, breakout_by: e.target.value as "close" | "high" } })}>
          <option value="close">Green candle close</option><option value="high">Green candle high</option>
        </select></label>
      </div>
    </>}
    {entry.reference_breakout && <>
      <h3>High-volume reference and account risk</h3>
      <p className="muted">AI must detect a bearish trend at the red reference candle and a bullish trend at the green breakout. Stop = marked low; target = net account gain. A low touch invalidates the setup; newer qualifying references replace older ones.</p>
      <div className="grid">
        {([
          ["reference_volume_min", "Minimum reference volume (× average)", 0.1, 50, 0.1],
          ["volume_lookback", "Previous candles for volume average", 2, 200, 1],
          ["momentum_body_min", "Minimum momentum body / range (0–1)", 0, 1, 0.05],
          ["context_candles", "Past candles available to AI", 20, 1000, 1],
          ["min_confidence", "Minimum model confidence (0–1)", 0, 1, 0.05],
          ["risk_account_pct", "Maximum planned account risk (%)", 0.01, 10, 0.25],
          ["target_account_pct", "Net account-profit target (%)", 0.01, 100, 0.25],
        ] as [Exclude<keyof ReferenceBreakout, "breakout_by">, string, number, number, number][]).map(([key, label, min, max, step]) =>
          <NumberField key={key} label={label} value={entry.reference_breakout![key]} min={min} max={max} step={step}
            onChange={(v) => v != null && setEntry({ reference_breakout: { ...entry.reference_breakout!, [key]: v } })} />)}
        <label>Breakout trigger<select value={entry.reference_breakout.breakout_by} onChange={(e) => setEntry({ reference_breakout: { ...entry.reference_breakout!, breakout_by: e.target.value as "close" | "high" } })}>
          <option value="close">Close above marked high</option><option value="high">High above marked high</option>
        </select></label>
      </div>
    </>}
    {!isReference && <>
    <h3>AI trend detection</h3>
    <label className="check"><input type="checkbox" checked={entry.ai_trend != null}
      onChange={(e) => setEntry({ ai_trend: e.target.checked ? { direction: "bullish", context_candles: 200, min_confidence: 0.6 } : undefined })} />Require AI-detected trend</label>
    {entry.ai_trend && <>
      <p className="muted">AI infers the trend's duration from price structure. Context size limits the history it can examine. Model calls occur at candidate entries and are cached.</p>
      <div className="grid">
        <label>Required trend<select value={entry.ai_trend.direction} onChange={(e) => setEntry({ ai_trend: { ...entry.ai_trend!, direction: e.target.value as "bullish" | "bearish" } })}>
          <option value="bullish">Bullish</option><option value="bearish">Bearish</option>
        </select></label>
        <NumberField label="Past candles available to AI" value={entry.ai_trend.context_candles} min={20} max={1000} onChange={(v) => v != null && setEntry({ ai_trend: { ...entry.ai_trend!, context_candles: v } })} />
        <NumberField label="Minimum model confidence (0–1)" value={entry.ai_trend.min_confidence} min={0} max={1} step={0.05} onChange={(v) => v != null && setEntry({ ai_trend: { ...entry.ai_trend!, min_confidence: v } })} />
      </div>
    </>}
    <h3>Candle conditions</h3>
    <label className="check"><input type="checkbox" checked={candle != null} disabled={entry.type === "candle_only"}
      onChange={(e) => setEntry({ candle_conditions: e.target.checked ? preset : undefined })} />Use candle conditions</label>
    {candle && <div className="grid" style={{ marginTop: 12 }}>
      <label>Direction<select value={candle.direction ?? ""} onChange={(e) => setCandle({ direction: (e.target.value || undefined) as CandleConditions["direction"] })}>
        <option value="">Any direction</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option>
      </select></label>
      <RatioField label="Minimum body / range" value={candle.body_to_range_min} onChange={(v) => setCandle({ body_to_range_min: v })} />
      <RatioField label="Maximum upper wick / range" value={candle.upper_wick_to_range_max} onChange={(v) => setCandle({ upper_wick_to_range_max: v })} />
      <RatioField label="Maximum lower wick / range" value={candle.lower_wick_to_range_max} onChange={(v) => setCandle({ lower_wick_to_range_max: v })} />
      <>
        <NumberField label="Minimum relative volume (optional)" value={candle.relative_volume_min} min={0.1} max={50} step={0.1} onChange={(v) => setCandle({ relative_volume_min: v })} />
        <NumberField label="Volume baseline (previous candles)" value={candle.relative_volume_lookback ?? 20} min={2} max={200} onChange={(v) => setCandle({ relative_volume_lookback: v })} />
      </>
      {strategy.symbol === "XAUUSD" && <p className="muted">Gold filters use Massive quote activity, not traded ounces or contracts.</p>}
    </div>}
    <h3>Exit</h3>
    <div className="grid">
      <NumberField label="Stop loss (%)" value={strategy.stop_loss_pct} min={0.01} max={50} step={0.25} onChange={(v) => v != null && set({ stop_loss_pct: v })} />
      <NumberField label="Take profit (%)" value={strategy.take_profit_pct} min={0.01} max={200} step={0.25} onChange={(v) => v != null && set({ take_profit_pct: v })} />
      <label className="check"><input type="checkbox" disabled={!isCrossover} checked={strategy.exit_on_reverse_crossover ?? false}
        onChange={(e) => set({ exit_on_reverse_crossover: e.target.checked })} />Exit on reverse crossover</label>
    </div>
    </>}
    <h3>Partial exit</h3>
    <label className="check"><input type="checkbox" checked={strategy.partial_exit != null}
      onChange={(e) => set({ partial_exit: e.target.checked ? { fraction: 0.5, profit_pct: 1, basis: isReference ? "account" : "price" } : undefined })} />Sell part of the position at a profit trigger</label>
    {strategy.partial_exit && <div className="grid">
      <NumberField label="Position to sell (%)" value={strategy.partial_exit.fraction * 100} min={1} max={99} onChange={(v) => v != null && set({ partial_exit: { ...strategy.partial_exit!, fraction: v / 100 } })} />
      <NumberField label="Profit trigger (%)" value={strategy.partial_exit.profit_pct} min={0.01} max={200} step={0.25} onChange={(v) => v != null && set({ partial_exit: { ...strategy.partial_exit!, profit_pct: v } })} />
      <label>Trigger basis<select value={strategy.partial_exit.basis} onChange={(e) => set({ partial_exit: { ...strategy.partial_exit!, basis: e.target.value as "price" | "account" } })}>
        <option value="price">Price rise from entry</option>{isReference && <option value="account">Net account gain if fully liquidated</option>}
      </select></label>
    </div>}
  </fieldset>;
}
