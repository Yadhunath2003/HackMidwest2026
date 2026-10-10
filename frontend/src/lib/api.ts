import type {
  BacktestRun,
  ExecutionSettings,
  Explanation,
  GenerateResponse,
  StressTestResult,
  ValidateResponse,
} from "./types";

export class ApiError extends Error {
  issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.issues = issues;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
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
      );
    }
    throw new ApiError(detail?.message ?? `Request failed (${response.status}).`, detail?.issues ?? []);
  }
  return data as T;
}

export const api = {
  generate: (body: { prompt: string; symbol?: string; timeframe?: string; initial_capital?: number }) =>
    post<GenerateResponse>("/strategy/generate", body),
  validate: (strategy: unknown) => post<ValidateResponse>("/strategy/validate", { strategy }),
  runBacktest: (strategy: unknown, execution: ExecutionSettings) =>
    post<BacktestRun>("/backtest/run", { strategy, execution }),
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
