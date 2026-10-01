import { atr, ema, last, priorAvgVolume, priorHigh, priorLow, round } from '../indicators'
import type { StrategyFn } from '../types'

const CHANNEL = 20
const VOLUME_MULTIPLE = 1.5
const MIN_RANGE_POSITION = 0.6
const EXIT_EMA = 20
const MIN_BARS = 60

/**
 * 1-hour momentum breakout for Bitcoin.
 * Entry: close breaks the prior 20-bar high, volume is at least 1.5x the 20-bar average,
 * and the candle closes in the top 40% of its range (a real push, not a wick).
 * Exit: close falls back below the 20 EMA.
 */
export const momentumBreakout: StrategyFn = (bars, position, market) => {
  if (bars.length < MIN_BARS) {
    return { action: 'hold', reason: `Warming up (${bars.length}/${MIN_BARS} bars)`, strength: 0, metrics: {} }
  }

  const closes = bars.map((b) => b.c)
  const highs = priorHigh(bars, CHANNEL)
  const lows = priorLow(bars, CHANNEL)
  const avgVol = priorAvgVolume(bars, CHANNEL)
  const emaSeries = ema(closes, EXIT_EMA)
  const atrSeries = atr(bars, 14)

  const bar = last(bars)
  const breakoutLevel = last(highs)
  const breakdownLevel = last(lows)
  const vol = last(avgVol)
  const e = last(emaSeries)
  const a = last(atrSeries)

  const range = bar.h - bar.l
  const rangePosition = range > 0 ? (bar.c - bar.l) / range : 0.5
  const volumeRatio = vol > 0 ? bar.v / vol : 0

  const metrics = {
    price: bar.c,
    breakoutLevel: round(breakoutLevel, 2),
    breakdownLevel: round(breakdownLevel, 2),
    volumeRatio: round(volumeRatio, 2),
    rangePosition: round(rangePosition, 2),
    ema20: round(e, 2),
    atrPct: round(a / bar.c, 5),
  }

  if (position === 'long') {
    if (bar.c < e) {
      return { action: 'exit', reason: `Momentum faded: close ${bar.c.toFixed(0)} under 20 EMA ${e.toFixed(0)}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Riding breakout, trailing 20 EMA at ${e.toFixed(0)}`, strength: 0, metrics }
  }

  if (position === 'short') {
    if (bar.c > e) {
      return { action: 'exit', reason: `Breakdown faded: close ${bar.c.toFixed(0)} over 20 EMA ${e.toFixed(0)}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Riding breakdown, trailing 20 EMA at ${e.toFixed(0)}`, strength: 0, metrics }
  }

  const brokeOut = bar.c > breakoutLevel
  const heavyVolume = volumeRatio >= VOLUME_MULTIPLE
  const strongClose = rangePosition >= MIN_RANGE_POSITION

  if (brokeOut && heavyVolume && strongClose && bar.c > e) {
    return {
      action: 'enter_long',
      reason: `Closed through ${breakoutLevel.toFixed(0)} on ${volumeRatio.toFixed(1)}x volume, closing in top ${Math.round((1 - rangePosition) * 100)}% of range`,
      strength: Math.min(1, volumeRatio / 3),
      metrics,
    }
  }

  if (market.allowShort && bar.c < breakdownLevel && heavyVolume && rangePosition <= 1 - MIN_RANGE_POSITION && bar.c < e) {
    return {
      action: 'enter_short',
      reason: `Closed through ${breakdownLevel.toFixed(0)} on ${volumeRatio.toFixed(1)}x volume with a weak close`,
      strength: Math.min(1, volumeRatio / 3),
      metrics,
    }
  }

  if (brokeOut && !heavyVolume) {
    return { action: 'hold', reason: `Breakout above ${breakoutLevel.toFixed(0)} rejected: volume only ${volumeRatio.toFixed(1)}x (need ${VOLUME_MULTIPLE}x)`, strength: 0, metrics }
  }
  if (brokeOut && !strongClose) {
    return { action: 'hold', reason: `Breakout above ${breakoutLevel.toFixed(0)} looks like a wick: closed at ${Math.round(rangePosition * 100)}% of range`, strength: 0, metrics }
  }

  const distance = ((breakoutLevel - bar.c) / bar.c) * 100
  return {
    action: 'hold',
    reason: `Watching ${breakoutLevel.toFixed(0)} (${distance.toFixed(2)}% above), volume ${volumeRatio.toFixed(1)}x avg`,
    strength: 0,
    metrics,
  }
}
