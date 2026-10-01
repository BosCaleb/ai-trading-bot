import { atr, last, round, rsi, sma, stdev } from '../indicators'
import type { StrategyFn } from '../types'

const LOOKBACK = 20
const BAND_SIGMA = 2
const RSI_PERIOD = 14
const RSI_OVERSOLD = 30
const RSI_OVERBOUGHT = 70
const MIN_BARS = 60

/**
 * 15-minute mean reversion for index ETFs.
 * Entry: close stretched beyond 2 sigma from the 20-bar mean, RSI confirms exhaustion,
 * and the current candle has already turned (bullish close for longs, bearish for shorts).
 * Exit: price returns to the 20-bar mean.
 */
export const meanReversion: StrategyFn = (bars, position, market) => {
  if (bars.length < MIN_BARS) {
    return { action: 'hold', reason: `Warming up (${bars.length}/${MIN_BARS} bars)`, strength: 0, metrics: {} }
  }

  const closes = bars.map((b) => b.c)
  const mean = sma(closes, LOOKBACK)
  const sd = stdev(closes, LOOKBACK)
  const rsiSeries = rsi(closes, RSI_PERIOD)
  const atrSeries = atr(bars, 14)

  const bar = last(bars)
  const m = last(mean)
  const s = last(sd)
  const r = last(rsiSeries)
  const a = last(atrSeries)
  const z = s > 0 ? (bar.c - m) / s : 0

  const metrics = {
    price: bar.c,
    mean: round(m, 2),
    zScore: round(z, 2),
    rsi: round(r, 1),
    upperBand: round(m + BAND_SIGMA * s, 2),
    lowerBand: round(m - BAND_SIGMA * s, 2),
    atrPct: round(a / bar.c, 5),
  }

  if (position === 'long') {
    if (bar.c >= m) {
      return { action: 'exit', reason: `Snapback complete: price ${bar.c.toFixed(2)} reached mean ${m.toFixed(2)}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Holding long, waiting for mean ${m.toFixed(2)} (z ${z.toFixed(2)})`, strength: 0, metrics }
  }

  if (position === 'short') {
    if (bar.c <= m) {
      return { action: 'exit', reason: `Snapback complete: price ${bar.c.toFixed(2)} reached mean ${m.toFixed(2)}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Holding short, waiting for mean ${m.toFixed(2)} (z ${z.toFixed(2)})`, strength: 0, metrics }
  }

  const bullishTurn = bar.c > bar.o
  const bearishTurn = bar.c < bar.o

  if (z <= -BAND_SIGMA && r <= RSI_OVERSOLD && bullishTurn) {
    return {
      action: 'enter_long',
      reason: `Stretched ${z.toFixed(2)} sigma below mean with RSI ${r.toFixed(0)} and a bullish reversal candle`,
      strength: Math.min(1, Math.abs(z) / 3),
      metrics,
    }
  }

  if (market.allowShort && z >= BAND_SIGMA && r >= RSI_OVERBOUGHT && bearishTurn) {
    return {
      action: 'enter_short',
      reason: `Stretched ${z.toFixed(2)} sigma above mean with RSI ${r.toFixed(0)} and a bearish reversal candle`,
      strength: Math.min(1, Math.abs(z) / 3),
      metrics,
    }
  }

  const side = z < 0 ? 'below' : 'above'
  return {
    action: 'hold',
    reason: `Within bands: ${Math.abs(z).toFixed(2)} sigma ${side} mean, RSI ${r.toFixed(0)}`,
    strength: 0,
    metrics,
  }
}
