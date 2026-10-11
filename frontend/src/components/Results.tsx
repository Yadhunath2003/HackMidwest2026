"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api, formatTime, money, percent } from "@/lib/api";
import type { AIReport, BacktestRun, Metrics, Trade } from "@/lib/types";
import AIReportView from "./AIReportView";
import { EquityChart, PriceChart } from "./Charts";

type SortKey = "id" | "entry_time" | "entry_price" | "exit_price" | "shares" | "pnl" | "pnl_pct" | "fees" | "bars_held" | "exit_reason";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "#" },
  { key: "entry_time", label: "Entry (UTC)" },
  { key: "entry_price", label: "Entry price" },
  { key: "exit_price", label: "Exit price" },
  { key: "shares", label: "Shares" },
  { key: "pnl", label: "P&L" },
  { key: "pnl_pct", label: "P&L %" },
  { key: "fees", label: "Fees" },
  { key: "bars_held", label: "Candles held" },
  { key: "exit_reason", label: "Exit reason" },
];

export function MetricCards({ metrics }: { metrics: Metrics }) {
  const tone = (value: number) => (value > 0 ? "good" : value < 0 ? "bad" : "");
  const cards: { label: string; value: string; tone?: string }[] = [
    { label: "Total return", value: percent(metrics.total_return_pct), tone: tone(metrics.total_return_pct) },
    { label: "Net profit", value: money(metrics.net_profit), tone: tone(metrics.net_profit) },
    { label: "Completed trades", value: String(metrics.num_trades) },
    { label: "Win rate", value: percent(metrics.win_rate_pct, 1) },
    { label: "Max drawdown", value: percent(metrics.max_drawdown_pct) },
    { label: "Profit factor", value: metrics.profit_factor?.toFixed(2) ?? "n/a" },
    { label: "Total fees", value: money(metrics.total_fees) },
    { label: "Slippage cost", value: money(metrics.total_slippage_cost) },
    { label: "Buy & hold (same period)", value: percent(metrics.buy_and_hold_return_pct) },
  ];
  return (
    <div className="metrics">
      {cards.map((card) => (
        <div className="metric" key={card.label}>
          <div className="muted">{card.label}</div>
          <div className={`value ${card.tone ?? ""}`}>{card.value}</div>
        </div>
      ))}
    </div>
  );
}

interface Props {
  run: BacktestRun;
  selectedTrade: Trade | null;
  onSelectTrade: (trade: Trade) => void;
}

export default function Results({ run, selectedTrade, onSelectTrade }: Props) {
  const [report, setReport] = useState<AIReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const reportRequest = useRef(0);
  useEffect(() => {
    reportRequest.current += 1;
    setReport(null); setReportError(null); setReportLoading(false);
  }, [run.id]);
  async function analyze() {
    const request = ++reportRequest.current;
    setReportLoading(true); setReportError(null);
    try {
      const result = await api.backtestReport(run.id);
      if (request === reportRequest.current) setReport(result);
    } catch (e) {
      if (request === reportRequest.current) setReportError(e instanceof Error ? e.message : "AI report failed.");
    } finally {
      if (request === reportRequest.current) setReportLoading(false);
    }
  }
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: "id", ascending: true });

  const trades = useMemo(() => {
    const sorted = [...run.trades].sort((a, b) => {
      const [x, y] = [a[sort.key], b[sort.key]];
      return typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    });
    return sort.ascending ? sorted : sorted.reverse();
  }, [run.trades, sort]);

  const { data, metrics } = run;

  return (
    <section className="panel">
      <h2>
        Backtest results <span className="tag">simulation · run {run.id}</span>
      </h2>
      <MetricCards metrics={metrics} />
      {run.strategy.partial_exit && <p className="muted">Each trade includes all of its sell fills. Exit price is the quantity-weighted average; the chart marks each partial sale and the final exit separately.</p>}
      {selectedTrade?.exits && selectedTrade.exits.length > 1 && <div className="notice">
        Trade #{selectedTrade.id} sell fills:
        <ul>{selectedTrade.exits.map((exit, i) => <li key={i}>{formatTime(exit.time)} UTC · {exit.reason.replaceAll("_", " ")} · {exit.shares} units at {money(exit.price)} · fee {money(exit.fee)}</li>)}</ul>
      </div>}
      {selectedTrade?.partial_exit_skipped && <p className="muted">{selectedTrade.partial_exit_skipped}</p>}
      {run.ai_usage && <p className="muted">
        Backtest AI usage: {run.ai_usage.requests} requests · {run.ai_usage.cache_hits} cached checks · {run.ai_usage.prompt_tokens.toLocaleString()} input tokens · {run.ai_usage.completion_tokens.toLocaleString()} output tokens · {run.ai_usage.total_tokens.toLocaleString()} total reported tokens.
        {run.ai_usage.unreported_requests > 0 && ` Usage was not reported for ${run.ai_usage.unreported_requests} requests; totals may be incomplete.`}
      </p>}
      <button className="primary" style={{ marginTop: 12 }} onClick={analyze} disabled={reportLoading}>
        {reportLoading ? "Analyzing results…" : "Generate AI report"}
      </button>
      {reportError && <div className="notice error">{reportError}</div>}
      {report && <AIReportView report={report} />}
      {(run.strategy.entry.ai_trend || run.strategy.entry.reference_breakout) && <>
        <h3>AI trend assessments</h3>
        <p className="muted">Judgments at candidate entries, using completed/past candles only. Confidence is a model judgment, not a probability of profit.</p>
        <div className="table-wrap"><table>
          <thead><tr><th>Candidate (UTC)</th><th>Trend</th><th>Confidence</th><th>Inferred start (UTC)</th><th>Reasoning</th></tr></thead>
          <tbody>{Object.entries(run.trend_assessments ?? {}).map(([time, assessment]) => <tr key={time}>
            <td>{formatTime(Number(time))}</td><td>{assessment.direction}</td>
            <td>{percent(assessment.confidence * 100, 0)}</td>
            <td>{assessment.start_time == null ? "Unavailable" : formatTime(assessment.start_time)}</td>
            <td style={{ whiteSpace: "normal", textAlign: "left", minWidth: 280 }}>{assessment.reason}</td>
          </tr>)}</tbody>
        </table></div>
      </>}
      {metrics.rejected_trades > 0 && (
        <div className="notice warn">{metrics.rejected_trades} entry signal(s) were rejected (not enough cash or size below the minimum quantity).</div>
      )}
      {metrics.num_trades === 0 && (
        <div className="notice warn">No trades were triggered in this period. Try loosening the entry conditions.</div>
      )}

      <h3>
        {data.symbol} {data.timeframe} candles · dots are matched signal candles, arrows are fills
      </h3>
      <PriceChart run={run} selectedTrade={selectedTrade} onSelectTrade={onSelectTrade} />

      <h3>Equity curve</h3>
      <EquityChart run={run} />

      <h3>Trade log · click a trade to investigate it</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="sortable"
                  onClick={() => setSort({ key: column.key, ascending: sort.key === column.key ? !sort.ascending : true })}
                >
                  {column.key === "shares" && run.strategy.symbol === "BTCUSD" ? "BTC" : column.key === "shares" && run.strategy.symbol === "XAUUSD" ? "Troy ounces" : column.label}
                  {sort.key === column.key ? (sort.ascending ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr
                key={trade.id}
                className={`clickable ${selectedTrade?.id === trade.id ? "selected" : ""}`}
                onClick={() => onSelectTrade(trade)}
              >
                <td>{trade.id}</td>
                <td>{formatTime(trade.entry_time)}</td>
                <td>{trade.entry_price.toFixed(2)}</td>
                <td>{trade.exit_price.toFixed(2)}</td>
                <td>{trade.shares}</td>
                <td className={trade.pnl >= 0 ? "good" : "bad"}>{money(trade.pnl)}</td>
                <td className={trade.pnl >= 0 ? "good" : "bad"}>{percent(trade.pnl_pct)}</td>
                <td>{money(trade.fees)}</td>
                <td>{trade.bars_held}</td>
                <td>{trade.exit_reason.replaceAll("_", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Data and execution assumptions</h3>
      <ul className="plain muted">
        <li>
          Source: {data.source}, {data.candle_count.toLocaleString()} candles from {data.start?.slice(0, 16).replace("T", " ")} to{" "}
          {data.end?.slice(0, 16).replace("T", " ")} UTC.
        </li>
        <li>Prices: {data.adjustment}</li>
        <li>Volume: {data.volume_type}</li>
        {data.limitations?.map((line) => <li key={line}>{line}</li>)}
        {run.assumptions.map((line) => <li key={line}>{line}</li>)}
      </ul>
    </section>
  );
}
