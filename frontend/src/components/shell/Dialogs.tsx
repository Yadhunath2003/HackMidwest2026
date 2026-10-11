"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ApiError, api } from "@/lib/api";
import { shortId, symbolName } from "@/lib/format";
import type { BacktestRun } from "@/lib/types";
import { Field } from "@/components/sl/Field";
import { Notice } from "@/components/sl/Notice";

/** Wording for the expected failures, from docs/Data-display.md. The server's own message is kept for 409s. */
export function deleteRunError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return "This backtest no longer exists. It may already have been deleted.";
    return e.message;
  }
  return "Can't reach the server. Is the backend running?";
}

/** Delete a completed backtest result. Cached market data and AI judgments remain. */
export function DeleteRunDialog({ runId, onOpenChange, onDeleted }: { runId: string | null; onOpenChange: (open: boolean) => void; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); setBusy(false); }, [runId]);

  async function confirm() {
    if (!runId) return;
    setBusy(true); setError(null);
    try {
      await api.deleteRun(runId);
      onDeleted(runId);
      onOpenChange(false);
    } catch (e) {
      const missing = e instanceof ApiError && e.status === 404;
      setError(deleteRunError(e));
      if (missing) onDeleted(runId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertDialog open={runId != null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete result{runId ? ` run ${shortId(runId)}` : ""}?</AlertDialogTitle>
          <AlertDialogDescription>Cached market data and AI judgments will remain. This can&apos;t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <Notice tone="error" title="Couldn't delete">{error}</Notice> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <Button variant="destructive" size="lg" disabled={busy} onClick={() => void confirm()}>
            {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}Delete result
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Save the strategy of a completed run so it can be followed on Paper signals. */
export function SaveStrategyDialog({ run, open, onOpenChange, onSaved }: { run: BacktestRun | null; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const defaultName = run ? `${symbolName(run.strategy.symbol)} ${run.strategy.timeframe} strategy` : "";
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (open) { setName(defaultName); setError(null); setSaved(false); } }, [open, defaultName]);

  async function save() {
    if (!run) return;
    setBusy(true); setError(null);
    try {
      await api.saveStrategy(run.id, name.trim());
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? "This backtest no longer exists, so its strategy can't be saved." : e instanceof ApiError ? e.message : "Can't reach the server. Is the backend running?");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Save strategy</DialogTitle>
          <DialogDescription>Keep the rules from this backtest so you can follow them on Paper signals.</DialogDescription>
        </DialogHeader>
        {saved ? (
          <Notice tone="info" title="Saved">Strategy saved. Select it on Paper signals.</Notice>
        ) : (
          <form id="save-strategy" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void save(); }}>
            <Field label="Strategy name" value={name} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} error={error} />
          </form>
        )}
        <DialogFooter>
          {saved ? (
            <Button size="lg" onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
              <Button size="lg" type="submit" form="save-strategy" disabled={busy || !name.trim()}>
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}Save strategy
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
