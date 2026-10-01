# Backtesting and tests

Nothing here proves a strategy makes money. It tells you how the **exact live rules** would have
behaved on past data, including costs, so you can decide whether paper trading is worth continuing.

## Run the tests

```bash
pnpm test        # strategies, risk rules, indicators, backtest engine
pnpm typecheck
```

## Run a backtest

```bash
pnpm backtest                                     # all five markets, last 2 years
pnpm backtest --market gold --from 2022-01-01     # one market, custom start
pnpm backtest --market btc --trades               # print every trade
pnpm backtest --out results.json                  # full results incl. equity curve
pnpm backtest --market spx --csv data/spy_15m.csv # your own OHLCV file, no API keys
```

Data comes from Alpaca using `ALPACA_API_KEY` / `ALPACA_API_SECRET` from `.env.local` and is cached
in `.cache/bars/` (use `--refresh` to refetch). `ALPACA_DATA_FEED=sip` gives full-market volume
if your plan includes it; the free `iex` feed has thin volume.

Costs default to 0 bps fees + 2 bps slippage for ETFs and 25 bps fees + 5 bps slippage for BTC.
Override with `--fee-bps` and `--slippage-bps`. Always rerun with doubled costs before trusting a result.

## How the simulation matches live trading

| Live behaviour                                         | Backtest                                          |
| ------------------------------------------------------ | ------------------------------------------------- |
| Strategy sees closed bars only, trailing 250-bar window | Same function, same window                        |
| Market order 1-3 min after the bar closes              | Fills at the next bar's open + slippage           |
| Equity signals deferred while the US session is closed | Dropped when the session is closed at the bar close |
| 15m index bars restricted to the regular session       | Same filter                                       |
| ATR stop: equities from signal close, crypto from fill | Same distance and anchors, checked intrabar; gaps fill at the open |
| 1% of equity at risk, leverage cap, broker minimums    | Same `positionSize` on marked-to-market equity; too-small trades skipped |

**Not modelled:** the cross-market correlation filter, combined 3% open-risk cap and cross-market
leverage cap (each market runs alone on full starting equity), short borrow fees, partial fills, and crypto stop-limits that fail
to fill in a fast move.

## Reading the summary

- **Return vs B&H**: strategy return against simply holding the instrument over the same bars.
- **Exp(R)**: average trade in units of its planned risk (1% of equity at the stop). Above roughly +0.1R after costs is
  interesting; below zero means the edge does not survive costs.
- **PF**: gross profit / gross loss. Under 1.0 loses money.
- **Stops**: how many exits were stop-outs. A high share means the ATR stop multiple is too tight for
  that market and timeframe.
- Few trades (under ~30) means the numbers are mostly noise.

## A sensible bar before going live

1. Positive expectancy after doubled costs on at least two separate periods (e.g. 2022 and 2024).
2. Max drawdown you could sit through with real money.
3. Several weeks of paper trading whose fills roughly match the backtest over the same dates.
