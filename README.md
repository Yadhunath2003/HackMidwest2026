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

XAUUSD uses Twelve Data's actual `XAU/USD` spot-gold feed, separate from Yahoo equities.
Set `TWELVEDATA_API_KEY` in `backend/.env` using a key entitled to commodity data, then restart the backend.
All five candle periods are supported natively; gold requests return up to the latest 5,000 candles,
subject to provider access. This Twelve Data feed has no volume. With `GOLD_PROVIDER=massive`, gold charts instead use provider quote activity (tick-volume proxy) and volume strategies require `volume_basis: "quote"`. Stock strategies continue to use traded share volume.
Gold positions use 0.01-troy-ounce increments with fixed dollar allocation and no leverage;
broker lots, spread, and overnight financing are not simulated. Enter XAUUSD or XAU/USD in a strategy
description, or use the gold example. No futures or ETF prices are substituted.

`backend/.env` uses the same variable names as the
[Akamai starter kit](https://github.com/akamai-developers/akamai-workshop-hackmidwest):
`OPENAI_BASE_URL`, `OPENAI_API_KEY`, `CHAT_MODEL` (`hackathon-chat`). The key never leaves the backend.

Strategy generation uses the configured inference API and requires `OPENAI_API_KEY`;
it does not silently switch to a keyword parser. Generated rules remain constrained by the
implemented strategy schema and are validated before execution.
Use **Generate AI report** on backtest results for model-written analysis of recorded metrics.
Reliability stress tests also include AI analysis of cost sensitivity and period comparisons.
If AI reporting fails, calculated results remain available and the failure is shown explicitly.
Trade Detective uses the same API for individual-trade explanations.

`frontend/.env.local` can set `BACKEND_URL` if the API is not on `http://localhost:8000`.

## Execution rules the engine enforces

### AI trend detection

Ask for a bullish or bearish trend filter, or enable **Require AI-detected trend** in Advanced Mode.
Example: "Buy AAPL on daily candles after a bullish momentum candle in an AI-detected bullish trend,
with a 2% stop and 4% target." Entry JSON uses `ai_trend` with `direction`, `context_candles`
(default 200), and `min_confidence` (default 0.6).
AI assesses price structure and chooses a variable trend start using only the completed candle and its past context.
The context window bounds available history; it is not a fixed trend length. Fewer than 20 candles,
sideways/uncertain results, and insufficient model confidence prevent entry. Assessments happen only at
candidate entry points, so first runs can require many API calls. Results are cached by exact history,
model/endpoint and prompt version, saved with the run, and displayed in results and trade evidence.
Stress tests reuse original judgments without AI calls. Split comparisons retain those judgments' original
past context; newly arising candidates without recorded judgments are skipped. Model errors abort an
initial backtest rather than silently substituting a trend rule. Short-only strategies are supported as hypothetical simulations; combined long/short strategies require separate definitions.

### High-volume reference breakout

`ai_reference_breakout` marks a high-volume red candle when AI judges its trend bearish, then waits
for a later green momentum candle breaking above that high when AI judges the trend bullish.
Entry fills at the next open; stop is the marked red candle's low. Whole shares (stocks) or 0.01-ounce units (gold) are sized for a
planned loss of 1% of current equity including modeled costs, capped by cash. The target produces
a net 2% gain on account equity at entry (not a 2% price rise). Gaps can exceed planned risk.
Reference volume defaults to 2× the preceding 20 candles; momentum body defaults to 70% of range.
Breakout defaults to a close above the marked high. New qualifying references replace older ones;
a touch of the marked low before entry invalidates the setup. Each reference allows one entry attempt.
Advanced Mode exposes these settings in `reference_breakout`, including account risk/target percentages.
Legacy fixed size and percentage stop/target fields are ignored for this type. Current XAUUSD spot data
has no traded volume. Massive gold reference setups use explicitly selected quote activity (`volume_basis: "quote"`), while the Twelve Data gold feed still cannot support volume filters.

The price chart includes a standard Volume histogram in a separate pane with the same time axis.
Bars are green for candles closing at or above their open, and red for candles closing below it.
Use the Volume checkbox to hide/show the pane; hovering shows the corresponding candle's volume.
Feeds without volume display an unavailable message instead of fabricated bars. Massive XAUUSD displays quote activity with a tick-volume label.

Natural-language strategies also support a bullish rally / red pullback / green breakout pattern.
For example: "Buy AAPL after 3 green candles, then 1-3 red candles, then a green candle
that closes above the first red candle's high. Use a 2% stop loss and 4% take profit."
The generated `bullish_pullback_breakout` entry includes `pullback_breakout` settings for
`rally_min_candles`, `pullback_min_candles`, `pullback_max_candles`, and `breakout_by` (`close` or `high`).
Defaults are 3 green candles, 1-3 red candles, and a closing breakout. The first green candle
must break the level; flat candles invalidate the sequence. This rule uses candle colors,
not a general higher-high/higher-low trend definition. Simple Mode displays the selected rules;
Advanced Mode provides editable form controls alongside synchronized strategy JSON, including
market, indicator, candle, rally/pullback, exit, and cost settings.
The server runs the implemented rule, not model-generated Python.

Supported candle periods: **5 minutes, 30 minutes, 1 hour, 4 hours, and 1 day**
(`5m`, `30m`, `1h`, `4h`, `1d`). Five-minute and 30-minute requests use the last 60 days;
hourly, four-hour, and daily requests use up to 2 years, subject to provider availability.
Four-hour candles aggregate hourly data from the 09:30 New York market open within each trading day.
The final candle is shorter; forming candles are excluded until their scheduled end.

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
# Extended stock history

To prefetch every supported chart, run `python -m app.cache_all` from `backend/`. This downloads/caches charts without AI backtests and writes a coverage inventory under `backend/data/candles/chart_inventory.json`. Massive five-minute stock archives also supply 30-minute OHLCV locally; hourly/four-hour/daily equities use their configured Yahoo history. To use the Massive key for spot gold, set `GOLD_PROVIDER=massive`: all five gold timeframes share the five-minute spot archive, with larger bars aggregated on UTC clock boundaries. Massive gold charts show quote activity, explicitly labeled as a tick-volume proxy; it is not traded ounces or contracts. Provider quota limits can pause initial downloads for a minute before retrying.

For a Massive API key, use the Massive provider settings instead:

```dotenv
MASSIVE_API_KEY=your_key_here
STOCK_INTRADAY_PROVIDER=massive
STOCK_INTRADAY_HISTORY_DAYS=365
```

Restart the backend after editing `.env`. Massive stock requests fetch paginated 5-minute or 30-minute OHLCV with split adjustments, restrict candles to regular US trading hours, and cache the actual available date range. History depends on your plan. A Massive key authenticates only with Massive; it does not work with Twelve Data or the gold feed.

For stock history older than Yahoo's 60-day 5m/30m window, set these in `backend/.env` and restart the backend:

```dotenv
TWELVEDATA_API_KEY=your_key_here
STOCK_INTRADAY_PROVIDER=twelvedata
STOCK_INTRADAY_HISTORY_DAYS=365
```

The app downloads stock OHLCV in batches of up to 5,000 candles and caches the result. Available history depends on the provider's instrument coverage and your plan. Results show the actual date range and warn about shortened coverage or cached fallback after a provider error. Hourly/daily equity history still uses Yahoo; spot gold retains its existing Twelve Data feed. The first extended stock download makes multiple API requests; increasing history also increases AI backtest workload. Set the provider back to `yahoo` to use the original feed.

# Partial exits

Partial exits are supported through the optional strategy field:

```json
"partial_exit": {"fraction": 0.5, "profit_pct": 1, "basis": "account"}
```

For the AI reference-breakout strategy, this sells half the original quantity when the trade reaches a net 1% account gain if the entire position were liquidated, including modeled split commissions and slippage. Selling half realizes only part of that gain. The original stop remains in place; the remaining target is recalculated so realized partial profit plus the final sale reaches the configured net account-profit target. `basis: "price"` instead triggers on a percentage price rise from the entry fill. Account-based partials require the reference-breakout strategy. One partial target is supported.

Advanced Mode edits partial-exit settings; Simple Mode displays them. Quantities round down to whole shares or 0.01 gold ounces; an unfillable partial or one at/above the final target is skipped and recorded. Each sell pays commission. Intrabar stop/partial ambiguity assumes the stop first, while an opening gap above the partial trigger fills that partial at the open before later intrabar checks. Completed trades include every sell fill, quantity-weighted average exit price, total fees and total profit; chart markers show partial and final exits separately.

# AI token controls

Output limits are configurable in `backend/.env` (restart the backend after changing them):

```dotenv
AI_TREND_INITIAL_TOKENS=700
AI_TREND_MAX_TOKENS=2800
AI_STRATEGY_MAX_TOKENS=2000
AI_REPORT_MAX_TOKENS=1600
AI_EXPLANATION_MAX_TOKENS=900
```

Each value must be a whole number between 128 and 32768. The trend maximum must be at least the initial limit. Provider and model limits still apply. Truncated trend checks retry at the initial limit, twice that limit (capped), and the maximum, omitting duplicate limits. These are output limits per request, not a total backtest budget.

Trend input uses compact OHLCV arrays with explicit column names and zero-based row indexes, preserving every supplied value and the configured history length. Existing judgments from the earlier input format remain reusable.

Running backtests show AI requests, cache hits, and reported tokens. Saved results include input, output, and total token counts for that backtest, including truncated attempts. Cached judgments add no new token usage. If the provider omits usage, counts are marked incomplete rather than estimated. Strategy generation, reports, and trade explanations are excluded from the backtest totals. Tracking does not enforce a spending cap.

## Live paper signals

BTC/USD is supported as `BTCUSD` on 5m, 30m, 1h, 4h and 1d candles. Both
backtests and real-time paper signals use Kraken's public spot OHLC feed; no crypto
API key is required. Volume is BTC traded on Kraken. Quantities use 0.00000001 BTC
increments in this simulator, not broker-enforced order minimums. Trading is 24/7.
Kraken exposes roughly 720 recent completed candles per interval: initially about
2.5 days at 5m, 15 days at 30m, 30 days at 1h, 120 days at 4h, and 720 days at 1d.
Previously cached completed candles are retained when refreshing. AI trend requests
still use the configured AI key. No crypto exchange orders are submitted.

After a completed backtest, name and save its strategy, or delete the result. Saved
strategies snapshot the tested rules and execution costs; subsequent editor changes
do not change that snapshot. Go to **Live paper signals** (`/live`), select a saved
strategy, and start monitoring. The app emits BUY/SELL signals with paper prices,
quantities, stops, targets, market timestamps and detection timestamps. It never
submits orders to a broker. Delete saved strategies from the live page; stop an
active session first. Deleting a result does not delete candle or AI caches.

Real-time feeds require configuration in `backend/.env` and a backend restart:

```dotenv
ALPACA_API_KEY=
ALPACA_API_SECRET=
OANDA_API_TOKEN=
OANDA_ACCOUNT_ID=
```

Stocks use Alpaca IEX real-time bars. IEX is one exchange, so its volume and signals
can differ from consolidated historical stock data. Gold uses OANDA practice
midpoint candles and quote activity; XAU_USD must be available on that account.
Historical providers are never silently substituted for these real-time feeds.
Provider access and subscription terms still apply.

The backend polls every 15 seconds. Entry rules evaluate completed candles only;
forming candles can fill an already-pending paper entry and trigger protective
exits. Signals can arrive after the reported market time, particularly after an
outage or slow AI request. These are simulated fills rather than executable broker
quotes; spread, liquidity and financing are not modeled. Stops take priority when
an observed candle touches both stop and target. A session starts with historical
indicator warm-up, which does not produce historical trade alerts.

One session runs at a time. SQLite persists its virtual balance, position, pending
setup, candle context and signals. Active sessions resume polling after restart.
Stopping freezes a session without closing its virtual position or issuing a SELL.
Keep the backend running to monitor markets, even if the browser is closed. Run
**one backend worker**; multiple processes would duplicate monitoring. AI calls use
the configured API and cached trend assessments; this does not impose a spending cap.
# Free extended BTC/USD history

From `backend`, run `python -m app.import_crypto_history`. This downloads only
BTC/USD members from Kraken's public split ZIP archive using HTTP byte ranges,
validates candles and ZIP CRCs, and imports two years ending at the archive's
June 30, 2026 cutoff. Recent Kraken API candles are merged without deleting the
archive. No credentials or AI requests are needed. The archive version is pinned
in `app/import_crypto_history.py`; update it when Kraken publishes newer data.

The five supported timeframes are imported; 30-minute candles require six complete
5-minute bars. Cache files live in `backend/data/candles/BTCUSD_*.json` and survive
app restarts. Metadata lists missing intervals; absent prices are never fabricated.
Backtests use the largest segment without gaps longer than one day (or two candles
for longer intervals), so hourly backtests may end June 30 rather than today.
Restart the backend to load the new gap-handling code; this interrupts active jobs.

In Docker this import is automatic: the backend container runs `python -m app.ensure_history`
before starting, which imports the archive when any BTC/USD timeframe has less than a year of
cached history and otherwise does nothing. If the archive is unreachable the backend still
starts with Kraken's recent candles; rerun the importer with
`docker compose exec backend python -m app.import_crypto_history`.


### Short-selling simulations

Generate a strategy with an explicit short/sell-to-open description, or choose
Short in Advanced Mode (`direction: "short"`). Existing strategies default to Long.
EMA/SMA short entries cross below, and reverse exits cross above, at the next open.
Stops sit above entry and targets below it. Bearish pullback and mirrored AI
reference-volume setups, account-risk sizing, partial covers, historical charts
and paper signals support shorts. Charts label SELL SHORT and BUY TO COVER.

Shorts reserve 100% entry-notional collateral from virtual equity; sale proceeds
are not spendable. Borrow availability/costs, funding, margin liquidation and broker
orders are not modeled. A strategy trades one direction only; generate separate
long and short strategies. Restart the backend after active jobs finish to load
the change. The independent verification script currently accepts long equity
reference strategies only and rejects short runs explicitly.
