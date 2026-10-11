import logging
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query

from . import ai, ai_usage, detective, market_data, storage, paper, live_data
from pydantic import BaseModel, Field
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


class SaveStrategyRequest(BaseModel):
    run_id: str
    name: str = Field(min_length=1, max_length=100)


class StartPaperRequest(BaseModel):
    strategy_id: str


@router.get('/strategies/saved')
def saved_strategies():
    return storage.list_strategies()


@router.get('/backtests')
def recent_backtests():
    return storage.recent_runs()


@router.post('/strategies/save')
def save_strategy(request: SaveStrategyRequest):
    if not request.name.strip():raise HTTPException(422,detail={'message':'Enter a strategy name.'})
    try:return storage.save_strategy(request.run_id,request.name)
    except ValueError as exc:raise HTTPException(404,detail={'message':str(exc)}) from exc


@router.delete('/strategies/saved/{strategy_id}')
def delete_saved_strategy(strategy_id: str):
    try:
        if not storage.delete_strategy(strategy_id):raise HTTPException(404,detail={'message':'Saved strategy not found.'})
    except ValueError as exc:raise HTTPException(409,detail={'message':str(exc)}) from exc
    return {'deleted':True}


@router.delete('/backtest/{run_id}')
def delete_backtest(run_id: str):
    try:
        if not storage.delete_run(run_id):raise HTTPException(404,detail={'message':'Backtest not found.'})
    except ValueError as exc:raise HTTPException(409,detail={'message':str(exc)}) from exc
    return {'deleted':True}


@router.get('/paper/feeds')
def paper_feeds():
    return {'stocks':live_data.settings('TSLA'),'gold':live_data.settings('XAUUSD'),'crypto':live_data.settings('BTCUSD')}


@router.get('/paper/sessions')
def paper_sessions():
    return [paper.public(s) for s in storage.paper_sessions()]


@router.post('/paper/start')
def start_paper(request: StartPaperRequest):
    saved=next((s for s in storage.list_strategies() if s['id']==request.strategy_id),None)
    if saved is None:raise HTTPException(404,detail={'message':'Saved strategy not found.'})
    try:return paper.create(saved)
    except ValueError as exc:raise HTTPException(422,detail={'message':str(exc)}) from exc


@router.post('/paper/sessions/{session_id}/stop')
def stop_paper(session_id: str):
    if not storage.stop_paper_session(session_id):raise HTTPException(404,detail={'message':'Running paper session not found.'})
    return {'stopped':True}

SMALL_SAMPLE_TRADES = 30
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="backtest")
_jobs: dict[str, dict] = {}
_jobs_lock = Lock()


def _execute_job(job_id: str, request: BacktestRequest):
    with _jobs_lock:
        _jobs[job_id]["status"] = "running"
    try:
        def on_usage(usage):
            with _jobs_lock:
                _jobs[job_id]["ai_usage"] = usage
        result = _perform_backtest(request, on_usage)
        update = {"status": "completed", "run_id": result["id"]}
    except HTTPException as exc:
        detail = exc.detail
        update = {"status": "failed", "message": detail.get("message", str(detail)) if isinstance(detail, dict) else str(detail)}
    except Exception:
        logging.exception("Backtest job %s failed", job_id)
        update = {"status": "failed", "message": "Backtest failed on the server. Check the backend terminal for the error details."}
    with _jobs_lock:
        _jobs[job_id].update(update, finished_at=time.monotonic())


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
    if issues:
        try:
            generated = ai.generate_strategy(request.prompt, defaults, repair={"draft": generated, "validation_errors": issues})
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
    return _perform_backtest(request)


def _perform_backtest(request: BacktestRequest, on_usage=None):
    strategy = _require_strategy(request.strategy)
    series, meta = _load_candles(strategy.symbol, strategy.timeframe)
    try:
        with ai_usage.track(on_usage) as usage:
            result = run_backtest(series, strategy, request.execution, meta)
            result["ai_usage"] = usage.snapshot()
            return storage.save_run(result)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail={"message": f"AI trend detection failed: {exc}"}) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc


@router.post("/backtest/jobs")
def start_backtest(request: BacktestRequest):
    _require_strategy(request.strategy)
    with _jobs_lock:
        expired = [key for key, job in _jobs.items() if time.monotonic() - job.get("finished_at", time.monotonic()) > 3600]
        for key in expired:
            del _jobs[key]
        if sum(job["status"] in ("queued", "running") for job in _jobs.values()) >= 2:
            raise HTTPException(status_code=429, detail={"message": "Two backtests are already running. Wait for one to finish before trying again."})
        job_id = uuid4().hex
        _jobs[job_id] = {"job_id": job_id, "status": "queued"}
    _executor.submit(_execute_job, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@router.get("/backtest/jobs/{job_id}")
def backtest_status(job_id: str):
    with _jobs_lock:
        if job_id not in _jobs:
            raise HTTPException(status_code=404, detail={"message": "This backtest job is no longer available. The backend may have restarted; run the backtest again."})
        return dict(_jobs[job_id])


@router.get("/backtest/{run_id}")
def get_backtest(run_id: str):
    return _require_run(run_id)


@router.post("/backtest/{run_id}/report")
def backtest_report(run_id: str):
    run = _require_run(run_id)
    evidence = {key: run[key] for key in ("strategy", "execution", "metrics", "data", "assumptions")}
    try:
        return ai.generate_report(evidence)
    except ai.AIError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc


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
    replay = run.get("trend_assessments", {}) if strategy.entry.ai_trend or strategy.entry.reference_breakout else None
    stressed = run_backtest(series, strategy, stressed_execution, trend_assessments=replay)

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
            result = run_backtest(segment, strategy, base_execution, trend_assessments=replay)
            parts[name] = {"range": describe_range(segment), "metrics": result["metrics"]}
        split = parts
        notes.append(
            "The out-of-sample segment restarts with fresh capital and indicator warm-up. The strategy's "
            "parameters were not fitted on the in-sample segment by this tool, so this is a consistency "
            "check across periods, not proof of robustness."
        )

    result = {
        "run_id": request.run_id,
        "baseline": {"execution": run["execution"], "metrics": run["metrics"]},
        "stressed": {"execution": stressed_execution.model_dump(), "metrics": stressed["metrics"]},
        "split": split,
        "notes": notes,
    }
    if strategy.entry.ai_trend or strategy.entry.reference_breakout:
        result["notes"].append("AI trend judgments are replayed from the original run, without new model calls. Split periods retain the original judgments' past context; candidates without a saved judgment are skipped.")
    try:
        result["ai_report"] = ai.generate_report({"strategy": run["strategy"], "data": run["data"],
                                                  "assumptions": run["assumptions"], **result})
        result["ai_error"] = None
    except ai.AIError as exc:
        result["ai_report"] = None
        result["ai_error"] = str(exc)
    return result
