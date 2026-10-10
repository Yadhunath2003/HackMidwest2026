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

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()]

DATABASE_PATH = _path("DATABASE_PATH", "data/strategylab.db")
CANDLE_CACHE_DIR = _path("CANDLE_CACHE_DIR", "data/candles")
