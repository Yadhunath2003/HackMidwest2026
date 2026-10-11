import { cn } from "@/lib/utils";
import { Badge } from "./Badge";
import { Notice } from "./Notice";

export interface EvidenceGroup {
  title: string;
  rows: [string, string][];
  /** "judgment" groups are the model's saved reading, not a measurement: dashed frame, Model judgment badge. */
  kind?: "recorded" | "judgment";
  note?: string;
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1.5 text-[13px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="break-words font-mono">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Trade Detective's answer. Recorded facts, the model's saved judgments and the AI hypotheses are kept visibly apart.
 * When the AI call fails, every Recorded group stays and a warning replaces the hypotheses.
 */
export function EvidencePanel({ heading, summary, groups, facts, hypotheses, testableChange, disclaimer, source, aiError, children }: {
  heading: string; summary?: string; groups: EvidenceGroup[]; facts?: string[]; hypotheses?: string[];
  testableChange?: string | null; disclaimer?: string; source?: string; aiError?: string | null; children?: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <p className="font-mono text-xs text-muted-foreground">{heading}</p>
      {summary && !aiError ? <p className="font-serif text-base leading-[26px]">{summary}</p> : null}

      {facts && facts.length > 0 ? (
        <section className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Badge tone="brand">Recorded</Badge>What the record shows</h4>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">{facts.map((f) => <li key={f}>{f}</li>)}</ul>
        </section>
      ) : null}

      {groups.map((g) => g.kind === "judgment" ? (
        <section key={g.title} className="space-y-2 rounded-xl border border-dashed border-warning/60 p-3">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Badge tone="warning">Model judgment</Badge>{g.title}</h4>
          <Rows rows={g.rows} />
          {g.note ? <p className="text-xs text-muted-foreground">{g.note}</p> : null}
        </section>
      ) : (
        <section key={g.title} className="space-y-2">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Badge tone="brand">Recorded</Badge>{g.title}</h4>
          <Rows rows={g.rows} />
        </section>
      ))}

      {children}

      {aiError ? (
        <Notice tone="warning" title="AI explanation unavailable">{aiError} The recorded facts above are unaffected.</Notice>
      ) : hypotheses && hypotheses.length > 0 ? (
        <section className={cn("space-y-2 rounded-xl border border-dashed border-warning p-3")}>
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Badge tone="warning">Hypothesis</Badge>About market conditions, unverified</h4>
          <ul className="list-disc space-y-1 pl-5 text-[13px]">{hypotheses.map((h) => <li key={h}>{h}</li>)}</ul>
        </section>
      ) : null}

      {testableChange && !aiError ? (
        <section>
          <h4 className="mb-1 text-sm font-semibold">Something you could test next</h4>
          <p className="text-sm">{testableChange}</p>
        </section>
      ) : null}

      {disclaimer ? (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {disclaimer}{source ? <Badge mono>{source}</Badge> : null}
        </p>
      ) : null}
    </div>
  );
}
