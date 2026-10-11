"use client";

import { Bookmark, ChartCandlestick, Plus, Radio, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { shortId, symbolName } from "@/lib/format";
import type { SavedStrategy } from "@/lib/types";
import { Mark } from "@/components/sl/Chat";
import { cn } from "@/lib/utils";

export interface RunRow { id: string; created_at: string; symbol: string; timeframe: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Runs are shown in UTC: HH:mm for today, "Oct 9" for earlier days. */
function whenText(iso: string, today: boolean): string {
  const d = new Date(iso);
  return today ? `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}` : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const isToday = (iso: string) => new Date(iso).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);

/** Screen links, saved strategies, server runs, and a footer that says what is stored where. */
export function SidebarContent({ screen, runs, saved, activeRunId, onSelectRun, onDeleteRun, onNew, onNavigate }: {
  screen: "backtest" | "paper"; runs: RunRow[]; saved: SavedStrategy[]; activeRunId?: string | null;
  onSelectRun: (id: string) => void; onDeleteRun: (id: string) => void; onNew: () => void; onNavigate?: () => void;
}) {
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K jumps to the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase();
  const filteredRuns = useMemo(() => runs.filter((r) => !q || `${symbolName(r.symbol)} ${r.timeframe} ${r.id}`.toLowerCase().includes(q)), [runs, q]);
  const filteredSaved = useMemo(() => saved.filter((s) => !q || `${s.name} ${s.strategy.symbol} ${s.strategy.timeframe}`.toLowerCase().includes(q)), [saved, q]);
  const today = filteredRuns.filter((r) => isToday(r.created_at));
  const earlier = filteredRuns.filter((r) => !isToday(r.created_at));

  const navLink = (href: string, label: string, Icon: typeof Radio, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined} onClick={onNavigate}
      className={cn("flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-sidebar-accent" : "text-muted-foreground")}>
      <Icon aria-hidden className="size-4" strokeWidth={1.75} />{label}
    </Link>
  );

  const runGroup = (label: string, items: RunRow[]) => items.length === 0 ? null : (
    <div key={label} className="space-y-0.5">
      <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      {items.map((r) => {
        const active = r.id === activeRunId;
        return (
          <div key={r.id} className={cn("group relative flex items-center rounded-md hover:bg-sidebar-accent", active && "bg-sidebar-accent")}>
            {active ? <span aria-hidden className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-brand" /> : null}
            <button type="button" aria-current={active ? "true" : undefined} title={r.id}
              onClick={() => { onSelectRun(r.id); onNavigate?.(); }}
              className="min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="block truncate text-sm font-medium">{symbolName(r.symbol)} &middot; {r.timeframe}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">{whenText(r.created_at, label === "Today")} &middot; run {shortId(r.id)}</span>
            </button>
            <button type="button" aria-label={`Delete run ${shortId(r.id)}`} onClick={() => onDeleteRun(r.id)}
              className="mr-1 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100">
              <Trash2 aria-hidden className="size-3.5" strokeWidth={1.75} />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3"><Mark className="size-7" /><span className="text-sm font-semibold">StrategyLab</span></div>

      <nav aria-label="Screens" className="space-y-0.5 px-2 pb-3">
        {navLink("/", "Backtest", ChartCandlestick, screen === "backtest")}
        {navLink("/live", "Paper signals", Radio, screen === "paper")}
      </nav>

      <div className="space-y-2 border-t px-3 pt-3 pb-1">
        {screen === "backtest" ? (
          <Button variant="outline" size="lg" className="w-full justify-start" onClick={() => { onNew(); onNavigate?.(); }}><Plus aria-hidden />New strategy</Button>
        ) : null}
        <label className="relative block">
          <span className="sr-only">Search runs and saved strategies</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search runs"
            className="h-9 w-full rounded-md border border-input bg-transparent pr-12 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
          <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {filteredSaved.length > 0 ? (
          <div className="space-y-0.5">
            <h3 className="px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground">Saved strategies</h3>
            {filteredSaved.map((s) => (
              <Link key={s.id} href={`/live?strategy=${encodeURIComponent(s.id)}`} onClick={onNavigate}
                className="block rounded-md px-2.5 py-1.5 outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Bookmark aria-hidden className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.75} /><span className="truncate">{s.name}</span></span>
                <span className="block pl-5 text-xs text-muted-foreground">{symbolName(s.strategy.symbol)} &middot; {s.strategy.timeframe}</span>
              </Link>
            ))}
          </div>
        ) : null}
        {runGroup("Today", today)}
        {runGroup("Earlier", earlier)}
        {runs.length === 0 && saved.length === 0 ? <p className="px-2 pt-4 text-[13px] text-muted-foreground">Completed backtests will appear here.</p> : null}
        {(runs.length > 0 || saved.length > 0) && filteredRuns.length === 0 && filteredSaved.length === 0 ? <p className="px-2 pt-4 text-[13px] text-muted-foreground">Nothing matches that search.</p> : null}
      </div>

      <footer className="space-y-1 border-t px-4 py-3 text-xs leading-4 text-muted-foreground">
        <p>Backtests and saved strategies are stored on the server. Drafts and chat stay in this browser.</p>
        <p>Research only &middot; no broker orders</p>
      </footer>
    </div>
  );
}
