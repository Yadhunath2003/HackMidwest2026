"use client";

import { Loader2, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError, api, formatTime, money } from "@/lib/api";
import { quantityUnit, shortId, signedMoney, signedPercent, symbolName } from "@/lib/format";
import type { BacktestRun, Explanation, Trade } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { EvidencePanel, type EvidenceGroup } from "@/components/sl/EvidencePanel";
import { FillsTable } from "@/components/sl/FillsTable";
import { Field } from "@/components/sl/Field";
import { Notice } from "@/components/sl/Notice";

const ratio = (value: number | null) => (value == null ? "unavailable" : `${(value * 100).toFixed(1)}%`);

/** Snapshot rows for one trade, grouped: Signal, Pattern / Reference, AI trend at entry, Execution, Costs. */
function groupsFor(run: BacktestRun, trade: Trade): EvidenceGroup[] {
  const s = trade.entry_evidence;
  const unit = quantityUnit(run.strategy.symbol).toLowerCase();
  const groups: EvidenceGroup[] = [];

  groups.push({
    title: "Signal",
    rows: [
      ["Signal candle (UTC)", formatTime(s.candle.time)],
      ["Candle OHLC", `${s.candle.open} / ${s.candle.high} / ${s.candle.low} / ${s.candle.close}`],
      ["Shape", `${s.direction}, body ${ratio(s.body_to_range)}, upper wick ${ratio(s.upper_wick_to_range)}, lower wick ${ratio(s.lower_wick_to_range)}`],
      ["Raw volume", s.candle.volume?.toLocaleString() ?? "Unavailable"],
      ["Relative volume", s.relative_volume == null ? "unavailable" : `${s.relative_volume.toFixed(2)}× (previous ${s.relative_volume_lookback})`],
      ["Fast / slow average", s.fast_ma == null ? "not used" : `${s.fast_ma} / ${s.slow_ma}`],
      ["RSI", s.rsi == null ? "not used" : String(s.rsi)],
    ],
  });

  const pattern: [string, string][] = [];
  if (s.pattern) {
    pattern.push(["Rally / pullback", `${s.pattern.rally_min_candles}+ green, then ${s.pattern.pullback_candles} red`]);
    pattern.push(["Breakout", `${s.pattern.breakout_by} ${s.pattern.breakout_value} above first red high ${s.pattern.first_red_high} (${formatTime(s.pattern.first_red_time)} UTC)`]);
  }
  if (s.reference_breakout) {
    const r = s.reference_breakout;
    pattern.push(["Marked red candle (UTC)", formatTime(r.time)]);
    pattern.push(["Marked high / low", `${r.high} / ${r.low}`]);
    pattern.push(["Reference volume", `${r.relative_volume.toFixed(2)}×`]);
    pattern.push(["Planned stop risk / budget", `${money(trade.planned_stop_loss ?? 0)} / ${money(trade.risk_budget ?? 0)}`]);
    pattern.push(["Net account-profit target", money(trade.target_account_profit ?? 0)]);
  }
  if (pattern.length > 0) groups.push({ title: s.reference_breakout ? "Reference" : "Pattern", rows: pattern });

  const trend = s.ai_trend ?? s.reference_breakout?.ai_trend ?? null;
  if (trend) {
    groups.push({
      title: "AI trend at entry",
      kind: "judgment",
      rows: [
        ["Trend", `${trend.direction}, confidence ${Math.round(trend.confidence * 100)}%`],
        ["Reasoning", trend.reason],
        ["Inferred start (UTC)", trend.start_time == null ? "Unavailable" : formatTime(trend.start_time)],
      ],
      note: "Saved with the run when it executed. A model's reading of the chart, not a measured fact.",
    });
  }

  groups.push({
    title: "Execution",
    rows: [
      ["Entry (UTC)", `${formatTime(trade.entry_time)} at ${trade.entry_price} · ${trade.shares} ${unit} (${money(trade.position_value)})`],
      ["Stop / target", `${trade.stop_price} / ${trade.target_price}`],
      ["Exit (UTC)", `${formatTime(trade.exit_time)} at ${trade.exit_price}`],
      ["Exit trigger", trade.exit_evidence.trigger],
      ["Realized P&L", `${signedMoney(trade.pnl)} (${signedPercent(trade.pnl_pct)})`],
    ],
  });
  groups.push({ title: "Costs", rows: [["Costs", `${money(trade.fees)} commission, ${money(trade.slippage_cost)} slippage`]] });
  return groups;
}

/** Trade Detective: the recorded evidence for one trade, plus the AI's explanation on request. */
export function DetectiveTab({ run, trade }: { run: BacktestRun; trade: Trade | null }) {
  const defaultQuestion = trade && trade.pnl < 0 ? "Why did this trade lose money?" : "Why did this trade make money?";
  const [question, setQuestion] = useState(defaultQuestion);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQuestion(defaultQuestion); setExplanation(null); setError(null);
  }, [run.id, trade?.id, defaultQuestion]);

  if (!trade) {
    return <Notice tone="info" title="Pick a trade">Select a trade in the table, the chart toolbar or on the chart to see the recorded evidence behind it.</Notice>;
  }

  async function ask() {
    if (!trade) return;
    setLoading(true); setError(null);
    try {
      setExplanation(await api.explainTrade(run.id, trade.id, question));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const aiError = explanation?.source === "error" ? explanation.summary : null;

  return (
    <div className="space-y-5">
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <Field className="min-w-[260px] flex-1" label="Question" value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
        <Button type="submit" size="lg" disabled={loading || !question.trim()}>
          {loading ? <Loader2 aria-hidden className="animate-spin" /> : <Search aria-hidden />}
          {loading ? "Investigating…" : "Ask Trade Detective"}
        </Button>
      </form>
      {error ? <Notice tone="error" title="Couldn't ask">{error}</Notice> : null}

      <EvidencePanel
        heading={`run ${shortId(run.id)} · trade #${trade.id} · ${symbolName(run.strategy.symbol)}`}
        summary={explanation?.summary}
        groups={groupsFor(run, trade)}
        facts={explanation && !aiError ? explanation.known_facts : undefined}
        hypotheses={explanation?.hypotheses}
        testableChange={explanation?.testable_change}
        disclaimer={explanation?.disclaimer}
        source={explanation?.source}
        aiError={aiError}
      >
        {trade.exits && trade.exits.length > 1 ? <FillsTable fills={trade.exits} symbol={run.strategy.symbol} skipped={trade.partial_exit_skipped} /> : null}
      </EvidencePanel>
    </div>
  );
}
