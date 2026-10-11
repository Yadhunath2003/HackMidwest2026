"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { shortId } from "@/lib/format";
import type { AIReport, BacktestRun, Trade } from "@/lib/types";
import { AIReportCard } from "@/components/sl/AIReportCard";
import { Badge } from "@/components/sl/Badge";
import { EquityChart } from "@/components/sl/Charts";
import { MetricGrid } from "@/components/sl/MetricGrid";
import { Notice } from "@/components/sl/Notice";
import { TradeTable } from "@/components/sl/TradeTable";
import { TrendTable } from "@/components/sl/TrendTable";

/** The Results tab: metrics, equity, trade log, AI report, AI trend judgments, then data and assumptions. */
export function ResultsTab({ run, selectedId, onSelectTrade }: { run: BacktestRun; selectedId: number | null; onSelectTrade: (trade: Trade) => void }) {
  const [report, setReport] = useState<AIReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);

  // A different run starts with a clean report area; a late reply for the old run is ignored.
  useEffect(() => {
    request.current += 1;
    setReport(null); setError(null); setLoading(false);
  }, [run.id]);

  async function generate() {
    const mine = ++request.current;
    setLoading(true); setError(null);
    try {
      const result = await api.backtestReport(run.id);
      if (mine === request.current) setReport(result);
    } catch (e) {
      if (mine === request.current) setError(e instanceof Error ? e.message : "The report could not be generated.");
    } finally {
      if (mine === request.current) setLoading(false);
    }
  }

  const { data, metrics } = run;
  const usesAI = Boolean(run.strategy.entry.ai_trend || run.strategy.entry.reference_breakout);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Backtest results</h2>
        <Badge>simulation</Badge>
        <Badge mono title={run.id}>run {shortId(run.id)}</Badge>
      </header>

      <MetricGrid metrics={metrics} usage={run.ai_usage} />

      {run.equity_curve.length > 1 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Equity curve</h3>
          <EquityChart run={run} />
        </section>
      ) : null}

      {metrics.rejected_trades > 0 ? (
        <Notice tone="warning" title="Rejected">{metrics.rejected_trades} entry signals were rejected (not enough cash or below the minimum quantity).</Notice>
      ) : null}
      {metrics.num_trades === 0 ? (
        <Notice tone="warning" title="No trades">No trades were triggered in this period. Try loosening the entry conditions.</Notice>
      ) : null}

      {run.trades.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Trades</h3>
          <p className="text-xs text-muted-foreground">Select a trade to mark it on the chart and open it in Trade Detective.</p>
          <TradeTable trades={run.trades} symbol={run.strategy.symbol} selectedId={selectedId} onSelect={onSelectTrade} />
        </section>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">AI report</h3>
        <AIReportCard report={report} loading={loading} error={error} onGenerate={generate} />
      </section>

      {usesAI ? <TrendTable assessments={run.trend_assessments ?? {}} /> : null}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Data and assumptions</h3>
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-muted-foreground">
          <li>Source: {data.source}, {data.candle_count.toLocaleString()} candles from {data.start?.slice(0, 16).replace("T", " ")} to {data.end?.slice(0, 16).replace("T", " ")} UTC.</li>
          {data.adjustment ? <li>Prices: {data.adjustment}</li> : null}
          {data.volume_type ? <li>Volume: {data.volume_type}</li> : null}
          {data.limitations?.map((line) => <li key={line}>{line}</li>)}
          {run.assumptions.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
    </div>
  );
}
