"use client";

import type { ReactNode } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { SYMBOL_NAMES, TIMEFRAMES } from "@/lib/format";
import type { CandleConditions, Entry, ExecutionSettings, ReferenceBreakout, Strategy } from "@/lib/types";
import { Badge } from "@/components/sl/Badge";
import { Field } from "@/components/sl/Field";
import { RatioField } from "@/components/sl/RatioField";

const PRESET: CandleConditions = { direction: "bullish", body_to_range_min: 0.7, upper_wick_to_range_max: 0.15, relative_volume_min: 2, relative_volume_lookback: 20 };

const ENTRY_OPTIONS = [
  { value: "ema_crossover", label: "EMA crossover" },
  { value: "sma_crossover", label: "SMA crossover" },
  { value: "candle_only", label: "Candle conditions only" },
  { value: "bullish_pullback_breakout", label: "Rally, pullback, breakout" },
  { value: "bearish_pullback_breakout", label: "Bearish pullback breakdown" },
  { value: "ai_reference_breakout", label: "AI reference breakout" },
];

type Num = number | undefined;
const num = (raw: string): Num => (raw === "" ? undefined : Number(raw));

function NumberField({ label, value, onChange, min = 0, max, step = 1, disabled }: {
  label: string; value: Num; onChange: (value: Num) => void; min?: number; max?: number; step?: number; disabled?: boolean;
}) {
  return <Field label={label} type="number" value={value ?? ""} min={min} max={max} step={step} disabled={disabled} onChange={(e) => onChange(num(e.target.value))} />;
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] font-medium sm:col-span-2">
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />{label}
    </label>
  );
}

function Section({ value, title, aiBadge, children }: { value: string; title: string; aiBadge?: boolean; children: ReactNode }) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger className="text-sm font-semibold">
        <span className="flex flex-1 items-center gap-2">{title}{aiBadge ? <Badge tone="warning" className="ml-auto mr-2">uses AI</Badge> : null}</span>
      </AccordionTrigger>
      <AccordionContent><div className="grid grid-cols-1 gap-3 pt-2 pb-2 sm:grid-cols-2">{children}</div></AccordionContent>
    </AccordionItem>
  );
}

/**
 * The structured rule form, as a right-hand sheet. The entry-type select decides which sections show.
 * Switching type clears fields that no longer apply. Edits validate live; the JSON tab shows the same object.
 */
export function StrategyEditor({ open, onOpenChange, strategy, onChange, execution, onExecutionChange, disabled }: {
  open: boolean; onOpenChange: (open: boolean) => void; strategy: Strategy; onChange: (strategy: Strategy) => void;
  execution: ExecutionSettings; onExecutionChange: (execution: ExecutionSettings) => void; disabled: boolean;
}) {
  const entry = strategy.entry;
  const candle = entry.candle_conditions;
  const short = strategy.direction === "short";
  const isCrossover = entry.type === "ema_crossover" || entry.type === "sma_crossover";
  const isReference = entry.type === "ai_reference_breakout";

  const set = (patch: Partial<Strategy>) => onChange({ ...strategy, ...patch, volume_basis: (patch.symbol ?? strategy.symbol) === "XAUUSD" ? "quote" : "traded" });
  const setEntry = (patch: Partial<Entry>) => set({ entry: { ...entry, ...patch } });
  const setCandle = (patch: Partial<CandleConditions>) => setEntry({ candle_conditions: { ...candle, ...patch } });
  const setPullback = (patch: Partial<NonNullable<Entry["pullback_breakout"]>>) => setEntry({ pullback_breakout: { ...entry.pullback_breakout!, ...patch } });
  const setReference = (patch: Partial<ReferenceBreakout>) => setEntry({ reference_breakout: { ...entry.reference_breakout!, ...patch } });
  const setTrend = (patch: Partial<NonNullable<Entry["ai_trend"]>>) => setEntry({ ai_trend: { ...entry.ai_trend!, ...patch } });

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
        next.candle_conditions = candle ?? PRESET;
        delete next.pullback_breakout;
      } else if (type === "bullish_pullback_breakout" || type === "bearish_pullback_breakout") {
        next.pullback_breakout = entry.pullback_breakout ?? { rally_min_candles: 3, pullback_min_candles: 1, pullback_max_candles: 3, breakout_by: "close" };
      } else {
        delete next.ai_trend;
        delete next.candle_conditions;
        delete next.pullback_breakout;
        next.reference_breakout = entry.reference_breakout ?? {
          reference_volume_min: 2, volume_lookback: 20, momentum_body_min: 0.7, breakout_by: "close", context_candles: 200,
          min_confidence: 0.6, risk_account_pct: 1, target_account_pct: 2,
        };
      }
    }
    set({
      entry: next,
      ...(type === "bearish_pullback_breakout" ? { direction: "short" as const } : type === "bullish_pullback_breakout" ? { direction: "long" as const } : {}),
      exit_on_reverse_crossover: type === "ema_crossover" || type === "sma_crossover" ? strategy.exit_on_reverse_crossover : false,
      ...(type !== "ai_reference_breakout" && strategy.partial_exit?.basis === "account" ? { partial_exit: { ...strategy.partial_exit, basis: "price" as const } } : {}),
    });
  }

  const referenceFields: [Exclude<keyof ReferenceBreakout, "breakout_by">, string, number, number, number][] = [
    ["reference_volume_min", "Minimum reference volume (× average)", 0.1, 50, 0.1],
    ["volume_lookback", "Previous candles for the volume average", 2, 200, 1],
    ["momentum_body_min", "Minimum momentum body / range (0–1)", 0, 1, 0.05],
    ["context_candles", "Past candles available to AI", 20, 1000, 1],
    ["min_confidence", "Minimum model confidence (0–1)", 0, 1, 0.05],
    ["risk_account_pct", "Maximum planned account risk (%)", 0.01, 10, 0.25],
    ["target_account_pct", "Net account-profit target (%)", 0.01, 100, 0.25],
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-[560px]">
        <SheetHeader className="border-b">
          <SheetTitle>Edit rules</SheetTitle>
          <SheetDescription>Changes are re-checked by the server as you type.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4">
          <Accordion type="multiple" defaultValue={["market", "entry", "pullback", "reference", "trend", "candle", "exit", "partial", "costs"]}>
            <Section value="market" title="Market">
              <Field as="select" label="Trade direction" value={strategy.direction ?? "long"} disabled={disabled}
                options={[{value:"long",label:"Long (buy to open)"},{value:"short",label:"Short (sell to open)"}]}
                onChange={(e) => {
                  const direction=e.target.value as "long" | "short";
                  set({direction,entry:{...entry,type:entry.pullback_breakout ? (direction === "short" ? "bearish_pullback_breakout" : "bullish_pullback_breakout") : entry.type}});
                }} />
              {short ? <p className="text-xs text-muted-foreground sm:col-span-2">Hypothetical shorts reserve entry-value collateral; borrow costs, funding and liquidation are not modeled.</p> : null}
              <Field as="select" label="Symbol" value={strategy.symbol} disabled={disabled}
                options={Object.entries(SYMBOL_NAMES).map(([value, label]) => ({ value, label }))}
                onChange={(e) => set({ symbol: e.target.value as Strategy["symbol"] })} />
              <Field as="select" label="Timeframe" value={strategy.timeframe} disabled={disabled} options={TIMEFRAMES}
                onChange={(e) => set({ timeframe: e.target.value as Strategy["timeframe"] })} />
              <NumberField label="Starting balance ($)" value={strategy.initial_capital} min={1} step={100} disabled={disabled} onChange={(v) => v != null && set({ initial_capital: v })} />
              {!isReference ? <NumberField label="Position size ($)" value={strategy.position_size_usd} min={1} step={100} disabled={disabled} onChange={(v) => v != null && set({ position_size_usd: v })} /> : null}
            </Section>

            <Section value="entry" title="Entry">
              <Field as="select" label="Entry rule" className="sm:col-span-2" value={entry.type} disabled={disabled} options={ENTRY_OPTIONS} onChange={(e) => setType(e.target.value as Entry["type"])} />
              {isCrossover ? (
                <>
                  <NumberField label="Fast period" value={entry.fast_period} min={2} max={200} disabled={disabled} onChange={(v) => setEntry({ fast_period: v })} />
                  <NumberField label="Slow period" value={entry.slow_period} min={3} max={400} disabled={disabled} onChange={(v) => setEntry({ slow_period: v })} />
                </>
              ) : null}
              <Toggle label="RSI filter" checked={entry.rsi_period != null} disabled={disabled}
                onChange={(on) => setEntry(on ? { rsi_period: 14, rsi_below: 70 } : { rsi_period: undefined, rsi_below: undefined, rsi_above: undefined })} />
              {entry.rsi_period != null ? (
                <>
                  <NumberField label="RSI period" value={entry.rsi_period} min={2} max={100} disabled={disabled} onChange={(v) => setEntry({ rsi_period: v })} />
                  <NumberField label="RSI below (optional)" value={entry.rsi_below} max={100} disabled={disabled} onChange={(v) => setEntry({ rsi_below: v })} />
                  <NumberField label="RSI above (optional)" value={entry.rsi_above} max={100} disabled={disabled} onChange={(v) => setEntry({ rsi_above: v })} />
                </>
              ) : null}
            </Section>

            {entry.pullback_breakout ? (
              <Section value="pullback" title="Rally and pullback">
                <NumberField label={short ? "Minimum red candles" : "Minimum green candles"} value={entry.pullback_breakout.rally_min_candles} min={2} max={100} disabled={disabled} onChange={(v) => v != null && setPullback({ rally_min_candles: v })} />
                <NumberField label={short ? "Minimum green candles" : "Minimum red candles"} value={entry.pullback_breakout.pullback_min_candles} min={1} max={50} disabled={disabled} onChange={(v) => v != null && setPullback({ pullback_min_candles: v })} />
                <NumberField label={short ? "Maximum green candles" : "Maximum red candles"} value={entry.pullback_breakout.pullback_max_candles} min={1} max={50} disabled={disabled} onChange={(v) => v != null && setPullback({ pullback_max_candles: v })} />
                <Field as="select" label={short ? "Breakout below first green low by" : "Breakout above first red high by"} value={entry.pullback_breakout.breakout_by} disabled={disabled}
                  options={[{ value: "close", label: short ? "Red candle close" : "Green candle close" }, { value: "high", label: short ? "Red candle low" : "Green candle high" }]}
                  onChange={(e) => setPullback({ breakout_by: e.target.value as "close" | "high" })} />
              </Section>
            ) : null}

            {entry.reference_breakout ? (
              <Section value="reference" title="Reference and account risk" aiBadge>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  {short ? "Green reference in AI bullish trend; red breakout below marked low in AI bearish trend. Stop at marked high; a high touch invalidates." : "Red reference in AI bearish trend; green breakout above marked high in AI bullish trend. Stop at marked low; a low touch invalidates."} Target is net account gain; new qualifying references replace old ones.
                </p>
                {referenceFields.map(([key, label, min, max, step]) => (
                  <NumberField key={key} label={label} value={entry.reference_breakout![key]} min={min} max={max} step={step} disabled={disabled} onChange={(v) => v != null && setReference({ [key]: v })} />
                ))}
                <Field as="select" label="Breakout trigger" value={entry.reference_breakout.breakout_by} disabled={disabled}
                  options={[{ value: "close", label: short ? "Close below marked low" : "Close above marked high" }, { value: "high", label: short ? "Low below marked low" : "High above marked high" }]}
                  onChange={(e) => setReference({ breakout_by: e.target.value as "close" | "high" })} />
              </Section>
            ) : null}

            {!isReference ? (
              <Section value="trend" title="AI trend filter" aiBadge>
                <Toggle label="Require an AI-detected trend" checked={entry.ai_trend != null} disabled={disabled}
                  onChange={(on) => setEntry({ ai_trend: on ? { direction: "bullish", context_candles: 200, min_confidence: 0.6 } : undefined })} />
                {entry.ai_trend ? (
                  <>
                    <p className="text-xs text-muted-foreground sm:col-span-2">AI infers how long the trend has lasted from price structure. Model calls happen at candidate entries and are cached.</p>
                    <Field as="select" label="Required trend" value={entry.ai_trend.direction} disabled={disabled}
                      options={[{ value: "bullish", label: "Bullish" }, { value: "bearish", label: "Bearish" }]}
                      onChange={(e) => setTrend({ direction: e.target.value as "bullish" | "bearish" })} />
                    <NumberField label="Past candles for AI" value={entry.ai_trend.context_candles} min={20} max={1000} disabled={disabled} onChange={(v) => v != null && setTrend({ context_candles: v })} />
                    <NumberField label="Minimum confidence (0–1)" value={entry.ai_trend.min_confidence} min={0} max={1} step={0.05} disabled={disabled} onChange={(v) => v != null && setTrend({ min_confidence: v })} />
                  </>
                ) : null}
              </Section>
            ) : null}

            {!isReference ? (
              <Section value="candle" title="Candle conditions">
                <Toggle label="Use candle conditions" checked={candle != null} disabled={disabled || entry.type === "candle_only"} onChange={(on) => setEntry({ candle_conditions: on ? PRESET : undefined })} />
                {candle ? (
                  <>
                    <Field as="select" label="Direction" value={candle.direction ?? ""} disabled={disabled}
                      options={[{ value: "", label: "Any direction" }, { value: "bullish", label: "Bullish" }, { value: "bearish", label: "Bearish" }]}
                      onChange={(e) => setCandle({ direction: (e.target.value || undefined) as CandleConditions["direction"] })} />
                    <span className="hidden sm:block" />
                    <RatioField label="Minimum body / range" value={candle.body_to_range_min} preset={0.7} disabled={disabled} onChange={(v) => setCandle({ body_to_range_min: v })} />
                    <RatioField label="Maximum upper wick / range" value={candle.upper_wick_to_range_max} preset={0.15} disabled={disabled} onChange={(v) => setCandle({ upper_wick_to_range_max: v })} />
                    <RatioField label="Maximum lower wick / range" value={candle.lower_wick_to_range_max} preset={0.15} disabled={disabled} onChange={(v) => setCandle({ lower_wick_to_range_max: v })} />
                    <NumberField label="Minimum relative volume (optional)" value={candle.relative_volume_min} min={0.1} max={50} step={0.1} disabled={disabled} onChange={(v) => setCandle({ relative_volume_min: v })} />
                    <NumberField label="Volume baseline (previous candles)" value={candle.relative_volume_lookback ?? 20} min={2} max={200} disabled={disabled} onChange={(v) => setCandle({ relative_volume_lookback: v })} />
                    {strategy.symbol === "XAUUSD" ? <p className="text-xs text-muted-foreground sm:col-span-2">Gold filters use quote activity (a tick-volume proxy), not traded ounces or contracts.</p> : null}
                  </>
                ) : null}
              </Section>
            ) : null}

            {!isReference ? (
              <Section value="exit" title="Exit">
                <NumberField label="Stop loss (%)" value={strategy.stop_loss_pct} min={0.01} max={50} step={0.25} disabled={disabled} onChange={(v) => v != null && set({ stop_loss_pct: v })} />
                <NumberField label="Take profit (%)" value={strategy.take_profit_pct} min={0.01} max={200} step={0.25} disabled={disabled} onChange={(v) => v != null && set({ take_profit_pct: v })} />
                <Toggle label="Also exit on a reverse crossover" checked={strategy.exit_on_reverse_crossover ?? false} disabled={disabled || !isCrossover} onChange={(on) => set({ exit_on_reverse_crossover: on })} />
              </Section>
            ) : null}

            <Section value="partial" title="Partial exit">
              <Toggle label="Close part of the position at a profit trigger" checked={strategy.partial_exit != null} disabled={disabled}
                onChange={(on) => set({ partial_exit: on ? { fraction: 0.5, profit_pct: 1, basis: isReference ? "account" : "price" } : undefined })} />
              {strategy.partial_exit ? (
                <>
                  <NumberField label="Position to close (%)" value={Math.round(strategy.partial_exit.fraction * 100)} min={1} max={99} disabled={disabled} onChange={(v) => v != null && set({ partial_exit: { ...strategy.partial_exit!, fraction: v / 100 } })} />
                  <NumberField label="Profit trigger (%)" value={strategy.partial_exit.profit_pct} min={0.01} max={200} step={0.25} disabled={disabled} onChange={(v) => v != null && set({ partial_exit: { ...strategy.partial_exit!, profit_pct: v } })} />
                  <Field as="select" label="Trigger basis" value={strategy.partial_exit.basis} disabled={disabled}
                    options={[{ value: "price", label: short ? "Price fall from entry" : "Price rise from entry" }, ...(isReference ? [{ value: "account", label: "Net account gain" }] : [])]}
                    onChange={(e) => set({ partial_exit: { ...strategy.partial_exit!, basis: e.target.value as "price" | "account" } })} />
                </>
              ) : null}
            </Section>

            <Section value="costs" title="Costs">
              <NumberField label="Commission per order ($)" value={execution.commission_per_order_usd} step={0.5} max={100} disabled={disabled} onChange={(v) => v != null && onExecutionChange({ ...execution, commission_per_order_usd: v })} />
              <NumberField label="Slippage (basis points)" value={execution.slippage_bps} max={500} disabled={disabled} onChange={(v) => v != null && onExecutionChange({ ...execution, slippage_bps: v })} />
            </Section>
          </Accordion>
        </div>

        <SheetFooter className="border-t">
          <Button size="lg" onClick={() => onOpenChange(false)}>Done</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
