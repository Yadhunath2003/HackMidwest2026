"use client";

import { useEffect, useState } from "react";
import { ApiError, api, money, percent } from "@/lib/api";
import type { BacktestRun, Metrics, StressTestResult } from "@/lib/types";

const ROWS: { label: string; render: (m: Metrics) => string }[] = [
  { label: "Total return", render: (m) => percent(m.total_return_pct) },
  { label: "Net profit", render: (m) => money(m.net_profit) },
  { label: "Completed trades", render: (m) => String(m.num_trades) },
  { label: "Win rate", render: (m) => percent(m.win_rate_pct, 1) },
  { label: "Max drawdown", render: (m) => percent(m.max_drawdown_pct) },
  { label: "Profit factor", render: (m) => m.profit_factor?.toFixed(2) ?? "n/a" },
  { label: "Fees + slippage", render: (m) => money(m.total_fees + m.total_slippage_cost) },
];

export default function ReliabilityReport({ run }: { run: BacktestRun }) {
  const [commission, setCommission] = useState(run.execution.commission_per_order_usd * 2);
  const [slippage, setSlippage] = useState(Math.max(run.execution.slippage_bps * 3, 5));
  const [useSplit, setUseSplit] = useState(true);
  const [inSamplePct, setInSamplePct] = useState(70);
  const [result, setResult] = useState<StressTestResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setResult(null);
    setError(null);
    setCommission(run.execution.commission_per_order_usd * 2);
    setSlippage(Math.max(run.execution.slippage_bps * 3, 5));
  }, [run]);

  async function runStressTest() {
    setLoading(true);
    setError(null);
    try {
      setResult(
        await api.stressTest({
          run_id: run.id,
          commission_per_order_usd: commission,
          slippage_bps: slippage,
          in_sample_fraction: useSplit ? inSamplePct / 100 : undefined,
        }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? [e.message, ...e.issues].join(" ") : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const columns: { title: string; subtitle: string; metrics: Metrics }[] = [];
  if (result) {
    const cost = (e: { commission_per_order_usd: number; slippage_bps: number }) =>
      `$${e.commission_per_order_usd} / order, ${e.slippage_bps} bps`;
    columns.push({ title: "Original", subtitle: cost(result.baseline.execution), metrics: result.baseline.metrics });
    columns.push({ title: "Higher costs", subtitle: cost(result.stressed.execution), metrics: result.stressed.metrics });
    if (result.split) {
      const range = (r: { start: string | null; end: string | null }) => `${r.start?.slice(0, 10)} to ${r.end?.slice(0, 10)}`;
      columns.push({ title: "Earlier period", subtitle: range(result.split.in_sample.range), metrics: result.split.in_sample.metrics });
      columns.push({ title: "Later (unseen) period", subtitle: range(result.split.out_of_sample.range), metrics: result.split.out_of_sample.metrics });
    }
  }

  return (
    <section className="panel">
      <h2>Reliability report</h2>
      <p className="muted">Rerun the same strategy on the same candles with harsher costs, and compare an earlier period with a later one.</p>
      <div className="row">
        <label>
          Commission per order ($)
          <input type="number" min={0} step={0.5} value={commission} onChange={(e) => setCommission(Number(e.target.value))} />
        </label>
        <label>
          Slippage (basis points)
          <input type="number" min={0} value={slippage} onChange={(e) => setSlippage(Number(e.target.value))} />
        </label>
        <label className="check">
          <input type="checkbox" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} />
          Split periods
        </label>
        {useSplit && (
          <label>
            Earlier period: first {inSamplePct}% of candles
            <input type="range" min={50} max={85} step={5} value={inSamplePct} onChange={(e) => setInSamplePct(Number(e.target.value))} />
          </label>
        )}
        <button className="primary" onClick={runStressTest} disabled={loading}>
          {loading ? "Running…" : "Run stress test"}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}

      {result && (
        <>
          <div className="table-wrap" style={{ marginTop: 12, maxHeight: "none" }}>
            <table>
              <thead>
                <tr>
                  <th />
                  {columns.map((column) => (
                    <th key={column.title}>
                      {column.title}
                      <br />
                      <span style={{ fontSize: 11 }}>{column.subtitle}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="muted">{row.label}</td>
                    {columns.map((column) => <td key={column.title}>{row.render(column.metrics)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.notes.map((note) => (
            <div className="notice warn" key={note}>{note}</div>
          ))}
        </>
      )}
    </section>
  );
}
