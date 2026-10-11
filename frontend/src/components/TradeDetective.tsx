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
  const short = trade.direction === "short";
  const rows: [string, string][] = [
    ...(signal.reference_breakout ? [
      [short ? "Marked green candle (UTC)" : "Marked red candle (UTC)", formatTime(signal.reference_breakout.time)],
      ["Marked high / low", `${signal.reference_breakout.high} / ${signal.reference_breakout.low}`],
      ["Reference relative volume", `${signal.reference_breakout.relative_volume.toFixed(2)}x`],
      ["Reference trend", `${signal.reference_breakout.ai_trend.direction}: ${signal.reference_breakout.ai_trend.reason}`],
      ["Planned stop risk / budget", `${money(trade.planned_stop_loss ?? 0)} / ${money(trade.risk_budget ?? 0)}`],
      ["Net account-profit target", money(trade.target_account_profit ?? 0)],
    ] as [string, string][] : []),
    ...(signal.ai_trend ? [
      ["AI trend at entry signal", `${signal.ai_trend.direction}, confidence ${(signal.ai_trend.confidence * 100).toFixed(0)}%`],
      ["AI trend reasoning", signal.ai_trend.reason],
      ["Inferred trend start (UTC)", signal.ai_trend.start_time == null ? "Unavailable" : formatTime(signal.ai_trend.start_time)],
    ] as [string, string][] : []),
    ...(signal.pattern ? [
      ["Rally / pullback", short ? `At least ${signal.pattern.rally_min_candles} red candles, then ${signal.pattern.pullback_candles} green candles` : `At least ${signal.pattern.rally_min_candles} green candles, then ${signal.pattern.pullback_candles} red candles`],
      ["Breakout", short ? `${signal.pattern.breakout_by} ${signal.pattern.breakout_value} below first green low ${signal.pattern.first_green_low}` : `${signal.pattern.breakout_by} ${signal.pattern.breakout_value} above first red candle high ${signal.pattern.first_red_high} (${formatTime(signal.pattern.first_red_time ?? 0)} UTC)`],
    ] as [string, string][] : []),
    ["Signal candle (UTC)", formatTime(signal.candle.time)],
    ["Signal candle OHLC", `${signal.candle.open} / ${signal.candle.high} / ${signal.candle.low} / ${signal.candle.close}`],
    ["Shape", `${signal.direction}, body ${ratio(signal.body_to_range)}, upper wick ${ratio(signal.upper_wick_to_range)}, lower wick ${ratio(signal.lower_wick_to_range)}`],
    ["Raw volume", signal.candle.volume?.toLocaleString() ?? "Unavailable"],
    ["Relative volume", signal.relative_volume == null ? "unavailable" : `${signal.relative_volume.toFixed(2)}x (previous ${signal.relative_volume_lookback} candles)`],
    ["Fast / slow average", signal.fast_ma == null ? "not used" : `${signal.fast_ma} / ${signal.slow_ma}`],
    ["RSI", signal.rsi == null ? "not used" : String(signal.rsi)],
    [short ? "Sell short entry (UTC)" : "Buy entry (UTC)", `${formatTime(trade.entry_time)} at ${trade.entry_price}`],
    ["Position", `${trade.shares} ${signal.candle.volume == null ? "troy ounces" : "shares"} (${money(trade.position_value)})`],
    ["Stop / target", `${trade.stop_price} / ${trade.target_price}`],
    [short ? "Buy to cover exit (UTC)" : "Sell exit (UTC)", `${formatTime(trade.exit_time)} at ${trade.exit_price}`],
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
