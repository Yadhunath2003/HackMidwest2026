"use client";

import { useState } from "react";
import AdvancedStrategyForm from "./AdvancedStrategyForm";
import { money } from "@/lib/api";
import type { ExecutionSettings, Strategy } from "@/lib/types";

interface Props {
  strategy: Strategy;
  jsonText: string;
  jsonError: string | null;
  execution: ExecutionSettings;
  onStrategyChange: (strategy: Strategy) => void;
  onJsonChange: (text: string) => void;
  onExecutionChange: (execution: ExecutionSettings) => void;
}

const TIMEFRAMES = { "5m": "5 minutes", "30m": "30 minutes", "1h": "1 hour", "4h": "4 hours", "1d": "1 day" };
const ENTRY_TYPES = { ema_crossover: "EMA crossover", sma_crossover: "SMA crossover", candle_only: "Candle conditions only", bullish_pullback_breakout: "Bullish rally / pullback / breakout", ai_reference_breakout: "AI high-volume reference breakout" };
const ratio = (value: number | undefined) => value == null ? "Not selected" : `${Number((value * 100).toFixed(2))}%`;

function Values({ rows }: { rows: [string, string | number | undefined][] }) {
  return <div className="grid">{rows.map(([label, value]) => (
    <div className="metric" key={label}>
      <div className="muted">{label}</div>
      <div>{value ?? "Not selected"}</div>
    </div>
  ))}</div>;
}

// Simple Mode displays the strategy; Advanced Mode keeps the form and JSON in sync.
export default function StrategyBuilder(props: Props) {
  const [mode, setMode] = useState<"simple" | "advanced">("simple");
  const { strategy, execution } = props;
  const entry = strategy.entry;
  const candle = entry.candle_conditions;

  return (
    <>
      <div className="row tabs" style={{ gap: 4 }}>
        <button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")}>Simple Mode</button>
        <button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")}>Advanced Mode</button>
      </div>
      {mode === "advanced" ? (
        <>
          <p className="muted">Edit the controls or JSON below. Both update the same strategy.</p>
          {props.jsonError && <div className="notice warn">Fix the JSON syntax before editing the controls.</div>}
          <AdvancedStrategyForm strategy={strategy} disabled={props.jsonError != null} onChange={props.onStrategyChange} />
          <h3>Strategy JSON</h3>
          <textarea className="code" rows={22} spellCheck={false} value={props.jsonText}
            onChange={(e) => props.onJsonChange(e.target.value)} />
          {props.jsonError && <div className="notice error">JSON syntax: {props.jsonError}</div>}
          <p className="muted">Edit the selected strategy here. Changes are validated before running.</p>
        </>
      ) : (
        <>
          <p className="muted">Selected strategy. To change it, update your description and generate again, or use Advanced Mode.</p>
          {props.jsonError && <div className="notice error">The JSON contains an error. Showing the last readable strategy: {props.jsonError}</div>}
          <h3>Market</h3>
          <Values rows={[
            ["Symbol", strategy.symbol === "XAUUSD" ? "XAUUSD (spot gold / USD)" : strategy.symbol], ["Timeframe", TIMEFRAMES[strategy.timeframe] ?? strategy.timeframe],
            ["Starting balance", money(strategy.initial_capital)], ["Position size", entry.reference_breakout ? "Calculated from account risk and reference low" : money(strategy.position_size_usd)],
          ]} />
          <h3>Entry</h3>
          <Values rows={[
            ["Entry rule", ENTRY_TYPES[entry.type] ?? entry.type],
            ...(entry.type === "ema_crossover" || entry.type === "sma_crossover" ? [["Fast period", entry.fast_period], ["Slow period", entry.slow_period]] as [string, number | undefined][] : []),
            ["RSI period", entry.rsi_period], ["RSI below", entry.rsi_below], ["RSI above", entry.rsi_above],
            ["Candle conditions", candle ? "Selected" : "Not selected"],
          ]} />
          {entry.pullback_breakout && <>
            <h3>Rally and pullback</h3>
            <Values rows={[
              ["Minimum consecutive green candles", entry.pullback_breakout.rally_min_candles],
              ["Minimum consecutive red candles", entry.pullback_breakout.pullback_min_candles],
              ["Maximum consecutive red candles", entry.pullback_breakout.pullback_max_candles],
              ["Breakout trigger", `First green candle's ${entry.pullback_breakout.breakout_by} above the first red candle's high`],
            ]} />
          </>}
          {entry.ai_trend && <>
            <h3>AI trend filter</h3>
            <Values rows={[
              ["Required direction", entry.ai_trend.direction],
              ["Past candles available to AI", entry.ai_trend.context_candles],
              ["Minimum model confidence", `${Math.round(entry.ai_trend.min_confidence * 100)}%`],
              ["Trend duration", "Inferred by AI within the available history"],
            ]} />
          </>}
          {entry.reference_breakout && <>
            <h3>Reference breakout</h3>
            <Values rows={[
              ["Reference", `Red candle in AI bearish trend; volume ≥ ${entry.reference_breakout.reference_volume_min}× previous ${entry.reference_breakout.volume_lookback} candles`],
              ["Breakout", `Green candle in AI bullish trend; ${entry.reference_breakout.breakout_by} above marked high`],
              ["Minimum momentum body / range", ratio(entry.reference_breakout.momentum_body_min)],
              ["Planned account risk", `${entry.reference_breakout.risk_account_pct}% including modeled costs`],
              ["Stop", "Marked red candle's low"],
              ["Net account-profit target", `${entry.reference_breakout.target_account_pct}% of equity at entry`],
            ]} />
          </>}
          {candle && <>
            <h3>Candle conditions</h3>
            <Values rows={[
              ["Direction", candle.direction], ["Minimum body / range", ratio(candle.body_to_range_min)],
              ["Maximum upper wick / range", ratio(candle.upper_wick_to_range_max)],
              ["Maximum lower wick / range", ratio(candle.lower_wick_to_range_max)],
              ["Minimum relative volume", candle.relative_volume_min == null ? "Not selected" : `${candle.relative_volume_min}x`],
              ["Volume baseline (previous candles)", candle.relative_volume_min == null ? "Not used" : candle.relative_volume_lookback ?? 20],
            ]} />
          </>}
          {!entry.reference_breakout && <>
          <h3>Exit</h3>
          <Values rows={[
            ["Stop loss", `${strategy.stop_loss_pct}%`], ["Take profit", `${strategy.take_profit_pct}%`],
            ["Exit on reverse crossover", strategy.exit_on_reverse_crossover ? "Yes" : "No"],
          ]} />
          </>}
        </>
      )}
      {mode === "simple" && strategy.partial_exit && <Values rows={[["Partial exit", `Sell ${strategy.partial_exit.fraction * 100}% at ${strategy.partial_exit.profit_pct}% ${strategy.partial_exit.basis === "account" ? "net account gain if fully liquidated" : "price rise"}; keep the remainder's stop and final target`]]} />}
      <h3>Trading costs</h3>
      {mode === "simple" && strategy.symbol === "XAUUSD" && strategy.volume_basis === "quote" && <p className="muted">Gold volume means quote activity (tick-volume proxy), not traded ounces or contracts.</p>}
      {strategy.symbol === "BTCUSD" && <p className="muted">BTC/USD uses Kraken spot prices and traded BTC volume, with fractional Bitcoin sizing and 24/7 candles. Initial history is about 720 completed candles per timeframe.</p>}
      {mode === "simple" ? (
        <Values rows={[
          ["Commission per order", money(execution.commission_per_order_usd)],
          ["Slippage", `${execution.slippage_bps} basis points`],
        ]} />
      ) : (
        <div className="grid">
          <label>Commission per order ($)
            <input type="number" min={0} step={0.5} value={execution.commission_per_order_usd}
              onChange={(e) => e.target.value !== "" && props.onExecutionChange({ ...execution, commission_per_order_usd: Number(e.target.value) })} />
          </label>
          <label>Slippage (basis points)
            <input type="number" min={0} value={execution.slippage_bps}
              onChange={(e) => e.target.value !== "" && props.onExecutionChange({ ...execution, slippage_bps: Number(e.target.value) })} />
          </label>
        </div>
      )}
    </>
  );
}
