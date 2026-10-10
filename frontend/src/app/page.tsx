"use client";

import { useEffect, useState } from "react";
import ReliabilityReport from "@/components/ReliabilityReport";
import Results from "@/components/Results";
import StrategyBuilder from "@/components/StrategyBuilder";
import TradeDetective from "@/components/TradeDetective";
import { ApiError, api } from "@/lib/api";
import type { BacktestRun, ExecutionSettings, GenerateResponse, Strategy, Trade, ValidateResponse } from "@/lib/types";

const SAMPLE_PROMPTS = [
  "Buy AAPL when EMA(9) crosses above EMA(21), provided RSI(14) is below 70; use a 2% stop loss and 4% take profit.",
  "On AAPL 5-minute candles, buy after a bullish momentum candle with body at least 70% of its high-low range, upper wick at most 15%, and volume at least twice the average of the preceding 20 candles. Enter on the next candle, risk 1% with a 2% target.",
  "On SPY daily candles, buy when SMA(20) crosses above SMA(50). 5% stop loss, 10% take profit.",
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
  // One strategy definition; Simple Mode edits the object and Advanced Mode edits its JSON text.
  const [strategy, setStrategy] = useState<Strategy>(DEFAULT_STRATEGY);
  const [jsonText, setJsonText] = useState(stringify(DEFAULT_STRATEGY));
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionSettings>({ commission_per_order_usd: 1, slippage_bps: 2 });

  const [generated, setGenerated] = useState<GenerateResponse | null>(null);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [run, setRun] = useState<BacktestRun | null>(null);
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null);
  const [busy, setBusy] = useState<"generate" | "backtest" | null>(null);
  const [error, setError] = useState<{ message: string; issues: string[] } | null>(null);

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
      const result = await api.generate({ prompt });
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
    setError(null);
    try {
      const result = await api.runBacktest(strategy, execution);
      setRun(result);
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
      </header>

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
        <h2>2. Review and edit the rules</h2>
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
        {error && (
          <div className="notice error">
            {error.message}
            {error.issues.length > 0 && <ul>{error.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
          </div>
        )}
      </section>

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
