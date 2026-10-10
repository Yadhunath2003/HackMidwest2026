"""Akamai hosted inference client (OpenAI-compatible chat completions).

The model only ever returns JSON that is validated against the strict strategy schema, or prose
about evidence the server hands it. Nothing it returns is executed. When no API key is set,
small deterministic fallbacks keep the app usable for local development.
"""

import json
import re
import time

import httpx

from . import config
from .schemas import SUPPORTED_SYMBOLS

MAX_RETRIES = 2


class AIError(Exception):
    pass


def is_configured() -> bool:
    return bool(config.OPENAI_API_KEY)


def chat(messages: list[dict], max_tokens: int = 1200, temperature: float = 0.1) -> str:
    if not is_configured():
        raise AIError("OPENAI_API_KEY is not set on the server.")
    payload = {"model": config.CHAT_MODEL, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    headers = {"Authorization": f"Bearer {config.OPENAI_API_KEY}"}
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = httpx.post(f"{config.OPENAI_BASE_URL}/chat/completions", json=payload, headers=headers, timeout=60)
        except httpx.HTTPError as exc:
            raise AIError(f"Could not reach the inference endpoint: {exc}") from exc
        if response.status_code == 429 and attempt < MAX_RETRIES:
            time.sleep(min(_float(response.headers.get("x-ratelimit-reset"), 2.0), 10.0))
            continue
        if response.status_code >= 400:
            raise AIError(f"Inference endpoint returned {response.status_code}: {response.text[:300]}")
        choice = response.json()["choices"][0]
        if choice.get("finish_reason") == "length":
            raise AIError("The model response was cut off before it finished.")
        return choice["message"]["content"] or ""
    raise AIError("Inference endpoint is rate limited; try again shortly.")


def _float(value: str | None, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def extract_json(text: str) -> dict:
    """Pull the first JSON object out of a model reply (tolerates code fences and stray prose)."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        raise AIError("The model did not return JSON.")
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise AIError(f"The model returned malformed JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise AIError("The model did not return a JSON object.")
    return parsed


# --- Strategy generation -----------------------------------------------------------------

STRATEGY_SYSTEM_PROMPT = f"""You convert a trader's plain-English idea into a JSON strategy for a backtesting tool.
Reply with ONE JSON object and nothing else:

{{
  "strategy": {{
    "symbol": one of {list(SUPPORTED_SYMBOLS)},
    "timeframe": "5m" or "1d",
    "entry": {{
      "type": "ema_crossover" | "sma_crossover" | "candle_only",
      "fast_period": int, "slow_period": int,        // required for crossover types, omit for candle_only
      "rsi_period": int, "rsi_below": number, "rsi_above": number,   // optional RSI filter
      "candle_conditions": {{                          // optional; required for candle_only
        "direction": "bullish" | "bearish",
        "body_to_range_min": 0-1, "upper_wick_to_range_max": 0-1, "lower_wick_to_range_max": 0-1,
        "relative_volume_min": number, "relative_volume_lookback": int
      }}
    }},
    "stop_loss_pct": number, "take_profit_pct": number,
    "exit_on_reverse_crossover": boolean,
    "initial_capital": number, "position_size_usd": number
  }},
  "clarifications": [string],   // questions about anything ambiguous, with the interpretation you used
  "unsupported": [string]       // requested things this tool cannot do
}}

Rules:
- Use only the fields above. Omit optional fields the user did not ask for. Percentages like "70% body" become ratios (0.70).
- The tool is long-only, US equities, one position at a time, fixed dollar position size. Short selling, options,
  trailing stops, other indicators (MACD, Bollinger, VWAP, ATR...), other symbols and time-of-day rules are unsupported:
  list each one in "unsupported" and leave it out of the strategy.
- "Bullish momentum candle" with no numbers means direction bullish, body_to_range_min 0.70,
  upper_wick_to_range_max 0.15, relative_volume_min 2.0, relative_volume_lookback 20.
- Never guess silently. If a phrase is ambiguous (for example "risk 1%" could be a 1% stop-loss distance or 1% of
  the account at risk), pick the stop-loss-distance reading, and add a clarification that says what you assumed.
- If stop loss or take profit is missing, use 2 and 4 and say so in "clarifications".
- Defaults when not stated: initial_capital 10000, position_size_usd 1000, timeframe "5m".
- If the request is not a trading strategy at all, return "strategy": null and explain in "unsupported"."""


def generate_strategy(prompt: str, defaults: dict) -> dict:
    """Return {"strategy": dict | None, "clarifications": [...], "unsupported": [...], "source": str}."""
    if not is_configured():
        return _fallback_strategy(prompt, defaults)
    user = prompt
    if defaults:
        user += f"\n\nUI selections to use unless the text says otherwise: {json.dumps(defaults)}"
    reply = extract_json(chat([
        {"role": "system", "content": STRATEGY_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]))
    strategy = reply.get("strategy")
    return {
        "strategy": strategy if isinstance(strategy, dict) else None,
        "clarifications": _string_list(reply.get("clarifications")),
        "unsupported": _string_list(reply.get("unsupported")),
        "source": f"akamai-inference:{config.CHAT_MODEL}",
    }


def _string_list(value) -> list[str]:
    return [str(item) for item in value] if isinstance(value, list) else []


def _fallback_strategy(prompt: str, defaults: dict) -> dict:
    """Keyword parser used only when no inference key is configured."""
    text = prompt.lower()

    def number(pattern: str) -> float | None:
        match = re.search(pattern, text)
        return float(match.group(1)) if match else None

    symbol = next((s for s in SUPPORTED_SYMBOLS if s.lower() in text), None) or defaults.get("symbol") or "AAPL"
    if re.search(r"\b(daily|1d|day candles?)\b", text):
        timeframe = "1d"
    elif re.search(r"5[- ]?min", text):
        timeframe = "5m"
    else:
        timeframe = defaults.get("timeframe") or "5m"

    clarifications = []
    entry: dict = {}
    averages = [int(n) for n in re.findall(r"(?:ema|sma)\s*\(?\s*(\d+)", text)]
    if "cross" in text and len(averages) >= 2:
        entry = {"type": "sma_crossover" if "sma" in text and "ema" not in text else "ema_crossover",
                 "fast_period": min(averages[:2]), "slow_period": max(averages[:2])}
    if "momentum" in text or "body" in text or "wick" in text or "volume" in text:
        body = number(r"body[^.\d]*(\d+(?:\.\d+)?)\s*%")
        wick = number(r"wick[^.\d]*(\d+(?:\.\d+)?)\s*%")
        entry["candle_conditions"] = {
            "direction": "bearish" if "bearish" in text else "bullish",
            "body_to_range_min": (body or 70) / 100,
            "upper_wick_to_range_max": (wick or 15) / 100,
            "relative_volume_min": 2.0,
            "relative_volume_lookback": int(number(r"(?:preceding|previous|last|prior)\s+(\d+)\s+candles") or 20),
        }
        entry.setdefault("type", "candle_only")
    if not entry:
        return {
            "strategy": None, "clarifications": [], "source": "rule_based_fallback",
            "unsupported": ["Could not find a supported entry rule (moving-average crossover or candle conditions)."],
        }
    rsi_period = number(r"rsi\s*\(?\s*(\d+)")
    rsi_below = number(r"rsi[^.]*?(?:below|under|less than|<)\s*(\d+(?:\.\d+)?)")
    if "rsi" in text and rsi_below:
        entry["rsi_period"], entry["rsi_below"] = int(rsi_period or 14), rsi_below

    stop = number(r"(\d+(?:\.\d+)?)\s*%\s*stop") or number(r"stop[- ]?loss[^.\d]*(\d+(?:\.\d+)?)\s*%")
    target = (number(r"(\d+(?:\.\d+)?)\s*%\s*(?:take[- ]?profit|target|profit)")
              or number(r"(?:take[- ]?profit|target)[^.\d]*(\d+(?:\.\d+)?)\s*%"))
    risk = number(r"risk\s+(\d+(?:\.\d+)?)\s*%")
    if stop is None and risk is not None:
        stop = risk
        clarifications.append(
            f'"Risk {risk:g}%" is ambiguous: it was read as a {risk:g}% stop-loss distance, not {risk:g}% of the account at risk. Adjust if you meant position sizing.'
        )
    if stop is None or target is None:
        clarifications.append("Stop loss and/or take profit were not found; defaults of 2% and 4% were used.")

    capital = defaults.get("initial_capital") or 10_000
    return {
        "strategy": {
            "symbol": symbol, "timeframe": timeframe, "entry": entry,
            "stop_loss_pct": stop or 2, "take_profit_pct": target or 4,
            "exit_on_reverse_crossover": False,
            "initial_capital": capital, "position_size_usd": min(1_000, capital),
        },
        "clarifications": clarifications,
        "unsupported": [],
        "source": "rule_based_fallback",
    }


# --- Trade Detective ---------------------------------------------------------------------

EXPLAIN_SYSTEM_PROMPT = """You are Trade Detective for a backtesting tool. You receive the recorded evidence for ONE simulated trade.
Reply with ONE JSON object and nothing else:

{
  "summary": string,            // 2-3 sentences answering the user's question from the recorded facts
  "hypotheses": [string],       // 1-3 possible market explanations, each phrased as a possibility, each citing a number from the evidence
  "testable_change": string     // one specific parameter change the user could backtest next
}

Rules:
- Use only numbers that appear in the evidence. Never invent prices, news, earnings or events.
- The summary states what happened (signal, fill, exit trigger, costs). Hypotheses are guesses and must sound like guesses.
- The testable change is an experiment, not advice. Do not promise or imply it will improve returns.
- This is a historical simulation, not financial advice."""


def explain_trade(evidence: dict, question: str) -> dict:
    """Return {"summary", "hypotheses", "testable_change", "source"} grounded in `evidence`."""
    if not is_configured():
        return {
            "summary": "AI explanation is unavailable because no inference key is configured. The recorded facts are still exact.",
            "hypotheses": [],
            "testable_change": None,
            "source": "unavailable",
        }
    reply = extract_json(chat([
        {"role": "system", "content": EXPLAIN_SYSTEM_PROMPT},
        {"role": "user", "content": f"Question: {question}\n\nEvidence:\n{json.dumps(evidence)}"},
    ], max_tokens=900, temperature=0.3))
    return {
        "summary": str(reply.get("summary", "")),
        "hypotheses": _string_list(reply.get("hypotheses")),
        "testable_change": str(reply["testable_change"]) if reply.get("testable_change") else None,
        "source": f"akamai-inference:{config.CHAT_MODEL}",
    }
