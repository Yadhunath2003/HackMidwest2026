"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, api } from "@/lib/api";
import type { FeedStatus, PaperSession, SavedStrategy } from "@/lib/types";
import { LiveChart } from "@/components/paper/LiveChart";
import { PaperSessionPanel, SessionBadge } from "@/components/paper/PaperSessionPanel";
import { Notice } from "@/components/sl/Notice";
import { SignalTable } from "@/components/sl/SignalTable";
import { AppShell, ShellProvider, useShell } from "@/components/shell/AppShell";
import { DeleteStrategyDialog } from "@/components/shell/Dialogs";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;
const NETWORK = "Can't reach the server. Is the backend running?";

type Feeds = { stocks: FeedStatus; gold: FeedStatus; crypto: FeedStatus };

/** "just now", "3s ago", "2m ago": the only sign that the page is polling. No spinner. */
function agoText(from: number | null, now: number): string {
  if (from == null) return "waiting";
  const s = Math.max(0, Math.round((now - from) / 1000));
  return s < 2 ? "just now" : s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

function PaperScreen() {
  const shell = useShell();
  const router = useRouter();
  const params = useSearchParams();
  const wanted = params.get("strategy");

  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [sessions, setSessions] = useState<PaperSession[]>([]);
  const [feeds, setFeeds] = useState<Feeds | null>(null);
  const [selected, setSelected] = useState("");
  const [inspected, setInspected] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [mobileTab, setMobileTab] = useState("session");
  const [deleting, setDeleting] = useState<SavedStrategy | null>(null);

  const refresh = useCallback(async () => {
    const [strategies, records, providers] = await Promise.all([api.savedStrategies(), api.paperSessions(), api.paperFeeds()]);
    setSaved(strategies); setSessions(records); setFeeds(providers); setLoaded(true); setFetchedAt(Date.now());
    setSelected((current) => {
      if (strategies.some((s) => s.id === current)) return current;
      // Nothing chosen yet: the running session's strategy, then the one linked from the sidebar, then the first.
      const running = records.find((r) => r.status === "running")?.strategy_id;
      return strategies.find((s) => s.id === wanted)?.id ?? strategies.find((s) => s.id === running)?.id ?? strategies[0]?.id ?? "";
    });
  }, [wanted]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try { await refresh(); if (!disposed) setError(null); }
      catch (e) { if (!disposed) setError(e instanceof ApiError ? e.message : NETWORK); }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => { disposed = true; clearInterval(timer); };
  }, [refresh]);

  // Tick once a second so "Updated Ns ago" stays true between polls.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // A link from the sidebar (?strategy=) selects that saved strategy.
  useEffect(() => { if (wanted && saved.some((s) => s.id === wanted)) setSelected(wanted); }, [wanted, saved]);

  async function act(task: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await task(); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : NETWORK); }
    finally { setBusy(false); }
  }

  const choice = saved.find((s) => s.id === selected) ?? null;
  const feed = feeds && choice ? (choice.strategy.symbol === "BTCUSD" ? feeds.crypto : choice.strategy.symbol === "XAUUSD" ? feeds.gold : feeds.stocks) : null;
  const active = sessions.find((s) => s.status === "running") ?? null;
  const session = sessions.find((s) => s.id === inspected) ?? active ?? sessions[0] ?? null;
  const ago = useMemo(() => agoText(fetchedAt, now), [fetchedAt, now]);

  return (
    <AppShell screen="paper" section="Paper signals" title={session?.name ?? choice?.name}
      badges={session ? <SessionBadge status={session.status} /> : undefined}>
      <div className="flex h-full min-h-0 flex-col">
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="border-b px-3 py-2 min-[960px]:hidden">
          <TabsList className="w-full">
            <TabsTrigger value="session">Session</TabsTrigger>
            <TabsTrigger value="chart" disabled={!session}>Chart</TabsTrigger>
            <TabsTrigger value="signals" disabled={!session}>Signals</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-h-0 flex-1 min-[960px]:grid min-[960px]:grid-cols-[40%_60%]">
          <div className={cn("min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 min-[960px]:border-r", mobileTab !== "session" && "max-[959px]:hidden")}>
            {error ? <Notice tone="error" title="Problem">{error}</Notice> : null}
            <PaperSessionPanel loaded={loaded} saved={saved} selectedId={selected} onSelectStrategy={setSelected} feed={feed}
              session={session} sessions={sessions} onSelectSession={setInspected} activeSession={active} updatedAgo={ago} busy={busy}
              onStart={() => void act(async () => { const created = await api.startPaper(selected); setInspected(created.id); })}
              onStop={() => session && void act(() => api.stopPaper(session.id))}
              onDelete={() => choice && setDeleting(choice)} onGoBacktest={() => router.push("/")} />
          </div>
          <div className={cn("min-h-0 min-w-0 flex-1 space-y-5 overflow-y-auto p-4", mobileTab === "session" && "max-[959px]:hidden")}>
            {session ? (
              <>
                <div className={cn(mobileTab === "signals" && "max-[959px]:hidden")}><LiveChart session={session} /></div>
                <div className={cn(mobileTab === "chart" && "max-[959px]:hidden")}><SignalTable signals={session.signals} symbol={session.strategy.symbol} /></div>
              </>
            ) : (
              <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                Start paper signals to see the live chart and signals here.
              </div>
            )}
          </div>
        </div>
      </div>

      <DeleteStrategyDialog strategy={deleting} onOpenChange={(open) => !open && setDeleting(null)}
        onDeleted={() => { void refresh(); shell.reload(); }} />
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShellProvider>
        <PaperScreen />
      </ShellProvider>
    </Suspense>
  );
}
