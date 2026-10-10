# StrategyLab AI — Hack Midwest 2026 MVP

**Challenge:** Akamai Cloud AI Challenge  
**Tagline:** Describe it. Backtest it. Understand it. Validate it.

## 1. Project overview

StrategyLab AI is a web application that lets traders describe a trading strategy in plain English, turn that description into validated trading rules, run a historical backtest using real market data, investigate individual trades with AI, and stress-test the strategy before risking money.

**MVP goal:** Demonstrate one reliable end-to-end workflow running on Akamai Cloud. This is a trading research tool—not a broker, a live-money trading system, or a promise of future profitability.

## 2. Core MVP features

| # | Feature | User capability | Priority |
|---|---|---|---|
| 1 | AI Strategy Builder | Describe a strategy in natural language and generate supported, structured trading rules | P0 |
| 2 | Hybrid Editor | Edit strategy parameters in Simple Mode or structured JSON in Advanced Mode | P0 |
| 3 | Historical Backtesting | Simulate trades using real historical price candles | P0 |
| 4 | Performance Dashboard | View returns, win rate, maximum drawdown, costs, equity curve and trade history | P0 |
| 5 | AI Trade Detective | Select a trade and receive an evidence-grounded explanation of entry and exit | P0 |
| 6 | Strategy Stress Test | Compare initial performance against higher costs and/or unseen historical data | P1 |

**Not in MVP:** Real-money trading, brokerage authentication, automatic order execution, multi-asset portfolio optimization, comprehensive indicator libraries, or guaranteed live alerts.

## 3. Primary user workflow

1. **Describe:** User enters, for example: “Buy AAPL when EMA(9) crosses above EMA(21), provided RSI(14) is below 70; use a 2% stop loss and 4% take profit.”
2. **Generate:** AI returns a structured strategy definition. The app flags unsupported or ambiguous requests.
3. **Review:** User edits parameters in Simple Mode or JSON in Advanced Mode. Both modes operate on the same strategy definition.
4. **Backtest:** Server processes historical market candles and simulates entries/exits with explicit execution assumptions.
5. **Inspect:** User sees candlesticks, trade markers, performance metrics and a chronological trade log.
6. **Investigate:** User clicks a losing or winning trade. AI explains the actual signal, indicator values, exit reason and costs using saved backtest evidence.
7. **Challenge:** User tests higher transaction costs or an out-of-sample period and compares results.

## 4. Supported trading scope

| Setting | MVP scope |
|---|---|
| Asset class | US equities |
| Symbols | Start with AAPL or SPY; add TSLA only if data is available |
| Candle timeframe | 5-minute preferred; daily candles are a fallback if intraday data access is limited |
| Indicators | EMA, SMA, RSI, volume, relative volume (RVOL), candle-body and wick measurements |
| Entry logic | Moving-average crossover, optional RSI, relative-volume threshold, and deterministic candle-shape or momentum conditions |
| Exit logic | Stop loss, take profit, and optionally reverse crossover |
| Positions | Long-only, one position at a time |
| Sizing | Fixed dollar allocation |
| Initial capital | $10,000 default, user configurable |
| Trading costs | Configurable commission and slippage |

**Candle data requirement:** Historical data must include open, high, low, close and volume (OHLCV). Do not invent missing volume; distinguish reported share volume from proxy/tick volume. Calculate relative volume from past candles only, and display any data limitations.

**Backtest correctness requirements:** Prevent look-ahead bias; calculate indicators only from previously available candles; execute signals at the next eligible price; define behavior when a candle crosses both stop-loss and take-profit levels; track costs and rejected trades. The source, time range, adjustment status and data resolution must be visible in results.

## 5. App screens

### Screen 1 — Strategy Builder
- Natural-language prompt box and **Generate Strategy** action.
- Symbol, timeframe and starting balance selectors.
- **Simple Mode:** indicator periods, candle/volume conditions (body %, wick %, RVOL), stop loss and take profit controls.
- **Advanced Mode:** editable, validated structured JSON (not unrestricted executable Python).
- Validation errors and assumptions shown before the run.

### Screen 2 — Backtest Results
- Historical candlestick chart with entry and exit markers.
- Metrics: total return, win rate, number of completed trades, maximum drawdown, total fees, profit factor where defined.
- Equity curve and complete sortable trade log.
- Market-data source, test date range and execution assumptions.

### Screen 3 — AI Trade Detective
- Select a specific trade.
- Show timestamp, entry/exit price, position size, indicators, candle anatomy, raw volume, relative volume, order triggers, realized P&L, fees and market context.
- Ask: “Why did this trade lose money?”
- Explanation must distinguish **known execution facts** from **hypotheses about market conditions**.
- Suggest a testable change without promising improved returns.

### Screen 4 — Reliability Report
- Original result versus rerun with increased fees/slippage.
- Optional train/test period split and comparison on unseen data.
- Explain performance differences and small-sample limitations.

## 6. Akamai architecture

```text
Browser: Next.js / React UI
          |
          v
Akamai Cloud (Linode compute instance)
  - API: Python FastAPI
  - Strategy JSON validation
  - Backtesting engine (Backtesting.py or equivalent)
  - Performance and stress-test calculations
  - OHLCV candle feature extraction and pattern classification
  - AI inference client
          |                      |
          v                      v
Akamai-hosted inference     Historical market-data provider
  - Prompt → rules           - Real OHLCV candles
  - Trade explanation
          |
          v
Persistent storage
  - MVP: SQLite on VM
  - Optional: PostgreSQL / Akamai Object Storage
  - Strategies, runs, trades, assumptions, source metadata
```

**Akamai contribution:** Serve the deployed app/API on Akamai compute, call the hackathon-provided hosted AI inference endpoint, and persist real backtest output. Use the official starter kit for credential setup and deployment. Do not provision Kubernetes or a GPU unless they directly solve a demonstrated need.

**Security:** API keys stay server-side. Never execute arbitrary AI-generated Python. Validate generated JSON against a strict schema and supported operator list.

## 7. Initial API contract

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/strategy/generate` | Natural-language request → structured rules |
| POST | `/api/strategy/validate` | Validate rules and return issues/assumptions |
| GET | `/api/market/candles` | Fetch validated historical OHLCV series |
| POST | `/api/backtest/run` | Execute and save backtest |
| GET | `/api/backtest/{id}` | Retrieve stored metrics, trades and chart data |
| POST | `/api/trades/explain` | Explain a selected trade with evidence |
| POST | `/api/backtest/stress-test` | Run cost and/or out-of-sample comparison |

### Example strategy representation

```json
{
  "symbol": "AAPL",
  "timeframe": "5m",
  "entry": {
    "type": "ema_crossover",
    "fast_period": 9,
    "slow_period": 21,
    "rsi_period": 14,
    "rsi_below": 70,
    "candle_conditions": {
      "direction": "bullish",
      "body_to_range_min": 0.70,
      "upper_wick_to_range_max": 0.15,
      "relative_volume_min": 2.0,
      "relative_volume_lookback": 20
    }
  },
  "stop_loss_pct": 2,
  "take_profit_pct": 4,
  "initial_capital": 10000,
  "position_size_usd": 1000
}
```

**Backtest output must include:** Strategy version, market-data source and time span, execution assumptions, metrics, equity curve, individual trades and timestamped entry/exit reasons. The explanation endpoint should use this output rather than inventing trade facts.

## 8. Candle anatomy, volume and momentum requirements (added)

### Definitions for deterministic testing

For each completed OHLCV candle:

- `range = high - low`
- `body = abs(close - open)`
- `body_to_range = body / range` when range > 0
- `upper_wick = high - max(open, close)`
- `lower_wick = min(open, close) - low`
- `upper_wick_to_range = upper_wick / range` when range > 0
- `lower_wick_to_range = lower_wick / range` when range > 0
- `relative_volume = current_volume / mean(previous N completed candle volumes)` when that mean > 0; **exclude the current candle from the baseline**

If range is zero or volume history is insufficient, return an explicit non-match / unavailable value rather than division by zero. Volume comparisons across intraday timestamps may be biased by typical time-of-day volume variation; a time-of-day-adjusted baseline is a future improvement.

### Momentum candle (configurable preset)

A candidate bullish momentum candle can be defined as:

- `close > open`
- `body_to_range >= 0.70`
- `upper_wick_to_range <= 0.15`
- `relative_volume >= 2.0` using previous 20 completed candles

These cutoffs are user-configurable **example parameters**, not universal trading definitions. Bearish momentum reverses direction and can instead limit lower-wick size. Provide the exact matched candle and computed values in Trade Detective.

### Simple and Advanced modes

**Simple Mode:** Checkbox/preset for bullish momentum candle; sliders for minimum body percentage, maximum wick percentage, relative-volume multiplier and baseline period; optional EMA/RSI confirmations. The UI previews which historical candles match.

**Advanced Mode:** Edit the same validated structured conditions as JSON. The app can show rule explanations; do not execute arbitrary generated Python.

### Pattern support and priorities

- **P0:** bullish/bearish direction, body ratio, upper/lower wick ratios, relative volume and configurable momentum-candle preset.
- **P1:** doji, hammer, shooting star, bullish/bearish engulfing, inside/outside bar, consecutive candles and breakout closes.
- **P2:** advanced multi-candle custom pattern combinations and time-of-day-normalized relative volume.

Use mechanical definitions for named patterns and disclose settings. The patterns are geometric labels rather than guarantees of future price movement. When evaluating a completed candle, the earliest assumed order is the **next candle's eligible open** (subject to execution settings); no current-candle future information is allowed.

### Example natural-language strategy

> On AAPL 5-minute candles, buy after a bullish momentum candle with body at least 70% of its high-low range, upper wick at most 15%, and volume at least twice the average of the preceding 20 candles. Enter on the next candle, risk 1% with a 2% target.

The AI must resolve whether “risk 1%” means stop-loss distance or account risk/position sizing, rather than guessing.

### Acceptance tests for new feature

- [ ] Ingest real OHLCV data; validate volume availability.
- [ ] Candle body, wick and RVOL metrics match hand-calculated examples.
- [ ] Momentum preset can be edited in both UI modes.
- [ ] Matched candles appear on the historical chart.
- [ ] Backtest entries are placed no earlier than the next eligible candle after a completed signal.
- [ ] Trade Detective reports triggering candle shape, raw volume and RVOL with source timestamps.

## 9. 24-hour implementation plan

| Time | Work | Deliverable |
|---|---|---|
| Hours 0–4 | Akamai deployment and market-data acquisition | Publicly reachable basic app + validated candle dataset |
| Hours 4–9 | Trading engine and calculation tests | Reproducible backtest with real trade log |
| Hours 9–13 | AI inference and structured strategy validation | Plain-English strategy → valid executable configuration |
| Hours 13–17 | Frontend, hybrid editor and charts | Usable end-to-end UI |
| Hours 17–20 | Trade Detective and stress testing | Evidence-grounded explanation and comparative run |
| Hours 20–24 | Integration testing, fixes, presentation | Stable three-minute demo |

Work on frontend and backend in parallel wherever possible. Prioritize correctness and deployment over styling and extra indicators.

## 10. MVP acceptance checklist

- [ ] Application opens from a public Akamai-hosted URL.
- [ ] Hosted AI inference works with authorized hackathon credentials.
- [ ] At least three supported sample prompts generate valid rules.
- [ ] Simple and Advanced modes use the same strategy definition.
- [ ] Real historical candles load with visible source and timestamps.
- [ ] Backtests produce reproducible trades, metrics and equity curves.
- [ ] Trades appear as entry/exit markers on a chart.
- [ ] A selected trade has an explanation linked to recorded data.
- [ ] At least one higher-cost or out-of-sample comparison works.
- [ ] Unsupported inputs and unavailable data fail with useful errors.
- [ ] A complete three-minute demonstration runs reliably.

## 11. Three-minute hackathon demo

| Time | Demo action |
|---|---|
| 0:00–0:30 | State problem: attractive backtests can hide real trading risk |
| 0:30–1:00 | Type an English strategy; show Akamai AI generate structured rules |
| 1:00–1:40 | Run historical backtest; show real candles, trades and results |
| 1:40–2:20 | Click a losing trade and show AI Trade Detective explaining recorded facts |
| 2:20–2:45 | Stress-test costs or unseen data and compare outcomes |
| 2:45–3:00 | Show deployment architecture and finish with the product's value |

## 12. Fit with Akamai judging criteria

| Criterion | Evidence from StrategyLab AI |
|---|---|
| Impact & Usefulness | Helps users critically assess trading ideas before risking money |
| Powered by Akamai | Deployed backend/frontend plus hosted AI inference and storage |
| Technical Execution | Actual reproducible backtesting with validated logic and graceful errors |
| Creativity & Innovation | Trade-level investigation and reliability testing beyond a chatbot |

## 13. Key risks and mitigations

- **Unreliable intraday data:** Confirm provider coverage immediately; fall back to daily OHLCV if necessary.
- **Backtest bias:** Enforce next-bar execution and carefully define same-candle exit assumptions.
- **Misleading AI explanations:** Supply structured trade evidence; separate facts and possible causes.
- **Unsafe generated code:** Accept validated JSON only; do not execute arbitrary Python from the model.
- **Underbuilt demo:** Freeze feature scope early and protect the end-to-end working path.
- **Overstated financial claims:** Label historical results as simulations, not future-return guarantees.

## 13. Official development resources

- [Hack Midwest × Akamai Cloud Starter Kit](https://github.com/akamai-developers/akamai-workshop-hackmidwest)
- [Akamai Cloud documentation](https://techdocs.akamai.com/cloud-computing/docs/welcome)
- [Akamai Cloud hackathon registration and credits](http://login.linode.com/signup?promo=akm-dev-hack-mid-300-100826-K277)

---

**Core demo promise:** A trader describes an idea → Akamai-hosted AI generates validated rules → an Akamai-hosted engine runs a real backtest → the user investigates a trade using actual evidence → a stress test reveals whether results withstand more realistic assumptions.
