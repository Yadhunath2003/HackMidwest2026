from fastapi import APIRouter, HTTPException, Query

from . import ai, detective, market_data, storage
from .engine import describe_range, run_backtest
from .schemas import (
    BacktestRequest,
    ExecutionSettings,
    ExplainRequest,
    GenerateRequest,
    StressTestRequest,
    Strategy,
    ValidateRequest,
    describe_assumptions,
    validate_strategy,
)

router = APIRouter(prefix="/api")

SMALL_SAMPLE_TRADES = 30


def _require_strategy(raw: dict) -> Strategy:
    strategy, issues = validate_strategy(raw)
    if strategy is None:
        raise HTTPException(status_code=422, detail={"message": "Strategy is not valid.", "issues": issues})
    return strategy


def _require_run(run_id: str) -> dict:
    run = storage.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail={"message": f"Backtest '{run_id}' was not found."})
    return run


def _load_candles(symbol: str, timeframe: str, refresh: bool = False) -> tuple[list[dict], dict]:
    try:
        return market_data.get_candles(symbol, timeframe, refresh)
    except market_data.MarketDataError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc


@router.get("/health")
def health():
    return {"status": "ok", "ai_configured": ai.is_configured()}


@router.post("/strategy/generate")
def generate_strategy(request: GenerateRequest):
    defaults = request.model_dump(exclude={"prompt"}, exclude_none=True)
    try:
        generated = ai.generate_strategy(request.prompt, defaults)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc

    strategy, issues = (None, []) if generated["strategy"] is None else validate_strategy(generated["strategy"])
    return {
        # Only a schema-valid strategy is returned as runnable; the raw draft is shown for editing.
        "strategy": strategy.model_dump(exclude_none=True) if strategy else None,
        "draft": generated["strategy"],
        "issues": issues,
        "clarifications": generated["clarifications"],
        "unsupported": generated["unsupported"],
        "assumptions": describe_assumptions(strategy) if strategy else [],
        "source": generated["source"],
    }


@router.post("/strategy/validate")
def validate(request: ValidateRequest):
    strategy, issues = validate_strategy(request.strategy)
    return {
        "valid": strategy is not None,
        "strategy": strategy.model_dump(exclude_none=True) if strategy else None,
        "issues": issues,
        "assumptions": describe_assumptions(strategy) if strategy else [],
    }


@router.get("/market/candles")
def candles(symbol: str = Query(...), timeframe: str = Query("5m"), refresh: bool = False):
    series, meta = _load_candles(symbol.upper(), timeframe, refresh)
    return {"meta": meta, "candles": series}


@router.post("/backtest/run")
def backtest(request: BacktestRequest):
    strategy = _require_strategy(request.strategy)
    series, meta = _load_candles(strategy.symbol, strategy.timeframe)
    return storage.save_run(run_backtest(series, strategy, request.execution, meta))


@router.get("/backtest/{run_id}")
def get_backtest(run_id: str):
    return _require_run(run_id)


@router.post("/trades/explain")
def explain_trade(request: ExplainRequest):
    run = _require_run(request.run_id)
    trade = next((t for t in run["trades"] if t["id"] == request.trade_id), None)
    if trade is None:
        raise HTTPException(status_code=404, detail={"message": f"Trade {request.trade_id} is not in this backtest."})

    evidence = detective.build_evidence(run, trade)
    try:
        explanation = ai.explain_trade(evidence, request.question)
    except ai.AIError as exc:
        # The recorded facts are still worth showing when the model is unavailable.
        explanation = {"summary": f"AI explanation failed: {exc}", "hypotheses": [], "testable_change": None, "source": "error"}
    return {
        "run_id": request.run_id,
        "trade_id": request.trade_id,
        "question": request.question,
        "known_facts": detective.known_facts(evidence),
        "evidence": evidence,
        **explanation,
        "disclaimer": "Historical simulation only. Hypotheses are not verified causes and nothing here is financial advice.",
    }


@router.post("/backtest/stress-test")
def stress_test(request: StressTestRequest):
    run = _require_run(request.run_id)
    strategy = Strategy.model_validate(run["strategy"])
    base_execution = ExecutionSettings.model_validate(run["execution"])
    series = run["candles"]  # the stored candles, so the comparison uses identical data

    # Default stress: double the commission, triple the slippage (at least 5 bps).
    stressed_execution = ExecutionSettings(
        commission_per_order_usd=request.commission_per_order_usd
        if request.commission_per_order_usd is not None
        else min(base_execution.commission_per_order_usd * 2, 100),
        slippage_bps=request.slippage_bps
        if request.slippage_bps is not None
        else min(max(base_execution.slippage_bps * 3, 5.0), 500),
    )
    stressed = run_backtest(series, strategy, stressed_execution)

    notes = []
    if run["metrics"]["num_trades"] < SMALL_SAMPLE_TRADES:
        notes.append(
            f"Only {run['metrics']['num_trades']} completed trades: differences between runs may be noise, "
            "and no result here is statistically reliable."
        )

    split = None
    if request.in_sample_fraction is not None:
        cut = int(len(series) * request.in_sample_fraction)
        parts = {}
        for name, segment in (("in_sample", series[:cut]), ("out_of_sample", series[cut:])):
            result = run_backtest(segment, strategy, base_execution)
            parts[name] = {"range": describe_range(segment), "metrics": result["metrics"]}
        split = parts
        notes.append(
            "The out-of-sample segment restarts with fresh capital and indicator warm-up. The strategy's "
            "parameters were not fitted on the in-sample segment by this tool, so this is a consistency "
            "check across periods, not proof of robustness."
        )

    return {
        "run_id": request.run_id,
        "baseline": {"execution": run["execution"], "metrics": run["metrics"]},
        "stressed": {"execution": stressed_execution.model_dump(), "metrics": stressed["metrics"]},
        "split": split,
        "notes": notes,
    }
