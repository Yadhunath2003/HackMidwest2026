"use client";

import { useEffect, useState } from "react";
import { ApiError, api, formatTime, money, percent } from "@/lib/api";
import type { Explanation, Trade } from "@/lib/types";

const ratio = (value: number | null) => (value == null ? "unavailable" : `${(value * 100).toFixed(1)}%`);

export default function TradeDetective({ runId, trade }: { runId: string; trade: Trade }) {
  const defaultQuestion = trade.pnl < 0 ? "Why did this trade lose money?" : "Why did this trade make money?";
  const [question, setQuestion] = useState(defaultQuestion);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestion(defaultQuestion);
    setExplanation(null);
    setError(null);
  }, [runId, trade.id, defaultQuestion]);

  async function ask() {
    setLoading(true);
    setError(null);
    try {
      setExplanation(await api.explainTrade(runId, trade.id, question));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const signal = trade.entry_evidence;
  const rows: [string, string][] = [
    ["Signal candle (UTC)", formatTime(signal.candle.time)],
    ["Signal candle OHLC", `${signal.candle.open} / ${signal.candle.high} / ${signal.candle.low} / ${signal.candle.close}`],
    ["Shape", `${signal.direction}, body ${ratio(signal.body_to_range)}, upper wick ${ratio(signal.upper_wick_to_range)}, lower wick ${ratio(signal.lower_wick_to_range)}`],
    ["Raw volume", signal.candle.volume.toLocaleString()],
    ["Relative volume", signal.relative_volume == null ? "unavailable" : `${signal.relative_volume.toFixed(2)}x (previous ${signal.relative_volume_lookback} candles)`],
    ["Fast / slow average", signal.fast_ma == null ? "not used" : `${signal.fast_ma} / ${signal.slow_ma}`],
    ["RSI", signal.rsi == null ? "not used" : String(signal.rsi)],
    ["Entry (UTC)", `${formatTime(trade.entry_time)} at ${trade.entry_price}`],
    ["Position", `${trade.shares} shares (${money(trade.position_value)})`],
    ["Stop / target", `${trade.stop_price} / ${trade.target_price}`],
    ["Exit (UTC)", `${formatTime(trade.exit_time)} at ${trade.exit_price}`],
    ["Exit trigger", trade.exit_evidence.trigger],
    ["Realized P&L", `${money(trade.pnl)} (${percent(trade.pnl_pct)})`],
    ["Costs", `${money(trade.fees)} commission, ${money(trade.slippage_cost)} slippage`],
  ];

  return (
    <section className="panel">
      <h2>
        AI Trade Detective · trade #{trade.id}{" "}
        <span className={trade.pnl >= 0 ? "good" : "bad"}>{money(trade.pnl)}</span>
      </h2>

      <div className="table-wrap" style={{ maxHeight: "none" }}>
        <table>
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <td className="muted">{label}</td>
                <td style={{ textAlign: "left", whiteSpace: "normal" }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <label style={{ flex: 1, minWidth: 260 }}>
          Question
          <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={500} />
        </label>
        <button className="primary" onClick={ask} disabled={loading || !question.trim()}>
          {loading ? "Investigating…" : "Ask Trade Detective"}
        </button>
      </div>
      {error && <div className="notice error">{error}</div>}

      {explanation && (
        <>
          <h3>Answer</h3>
          <p>{explanation.summary}</p>

          <h3>Known execution facts (from the recorded backtest)</h3>
          <ul className="plain">
            {explanation.known_facts.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>

          {explanation.hypotheses.length > 0 && (
            <>
              <h3>Hypotheses about market conditions (unverified)</h3>
              <ul className="plain">
                {explanation.hypotheses.map((hypothesis) => <li key={hypothesis}>{hypothesis}</li>)}
              </ul>
            </>
          )}

          {explanation.testable_change && (
            <>
              <h3>Something you could test next</h3>
              <p>{explanation.testable_change}</p>
            </>
          )}
          <p className="muted">
            {explanation.disclaimer} <span className="tag">{explanation.source}</span>
          </p>
        </>
      )}
    </section>
  );
}
