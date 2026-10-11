import { formatTime } from "@/lib/api";
import type { TrendAssessment } from "@/lib/types";
import { cn } from "@/lib/utils";
import { NUM, TableWrap, TD, TH } from "./table";

// A neutral glyph, never green or red, so a trend can't be mistaken for a trade result.
const TREND: Record<TrendAssessment["direction"], { glyph: string; word: string }> = {
  bullish: { glyph: "↗", word: "Bullish" },
  bearish: { glyph: "↘", word: "Bearish" },
  sideways: { glyph: "→", word: "Sideways" },
  uncertain: { glyph: "?", word: "Uncertain" },
};

/** The model's trend judgments at candidate entries. Shown only for runs that use AI trend. */
export function TrendTable({ assessments }: { assessments: Record<string, TrendAssessment> }) {
  const rows = Object.entries(assessments).sort(([a], [b]) => Number(a) - Number(b));
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2" aria-labelledby="trend-heading">
      <h3 id="trend-heading" className="text-sm font-semibold">AI trend assessments</h3>
      <p className="text-xs text-muted-foreground">
        Judgments at candidate entries, using completed and past candles only. Confidence is a model judgment, not a probability of profit.
      </p>
      <TableWrap maxHeight={360}>
        <thead>
          <tr>
            <th className={TH}>Candidate (UTC)</th>
            <th className={TH}>Trend</th>
            <th className={cn(TH, "text-right")}>Confidence</th>
            <th className={TH}>Inferred start (UTC)</th>
            <th className={TH}>Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([time, a]) => (
            <tr key={time}>
              <td className={cn(TD, "font-mono")}>{formatTime(Number(time))}</td>
              <td className={TD}><span aria-hidden className="mr-1.5 text-muted-foreground">{TREND[a.direction].glyph}</span>{TREND[a.direction].word}</td>
              <td className={cn(TD, NUM)}>{Math.round(a.confidence * 100)}%</td>
              <td className={cn(TD, "font-mono")}>{a.start_time == null ? "Unavailable" : formatTime(a.start_time)}</td>
              <td className={cn(TD, "min-w-[280px] whitespace-normal")}>{a.reason}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </section>
  );
}
