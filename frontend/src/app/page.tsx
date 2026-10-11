"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import ReliabilityReport from "@/components/ReliabilityReport";
import Results from "@/components/Results";
import StrategyBuilder from "@/components/StrategyBuilder";
import TradeDetective from "@/components/TradeDetective";
import { ApiError, api } from "@/lib/api";
import type { AIUsage, BacktestRun, ExecutionSettings, GenerateResponse, Strategy, Trade, ValidateResponse } from "@/lib/types";

const SAMPLE_PROMPTS = [
  "Buy AAPL when a red candle has at least twice the prior 20 candles' average volume in an AI-detected bearish trend. Mark its high and low. When a green momentum candle closes above that high in an AI-detected bullish trend, buy at the next open. Stop at the marked low, risk at most 1% of account equity, and target a net 2% gain on the account.",
  "Buy AAPL after at least 3 green candles, followed by 1-3 red candles, then a green candle that closes above the high of the first red candle. Use a 2% stop loss and 4% take profit.",
  "Buy AAPL when EMA(9) crosses above EMA(21), provided RSI(14) is below 70; use a 2% stop loss and 4% take profit.",
  "On AAPL 5-minute candles, buy after a bullish momentum candle with body at least 70% of its high-low range, upper wick at most 15%, and volume at least twice the average of the preceding 20 candles. Enter on the next candle, risk 1% with a 2% target.",
  "On SPY daily candles, buy when SMA(20) crosses above SMA(50). 5% stop loss, 10% take profit.",
  "Buy XAUUSD on 1-hour candles after 3 green candles, then 1-3 red candles, then a green candle closing above the first red candle's high. Use a 2% stop loss and 4% take profit.",
];

const DEFAULT_STRATEGY: Strategy = {
  symbol: "AAPL",
  timeframe: "5m",
  entry: { type: "ema_crossover", fast_period: 9, slow_period: 21, rsi_period: 14, rsi_below: 70 },
  stop_loss_pct: 2,
  take_profit_pct: 4,
  exit_on_reverse_crossover: false,
  initial_capital: 10000,
  position_size_usd: 1000,
};

const stringify = (value: unknown) => JSON.stringify(value, null, 2);

export default function Home() {
  const [prompt, setPrompt] = useState(SAMPLE_PROMPTS[0]);
  // One strategy definition; Simple Mode displays it and Advanced Mode edits its JSON text.
  const [strategy, setStrategy] = useState<Strategy>(DEFAULT_STRATEGY);
  const [jsonText, setJsonText] = useState(stringify(DEFAULT_STRATEGY));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionSettings>({ commission_per_order_usd: 1, slippage_bps: 2 });

  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [busy, setBusy] = useState<"generate" | "backtest" | null>(null);
  const [aiUsage, setAIUsage] = useState<AIUsage | null>(null);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);
  const [savedName, setSavedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [recentRuns, setRecentRuns] = useState<{ id: string; created_at: string; symbol: string; timeframe: string }[]>([]);
  useEffect(() => { api.recentRuns().then(setRecentRuns).catch(() => {}); }, []);

  function updateStrategy(next: Strategy) {
    setStrategy(next);
    setJsonText(stringify(next));
    setJsonError(null);
  }

  function updateJson(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || parsed === null || typeof parsed.entry !== "object" || parsed.entry === null) {
        throw new Error('expected an object with an "entry" object');
      }
      setStrategy(parsed);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  }

  // Server-side validation is the source of truth; re-check shortly after every edit.
  useEffect(() => {
    let stale = false;
    const timer = setTimeout(() => {
      api.validate(strategy).then(
        (result) => !stale && setValidation(result),
        () => !stale && setValidation(null),
      );
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [strategy]);

  function fail(e: unknown) {
    setError(e instanceof ApiError ? { message: e.message, issues: e.issues } : { message: "Something went wrong.", issues: [] });
  }

  async function generate() {
    setBusy("generate");
    setError(null);
    try {
      const result = await api.generate({ prompt, symbol: strategy.symbol, timeframe: strategy.timeframe, initial_capital: strategy.initial_capital });
      setGenerated(result);
      if (result.strategy) updateStrategy(result.strategy);
      else if (result.draft) setJsonText(stringify(result.draft));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  async function backtest() {
    setBusy("backtest");
    setAIUsage(null);
    setError(null);
    try {
      const result = await api.runBacktest(strategy, execution, setAIUsage);
      setRun(result);
      setSavedName(`${result.strategy.symbol} ${result.strategy.timeframe} strategy`);
      setSavedMessage(null);
      api.recentRuns().then(setRecentRuns).catch(() => {});
      setSelectedTrade(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  }

  const canRun = !jsonError && validation?.valid !== false && busy === null;

  return (
    <main>
      <header>
        <h1>StrategyLab AI</h1>
        <p>Describe it. Backtest it. Understand it. Validate it.</p>
        <nav className="row"><Link href="/">Backtesting</Link><Link href="/live">Live paper signals</Link></nav>
      </header>

      {recentRuns.length > 0 && <section className="panel">
        <h2>Previously completed backtests</h2>
        <p>Open a saved result to review it or save its strategy without running the backtest again.</p>
        <select aria-label="Open completed backtest" value={run?.id ?? ""} disabled={busy !== null || saving} onChange={async (e) => {
          if (!e.target.value) return;
          setSaving(true); setError(null);
          try {
            const result = await api.getRun(e.target.value); setRun(result); setSelectedTrade(null);
            setSavedName(`${result.strategy.symbol} ${result.strategy.timeframe} strategy`); setSavedMessage(null);
          } catch (e) { fail(e); } finally { setSaving(false); }
        }}><option value="">Select a completed backtest</option>{recentRuns.map((r) => <option key={r.id} value={r.id}>{r.symbol} · {r.timeframe} · {new Date(r.created_at).toLocaleString()}</option>)}</select>
      </section>}

      <section className="panel">
        <h2>1. Describe your strategy</h2>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={2000} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" onClick={generate} disabled={busy !== null || prompt.trim().length < 3}>
            {busy === "generate" ? "Generating…" : "Generate Strategy"}
          </button>
          {SAMPLE_PROMPTS.map((sample, i) => (
            <button key={sample} onClick={() => setPrompt(sample)}>
              Example {i + 1}
            </button>
          ))}
        </div>

        {generated && (
          <>
            {generated.strategy === null && (
              <div className="notice error">
                No runnable strategy could be generated from that description.
                {generated.issues.length > 0 && (
                  <ul>{generated.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
                )}
              </div>
            )}
            {generated.unsupported.length > 0 && (
              <div className="notice error">
                Not supported, so left out:
                <ul>{generated.unsupported.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            {generated.clarifications.length > 0 && (
              <div className="notice warn">
                Please review these interpretations before running:
                <ul>{generated.clarifications.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <p className="muted">
              Generated by <span className="tag">{generated.source}</span>
            </p>
          </>
        )}
      </section>

      <section className="panel">
        <h2>2. Review the selected rules</h2>
        <StrategyBuilder
          strategy={strategy}
          jsonText={jsonText}
          jsonError={jsonError}
          execution={execution}
          onStrategyChange={updateStrategy}
          onJsonChange={updateJson}
          onExecutionChange={setExecution}
        />

        {validation && !validation.valid && (
          <div className="notice error">
            Fix these before running:
            <ul>{validation.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        )}
        {validation?.valid && (
          <div className="notice">
            Assumptions for this run:
            <ul>{validation.assumptions.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>
        )}

        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={backtest} disabled={!canRun}>
            {busy === "backtest" ? "Running backtest…" : "Run Backtest"}
          </button>
        </div>
        {busy === "backtest" && <p className="muted">AI trend analysis can take several minutes. Keep this page open while the backtest runs.</p>}
        {busy === "backtest" && aiUsage && <p className="muted">
          AI requests: {aiUsage.requests} · Cached checks: {aiUsage.cache_hits} · Reported tokens: {aiUsage.total_tokens.toLocaleString()}
          {aiUsage.unreported_requests > 0 && ` · Awaiting or unavailable usage for ${aiUsage.unreported_requests} requests`}
        </p>}
        {error && (
          <div className="notice error">
            {error.message}
            {error.issues.length > 0 && <ul>{error.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          </div>
        )}
      </section>

      {run && <section className="panel">
        <h2>Keep this strategy?</h2>
        <p>Save the rules from this completed backtest to use on the live paper signals page.</p>
        <div className="row">
          <label>Strategy name<input value={savedName} maxLength={100} onChange={(e) => setSavedName(e.target.value)} /></label>
          <button className="primary" disabled={saving || !savedName.trim()} onClick={async () => {
            setSaving(true); setError(null);
            try { await api.saveStrategy(run.id, savedName); setSavedMessage("Strategy saved. You can select it on the live page."); }
            catch (e) { fail(e); } finally { setSaving(false); }
          }}>Save strategy</button>
          <button disabled={saving} onClick={async () => {
            if (!window.confirm("Delete this completed backtest result? Cached market data and AI judgments will remain.")) return;
            setSaving(true); setError(null);
            try { await api.deleteRun(run.id); setRecentRuns((items) => items.filter((r) => r.id !== run.id)); setRun(null); setSelectedTrade(null); }
            catch (e) { fail(e); } finally { setSaving(false); }
          }}>Delete result</button>
          <Link href="/live">Go to live paper signals →</Link>
        </div>
        {savedMessage && <p className="notice">{savedMessage}</p>}
      </section>}
      {run && <Results run={run} selectedTrade={selectedTrade} onSelectTrade={setSelectedTrade} />}
      {run && selectedTrade && <TradeDetective runId={run.id} trade={selectedTrade} />}
      {run && <ReliabilityReport run={run} />}

      <footer>
        StrategyLab AI is a research tool. Results are historical simulations with stated assumptions, not predictions
        or financial advice. No real orders are placed.
      </footer>
    </main>
  );
}
