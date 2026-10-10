"""Strict strategy schema. AI output and Advanced Mode JSON are both validated against this;
nothing outside these fields is ever executed."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SUPPORTED_SYMBOLS = ("AAPL", "SPY", "TSLA")
SUPPORTED_TIMEFRAMES = ("5m", "1d")

Symbol = Literal["AAPL", "SPY", "TSLA"]
Timeframe = Literal["5m", "1d"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CandleConditions(StrictModel):
    direction: Literal["bullish", "bearish"] | None = None
    body_to_range_min: float | None = Field(default=None, ge=0, le=1)
    upper_wick_to_range_max: float | None = Field(default=None, ge=0, le=1)
    lower_wick_to_range_max: float | None = Field(default=None, ge=0, le=1)
    relative_volume_min: float | None = Field(default=None, gt=0, le=50)
    relative_volume_lookback: int = Field(default=20, ge=2, le=200)


class Entry(StrictModel):
    # "candle_only" enters on the candle conditions alone, with no moving-average crossover.
    type: Literal["ema_crossover", "sma_crossover", "candle_only"]
    fast_period: int | None = Field(default=None, ge=2, le=200)
    slow_period: int | None = Field(default=None, ge=3, le=400)
    rsi_period: int | None = Field(default=None, ge=2, le=100)
    rsi_below: float | None = Field(default=None, gt=0, le=100)
    rsi_above: float | None = Field(default=None, ge=0, lt=100)
    candle_conditions: CandleConditions | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.type in ("ema_crossover", "sma_crossover"):
            if self.fast_period is None or self.slow_period is None:
                raise ValueError(f"{self.type} requires fast_period and slow_period")
            if self.fast_period >= self.slow_period:
                raise ValueError("fast_period must be smaller than slow_period")
        elif self.candle_conditions is None:
            raise ValueError("candle_only entry requires candle_conditions")
        if (self.rsi_below is not None or self.rsi_above is not None) and self.rsi_period is None:
            raise ValueError("rsi_below / rsi_above require rsi_period")
        if self.rsi_below is not None and self.rsi_above is not None and self.rsi_above >= self.rsi_below:
            raise ValueError("rsi_above must be smaller than rsi_below")
        return self


class Strategy(StrictModel):
    symbol: Symbol
    timeframe: Timeframe
    entry: Entry
    stop_loss_pct: float = Field(gt=0, le=50)
    take_profit_pct: float = Field(gt=0, le=200)
    exit_on_reverse_crossover: bool = False
    initial_capital: float = Field(default=10_000, gt=0, le=10_000_000)
    position_size_usd: float = Field(default=1_000, gt=0)

    @model_validator(mode="after")
    def _check(self):
        if self.position_size_usd > self.initial_capital:
            raise ValueError("position_size_usd cannot exceed initial_capital")
        if self.exit_on_reverse_crossover and self.entry.type == "candle_only":
            raise ValueError("exit_on_reverse_crossover requires a crossover entry type")
        return self


class ExecutionSettings(StrictModel):
    commission_per_order_usd: float = Field(default=1.0, ge=0, le=100)
    slippage_bps: float = Field(default=2.0, ge=0, le=500)


def validate_strategy(raw: dict) -> tuple[Strategy | None, list[str]]:
    """Return (strategy, issues). Issues are human-readable and safe to show in the UI."""
    try:
        return Strategy.model_validate(raw), []
    except ValidationError as exc:
        issues = []
        for err in exc.errors():
            loc = ".".join(str(part) for part in err["loc"])
            issues.append(f"{loc}: {err['msg']}" if loc else err["msg"])
        return None, issues


def describe_assumptions(strategy: Strategy, execution: ExecutionSettings | None = None) -> list[str]:
    execution = execution or ExecutionSettings()
    entry = strategy.entry
    notes = [
        "Long-only, one position at a time; signals that fire while a position is open are ignored.",
        "Signals are evaluated on completed candles and filled at the next candle's open.",
        "If a candle touches both the stop loss and the take profit, the stop loss is assumed to fill first.",
        "If a candle opens beyond the stop or target, the exit fills at that open (gap), not at the level.",
        f"Each order pays ${execution.commission_per_order_usd:.2f} commission and "
        f"{execution.slippage_bps:g} bps of adverse slippage.",
        f"Position size is a fixed ${strategy.position_size_usd:,.0f} in whole shares; "
        "entries that cannot afford one share are rejected and counted.",
        "Any position still open at the last candle is closed at that candle's close.",
    ]
    if entry.type != "candle_only" and (entry.candle_conditions or entry.rsi_period):
        notes.append("All entry conditions must be true on the same candle as the crossover.")
    if entry.candle_conditions and entry.candle_conditions.relative_volume_min is not None:
        notes.append(
            f"Relative volume compares a candle with the mean of the previous "
            f"{entry.candle_conditions.relative_volume_lookback} completed candles (current candle excluded). "
            "It is not adjusted for time of day."
        )
    if strategy.timeframe == "5m":
        notes.append("Positions can be held overnight; there is no end-of-day flatten rule.")
    return notes


# --- API request / response models -------------------------------------------------------


class GenerateRequest(StrictModel):
    prompt: str = Field(min_length=3, max_length=2000)
    symbol: Symbol | None = None
    timeframe: Timeframe | None = None
    initial_capital: float | None = Field(default=None, gt=0)


class ValidateRequest(StrictModel):
    strategy: dict


class BacktestRequest(StrictModel):
    strategy: dict
    execution: ExecutionSettings = ExecutionSettings()


class ExplainRequest(StrictModel):
    run_id: str
    trade_id: int
    question: str = Field(default="Why did this trade end the way it did?", max_length=500)


class StressTestRequest(StrictModel):
    run_id: str
    commission_per_order_usd: float | None = Field(default=None, ge=0, le=100)
    slippage_bps: float | None = Field(default=None, ge=0, le=500)
    # Fraction of candles used as the in-sample period; the rest is treated as unseen data.
    in_sample_fraction: float | None = Field(default=None, gt=0.1, lt=0.9)
