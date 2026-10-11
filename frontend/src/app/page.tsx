"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AITaskList, { type AITask } from "@/components/ui/ai-task-list";
import { PromptInput } from "@/components/ui/prompt-input";
import { ApiError, api, formatTime } from "@/lib/api";
import { SYMBOL_NAMES, TIMEFRAMES, ruleSections, shortId, signedPercent, symbolName, usageText } from "@/lib/format";
import type { BacktestRun, ExecutionSettings, GenerateResponse, Strategy, Trade, ValidateResponse } from "@/lib/types";
import { DetectiveTab } from "@/components/backtest/DetectiveTab";
import { ReliabilityTab } from "@/components/backtest/ReliabilityTab";
import { ResultsTab } from "@/components/backtest/ResultsTab";
import { StrategyDraftCard, type DraftStatus } from "@/components/backtest/StrategyDraftCard";
import { StrategyEditor } from "@/components/backtest/StrategyEditor";
import { Badge } from "@/components/sl/Badge";
import { ChatMessage, Welcome } from "@/components/sl/Chat";
import { PriceChart } from "@/components/sl/Charts";
import { ChartToolbar } from "@/components/sl/ChartToolbar";
import { ContextPill } from "@/components/sl/ContextPill";
import { Notice } from "@/components/sl/Notice";
import { AppShell, ShellProvider, useShell } from "@/components/shell/AppShell";
import { SaveStrategyDialog } from "@/components/shell/Dialogs";
import { cn } from "@/lib/utils";

const SUGGESTIONS: { title: string; description: string; symbol: Strategy["symbol"]; timeframe: Strategy["timeframe"] }[] = [
  { title: "EMA crossover with RSI", symbol: "AAPL", timeframe: "5m", description: "Buy AAPL when EMA(9) crosses above EMA(21), provided RSI(14) is below 70; use a 2% stop loss and 4% take profit." },
  { title: "Rally, pullback, breakout on gold", symbol: "XAUUSD", timeframe: "1h", description: "Buy XAUUSD on 1-hour candles after 3 green candles, then 1-3 red candles, then a green candle closing above the first red candle's high. Use a 2% stop loss and 4% take profit." },
  { title: "Momentum candle", symbol: "AAPL", timeframe: "5m", description: "On AAPL 5-minute candles, buy after a bullish momentum candle with body at least 70% of its high-low range, upper wick at most 15%, and volume at least twice the average of the preceding 20 candles. Enter on the next candle, risk 1% with a 2% target." },
  { title: "AI reference breakout", symbol: "AAPL", timeframe: "5m", description: "Buy AAPL when a red candle has at least twice the prior 20 candles' average volume in an AI-detected bearish trend. Mark its high and low. When a green momentum candle closes above that high in an AI-detected bullish trend, buy at the next open. Stop at the marked low, risk at most 1% of account equity, and target a net 2% gain on the account." },
];

const DEFAULT_CAPITAL = 10000;
const DEFAULT_EXECUTION: ExecutionSettings = { commission_per_order_usd: 1, slippage_bps: 2 };
const stringify = (value: unknown) => JSON.stringify(value, null, 2);
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const NETWORK = "Can't reach the server. Is the backend running?";

type ThreadItem =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "event"; text: string }
  | { id: string; kind: "result"; text: string }
  | { id: string; kind: "opened"; runId: string }
  | { id: string; kind: "generate"; prompt: string; state: "running" | "done" | "failed"; result?: GenerateResponse; error?: string }
  | { id: string; kind: "run"; tasks: AITask[]; footnote?: boolean; info?: string; error?: { message: string; issues: string[] } };

let counter = 0;
const nextId = () => `t${++counter}`;

function BacktestScreen() {
  const shell = useShell();
  const params = useSearchParams();

  // The composer's context pills. They apply to generation; after generating they follow the draft.
  const [symbol, setSymbol] = useState<Strategy["symbol"]>("AAPL");
  const [timeframe, setTimeframe] = useState<Strategy["timeframe"]>("5m");
  const [prompt, setPrompt] = useState("");

  const [thread, setThread] = useState<ThreadItem[]>([]);
  const [draftHost, setDraftHost] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [execution, setExecution] = useState<ExecutionSettings>(DEFAULT_EXECUTION);
  const [validation, setValidation] = useState<ValidateResponse | null>(null);
  const [validating, setValidating] = useState(false);

  const [run, setRun] = useState<BacktestRun | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState("results");
  const [mobileTab, setMobileTab] = useState("chat");
  const [showVolume, setShowVolume] = useState(true);
  const [hoverVolume, setHoverVolume] = useState<number | null>(null);
  const [fitKey, setFitKey] = useState(0);

  const [busy, setBusy] = useState<"generate" | "run" | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const patch = useCallback((id: string, change: Partial<ThreadItem>) =>
    setThread((items) => items.map((item) => (item.id === id ? ({ ...item, ...change } as ThreadItem) : item))), []);
  const push = useCallback((item: ThreadItem) => setThread((items) => [...items, item]), []);
  const setTask = useCallback((itemId: string, taskId: string, change: Partial<AITask>) =>
    setThread((items) => items.map((item) => item.id === itemId && item.kind === "run"
      ? { ...item, tasks: item.tasks.map((t) => (t.id === taskId ? { ...t, ...change } : t)) } : item)), []);

  // Follow new content while the reader is near the bottom; leave them alone if they scrolled up.
  const nearBottom = useRef(true);
  // Scroll only the thread itself; scrollIntoView would also move the app frame.
  useEffect(() => {
    const el = scroller.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [thread]);

  // A run deleted from the sidebar or top bar disappears from the chart column too.
  const deletedId = shell.deleted?.id;
  useEffect(() => {
    if (deletedId && run?.id === deletedId) { setRun(null); setSelectedId(null); }
  }, [shell.deleted]); // eslint-disable-line react-hooks/exhaustive-deps

  // Draft edits keep the object, its JSON text and the composer pills in step.
  const updateStrategy = useCallback((next: Strategy) => {
    setStrategy(next);
    setJsonText(stringify(next));
    setJsonError(null);
    setSymbol(next.symbol);
    setTimeframe(next.timeframe);
  }, []);

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

  // Validation is live: the server re-checks the draft 350 ms after every edit.
  useEffect(() => {
    if (!strategy) { setValidation(null); setValidating(false); return; }
    let stale = false;
    setValidating(true);
    const timer = setTimeout(() => {
      api.validate(strategy).then(
        (result) => { if (!stale) { setValidation(result); setValidating(false); } },
        () => { if (!stale) { setValidation({ valid: false, strategy: null, issues: [NETWORK], assumptions: [] }); setValidating(false); } },
      );
    }, 350);
    return () => { stale = true; clearTimeout(timer); };
  }, [strategy]);

  const draftStatus: DraftStatus = validating ? "validating" : validation?.valid ? "valid" : "invalid";

  async function generate(text: string, retry = false) {
    if (busy) return;
    nearBottom.current = true;
    if (!retry) push({ id: nextId(), kind: "user", text });
    const id = nextId();
    push({ id, kind: "generate", prompt: text, state: "running" });
    setBusy("generate");
    setMobileTab("chat");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const result = await api.generate({ prompt: text, symbol, timeframe, initial_capital: strategy?.initial_capital ?? DEFAULT_CAPITAL }, controller.signal);
      patch(id, { state: "done", result });
      if (result.strategy) {
        updateStrategy(result.strategy);
        setDraftHost(id);
      } else if (result.draft) {
        // Not runnable yet: keep the raw draft visible so it can be fixed in the JSON tab.
        setJsonText(stringify(result.draft));
      }
    } catch (e) {
      patch(id, { state: "failed", error: isAbort(e) ? "Stopped before the rules came back." : e instanceof ApiError ? e.message : NETWORK });
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  async function execute() {
    if (!strategy || busy) return;
    nearBottom.current = true;
    const id = nextId();
    const usesAI = Boolean(strategy.entry.ai_trend || strategy.entry.reference_breakout);
    push({ id, kind: "run", footnote: usesAI, tasks: [
      { id: "validate", label: "Validate rules", status: "running" },
      { id: "run", label: "Run backtest", status: "pending" },
      { id: "load", label: "Load result", status: "pending" },
    ] });
    setBusy("run");
    setMobileTab("chat");
    const controller = new AbortController();
    abort.current = controller;
    let stage: "validate" | "run" | "load" = "validate";
    try {
      const check = await api.validate(strategy);
      if (!check.valid) {
        setTask(id, "validate", { status: "failed", note: `${check.issues.length} issue${check.issues.length === 1 ? "" : "s"}` });
        patch(id, { error: { message: "The server rejected these rules.", issues: check.issues } });
        return;
      }
      setTask(id, "validate", { status: "done", note: "0 issues" });

      stage = "run";
      setTask(id, "run", { status: "running", note: "on server" });
      const runId = await api.runBacktestJob(strategy, execution, {
        signal: controller.signal,
        onUsage: (usage) => setTask(id, "run", { note: usageText(usage) || "on server" }),
      });
      setTask(id, "run", { status: "done" });

      stage = "load";
      setTask(id, "load", { status: "running" });
      const result = await api.getRun(runId);
      setTask(id, "load", { status: "done", note: `${result.data.candle_count.toLocaleString()} candles` });

      setRun(result);
      setSelectedId(null);
      setTab("results");
      push({ id: nextId(), kind: "event", text: `run ${shortId(result.id)} saved` });
      const n = result.metrics.num_trades;
      push({ id: nextId(), kind: "result", text: n === 0
        ? `No trades were triggered between ${result.data.start?.slice(0, 10)} and ${result.data.end?.slice(0, 10)} (UTC). Try loosening the entry conditions.`
        : `${n} trade${n === 1 ? "" : "s"}, ${signedPercent(result.metrics.total_return_pct)} return between ${result.data.start?.slice(0, 10)} and ${result.data.end?.slice(0, 10)} (UTC). This is a historical simulation, not a prediction.` });
      shell.reload();
      setMobileTab("results");
    } catch (e) {
      if (isAbort(e)) {
        setTask(id, "run", { status: "pending", note: "Stopped waiting" });
        patch(id, { info: "Stopped waiting. The backtest may still finish and appear in Runs." });
        shell.reload();
      } else {
        setTask(id, stage, { status: "failed" });
        patch(id, { error: e instanceof ApiError ? { message: e.message, issues: e.issues } : { message: NETWORK, issues: [] } });
      }
    } finally {
      abort.current = null;
      setBusy(null);
    }
  }

  const openRun = useCallback(async (runId: string) => {
    abort.current?.abort();
    try {
      const result = await api.getRun(runId);
      setRun(result);
      setSelectedId(null);
      setTab("results");
      setExecution(result.execution);
      updateStrategy(result.strategy);
      const id = nextId();
      push({ id: nextId(), kind: "event", text: `run ${shortId(result.id)} opened` });
      push({ id, kind: "opened", runId: result.id });
      setDraftHost(id);
    } catch (e) {
      push({ id: nextId(), kind: "result", text: e instanceof ApiError && e.status === 404 ? "That backtest no longer exists. It may have been deleted." : NETWORK });
    }
  }, [push, updateStrategy]);

  // /?run=<id> (from the Paper signals sidebar) opens that run once.
  const openedFromUrl = useRef(false);
  useEffect(() => {
    const id = params.get("run");
    if (id && !openedFromUrl.current) {
      openedFromUrl.current = true;
      void openRun(id);
      window.history.replaceState(null, "", "/");
    }
  }, [params, openRun]);

  function newStrategy() {
    abort.current?.abort();
    setThread([]); setDraftHost(null); setStrategy(null); setJsonText(""); setJsonError(null);
    setValidation(null); setRun(null); setSelectedId(null); setPrompt(""); setExecution(DEFAULT_EXECUTION); setBusy(null);
    setMobileTab("chat");
  }

  const selectTrade = useCallback((trade: Trade, openDetective = true) => {
    setSelectedId(trade.id);
    if (openDetective) setTab("detective");
  }, []);
  const selectedTrade = run?.trades.find((t) => t.id === selectedId) ?? null;
  const hasVolume = run?.candles.some((c) => c.volume != null && Number.isFinite(c.volume)) ?? false;

  const sections = useMemo(() => (strategy ? ruleSections(strategy, execution) : []), [strategy, execution]);
  const title = run ? `${symbolName(run.strategy.symbol)} · ${run.strategy.timeframe}` : strategy ? `${symbolName(strategy.symbol)} · ${strategy.timeframe}` : undefined;

  const draftCard = strategy ? (
    <StrategyDraftCard status={draftStatus} sections={sections} jsonText={jsonText} onJsonChange={updateJson} jsonError={jsonError}
      issues={validation?.valid === false ? validation.issues : []} assumptions={validation?.valid ? validation.assumptions : []}
      running={busy === "run"} disabled={busy !== null} onRun={() => void execute()} onEdit={() => setEditorOpen(true)} />
  ) : null;

  function renderItem(item: ThreadItem) {
    switch (item.kind) {
      case "user": return <ChatMessage key={item.id} role="user" text={item.text} />;
      case "event": return <ChatMessage key={item.id} role="event" text={item.text} />;
      case "result": return <ChatMessage key={item.id} role="assistant" text={item.text} />;
      case "opened": return (
        <ChatMessage key={item.id} role="assistant" text={`These are the rules for run ${shortId(item.runId)}. Editing them and running again creates a new run.`}>
          {draftHost === item.id ? draftCard : null}
        </ChatMessage>
      );
      case "generate": {
        const r = item.result;
        const source = r?.source;
        const meta = source ? <Badge tone={source === "rule_based_fallback" ? "warning" : "outline"} mono>{source}</Badge> : null;
        return (
          <ChatMessage key={item.id} role="assistant" meta={meta}
            text={item.state === "done" ? (r?.strategy ? "Here are the rules. Nothing runs until you press Run backtest." : "I couldn't turn that into a runnable strategy.") : undefined}>
            <AITaskList label="Generating" tasks={[{ id: "generate", label: "Generate rules", status: item.state === "running" ? "running" : item.state === "failed" ? "failed" : "done" }]} />
            {item.state === "failed" ? (
              <Notice tone="error" title="Couldn't generate" action={<Button size="sm" variant="outline" onClick={() => void generate(item.prompt, true)} disabled={busy !== null}>Retry</Button>}>
                {item.error} Your draft is unchanged.
              </Notice>
            ) : null}
            {r && !r.strategy ? <Notice tone="error" title="No runnable strategy" items={r.issues}>Fix these in the JSON tab or describe it again.</Notice> : null}
            {r && r.clarifications.length > 0 ? <Notice tone="warning" title="Clarify" items={r.clarifications}>Please review these interpretations before running.</Notice> : null}
            {r && r.unsupported.length > 0 ? <Notice tone="warning" title="Left out" items={r.unsupported}>These parts aren&apos;t supported yet.</Notice> : null}
            {draftHost === item.id ? draftCard : null}
          </ChatMessage>
        );
      }
      case "run": return (
        <ChatMessage key={item.id} role="assistant">
          <AITaskList label="Running" tasks={item.tasks} />
          {item.footnote ? <p className="text-xs text-muted-foreground">AI trend analysis can take several minutes. Keep this page open.</p> : null}
          {item.info ? <Notice tone="info" title={null}>{item.info}</Notice> : null}
          {item.error ? (
            <Notice tone="error" title="Run failed" items={item.error.issues} action={<Button size="sm" variant="outline" onClick={() => void execute()} disabled={busy !== null}>Retry</Button>}>
              {item.error.message} Your draft is unchanged.
            </Notice>
          ) : null}
        </ChatMessage>
      );
    }
  }

  const chat = (
    <section aria-label="Chat" className={cn("flex min-h-0 flex-1 flex-col", mobileTab !== "chat" && "max-[959px]:hidden")}>
      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(e) => { const el = e.currentTarget; nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
        <div className="mx-auto max-w-[720px] space-y-6 px-4 py-5">
          {thread.length === 0 ? (
            <Welcome suggestions={SUGGESTIONS} onPick={(s) => {
              const full = SUGGESTIONS.find((x) => x.title === s.title);
              setPrompt(s.description);
              if (full) { setSymbol(full.symbol); setTimeframe(full.timeframe); }
            }} />
          ) : thread.map(renderItem)}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[720px] px-4 pb-3">
        <PromptInput value={prompt} onValueChange={setPrompt} onSubmit={(text) => { setPrompt(""); void generate(text); }}
          onStop={() => abort.current?.abort()} status={busy ? "streaming" : "ready"} disabled={false}
          placeholder={thread.length === 0 ? "Describe a strategy…" : "Describe a new strategy…"} label="Describe a strategy"
          actions={<>
            <ContextPill label="Symbol" value={symbol} options={Object.entries(SYMBOL_NAMES).map(([value, label]) => ({ value, label }))} onChange={(v) => setSymbol(v as Strategy["symbol"])} disabled={busy !== null} />
            <ContextPill label="Timeframe" value={timeframe} options={TIMEFRAMES.map((t) => ({ value: t, label: t }))} onChange={(v) => setTimeframe(v as Strategy["timeframe"])} disabled={busy !== null} />
          </>} />
        <p className="mt-2 text-center text-xs text-muted-foreground">A new message generates a new strategy. Symbol and timeframe apply to it.</p>
        <p className="sl-prompt-foot mt-0.5 text-center text-xs text-muted-foreground">Historical simulations only. Not financial advice.</p>
      </div>
    </section>
  );

  const chartPane = (
    <section aria-label="Chart" className={cn("space-y-3", mobileTab === "results" && "max-[959px]:hidden")}>
      {run ? (
        <>
          <ChartToolbar trades={run.trades} symbol={run.strategy.symbol} selectedId={selectedId} onSelectTrade={(t) => selectTrade(t, false)} onFit={() => setFitKey((k) => k + 1)}
            volume={{ available: hasVolume, on: showVolume, onToggle: setShowVolume, value: hoverVolume ?? run.candles.findLast((c) => c.volume != null)?.volume ?? null }} />
          <PriceChart run={run} selectedTrade={selectedTrade} onSelectTrade={(t) => selectTrade(t, true)} showVolume={showVolume} onVolumeHover={setHoverVolume} fitKey={fitKey} />
          <p className="text-xs text-muted-foreground">
            {run.data.volume_type ? `${run.data.volume_type} ` : ""}{run.data.limitations?.join(" ")}
          </p>
        </>
      ) : (
        <div className="flex h-[300px] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          Run a backtest to see candles, trade markers and the equity curve here.
        </div>
      )}
    </section>
  );

  const resultsPane = run ? (
    <section aria-label="Results" className={cn(mobileTab === "chart" && "max-[959px]:hidden")}>
      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="detective">Trade Detective</TabsTrigger>
          <TabsTrigger value="reliability">Reliability</TabsTrigger>
        </TabsList>
        <TabsContent value="results" forceMount className="data-[state=inactive]:hidden"><ResultsTab run={run} selectedId={selectedId} onSelectTrade={(t) => selectTrade(t, true)} /></TabsContent>
        <TabsContent value="detective" forceMount className="data-[state=inactive]:hidden"><DetectiveTab run={run} trade={selectedTrade} /></TabsContent>
        <TabsContent value="reliability" forceMount className="data-[state=inactive]:hidden"><ReliabilityTab run={run} /></TabsContent>
      </Tabs>
    </section>
  ) : null;

  return (
    <AppShell screen="backtest" section="Backtest" title={title} runId={run?.id ?? null}
      onSaveRun={() => setSaveOpen(true)} onSelectRun={(id) => void openRun(id)} onNew={newStrategy}>
      <div className="flex h-full min-h-0 flex-col">
        <Tabs value={mobileTab} onValueChange={setMobileTab} className="border-b px-3 py-2 min-[960px]:hidden">
          <TabsList className="w-full">
            <TabsTrigger value="chat">Chat</TabsTrigger>
            <TabsTrigger value="chart">Chart</TabsTrigger>
            <TabsTrigger value="results" disabled={!run}>Results</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex min-h-0 flex-1 min-[960px]:grid min-[960px]:grid-cols-[40%_60%]">
          <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col min-[960px]:border-r", mobileTab !== "chat" && "max-[959px]:hidden")}>{chat}</div>
          <div className={cn("min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4", mobileTab === "chat" && "max-[959px]:hidden")}>
            {chartPane}
            {resultsPane}
          </div>
        </div>
      </div>

      {strategy ? (
        <StrategyEditor open={editorOpen} onOpenChange={setEditorOpen} strategy={strategy} onChange={updateStrategy}
          execution={execution} onExecutionChange={setExecution} disabled={busy !== null} />
      ) : null}
      <SaveStrategyDialog run={run} open={saveOpen} onOpenChange={setSaveOpen} onSaved={shell.reload} />
    </AppShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShellProvider>
        <BacktestScreen />
      </ShellProvider>
    </Suspense>
  );
}
