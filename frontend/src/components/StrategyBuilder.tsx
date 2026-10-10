"use client";

import { useState } from "react";
import type { CandleConditions, Entry, ExecutionSettings, Strategy } from "@/lib/types";

export const MOMENTUM_PRESET: CandleConditions = {
  direction: "bullish",
  body_to_range_min: 0.7,
  upper_wick_to_range_max: 0.15,
  relative_volume_min: 2,
  relative_volume_lookback: 20,
};

interface Props {
  strategy: Strategy;
  jsonText: string;
  jsonError: string | null;
  execution: ExecutionSettings;
  onStrategyChange: (strategy: Strategy) => void;
  onJsonChange: (text: string) => void;
  onExecutionChange: (execution: ExecutionSettings) => void;
}

function NumberField(props: {
  label: string;
  value: number | undefined;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
}) {
  return (
    <label>
      {props.label}
      <input
        type="number"
        value={props.value ?? ""}
        step={props.step ?? 1}
        min={props.min ?? 0}
        onChange={(e) => e.target.value !== "" && props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        type="range"
        value={props.value}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

// Simple Mode and Advanced Mode edit the same strategy object; the parent keeps them in sync.
export default function StrategyBuilder(props: Props) {
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const { strategy, execution } = props;
  const entry = strategy.entry;
  const candle = entry.candle_conditions;
  const isCrossover = entry.type !== "candle_only";

  const set = (patch: Partial<Strategy>) => props.onStrategyChange({ ...strategy, ...patch });
  const setEntry = (patch: Partial<Entry>) => set({ entry: { ...entry, ...patch } });
  const setCandle = (patch: Partial<CandleConditions>) =>
    setEntry({ candle_conditions: { ...MOMENTUM_PRESET, ...candle, ...patch } });

  function setEntryType(type: Entry["type"]) {
    if (type === "candle_only") {
      set({
        exit_on_reverse_crossover: false,
        entry: { type, candle_conditions: candle ?? MOMENTUM_PRESET, rsi_period: entry.rsi_period, rsi_below: entry.rsi_below },
      });
    } else {
      setEntry({ type, fast_period: entry.fast_period ?? 9, slow_period: entry.slow_period ?? 21 });
    }
  }

  return (
    <>
      <div className="row tabs" style={{ gap: 4 }}>
        <button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>
          Simple Mode
        </button>
        <button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>
          Advanced Mode (JSON)
        </button>
      </div>

      {mode === "advanced" ? (
        <>
          <textarea
            className="code"
            rows={22}
            spellCheck={false}
            value={props.jsonText}
            onChange={(e) => props.onJsonChange(e.target.value)}
          />
          {props.jsonError && <div className="notice error">JSON syntax: {props.jsonError}</div>}
          <p className="muted">
            Structured rules only. The server validates this against a strict schema; no code is executed.
          </p>
        </>
      ) : (
        <>
          <h3>Market</h3>
          <div className="grid">
            <label>
              Symbol
              <select value={strategy.symbol} onChange={(e) => set({ symbol: e.target.value as Strategy["symbol"] })}>
                <option>AAPL</option>
                <option>SPY</option>
                <option>TSLA</option>
              </select>
            </label>
            <label>
              Timeframe
              <select
                value={strategy.timeframe}
                onChange={(e) => set({ timeframe: e.target.value as Strategy["timeframe"] })}
              >
                <option value="5m">5-minute (last ~60 days)</option>
                <option value="1d">Daily (last 2 years)</option>
              </select>
            </label>
            <NumberField
              label="Starting balance ($)"
              value={strategy.initial_capital}
              step={500}
              onChange={(v) => set({ initial_capital: v })}
            />
            <NumberField
              label="Position size ($)"
              value={strategy.position_size_usd}
              step={100}
              onChange={(v) => set({ position_size_usd: v })}
            />
          </div>

          <h3>Entry</h3>
          <div className="grid">
            <label>
              Entry rule
              <select value={entry.type} onChange={(e) => setEntryType(e.target.value as Entry["type"])}>
                <option value="ema_crossover">EMA crossover</option>
                <option value="sma_crossover">SMA crossover</option>
                <option value="candle_only">Candle conditions only</option>
              </select>
            </label>
            {isCrossover && (
              <>
                <NumberField label="Fast period" value={entry.fast_period} min={2} onChange={(v) => setEntry({ fast_period: v })} />
                <NumberField label="Slow period" value={entry.slow_period} min={3} onChange={(v) => setEntry({ slow_period: v })} />
              </>
            )}
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={entry.rsi_below != null}
                onChange={(e) =>
                  setEntry(
                    e.target.checked
                      ? { rsi_period: 14, rsi_below: 70 }
                      : { rsi_period: undefined, rsi_below: undefined, rsi_above: undefined },
                  )
                }
              />
              RSI filter
            </label>
            {entry.rsi_below != null && (
              <>
                <NumberField label="RSI period" value={entry.rsi_period} min={2} onChange={(v) => setEntry({ rsi_period: v })} />
                <NumberField label="Only enter when RSI is below" value={entry.rsi_below} onChange={(v) => setEntry({ rsi_below: v })} />
              </>
            )}
          </div>

          <div className="grid" style={{ marginTop: 12 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={candle != null}
                disabled={!isCrossover}
                onChange={(e) => setEntry({ candle_conditions: e.target.checked ? MOMENTUM_PRESET : undefined })}
              />
              Bullish momentum candle
            </label>
            {candle && (
              <>
                <Slider
                  label={`Body at least ${Math.round((candle.body_to_range_min ?? 0) * 100)}% of range`}
                  value={candle.body_to_range_min ?? 0}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setCandle({ body_to_range_min: v })}
                />
                <Slider
                  label={`Upper wick at most ${Math.round((candle.upper_wick_to_range_max ?? 1) * 100)}% of range`}
                  value={candle.upper_wick_to_range_max ?? 1}
                  min={0}
                  max={1}
                  step={0.05}
                  onChange={(v) => setCandle({ upper_wick_to_range_max: v })}
                />
                <Slider
                  label={`Relative volume at least ${(candle.relative_volume_min ?? 1).toFixed(1)}x`}
                  value={candle.relative_volume_min ?? 1}
                  min={0.5}
                  max={6}
                  step={0.1}
                  onChange={(v) => setCandle({ relative_volume_min: v })}
                />
                <NumberField
                  label="Volume baseline (previous candles)"
                  value={candle.relative_volume_lookback}
                  min={2}
                  onChange={(v) => setCandle({ relative_volume_lookback: v })}
                />
              </>
            )}
          </div>

          <h3>Exit</h3>
          <div className="grid">
            <NumberField label="Stop loss (%)" value={strategy.stop_loss_pct} step={0.25} onChange={(v) => set({ stop_loss_pct: v })} />
            <NumberField label="Take profit (%)" value={strategy.take_profit_pct} step={0.25} onChange={(v) => set({ take_profit_pct: v })} />
            <label className="check">
              <input
                type="checkbox"
                checked={strategy.exit_on_reverse_crossover ?? false}
                disabled={!isCrossover}
                onChange={(e) => set({ exit_on_reverse_crossover: e.target.checked })}
              />
              Also exit on reverse crossover
            </label>
          </div>
        </>
      )}

      <h3>Trading costs</h3>
      <div className="grid">
        <NumberField
          label="Commission per order ($)"
          value={execution.commission_per_order_usd}
          step={0.5}
          onChange={(v) => props.onExecutionChange({ ...execution, commission_per_order_usd: v })}
        />
        <NumberField
          label="Slippage (basis points)"
          value={execution.slippage_bps}
          onChange={(v) => props.onExecutionChange({ ...execution, slippage_bps: v })}
        />
      </div>
    </>
  );
}
