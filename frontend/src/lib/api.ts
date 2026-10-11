import type {
  AIReport,
  AIUsage,
  BacktestRun,
  ExecutionSettings,
  Explanation,
  GenerateResponse,
  StressTestResult,
  ValidateResponse,
  SavedStrategy, PaperSession, FeedStatus,
} from "./types";

export class ApiError extends Error {
  issues: string[];
  /** HTTP status when the server answered; undefined for network failures. */
  status?: number;

  constructor(message: string, issues: string[] = [], status?: number) {
    super(message);
    this.issues = issues;
    this.status = status;
  }
}

async function request<T>(path: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError("Could not reach the server. Is the backend running?");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data?.detail;
    if (Array.isArray(detail)) {
      // FastAPI request-validation errors
      throw new ApiError(
        "The request was not valid.",
        detail.map((d: { loc: string[]; msg: string }) => `${d.loc.slice(1).join(".")}: ${d.msg}`),
        response.status,
      );
    }
    throw new ApiError(detail?.message ?? `Request failed (${response.status}).`, detail?.issues ?? [], response.status);
  }
  return data as T;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) => request<T>(path, body, undefined, signal);

/** Starts a backtest job and polls it until it completes. Resolves with the saved run id. */
async function runBacktestJob(
  strategy: unknown,
  execution: ExecutionSettings,
  options: { onUsage?: (usage: AIUsage) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const { onUsage, signal } = options;
  const job = await post<{ job_id: string }>("/backtest/jobs", { strategy, execution }, signal);
  for (;;) {
    const status = await request<{ status: string; run_id?: string; message?: string; ai_usage?: AIUsage }>(`/backtest/jobs/${job.job_id}`, undefined, undefined, signal);
    if (status.ai_usage) onUsage?.(status.ai_usage);
    if (status.status === "failed") throw new ApiError(status.message ?? "Backtest failed.");
    if (status.status === "completed" && status.run_id) return status.run_id;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 1500);
      signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
  }
}

export const api = {
  health: () => request<{ status: string; ai_configured: boolean }>("/health"),
  recentRuns: () => request<{ id: string; created_at: string; symbol: string; timeframe: string }[]>("/backtests"),
  getRun: (id: string) => request<BacktestRun>(`/backtest/${id}`),
  savedStrategies: () => request<SavedStrategy[]>("/strategies/saved"),
  saveStrategy: (run_id: string, name: string) => post<SavedStrategy>("/strategies/save", { run_id, name }),
  deleteStrategy: (id: string) => request(`/strategies/saved/${id}`, undefined, "DELETE"),
  deleteRun: (id: string) => request(`/backtest/${id}`, undefined, "DELETE"),
  paperFeeds: () => request<{ stocks: FeedStatus; gold: FeedStatus; crypto: FeedStatus }>("/paper/feeds"),
  paperSessions: () => request<PaperSession[]>("/paper/sessions"),
  startPaper: (strategy_id: string) => post<PaperSession>("/paper/start", { strategy_id }),
  stopPaper: (id: string) => post(`/paper/sessions/${id}/stop`, {}),
  backtestReport: (runId: string) => post<AIReport>(`/backtest/${runId}/report`, {}),
  generate: (body: { prompt: string; symbol?: string; timeframe?: string; initial_capital?: number }, signal?: AbortSignal) =>
    post<GenerateResponse>("/strategy/generate", body, signal),
  validate: (strategy: unknown) => post<ValidateResponse>("/strategy/validate", { strategy }),
  runBacktestJob,
  explainTrade: (run_id: string, trade_id: number, question: string) =>
    post<Explanation>("/trades/explain", { run_id, trade_id, question }),
  stressTest: (body: {
    run_id: string;
    commission_per_order_usd?: number;
    slippage_bps?: number;
    in_sample_fraction?: number;
  }) => post<StressTestResult>("/backtest/stress-test", body),
};

// All timestamps are candle open times in UTC.
export function formatTime(epochSeconds: number, withTime = true): string {
  const iso = new Date(epochSeconds * 1000).toISOString();
  return withTime ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : iso.slice(0, 10);
}

export function money(value: number): string {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function percent(value: number | null | undefined, digits = 2): string {
  return value == null ? "n/a" : `${value.toFixed(digits)}%`;
}
