"""Strict strategy schema. AI output and Advanced Mode JSON are both validated against this;
nothing outside these fields is ever executed."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

SUPPORTED_SYMBOLS = ("AAPL", "SPY", "TSLA", "XAUUSD", "BTCUSD")
SUPPORTED_TIMEFRAMES = ("5m", "30m", "1h", "4h", "1d")

Symbol = Literal["AAPL", "SPY", "TSLA", "XAUUSD", "BTCUSD"]
Timeframe = Literal["5m", "30m", "1h", "4h", "1d"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CandleConditions(StrictModel):
    direction: Literal["bullish", "bearish"] | None = None
    body_to_range_min: float | None = Field(default=None, ge=0, le=1)
    upper_wick_to_range_max: float | None = Field(default=None, ge=0, le=1)
    lower_wick_to_range_max: float | None = Field(default=None, ge=0, le=1)
    relative_volume_min: float | None = Field(default=None, gt=0, le=50)
    relative_volume_lookback: int = Field(default=20, ge=2, le=200)


class PullbackBreakout(StrictModel):
    rally_min_candles: int = Field(default=3, ge=2, le=100)
    pullback_min_candles: int = Field(default=1, ge=1, le=50)
    pullback_max_candles: int = Field(default=3, ge=1, le=50)
    breakout_by: Literal["close", "high"] = "close"

    @model_validator(mode="after")
    def _check(self):
        if self.pullback_min_candles > self.pullback_max_candles:
            raise ValueError("pullback_min_candles cannot exceed pullback_max_candles")
        return self


class AITrendFilter(StrictModel):
    direction: Literal["bullish", "bearish"] = "bullish"
    context_candles: int = Field(default=200, ge=20, le=1000)
    min_confidence: float = Field(default=0.6, ge=0, le=1)


class ReferenceBreakout(StrictModel):
    reference_volume_min: float = Field(default=2, gt=0, le=50)
    volume_lookback: int = Field(default=20, ge=2, le=200)
    momentum_body_min: float = Field(default=0.7, ge=0, le=1)
    breakout_by: Literal["close", "high"] = "close"
    context_candles: int = Field(default=200, ge=20, le=1000)
    min_confidence: float = Field(default=0.6, ge=0, le=1)
    risk_account_pct: float = Field(default=1, gt=0, le=10)
    target_account_pct: float = Field(default=2, gt=0, le=100)


class Entry(StrictModel):
    # "candle_only" enters on the candle conditions alone, with no moving-average crossover.
    type: Literal["ema_crossover", "sma_crossover", "candle_only", "bullish_pullback_breakout", "bearish_pullback_breakout", "ai_reference_breakout"]
    fast_period: int | None = Field(default=None, ge=2, le=200)
    slow_period: int | None = Field(default=None, ge=3, le=400)
    rsi_period: int | None = Field(default=None, ge=2, le=100)
    rsi_below: float | None = Field(default=None, gt=0, le=100)
    rsi_above: float | None = Field(default=None, ge=0, lt=100)
    candle_conditions: CandleConditions | None = None
    pullback_breakout: PullbackBreakout | None = None
    ai_trend: AITrendFilter | None = None
    reference_breakout: ReferenceBreakout | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.type in ("ema_crossover", "sma_crossover"):
            if self.fast_period is None or self.slow_period is None:
                raise ValueError(f"{self.type} requires fast_period and slow_period")
            if self.fast_period >= self.slow_period:
                raise ValueError("fast_period must be smaller than slow_period")
        elif self.type in ("bullish_pullback_breakout", "bearish_pullback_breakout"):
            if self.pullback_breakout is None:
                raise ValueError(f"{self.type} requires pullback_breakout settings")
        elif self.type == "ai_reference_breakout":
            if self.reference_breakout is None:
                raise ValueError("ai_reference_breakout requires reference_breakout settings")
            if self.ai_trend is not None or self.candle_conditions is not None:
                raise ValueError("reference_breakout contains its own trend and momentum settings; omit ai_trend and candle_conditions")
        elif self.candle_conditions is None:
            raise ValueError("candle_only entry requires candle_conditions")
        if self.type not in ("bullish_pullback_breakout", "bearish_pullback_breakout") and self.pullback_breakout is not None:
            raise ValueError("pullback_breakout settings require a bullish or bearish pullback entry type")
        if self.type != "ai_reference_breakout" and self.reference_breakout is not None:
            raise ValueError("reference_breakout settings require ai_reference_breakout entry type")
        if (self.rsi_below is not None or self.rsi_above is not None) and self.rsi_period is None:
            raise ValueError("rsi_below / rsi_above require rsi_period")
        if self.rsi_below is not None and self.rsi_above is not None and self.rsi_above >= self.rsi_below:
            raise ValueError("rsi_above must be smaller than rsi_below")
        return self


class PartialExit(StrictModel):
    fraction: float = Field(default=0.5, gt=0, lt=1)
    profit_pct: float = Field(default=1, gt=0, le=200)
    basis: Literal["price", "account"] = "price"


class Strategy(StrictModel):
    direction: Literal["long", "short"] = "long"
    volume_basis: Literal["traded", "quote"] = "traded"
    symbol: Symbol
    timeframe: Timeframe
    entry: Entry
    stop_loss_pct: float = Field(default=2, gt=0, le=50)
    take_profit_pct: float = Field(default=4, gt=0, le=200)
    exit_on_reverse_crossover: bool = False
    initial_capital: float = Field(default=10_000, gt=0, le=10_000_000)
    position_size_usd: float = Field(default=1_000, gt=0)
    partial_exit: PartialExit | None = None

    @model_validator(mode="after")
    def _check(self):
        if self.direction == 'short' and self.take_profit_pct >= 100:
            raise ValueError('Short price targets must be less than 100%')
        if self.entry.type == 'bullish_pullback_breakout' and self.direction != 'long':
            raise ValueError('Use bearish_pullback_breakout for short pullback entries')
        if self.entry.type == 'bearish_pullback_breakout' and self.direction != 'short':
            raise ValueError('bearish_pullback_breakout requires direction short')
        if self.entry.reference_breakout is None and self.position_size_usd > self.initial_capital:
            raise ValueError("position_size_usd cannot exceed initial_capital")
        if self.symbol != "XAUUSD" and self.volume_basis != "traded":
            raise ValueError("Quote activity is supported only for XAUUSD; stocks use traded share volume")
        if self.symbol == "XAUUSD" and self.volume_basis != "quote" and self.entry.candle_conditions and self.entry.candle_conditions.relative_volume_min is not None:
            raise ValueError("XAUUSD spot volume filters require volume_basis='quote'; this measures quote activity, not traded gold volume")
        if self.symbol == "XAUUSD" and self.volume_basis != "quote" and self.entry.reference_breakout is not None:
            raise ValueError("The XAUUSD reference-volume strategy requires volume_basis='quote'; this measures quote activity, not traded gold volume")
        if self.exit_on_reverse_crossover and self.entry.type not in ("ema_crossover", "sma_crossover"):
            raise ValueError("exit_on_reverse_crossover requires a crossover entry type")
        if self.partial_exit:
            partial = self.partial_exit
            if partial.basis == "account":
                if not self.entry.reference_breakout:
                    raise ValueError("Account-based partial exits require ai_reference_breakout")
                if partial.profit_pct >= self.entry.reference_breakout.target_account_pct:
                    raise ValueError("Partial account-profit trigger must be below the final account-profit target")
            elif not self.entry.reference_breakout and partial.profit_pct >= self.take_profit_pct:
                raise ValueError("Partial price-profit trigger must be below take_profit_pct")
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
        f"{strategy.direction.capitalize()} positions only, one position at a time; signals that fire while a position is open are ignored.",
        "Signals are evaluated on completed candles and filled at the next candle's open.",
        "If a candle touches both the stop loss and the take profit, the stop loss is assumed to fill first.",
        "If a candle opens beyond the stop or target, the exit fills at that open (gap), not at the level.",
        f"Each order pays ${execution.commission_per_order_usd:.2f} commission and "
        f"{execution.slippage_bps:g} bps of adverse slippage.",
        f"Position size is a fixed ${strategy.position_size_usd:,.0f} in "
        + ("0.01 troy-ounce units; no leverage, broker lots, spread, or financing is modeled." if strategy.symbol == "XAUUSD"
           else "0.00000001 BTC units; no leverage is modeled." if strategy.symbol == "BTCUSD"
           else "whole shares; entries that cannot afford one share are rejected and counted."),
        "Any position still open at the last candle is closed at that candle's close.",
    ]
    if strategy.direction == 'short':
        notes.append('Shorts are hypothetical backtest/paper positions with 100% entry-notional collateral reserved from equity. Sale proceeds are not available for new trades. No broker orders, borrow availability, borrow fees, funding, margin interest or liquidation model is included; losses can exceed collateral during gaps.')
    if strategy.symbol == "XAUUSD" and strategy.volume_basis == "quote":
        notes.append("Gold volume filters use provider quote activity (tick-volume proxy), not ounces or contracts traded. Counts are feed-specific and may differ from another broker's tick volume.")
    if strategy.partial_exit:
        partial = strategy.partial_exit
        notes.append(
            f"Close {partial.fraction * 100:g}% of the original quantity once at {partial.profit_pct:g}% "
            + ("net account gain if the entire position were liquidated, including the split's modeled costs. "
               if partial.basis == "account" else f"price {'rise' if strategy.direction == 'long' else 'fall'} from the entry fill. ")
            + "Quantity rounds down to the instrument's unit; skip the partial exit if it would sell zero units, leave no remainder, "
            "or its price is not below the final target. The stop stays unchanged. Each sell pays commission. "
            "A gap above the partial trigger fills at the open before testing the remainder's stop; otherwise the stop fills first "
            "when both are touched. The final account target includes realized partial profits and all modeled costs."
        )
        if strategy.direction == 'short':
            notes[-1] = (f"Buy to cover {partial.fraction * 100:g}% once at {partial.profit_pct:g}% "
                         + ('net account gain including modeled costs.' if partial.basis == 'account' else 'price fall from entry.')
                         + ' The stop stays unchanged. Every cover pays commission. The stop takes priority when both levels are touched, except a partial target crossed at the open fills first. Too-small quantities or targets beyond the final target are skipped.')
    if entry.type in ("ema_crossover", "sma_crossover") and (entry.candle_conditions or entry.rsi_period):
        notes.append("All entry conditions must be true on the same candle as the crossover.")
    if entry.pullback_breakout:
        pattern = entry.pullback_breakout
        notes.append(
            f"Rally means at least {pattern.rally_min_candles} consecutive green candles (close > open), "
            f"followed immediately by {pattern.pullback_min_candles}-{pattern.pullback_max_candles} red candles (close < open). "
            f"The first green candle after the pullback must have its {pattern.breakout_by} strictly above the first red candle's high. "
            "A flat candle breaks the sequence. Candle color defines this pattern; it does not establish a higher-high/higher-low trend."
        )
        if strategy.direction == 'short':
            notes[-1] = (f"At least {pattern.rally_min_candles} red candles, then {pattern.pullback_min_candles}-{pattern.pullback_max_candles} green candles. The first following red candle must break below the first green candle's low by {'close' if pattern.breakout_by == 'close' else 'low'}. Flat candles invalidate the pattern.")
    if entry.ai_trend:
        notes.append(
            f"AI assesses {entry.ai_trend.direction} trend at candidate entry candles using up to "
            f"{entry.ai_trend.context_candles} past/completed candles, with minimum reported confidence "
            f"{entry.ai_trend.min_confidence:g}. Confidence is a model judgment, not a calibrated probability. "
            "Trend length is inferred by AI within this context, not fixed by candle count. "
            "Sideways, uncertain, or insufficient-history assessments block entry. Assessments are saved and reused."
        )
    if entry.reference_breakout:
        ref = entry.reference_breakout
        notes = [n for n in notes if not n.startswith("Position size is a fixed")]
        notes.append(
            f"Mark a red candle with volume at least {ref.reference_volume_min:g}x the prior {ref.volume_lookback} candles' average "
            "when AI classifies its trend as bearish. A later green momentum candle must break its high in an AI-classified bullish trend. "
            f"Momentum body must be at least {ref.momentum_body_min:g} of candle range; breakout uses {ref.breakout_by}. "
            "New qualifying references replace the old one; touching the marked low before entry invalidates the setup. "
            f"AI uses up to {ref.context_candles} past candles, with minimum subjective confidence {ref.min_confidence:g}. "
            f"Stop is the reference low. Quantity is sized for planned loss up to {ref.risk_account_pct:g}% of current equity, "
            f"including commission and modeled slippage, capped by available cash. Target is {ref.target_account_pct:g}% of account equity "
            "as net trade profit after modeled costs, not a price percentage. Gaps can exceed the planned risk. "
            "Fixed dollar size and percentage stop/target fields are not used for this entry type."
        )
        if strategy.direction == 'short':
            notes[-1] = (f"Mark a green candle with volume at least {ref.reference_volume_min:g}x the prior {ref.volume_lookback} average in an AI bullish trend. A later red momentum candle (body/range at least {ref.momentum_body_min:g}) breaks the marked low by {'close' if ref.breakout_by == 'close' else 'low'} in an AI bearish trend; sell short at next open. Stop at marked high. Risk at most {ref.risk_account_pct:g}% of equity including modeled costs; target a net {ref.target_account_pct:g}% account gain. New references replace old ones; touching the marked high invalidates the setup; one entry attempt per reference. AI context {ref.context_candles}, minimum confidence {ref.min_confidence:g}.")
    if entry.candle_conditions and entry.candle_conditions.relative_volume_min is not None:
        notes.append(
            f"Relative volume compares a candle with the mean of the previous "
            f"{entry.candle_conditions.relative_volume_lookback} completed candles (current candle excluded). "
            "It is not adjusted for time of day."
        )
    if strategy.timeframe != "1d":
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
