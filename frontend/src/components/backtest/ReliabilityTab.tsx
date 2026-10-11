"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api, money } from "@/lib/api";
import { drawdownText, percentOrNA, signed, signedMoney, signedPercent } from "@/lib/format";
import type { BacktestRun, Metrics, StressTestResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { AIReportCard } from "@/components/sl/AIReportCard";
import { ComparisonTable, type ComparisonRow } from "@/components/sl/ComparisonTable";
import { Field } from "@/components/sl/Field";
import { MetricCard } from "@/components/sl/MetricCard";
import { Notice } from "@/components/sl/Notice";

const ROWS: { label: string; render: (m: Metrics) => string }[] = [
  { label: "Total return", render: (m) => signedPercent(m.total_return_pct) },
  { label: "Net profit", render: (m) => signedMoney(m.net_profit) },
  { label: "Completed trades", render: (m) => String(m.num_trades) },
  { label: "Win rate", render: (m) => percentOrNA(m.win_rate_pct) },
  { label: "Max drawdown", render: (m) => drawdownText(m.max_drawdown_pct) },
  { label: "Profit factor", render: (m) => m.profit_factor?.toFixed(2) ?? "n/a" },
  { label: "Fees + slippage", render: (m) => money(m.total_fees + m.total_slippage_cost) },
];

/** Reliability: rerun on the same candles with harsher costs, and compare an earlier period with a later one. */
export function ReliabilityTab({ run }: { run: BacktestRun }) {
  const [commission, setCommission] = useState(run.execution.commission_per_order_usd * 2);
  const [slippage, setSlippage] = useState(Math.max(run.execution.slippage_bps * 3, 5));
  const [useSplit, setUseSplit] = useState(true);
  const [inSamplePct, setInSamplePct] = useState(70);
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null); setError(null);
    setCommission(run.execution.commission_per_order_usd * 2);
    setSlippage(Math.max(run.execution.slippage_bps * 3, 5));
  }, [run]);

  async function runStressTest() {
    setLoading(true); setError(null);
    try {
      setResult(await api.stressTest({ run_id: run.id, commission_per_order_usd: commission, slippage_bps: slippage, in_sample_fraction: useSplit ? inSamplePct / 100 : undefined }));
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues].join(" ") : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const cost = (e: { commission_per_order_usd: number; slippage_bps: number }) => `$${e.commission_per_order_usd} / order · ${e.slippage_bps} bps`;
  const columns: { title: string; subtitle: string; metrics: Metrics }[] = [];
  if (result) {
    columns.push({ title: "Original", subtitle: cost(result.baseline.execution), metrics: result.baseline.metrics });
    columns.push({ title: "Higher costs", subtitle: cost(result.stressed.execution), metrics: result.stressed.metrics });
    if (result.split) {
      const range = (r: { start: string | null; end: string | null }) => `${r.start?.slice(0, 10)} to ${r.end?.slice(0, 10)}`;
      columns.push({ title: "Earlier period", subtitle: range(result.split.in_sample.range), metrics: result.split.in_sample.metrics });
      columns.push({ title: "Later period", subtitle: range(result.split.out_of_sample.range), metrics: result.split.out_of_sample.metrics });
    }
  }
  const rows: ComparisonRow[] = ROWS.map((row) => ({ label: row.label, values: columns.map((c) => row.render(c.metrics)) }));

  const base = result?.baseline.metrics;
  const stressed = result?.stressed.metrics;
  const early = result?.split?.in_sample.metrics;
  const late = result?.split?.out_of_sample.metrics;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-sm font-semibold">Reliability</h2>
        <p className="mt-1 text-[13px] text-muted-foreground">Rerun the same strategy on the same candles with harsher costs, and compare an earlier period with a later one.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Commission per order ($)" type="number" min={0} max={100} step={0.5} value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
        <Field label="Slippage (basis points)" type="number" min={0} max={500} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} />
        <div className="flex flex-col gap-2 sm:col-span-2">
          <div className="flex items-center gap-2.5">
            <Switch id="split" checked={useSplit} onCheckedChange={setUseSplit} />
            <label htmlFor="split" className="text-[13px] font-medium">Compare an earlier period with a later one</label>
          </div>
          {useSplit ? (
            <div className="flex items-center gap-3">
              <Slider aria-label="Share of candles in the earlier period" min={50} max={85} step={5} value={[inSamplePct]} onValueChange={([v]) => setInSamplePct(v)} className="max-w-xs" />
              <span className="font-mono text-xs text-muted-foreground">Earlier period: first {inSamplePct}% of candles</span>
            </div>
          ) : null}
        </div>
      </div>
      <Button size="lg" onClick={runStressTest} disabled={loading}>
        {loading ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />}
        {loading ? "Running stress test…" : "Run stress test"}
      </Button>
      {error ? <Notice tone="error" title="Stress test failed">{error}</Notice> : null}

      {result && base && stressed ? (
        <div className="space-y-4">
          <ComparisonTable columns={columns.map((c) => ({ title: c.title, subtitle: c.subtitle }))} rows={rows} />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard size="sm" label="Total return, higher costs" value={signed(stressed.total_return_pct)} unit="%"
              delta={{ value: stressed.total_return_pct - base.total_return_pct, unit: "pts", context: "vs original run" }} />
            <MetricCard size="sm" label="Max drawdown, higher costs" value={drawdownText(stressed.max_drawdown_pct).replace("%", "")} unit="%"
              delta={{ value: stressed.max_drawdown_pct - base.max_drawdown_pct, unit: "pts", context: "vs original run", goodWhen: "down" }} />
            {early && late ? (
              <>
                <MetricCard size="sm" label="Total return, later period" value={signed(late.total_return_pct)} unit="%"
                  delta={{ value: late.total_return_pct - early.total_return_pct, unit: "pts", context: "vs earlier period" }} />
                <MetricCard size="sm" label="Max drawdown, later period" value={drawdownText(late.max_drawdown_pct).replace("%", "")} unit="%"
                  delta={{ value: late.max_drawdown_pct - early.max_drawdown_pct, unit: "pts", context: "vs earlier period", goodWhen: "down" }} />
              </>
            ) : null}
          </div>

          {result.notes.map((note) => <Notice key={note} tone="warning" title="Small sample">{note}</Notice>)}
          {result.ai_error ? (
            <Notice tone="warning" title="AI analysis unavailable">{result.ai_error}. The calculated comparisons are still shown above.</Notice>
          ) : result.ai_report ? <AIReportCard report={result.ai_report} /> : null}
        </div>
      ) : null}
    </div>
  );
}
