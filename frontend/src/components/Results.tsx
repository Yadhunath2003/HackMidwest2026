"use client";

import { useMemo, useState } from "react";
import { formatTime, money, percent } from "@/lib/api";
import type { BacktestRun, Metrics, Trade } from "@/lib/types";
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
      {metrics.rejected_trades > 0 && (
        <div className="notice warn">{metrics.rejected_trades} entry signal(s) were rejected (not enough cash or size below one share).</div>
      )}
      {metrics.num_trades === 0 && (
        <div className="notice warn">No trades were triggered in this period. Try loosening the entry conditions.</div>
      )}

      <h3>
        {data.symbol} {data.timeframe} candles · dots are matched signal candles, arrows are fills
      </h3>
      <PriceChart run={run} selectedTrade={selectedTrade} />

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
                  {column.label}
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
