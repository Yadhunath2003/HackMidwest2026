# StrategyLab AI

**Describe it. Backtest it. Understand it. Validate it.**

StrategyLab AI lets you test a trading idea before you risk money on it. You describe a strategy in plain
English, the app turns it into precise rules, replays those rules over real historical prices, and shows you
every trade it would have taken. Then it helps you work out *why* trades won or lost, and whether the result
still holds up under tougher, more realistic conditions.

It is a research tool. It never places real orders, never connects to a brokerage account, and nothing it
shows is a prediction or financial advice.

Built for the Akamai Cloud AI Challenge at Hack Midwest 2026.

## Why it exists

A strategy that sounds convincing can still lose money, and a backtest that looks great can be misleading.
Most new traders hit the same problems:

- **Testing an idea normally means writing code.** Here you type the idea the way you would explain it to
  a friend.
- **Backtests are easy to get wrong.** Small mistakes, such as using information that was not available yet,
  make results look better than they could ever be in real trading. The engine here applies strict,
  stated rules so results are not flattered.
- **A headline return hides what happened.** You can open any single trade and see the exact candle,
  indicator values, fill prices and costs behind it.
- **One good result proves little.** The reliability report reruns the strategy with higher costs and on a
  different time period, so you can see how fragile it is.

## How it works

1. **Describe.** Type your idea, for example: *"Buy AAPL when EMA(9) crosses above EMA(21), provided
   RSI(14) is below 70; use a 2% stop loss and 4% take profit."*
2. **Review.** The AI returns structured rules. Anything ambiguous or unsupported is pointed out instead of
   being guessed. Nothing runs until you say so.
3. **Backtest.** The rules are replayed candle by candle over real historical data.
4. **Investigate.** Click any trade and ask Trade Detective why it ended the way it did.
5. **Challenge.** Rerun with higher fees and slippage, or compare an earlier period with a later one.
6. **Watch it live (optional).** Save the strategy and follow simulated buy and sell signals on live prices.

## Features

### AI Strategy Builder

Write a strategy in everyday language and get back a rule set you can read and check. The app tells you
which interpretations it made (for example, whether "risk 1%" meant a stop-loss distance or a share of your
account) and which parts of your request it cannot do, so you are never testing something different from
what you meant.

### Rule editor

Adjust the generated strategy without rewriting your description. Change the symbol, timeframe, starting
balance, indicator periods, candle and volume conditions, stop loss, take profit and trading costs with
form controls, or edit the same rules as structured JSON if you prefer. Both views edit one definition and
the server validates it before every run.

### Historical backtesting

Replays your rules over real open, high, low, close and volume data and simulates each entry and exit.
Results always state where the data came from, the exact date range tested and the assumptions used.

### Results dashboard

- **Key numbers:** total return, net profit, number of trades, win rate, maximum drawdown, profit factor,
  fees and slippage paid, and a buy-and-hold comparison for the same period.
- **Candlestick chart:** every entry and exit marked on the price chart, with matched signal candles and a
  volume pane.
- **Equity curve:** how the account value moved over the test.
- **Trade log:** every trade, sortable, with prices, profit or loss, costs and the reason it closed.
- **AI report:** an optional written summary of the recorded results, with limitations and suggested next
  tests.

### AI Trade Detective

Pick any winning or losing trade to see the evidence behind it: the signal candle and its shape, raw and
relative volume, indicator values, entry and exit prices, stop and target levels, and costs. Ask a question
such as *"Why did this trade lose money?"* and the answer keeps two things apart:

- **Known facts**, taken directly from the recorded backtest.
- **Hypotheses** about market conditions, clearly labelled as unverified.

It also suggests one specific change you could test next, without promising that it will improve results.

### Reliability report

A stress test for your strategy. It reruns the same rules on the same data with higher commission and
slippage, and can split the history into an earlier and a later period to compare them. If the profit
disappears once costs rise, or only one period made money, you find out before trading it. Small trade
counts are flagged, because a handful of trades is not reliable evidence.

### Live paper signals

Save a tested strategy and let the app monitor live prices for it. It shows simulated BUY and SELL signals
with prices, quantities, stops and targets, and tracks a virtual balance. This is paper trading: no order is
ever sent to a broker.

### Saved strategies and run history

Completed backtests and saved strategies are stored on the server, so you can reopen earlier results,
search them and compare ideas over time.

## What you can test

| | Supported |
|---|---|
| **Markets** | US stocks (AAPL, SPY, TSLA), spot gold (XAUUSD), Bitcoin (BTCUSD) |
| **Candle timeframes** | 5 minutes, 30 minutes, 1 hour, 4 hours, 1 day |
| **Direction** | Long (buy first) or short (sell first), one direction per strategy |
| **Indicators** | EMA, SMA, RSI, volume, relative volume, candle body and wick size |
| **Exits** | Stop loss, take profit, reverse crossover, and an optional partial exit at a profit trigger |
| **Costs** | Commission per order and slippage, both adjustable |
| **Starting balance** | $10,000 by default, adjustable |

**Entry styles**

- **Moving-average crossover:** enter when a fast EMA or SMA crosses a slow one, with an optional RSI filter.
- **Momentum candle:** enter after a strong candle, defined by body size, wick size and unusually high
  volume. You set the thresholds.
- **Rally, pullback, breakout:** a run of candles in one direction, a short pullback, then a breakout
  beyond the pullback's first candle.
- **AI trend filter:** only take entries when the AI model reads the recent chart as a bullish or bearish
  trend with enough confidence.
- **AI high-volume reference breakout:** mark a high-volume candle against the trend, then enter when a
  later momentum candle breaks past it, with position size based on a set percentage of account risk.

How far back a test can go depends on the market, the timeframe and the data provider configured on the
server. Each result shows the exact period it covered.

## Example prompts

```text
Buy AAPL when EMA(9) crosses above EMA(21), provided RSI(14) is below 70;
use a 2% stop loss and 4% take profit.
```

```text
On AAPL 5-minute candles, buy after a bullish momentum candle with body at least 70% of its
high-low range, upper wick at most 15%, and volume at least twice the average of the preceding
20 candles. Enter on the next candle, risk 1% with a 2% target.
```

```text
Buy XAUUSD on 1-hour candles after 3 green candles, then 1-3 red candles, then a green candle
closing above the first red candle's high. Use a 2% stop loss and 4% take profit.
```

```text
Buy AAPL on daily candles after a bullish momentum candle in an AI-detected bullish trend,
with a 2% stop and 4% target.
```

## How the simulation stays honest

These rules are applied to every backtest and listed alongside every result:

- **No peeking ahead.** A signal is judged only on completed candles, and the trade is filled at the *next*
  candle's opening price.
- **Pessimistic when unsure.** If a single candle touches both your stop loss and your take profit, the
  stop is assumed to have been hit first.
- **Gaps are respected.** If price opens beyond your stop or target, the trade fills at that opening price,
  not at the level you hoped for.
- **Costs are always counted.** Commission and slippage are applied to every fill and reported separately.
- **Missing data is never invented.** Gaps and unavailable volume are reported as such.
- **The AI cannot run code.** The model only produces rules that are checked against a fixed list of
  supported options. Trade facts come from the recorded backtest, not from the model.

## Terms used in the app

| Term | Meaning |
|---|---|
| **Backtest** | Replaying a strategy over past prices to see what it would have done. |
| **Candle** | One time period of price data: the open, high, low and close, plus volume. |
| **EMA / SMA** | Moving averages that smooth price. A fast one crossing a slow one is a common trend signal. |
| **RSI** | A 0 to 100 momentum reading. High values suggest price has risen quickly. |
| **Relative volume** | A candle's volume compared with the average of the candles before it. 2x means twice the usual. |
| **Stop loss / take profit** | The loss and the gain, as a percentage from entry, at which the trade closes. |
| **Slippage** | The difference between the price you expected and the price you got. |
| **Win rate** | The share of trades that made money. A high win rate can still lose money overall. |
| **Maximum drawdown** | The largest fall from a peak in account value to the following low. |
| **Profit factor** | Total profit from winning trades divided by total loss from losing trades. Above 1 is profitable. |
| **Paper trading** | Following signals with a virtual balance instead of real money. |

## What it does not do

- It does not place trades or connect to any brokerage account.
- It does not predict future prices. A strategy that worked on past data can fail tomorrow.
- It does not model everything a broker would: bid-ask spread, liquidity, borrowing costs for short
  positions, margin calls and overnight financing are left out.
- It covers a fixed set of markets and entry styles, not every indicator or instrument.
- AI explanations are interpretations. Treat hypotheses as ideas to test, not as causes.

## Built on Akamai Cloud

The web app and API run in Docker containers on an Akamai Cloud (Linode) compute instance. Strategy
generation, trend reading, reports and trade explanations use Akamai's hosted AI inference endpoint, and
backtest results are stored on the server.

Setup instructions, configuration, engine details and the API reference are in the
[developer guide](DEVELOPMENT.md).
