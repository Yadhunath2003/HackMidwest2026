"use client";

import { Loader2, Play, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatTime, money } from "@/lib/api";
import { ENTRY_LABELS, quantityUnit, symbolName } from "@/lib/format";
import type { FeedStatus, PaperSession, SavedStrategy } from "@/lib/types";
import { Badge } from "@/components/sl/Badge";
import { Field } from "@/components/sl/Field";
import { MetricCard } from "@/components/sl/MetricCard";
import { Notice } from "@/components/sl/Notice";

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm" aria-label={title}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <div className="ml-auto flex items-center gap-2">{aside}</div>
      </header>
      {children}
    </section>
  );
}

/** Status in words: Monitoring (brand dot) or Stopped (gray). Announced politely. */
export function SessionBadge({ status }: { status: PaperSession["status"] }) {
  return (
    <span role="status">
      <Badge tone={status === "running" ? "brand" : "secondary"} dot>{status === "running" ? "Monitoring" : "Stopped"}</Badge>
    </span>
  );
}

/**
 * The left column of Paper signals: saved-strategy picker, feed status, the session and its virtual position.
 * Every label says paper or virtual; nothing here reads like real trading.
 */
export function PaperSessionPanel({ loaded, saved, selectedId, onSelectStrategy, feed, session, sessions, onSelectSession, activeSession, updatedAgo, busy, onStart, onStop, onDelete, onGoBacktest }: {
  loaded: boolean; saved: SavedStrategy[]; selectedId: string; onSelectStrategy: (id: string) => void; feed: FeedStatus | null;
  session: PaperSession | null; sessions: PaperSession[]; onSelectSession: (id: string) => void; activeSession: PaperSession | null;
  updatedAgo: string; busy: boolean; onStart: () => void; onStop: () => void; onDelete: () => void; onGoBacktest: () => void;
}) {
  const choice = saved.find((s) => s.id === selectedId) ?? null;
  const symbol = choice?.strategy.symbol ?? "";
  const startBlocked = !choice || Boolean(activeSession) || (feed != null && !feed.configured);
  const reason = !choice ? "" : activeSession ? "One session can run at a time." : feed && !feed.configured ? "Feed setup needed." : "";
  const unit = session ? (session.strategy.symbol === "BTCUSD" ? "BTC" : quantityUnit(session.strategy.symbol).toLowerCase()) : "";

  if (!loaded) return <p className="p-1 text-sm text-muted-foreground">Loading saved strategies…</p>;

  return (
    <div className="space-y-4">
      {saved.length === 0 ? (
        <Card title="Saved strategy">
          <div className="space-y-3 p-4">
            <p className="text-sm text-muted-foreground">No saved strategies yet. Complete a backtest and save its strategy.</p>
            <Button variant="outline" size="lg" onClick={onGoBacktest}>Go to Backtest</Button>
          </div>
        </Card>
      ) : (
        <Card title="Saved strategy" aside={choice ? <Badge mono>{symbolName(choice.strategy.symbol)} &middot; {choice.strategy.timeframe}</Badge> : null}>
          <div className="space-y-3 p-4">
            <Field as="select" label="Strategy" value={selectedId} onChange={(e) => onSelectStrategy(e.target.value)}
              options={saved.map((s) => ({ value: s.id, label: `${s.name} · ${symbolName(s.strategy.symbol)} · ${s.strategy.timeframe}` }))} />
            {choice ? (
              <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-muted-foreground">Virtual equity</dt><dd className="font-mono">{money(choice.strategy.initial_capital)}</dd>
                <dt className="text-muted-foreground">Entry rule</dt><dd className="font-mono">{ENTRY_LABELS[choice.strategy.entry.type as keyof typeof ENTRY_LABELS] ?? choice.strategy.entry.type}</dd>
              </dl>
            ) : null}
            {feed ? (
              feed.configured ? (
                <Notice tone="info" title={feed.provider}>{feed.notice}</Notice>
              ) : (
                <Notice tone="warning" title="Feed setup needed">
                  {feed.notice} Add {feed.required.join(" and ")} to backend/.env, then restart the backend.
                </Notice>
              )
            ) : null}
            {activeSession ? <Notice tone="warning" title="One at a time">A session is already running for {activeSession.name}. Stop it before starting another.</Notice> : null}
          </div>
          <footer className="flex flex-wrap items-center gap-2 border-t px-4 py-3">
            <Button variant="ghost" size="lg" onClick={onDelete} disabled={busy || !choice}><Trash2 aria-hidden />Delete saved strategy</Button>
            <Button size="lg" className="ml-auto" onClick={onStart} disabled={busy || startBlocked}>
              {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Play aria-hidden />}
              Start {symbol ? symbolName(symbol) : ""} paper signals
            </Button>
            {reason ? <p className="w-full text-right text-xs text-muted-foreground">{reason}</p> : null}
          </footer>
        </Card>
      )}

      {session ? (
        <Card title="Paper session" aside={
          <>
            <SessionBadge status={session.status} />
            {session.status === "running" ? <Button variant="outline" size="lg" onClick={onStop} disabled={busy}><Square aria-hidden />Stop signals</Button> : null}
          </>
        }>
          <div className="space-y-3 p-4">
            {sessions.length > 1 ? (
              <Field as="select" label="Session" value={session.id} onChange={(e) => onSelectSession(e.target.value)}
                options={sessions.map((s) => ({ value: s.id, label: `${s.name} · ${s.status === "running" ? "Monitoring" : "Stopped"}` }))} />
            ) : null}
            <p className="font-serif text-base leading-[26px]">{session.message}</p>
            <p className="font-mono text-xs text-muted-foreground">
              Last completed candle {session.last_candle ? `${formatTime(session.last_candle)} UTC` : "waiting"} &middot; Updated {updatedAgo}
            </p>
            {session.error ? <Notice tone="error" title="Feed error">{session.error}</Notice> : null}
            {session.position ? (
              <div className="grid grid-cols-3 gap-2.5">
                <MetricCard size="sm" prefix="$" value={session.position.entry_price.toFixed(2)} label="Paper entry" context={`${session.position.quantity} ${unit}`} />
                <MetricCard size="sm" prefix="$" value={session.position.stop.toFixed(2)} label="Stop" />
                <MetricCard size="sm" prefix="$" value={session.position.target.toFixed(2)} label="Target" />
              </div>
            ) : (
              <p className="text-[13px] text-muted-foreground">No open virtual position.</p>
            )}
            {session.status === "stopped" ? <p className="text-[13px] text-muted-foreground">Stopping froze this session; no sell signal was issued.</p> : null}
          </div>
        </Card>
      ) : null}

      <ul className="list-disc space-y-1.5 pl-5 text-xs leading-4 text-muted-foreground">
        <li>Provider candles are checked every 15 seconds; entry rules use completed candles only.</li>
        <li>Paper fills and exits may be reported later than their market timestamp. Historical warm-up never creates alerts.</li>
        <li>Virtual positions only. No broker orders are submitted. The app must stay running to monitor prices.</li>
      </ul>
    </div>
  );
}
