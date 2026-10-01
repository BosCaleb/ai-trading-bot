/**
 * Backtest the live strategies on historical data.
 *
 *   pnpm backtest                                   all five markets, last 2 years, Alpaca data
 *   pnpm backtest --market btc --from 2023-01-01    one market, custom range
 *   pnpm backtest --market gold --csv data/gld.csv  your own OHLCV file, no API keys needed
 *   pnpm backtest --trades --out results.json       print every trade, save full results
 *
 * Flags: --market <spx|ndx|btc|gold|oil|all> --from <YYYY-MM-DD> --to <YYYY-MM-DD> --csv <file>
 *        --equity <n> --fee-bps <n> --slippage-bps <n> --refresh --trades --out <file>
 *
 * Alpaca keys are read from .env.local / .env (ALPACA_API_KEY, ALPACA_API_SECRET, ALPACA_DATA_FEED).
 * Bars are cached in .cache/bars; pass --refresh to refetch.
 */
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { type BacktestResult, runBacktest } from '@/lib/backtest/engine'
import { loadBarsCached, loadBarsCsv } from '@/lib/backtest/history'
import { MARKETS, MARKET_BY_ID, STRATEGY_META, TIMEFRAME_META } from '@/lib/trading/markets'
import type { MarketConfig, MarketId } from '@/lib/trading/types'

for (const file of ['.env.local', '.env']) {
  if (existsSync(file)) process.loadEnvFile(file)
}

const { values } = parseArgs({
  options: {
    market: { type: 'string', default: 'all' },
    from: { type: 'string' },
    to: { type: 'string' },
    csv: { type: 'string' },
    equity: { type: 'string', default: '100000' },
    'fee-bps': { type: 'string' },
    'slippage-bps': { type: 'string' },
    refresh: { type: 'boolean', default: false },
    trades: { type: 'boolean', default: false },
    out: { type: 'string' },
  },
})

function fail(message: string): never {
  console.error(`backtest: ${message}`)
  process.exit(1)
}

const markets: MarketConfig[] =
  values.market === 'all'
    ? MARKETS
    : [MARKET_BY_ID[values.market as MarketId] ?? fail(`unknown market "${values.market}". Use ${MARKETS.map((m) => m.id).join(', ')} or all.`)]
if (values.csv && markets.length !== 1) fail('--csv needs a single --market')

const to = values.to ? new Date(values.to) : new Date()
const from = values.from ? new Date(values.from) : new Date(to.getTime() - 2 * 365 * 86_400_000)
if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) fail('invalid --from/--to range')

const costs = {
  ...(values['fee-bps'] !== undefined ? { feeBps: Number(values['fee-bps']) } : {}),
  ...(values['slippage-bps'] !== undefined ? { slippageBps: Number(values['slippage-bps']) } : {}),
}
const initialEquity = Number(values.equity)

const num = (n: number | null, digits = 2, suffix = '') => (n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(digits)}${suffix}`)
const day = (ms: number) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ')

function printSummary(results: BacktestResult[]) {
  const rows = results.map((r) => {
    const m = r.metrics
    return {
      Market: `${r.market.displaySymbol} ${TIMEFRAME_META[r.market.timeframe].label}`,
      Strategy: STRATEGY_META[r.market.strategy].short,
      Return: num(m.totalReturnPct, 1, '%'),
      'B&H': num(m.buyAndHoldPct, 1, '%'),
      CAGR: num(m.cagrPct, 1, '%'),
      MaxDD: num(m.maxDrawdownPct, 1, '%'),
      Sharpe: num(m.sharpe, 2),
      Trades: String(m.trades),
      'Win%': num(m.winRatePct, 0, '%'),
      PF: num(m.profitFactor, 2),
      'Exp(R)': num(m.expectancyR, 2),
      'Avg bars': num(m.avgBarsHeld, 1),
      Stops: `${m.exitsByReason.stop}/${m.trades}`,
      Exposure: num(m.exposurePct, 0, '%'),
    }
  })
  console.table(rows)
}

function printTrades(r: BacktestResult) {
  console.log(`\n${r.market.name} trades`)
  for (const t of r.trades) {
    console.log(
      `${day(t.entryTime)} -> ${day(t.exitTime)}  ${t.side.padEnd(5)} ${String(t.qty).padStart(8)} @ ${t.entryPrice.toFixed(2).padStart(10)} -> ${t.exitPrice
        .toFixed(2)
        .padStart(10)}  ${(t.returnPct * 100).toFixed(2).padStart(6)}%  ${t.rMultiple.toFixed(2).padStart(5)}R  ${t.exitReason}`,
    )
  }
}

async function main() {
  console.log(`Backtest ${from.toISOString().slice(0, 10)} -> ${to.toISOString().slice(0, 10)}, starting equity $${initialEquity.toLocaleString('en-US')}\n`)
  const results: BacktestResult[] = []
  for (const market of markets) {
    process.stdout.write(`Loading ${market.displaySymbol} ${market.timeframe}... `)
    const bars = values.csv ? await loadBarsCsv(market, values.csv) : await loadBarsCached(market, from, to, { refresh: values.refresh })
    const inRange = values.csv ? bars.filter((b) => b.t >= from.getTime() && b.t < to.getTime()) : bars
    console.log(`${inRange.length} bars`)
    if (inRange.length === 0) {
      console.warn(`  no bars for ${market.displaySymbol}; skipped`)
      continue
    }
    const result = runBacktest({ market, bars: inRange, initialEquity, costs })
    results.push(result)
    if (result.skippedClosedSession) console.log(`  ${result.skippedClosedSession} signals fell outside the regular session and were not traded (as live)`)
  }

  console.log()
  printSummary(results)
  if (values.trades) results.forEach(printTrades)

  console.log(
    '\nEach market is run on its own with full starting equity. Not modelled: correlation filter, gross cap, short borrow fees, crypto stop-limit misses.',
  )

  if (values.out) {
    await writeFile(values.out, JSON.stringify(results, null, 2))
    console.log(`Full results written to ${values.out}`)
  }
}

main().catch((err) => fail((err as Error).message))
