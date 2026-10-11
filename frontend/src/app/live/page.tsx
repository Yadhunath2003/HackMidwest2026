"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import LiveChart from "@/components/LiveChart";
import { api, formatTime, money } from "@/lib/api";
import type { FeedStatus, PaperSession, SavedStrategy } from "@/lib/types";

export default function LivePage() {
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [sessions, setSessions] = useState<PaperSession[]>([]);
  const [feeds, setFeeds] = useState<{ stocks: FeedStatus; gold: FeedStatus; crypto: FeedStatus } | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [inspected, setInspected] = useState("");

  async function refresh() {
    const [strategies, records, providers] = await Promise.all([api.savedStrategies(), api.paperSessions(), api.paperFeeds()]);
    setSaved(strategies); setSessions(records); setFeeds(providers); setLoaded(true);
    setSelected((value) => strategies.some((s) => s.id === value) ? value : strategies[0]?.id ?? "");
  }
  useEffect(() => {
    let disposed = false;
    async function poll() {
      if (disposed) return;
      try { await refresh(); setError(null); } catch (e) { if (!disposed) setError((e as Error).message); }
    }
    void poll(); const timer = setInterval(() => void poll(), 5000);
    return () => { disposed = true; clearInterval(timer); };
  }, []);
  async function action(callback: () => Promise<unknown>) {
    setBusy(true); setError(null);
    try { await callback(); await refresh(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const choice = saved.find((s) => s.id === selected);
  const feed = feeds && choice ? (choice.strategy.symbol === "BTCUSD" ? feeds.crypto : choice.strategy.symbol === "XAUUSD" ? feeds.gold : feeds.stocks) : null;
  const active = sessions.find((s) => s.status === "running");
  const session = sessions.find((s) => s.id === inspected) ?? active ?? sessions[0];

  return <main>
    <header><h1>Live paper signals</h1><p>Follow a saved strategy with virtual positions. No broker orders are submitted.</p>
      <nav className="row"><Link href="/">← Backtesting</Link><Link href="/live">Live paper signals</Link></nav>
    </header>
    {error && <div className="notice error" role="alert">{error}</div>}
    <section className="panel">
      <h2>Select a saved strategy</h2>
      {!loaded ? <p>Loading saved strategies…</p> : saved.length === 0 ? <p>No saved strategies yet. Complete a backtest and save its strategy.</p> : <>
        <div className="row">
          <label>Strategy<select value={selected} onChange={(e) => setSelected(e.target.value)}>{saved.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.strategy.symbol} · {s.strategy.timeframe}</option>)}</select></label>
          <button className="primary" disabled={busy || !!active || !choice} onClick={() => void action(async () => { const created = await api.startPaper(selected); setInspected(created.id); })}>{busy ? "Please wait…" : `Start ${choice?.strategy.symbol === "BTCUSD" ? "BTC/USD" : choice?.strategy.symbol ?? "paper"} signals`}</button>
          <button disabled={busy || !choice || active?.strategy_id === selected} onClick={() => {
            if (window.confirm("Delete this saved strategy? Its backtest and prior signal history will remain.")) void action(() => api.deleteStrategy(selected));
          }}>Delete saved strategy</button>
        </div>
        {choice && <p><strong>Selected: {choice.name} · {choice.strategy.symbol} · {choice.strategy.timeframe}</strong><br />Virtual starting equity: {money(choice.strategy.initial_capital)} · {choice.strategy.entry.type.replaceAll("_", " ")}</p>}
        {active && <p className="notice warn">A session is already running for {active.name}. Stop it below before starting another.</p>}
        {feed && <div className={`notice ${feed.configured ? "" : "warn"}`}>
          <strong>{feed.provider}</strong><p>{feed.notice}</p>
          {!feed.configured && <p>Feed setup required: add {feed.required.join(" and ")} to backend/.env, then restart the backend. Keep keys private.</p>}
        </div>}
        <p className="muted">Real-time provider candles are checked every 15 seconds. Entry rules use completed candles; paper fills and exits may be reported later than their market timestamp. Historical warm-up never creates trade alerts. One session can run at a time.</p>
      </>}
    </section>
    {session && <section className="panel">
      <h2>Paper session</h2>
      <div className="row"><label>Session<select value={session.id} onChange={(e) => setInspected(e.target.value)}>{sessions.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.status}</option>)}</select></label>
        {session.status === "running" && <button disabled={busy} onClick={() => void action(() => api.stopPaper(session.id))}>Stop signals</button>}
      </div>
      <p><strong>{session.status === "running" ? "Monitoring" : "Stopped"}</strong> · {session.strategy.symbol} · {session.strategy.timeframe} · {session.feed.provider}</p>
      <p>{session.message}</p>
      <p className="muted">Last completed candle: {session.last_candle ? formatTime(session.last_candle) + " UTC" : "Waiting"} · Last check: {new Date(session.updated_at).toLocaleTimeString()}</p>
      {session.error && <div className="notice error" role="alert">{session.error}</div>}
      <LiveChart session={session} />
      {session.position ? <p>Virtual {session.strategy.direction === "short" ? "short" : "long"} position: {session.position.quantity} {session.strategy.symbol === "BTCUSD" ? "BTC" : session.strategy.symbol === "XAUUSD" ? "ounces" : "shares"} · Entry {money(session.position.entry_price)} · Stop {money(session.position.stop)} · Target {money(session.position.target)}</p> : <p>No open virtual position.</p>}
      <h2 style={{ marginTop: 24 }}>Buy and sell signals</h2>
      {session.signals.length === 0 ? <p className="muted">No signals yet. Waiting for this strategy’s conditions.</p> : <div style={{ overflowX: "auto" }}><table>
        <thead><tr><th>Signal</th><th>Candle time (UTC)</th><th>Detected (UTC)</th><th>Paper price</th><th>Quantity</th><th>Reason</th></tr></thead>
        <tbody>{[...session.signals].reverse().map((signal) => <tr key={signal.id}><td style={{ color: signal.side === "BUY" ? "var(--good)" : "var(--bad)", fontWeight: 700 }}>{signal.direction === "short" ? (signal.action === "entry" ? "SELL SHORT" : "BUY TO COVER") : signal.side}</td><td>{formatTime(signal.time)}</td><td>{signal.detected_at.slice(0, 19).replace("T", " ")}</td><td>{money(signal.price)}</td><td>{signal.quantity}</td><td>{signal.reason}</td></tr>)}</tbody>
      </table></div>}
      <p className="muted">Stopping freezes this session; it does not issue a sell signal. Saved sessions survive a backend restart. This app must remain running to monitor prices.</p>
    </section>}
  </main>;
}
