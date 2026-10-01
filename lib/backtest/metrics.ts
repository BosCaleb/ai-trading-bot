import type { Bar } from '@/lib/trading/types'
import type { EquityPoint, Trade } from './engine'

export interface BacktestMetrics {
  totalReturnPct: number
  /** Compound annual growth rate; null for spans under 30 days where it is meaningless */
  cagrPct: number | null
  maxDrawdownPct: number
  /** Annualised from per-bar equity returns, risk-free rate 0 */
  sharpe: number | null
  trades: number
  winRatePct: number | null
  /** Gross profit / gross loss; null with no losing trades */
  profitFactor: number | null
  avgTradePct: number | null
  avgWinPct: number | null
  avgLossPct: number | null
  /** Mean pnl per trade in units of the planned 1% risk */
  expectancyR: number | null
  avgBarsHeld: number | null
  /** Share of bars with a position open */
  exposurePct: number
  exitsByReason: Record<'signal' | 'stop' | 'end_of_data', number>
  longTrades: number
  shortTrades: number
  /** Underlying's own move over the same bars, for context */
  buyAndHoldPct: number
}

const YEAR_MS = 365.25 * 86_400_000

function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

export function maxDrawdown(curve: EquityPoint[]): number {
  let peak = -Infinity
  let worst = 0
  for (const p of curve) {
    peak = Math.max(peak, p.equity)
    if (peak > 0) worst = Math.min(worst, (p.equity - peak) / peak)
  }
  return worst
}

export function sharpeRatio(curve: EquityPoint[], barsPerYear: number): number | null {
  if (curve.length < 3) return null
  const returns: number[] = []
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1].equity > 0) returns.push(curve[i].equity / curve[i - 1].equity - 1)
  }
  const m = mean(returns)
  if (m === null) return null
  const variance = returns.reduce((acc, r) => acc + (r - m) ** 2, 0) / (returns.length - 1)
  const sd = Math.sqrt(variance)
  if (sd === 0) return null
  return (m / sd) * Math.sqrt(barsPerYear)
}

export function computeMetrics(input: {
  trades: Trade[]
  equityCurve: EquityPoint[]
  initialEquity: number
  bars: Bar[]
  barMs: number
}): BacktestMetrics {
  const { trades, equityCurve, initialEquity, bars, barMs } = input
  const finalEquity = equityCurve.length ? equityCurve[equityCurve.length - 1].equity : initialEquity
  const totalReturn = finalEquity / initialEquity - 1

  const spanMs = bars.length ? bars[bars.length - 1].t + barMs - bars[0].t : 0
  const years = spanMs / YEAR_MS
  const cagr = spanMs >= 30 * 86_400_000 && finalEquity > 0 ? (finalEquity / initialEquity) ** (1 / years) - 1 : null
  // Calendar-based so sessions, weekends and 24/7 crypto all annualise correctly.
  const barsPerYear = years > 0 ? bars.length / years : 0

  const wins = trades.filter((t) => t.pnl > 0)
  const losses = trades.filter((t) => t.pnl <= 0)
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0)
  const grossLoss = -losses.reduce((a, t) => a + t.pnl, 0)

  const barsInMarket = trades.reduce((a, t) => a + t.barsHeld, 0)
  const first = bars[0]?.o ?? 0
  const lastClose = bars[bars.length - 1]?.c ?? 0

  return {
    totalReturnPct: totalReturn * 100,
    cagrPct: cagr === null ? null : cagr * 100,
    maxDrawdownPct: maxDrawdown(equityCurve) * 100,
    sharpe: barsPerYear > 0 ? sharpeRatio(equityCurve, barsPerYear) : null,
    trades: trades.length,
    winRatePct: trades.length ? (wins.length / trades.length) * 100 : null,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    avgTradePct: mean(trades.map((t) => t.returnPct * 100)),
    avgWinPct: mean(wins.map((t) => t.returnPct * 100)),
    avgLossPct: mean(losses.map((t) => t.returnPct * 100)),
    expectancyR: mean(trades.map((t) => t.rMultiple)),
    avgBarsHeld: mean(trades.map((t) => t.barsHeld)),
    exposurePct: bars.length ? Math.min(100, (barsInMarket / bars.length) * 100) : 0,
    exitsByReason: {
      signal: trades.filter((t) => t.exitReason === 'signal').length,
      stop: trades.filter((t) => t.exitReason === 'stop').length,
      end_of_data: trades.filter((t) => t.exitReason === 'end_of_data').length,
    },
    longTrades: trades.filter((t) => t.side === 'long').length,
    shortTrades: trades.filter((t) => t.side === 'short').length,
    buyAndHoldPct: first > 0 ? (lastClose / first - 1) * 100 : 0,
  }
}
