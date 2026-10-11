"""Causal AI trend judgments cached by model, prompt version, and exact candle context."""

import hashlib
import json

from pydantic import Field, ValidationError
from typing import Literal

from . import ai, ai_usage, config
from .schemas import StrictModel

VERSION = "trend-v2-compact"
PROMPT = """Assess the current price trend from ONLY the supplied sequential OHLCV candles.
Infer the trend's length from swing structure, persistence, pullbacks and reversals; do not
require a fixed number of green/red candles. Candle color alone does not establish a trend.
Consider competing shorter/longer trends and return uncertain when ambiguous or insufficient.
Return JSON: direction (bullish, bearish, sideways, uncertain), confidence (0..1),
start_index (index of the inferred trend start in this context, or null), reason (brief string).
Assess the trend AT THE LAST candle. Use no external knowledge or future outcomes.
The indexes are ordered observations, not dates. Explain using prices/indexes from the context.
Confidence is subjective, not a probability of profitable trading."""


class Judgment(StrictModel):
    direction: Literal["bullish", "bearish", "sideways", "uncertain"]
    confidence: float = Field(ge=0, le=1)
    start_index: int | None = Field(default=None, ge=0)
    reason: str = Field(min_length=1, max_length=2000)


def assess(candles: list[dict], context_candles: int, *, volume_kind: str = "traded") -> dict:
    context = candles[-context_candles:]
    if len(context) < 20:
        return {"direction": "uncertain", "confidence": 0, "start_time": None,
                "reason": "Fewer than 20 completed candles available for context.", "source": "insufficient_history"}
    identity = {"version": VERSION, "model": config.CHAT_MODEL,
                "endpoint": config.OPENAI_BASE_URL, "candles": context}
    if volume_kind == "quote":
        identity["volume_kind"] = "quote"
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    path = config.CANDLE_CACHE_DIR / "ai_trends" / f"{key}.json"
    # Legacy judgments used the same candle values and assessment semantics.
    legacy_key = hashlib.sha256(json.dumps({"version": "trend-v1", "model": config.CHAT_MODEL,
        "endpoint": config.OPENAI_BASE_URL, "candles": context}, sort_keys=True).encode()).hexdigest()
    for cached_path in ((path,) if volume_kind == "quote" else (path, path.parent / f"{legacy_key}.json")):
        if cached_path.exists():
            result = json.loads(cached_path.read_text())
            ai_usage.cache_hit()
            return result
    observations = {"columns": ["open", "high", "low", "close", "volume"],
                    "index_range": [0, len(context) - 1],
                    "candles": [[c[k] for k in ("open", "high", "low", "close", "volume")] for c in context]}
    messages = [
        {"role": "system", "content": PROMPT + ("\nVolume is provider quote activity, not executed trade volume." if volume_kind == "quote" else "") + f"\nInput candles are arrays matching columns. Each row's zero-based position is its index. start_index must be an integer from 0 to {len(context) - 1}, inclusive, or null. Never use timestamps or indexes from a larger history. Null volume means unavailable. Return only the JSON object. Keep reason to one short sentence (at most 40 words)."},
        {"role": "user", "content": json.dumps(observations, separators=(",", ":"))},
    ]
    for attempt in range(2):
        reply = _request_judgment(messages)
        try:
            judgment = Judgment.model_validate(ai.extract_json(reply))
            if judgment.start_index is not None and judgment.start_index >= len(context):
                raise ai.AIError("AI trend start falls outside the supplied candle history.")
            if judgment.direction in ("bullish", "bearish") and judgment.start_index is None:
                raise ai.AIError("AI trend assessment omitted its trend start.")
            break
        except (ValidationError, ai.AIError) as exc:
            if attempt == 1:
                raise ai.AIError("AI returned an invalid trend assessment after one correction attempt. Completed judgments are cached; rerunning will reuse them.") from exc
            messages.extend([
                {"role": "assistant", "content": reply},
                {"role": "user", "content": f"Correct the JSON assessment: {exc}. Use ONLY the same supplied candles. start_index must be a zero-based integer in 0..{len(context) - 1}; bullish/bearish assessments require it. Reassess honestly; do not clamp an invalid index. Return only corrected JSON."},
            ])
    result = {"direction": judgment.direction, "confidence": judgment.confidence,
        "start_time": context[judgment.start_index]["time"] if judgment.start_index is not None else None,
        "context_start_time": context[0]["time"], "assessed_at": context[-1]["time"],
        "reason": judgment.reason, "source": f"akamai-inference:{config.CHAT_MODEL}", "version": VERSION}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result))
    return result


def _request_judgment(messages: list[dict]) -> str:
    # Retry only the unfinished judgment, preserving the exact historical context.
    # Never parse partial output or silently substitute a trend when retries fail.
    budgets = sorted({config.AI_TREND_INITIAL_TOKENS,
                      min(config.AI_TREND_INITIAL_TOKENS * 2, config.AI_TREND_MAX_TOKENS),
                      config.AI_TREND_MAX_TOKENS})
    for budget in budgets:
        try:
            reply = ai.chat(messages, max_tokens=budget, temperature=0)
            return reply
        except ai.AIResponseTruncated as exc:
            if budget == budgets[-1]:
                raise ai.AIError(
                    f"The AI trend response was still cut off after {len(budgets)} attempts (output cap {budget} tokens). "
                    "Completed judgments are cached; rerunning will reuse them."
                ) from exc
