"use client";

import { Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RuleSection } from "@/lib/format";
import { Badge } from "@/components/sl/Badge";
import { Notice } from "@/components/sl/Notice";

export type DraftStatus = "validating" | "valid" | "invalid";

const STATUS: Record<DraftStatus, { tone: "secondary" | "positive" | "negative"; label: string }> = {
  validating: { tone: "secondary", label: "Validating…" },
  valid: { tone: "positive", label: "Valid" },
  invalid: { tone: "negative", label: "Invalid" },
};

/**
 * The current draft as plain rules or JSON, with the live validation badge and Run backtest.
 * There is no approval step: the badge mirrors the server's validation as the draft changes.
 */
export function StrategyDraftCard({ status, sections, jsonText, onJsonChange, jsonError, issues, assumptions, running, disabled, onRun, onEdit }: {
  status: DraftStatus; sections: RuleSection[]; jsonText: string; onJsonChange: (text: string) => void; jsonError: string | null;
  issues: string[]; assumptions: string[]; running: boolean; disabled: boolean; onRun: () => void; onEdit: () => void;
}) {
  const s = STATUS[status];
  const blocked = status !== "valid" || Boolean(jsonError);

  return (
    <div className="overflow-hidden rounded-xl border bg-background" aria-busy={running}>
      <Tabs defaultValue="rules" className="gap-0">
        <div className="flex items-center gap-2 px-3.5 py-3">
          <h3 className="text-sm font-semibold">Strategy draft</h3>
          <Badge tone={s.tone} dot={status !== "validating"}>{s.label}</Badge>
          <TabsList className="ml-auto">
            <TabsTrigger value="rules">Rules</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="rules" className="border-t px-3.5 py-3">
          <div className="space-y-3.5">
            {sections.map((section) => (
              <section key={section.title}>
                <h4 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{section.title}</h4>
                <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] gap-x-4 gap-y-1.5 text-[13px] leading-[18px]">
                  {section.rows.map(([label, value]) => (
                    <div key={label} className="contents">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="break-words font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="json" className="border-t px-3.5 py-3">
          <textarea aria-label="Strategy JSON" spellCheck={false} rows={16} value={jsonText} disabled={disabled}
            onChange={(e) => onJsonChange(e.target.value)}
            className="w-full resize-y rounded-md border border-input bg-transparent p-2.5 font-mono text-xs leading-5 outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60" />
          <p className="mt-1.5 text-xs text-muted-foreground">Structured rules only. The server validates this against a strict schema; no code is executed.</p>
        </TabsContent>

        {jsonError || issues.length > 0 || assumptions.length > 0 ? (
          <div className="space-y-2 border-t px-3.5 py-3">
            {jsonError ? <Notice tone="error" title="JSON">The text can&apos;t be read yet: {jsonError}. The last readable draft is shown in Rules.</Notice> : null}
            {issues.length > 0 ? <Notice tone="error" title="Fix before running" items={issues} /> : null}
            {assumptions.length > 0 && issues.length === 0 ? <Notice tone="warning" title="Assumptions" items={assumptions} /> : null}
          </div>
        ) : null}

        <footer className="flex items-center gap-2 border-t px-3.5 py-2.5">
          <span className="mr-auto text-xs text-muted-foreground">{status === "validating" ? "Checking with the server…" : "Checked by the server"}</span>
          <Button variant="ghost" size="lg" onClick={onEdit} disabled={disabled}><Pencil aria-hidden />Edit rules</Button>
          <Button size="lg" onClick={onRun} disabled={blocked || disabled}
            title={blocked ? (issues.length > 0 ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to fix` : undefined) : undefined}>
            {running ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {running ? "Running…" : "Run backtest"}
          </Button>
        </footer>
      </Tabs>
    </div>
  );
}
