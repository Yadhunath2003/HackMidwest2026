# StrategyLab AI — Hack Midwest 2026

Describe it. Backtest it. Understand it. Validate it.

A trading research tool: describe a strategy in plain English, get validated structured rules, backtest them on real
historical candles, investigate individual trades, and stress-test the result. Historical simulation only — no broker,
no live orders, no financial advice. The full spec is in [StrategyLab_AI_MVP.md](StrategyLab_AI_MVP.md).

## Layout

```
backend/                 FastAPI service
  app/schemas.py         Strict strategy schema (the only thing the engine will run)
  app/indicators.py      EMA, SMA, RSI, relative volume, candle body/wick ratios
  app/engine.py          Backtest engine: next-bar fills, stop/target rules, metrics
  app/market_data.py     Yahoo Finance OHLCV, cleaned and cached to data/candles/
  app/ai.py              Akamai inference client: prompt -> rules, trade explanation
  app/detective.py       Evidence package and known facts for one trade
  app/storage.py         SQLite persistence for runs
  app/api.py             The seven /api endpoints
  tests/                 Indicator and engine tests
frontend/                Next.js app (proxies /api to the backend)
  src/app/page.tsx       Single page: describe -> review -> results -> detective -> reliability
  src/components/        StrategyBuilder, Charts, Results, TradeDetective, ReliabilityReport
```

## Run locally

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env          # then paste the team key into OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev                     # http://localhost:3000
```

Tests: `cd backend && pytest`. API docs: http://localhost:8000/docs.

## Configuration

`backend/.env` uses the same variable names as the
[Akamai starter kit](https://github.com/akamai-developers/akamai-workshop-hackmidwest):
`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `CHAT_MODEL` (`hackathon-chat`). The key never leaves the backend.

Without a key the app still runs: strategy generation falls back to a small keyword parser (responses are labelled
`rule_based_fallback`) and Trade Detective shows the recorded facts without AI hypotheses.

`frontend/.env.local` can set `BACKEND_URL` if the API is not on `http://localhost:8000`.

## Execution rules the engine enforces

- Signals use completed candles only and fill at the next candle's open.
- If one candle touches both the stop and the target, the stop fills first.
- A candle that opens beyond the stop or target fills at that open.
- Long-only, one position at a time, fixed dollar size in whole shares; unaffordable entries are rejected and counted.
- Commission per order and slippage in basis points are applied to every fill.
- Relative volume divides by the mean of the previous N candles, excluding the current one.

## API

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/strategy/generate` | Plain-English request -> structured rules, clarifications, unsupported items |
| POST | `/api/strategy/validate` | Validate rules; return issues and assumptions |
| GET | `/api/market/candles?symbol=AAPL&timeframe=5m` | Cleaned OHLCV with source metadata |
| POST | `/api/backtest/run` | Run and save a backtest |
| GET | `/api/backtest/{id}` | Stored metrics, trades, equity curve and candles |
| POST | `/api/trades/explain` | Known facts plus AI hypotheses for one trade |
| POST | `/api/backtest/stress-test` | Higher-cost rerun and optional earlier/later period split |
