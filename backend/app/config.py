import os
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent

# override=True so the workshop settings win over other provider keys in the shell.
load_dotenv(BACKEND_DIR / ".env", override=True)


def _path(env_name: str, default: str) -> Path:
    path = Path(os.getenv(env_name, default))
    return path if path.is_absolute() else BACKEND_DIR / path


OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://ws.akamai-workshops.com/v1").rstrip("/")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
CHAT_MODEL = os.getenv("CHAT_MODEL", "hackathon-chat")


def _token_limit(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except ValueError as exc:
        raise ValueError(f"{name} must be a whole number.") from exc
    if not 128 <= value <= 32768:
        raise ValueError(f"{name} must be between 128 and 32768.")
    return value


AI_TREND_INITIAL_TOKENS = _token_limit("AI_TREND_INITIAL_TOKENS", 700)
AI_TREND_MAX_TOKENS = _token_limit("AI_TREND_MAX_TOKENS", 2800)
if AI_TREND_INITIAL_TOKENS > AI_TREND_MAX_TOKENS:
    raise ValueError("AI_TREND_INITIAL_TOKENS must not exceed AI_TREND_MAX_TOKENS.")
AI_STRATEGY_MAX_TOKENS = _token_limit("AI_STRATEGY_MAX_TOKENS", 2000)
AI_REPORT_MAX_TOKENS = _token_limit("AI_REPORT_MAX_TOKENS", 1600)
AI_EXPLANATION_MAX_TOKENS = _token_limit("AI_EXPLANATION_MAX_TOKENS", 900)
TWELVEDATA_API_KEY = os.getenv("TWELVEDATA_API_KEY", "")
MASSIVE_API_KEY = os.getenv("MASSIVE_API_KEY", "")
GOLD_PROVIDER = os.getenv("GOLD_PROVIDER", "twelvedata").lower()
if GOLD_PROVIDER not in ("twelvedata", "massive"):
    raise ValueError("GOLD_PROVIDER must be twelvedata or massive.")
STOCK_INTRADAY_PROVIDER = os.getenv("STOCK_INTRADAY_PROVIDER", "yahoo").lower()
if STOCK_INTRADAY_PROVIDER not in ("yahoo", "twelvedata", "massive"):
    raise ValueError("STOCK_INTRADAY_PROVIDER must be yahoo, twelvedata, or massive.")
STOCK_INTRADAY_HISTORY_DAYS = int(os.getenv("STOCK_INTRADAY_HISTORY_DAYS", "365"))
if not 30 <= STOCK_INTRADAY_HISTORY_DAYS <= 3650:
    raise ValueError("STOCK_INTRADAY_HISTORY_DAYS must be between 30 and 3650.")

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

DATABASE_PATH = _path("DATABASE_PATH", "data/strategylab.db")
CANDLE_CACHE_DIR = _path("CANDLE_CACHE_DIR", "data/candles")
