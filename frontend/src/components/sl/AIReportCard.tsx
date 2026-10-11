import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AIReport } from "@/lib/types";
import { Badge } from "./Badge";
import { Notice } from "./Notice";

const SECTIONS: [string, keyof Pick<AIReport, "findings" | "limitations" | "next_tests">][] = [
  ["Findings", "findings"],
  ["Limitations", "limitations"],
  ["Experiments to test next", "next_tests"],
];

/**
 * Generate AI report, then loading, then the report or an error. Gray reply style, because it is the model's voice,
 * with a Hypothesis badge: this is interpretation of recorded results, not a measurement.
 */
export function AIReportCard({ report, loading, error, onGenerate }: {
  report?: AIReport | null; loading?: boolean; error?: string | null; onGenerate?: () => void;
}) {
  return (
    <div className="space-y-3">
      {onGenerate ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="lg" onClick={onGenerate} disabled={loading}>
            {loading ? <Loader2 aria-hidden className="animate-spin" /> : <FileText aria-hidden />}
            {loading ? "Analyzing results…" : report ? "Generate again" : "Generate AI report"}
          </Button>
          <p className="text-[13px] text-muted-foreground">The model reads this run&apos;s recorded metrics and trades. Nothing is re-run.</p>
        </div>
      ) : null}

      {error ? (
        <Notice tone="error" title="AI report failed" action={onGenerate ? <Button size="sm" variant="outline" onClick={onGenerate}>Try again</Button> : undefined}>
          {error} The calculated results are unaffected.
        </Notice>
      ) : null}

      {report ? (
        <article className="space-y-4 rounded-2xl bg-reply p-5">
          <header className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Badge tone="warning">Hypothesis</Badge>
            <span>AI interpretation</span>
            <Badge mono className="ml-auto">{report.source}</Badge>
          </header>
          <p className="font-serif text-base leading-[26px]">{report.summary}</p>
          {SECTIONS.map(([title, key]) => report[key].length > 0 ? (
            <section key={key}>
              <h4 className="mb-1 text-sm font-semibold">{title}</h4>
              <ul className="list-disc space-y-1 pl-5 text-sm">{report[key].map((item, i) => <li key={i}>{item}</li>)}</ul>
            </section>
          ) : null)}
          <p className="text-xs text-muted-foreground">AI interpretation of recorded results. Historical simulation, not a prediction.</p>
        </article>
      ) : null}
    </div>
  );
}
