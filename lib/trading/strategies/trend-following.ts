import { atr, ema, last, round } from '../indicators'
import type { StrategyFn } from '../types'

const FAST = 20
const SLOW = 50
const SLOPE_LOOKBACK = 3
const FRESH_CROSS_BARS = 3
const MIN_BARS = 80

/**
 * 4-hour trend following for gold and oil ETFs.
 * Trend is defined by the 20 EMA vs the 50 EMA plus the slope of the 50 EMA.
 * Entry: a fresh 20/50 cross in the trend direction, or a pullback that reclaims the 20 EMA
 * inside an established trend. Exit: the EMAs cross back, or price closes through the 50 EMA.
 */
export const trendFollowing: StrategyFn = (bars, position, market) => {
  if (bars.length < MIN_BARS) {
    return { action: 'hold', reason: `Warming up (${bars.length}/${MIN_BARS} bars)`, strength: 0, metrics: {} }
  }

  const closes = bars.map((b) => b.c)
  const fast = ema(closes, FAST)
  const slow = ema(closes, SLOW)
  const atrSeries = atr(bars, 14)

  const bar = last(bars)
  const prevBar = last(bars, 1)
  const f = last(fast)
  const s = last(slow)
  const a = last(atrSeries)
  const slowSlope = (s - last(slow, SLOPE_LOOKBACK)) / last(slow, SLOPE_LOOKBACK)
  const spreadPct = (f - s) / s

  const uptrend = f > s && slowSlope > 0
  const downtrend = f < s && slowSlope < 0

  let crossedUpRecently = false
  let crossedDownRecently = false
  for (let k = 0; k < FRESH_CROSS_BARS; k++) {
    const now = fast.length - 1 - k
    const prev = now - 1
    if (fast[prev] <= slow[prev] && fast[now] > slow[now]) crossedUpRecently = true
    if (fast[prev] >= slow[prev] && fast[now] < slow[now]) crossedDownRecently = true
  }

  const reclaimedFast = prevBar.c < last(fast, 1) && bar.c > f
  const lostFast = prevBar.c > last(fast, 1) && bar.c < f

  const metrics = {
    price: bar.c,
    ema20: round(f, 2),
    ema50: round(s, 2),
    spreadPct: round(spreadPct * 100, 2),
    slowSlopePct: round(slowSlope * 100, 3),
    atrPct: round(a / bar.c, 5),
  }

  if (position === 'long') {
    if (f < s || bar.c < s) {
      return { action: 'exit', reason: `Trend broke: ${bar.c < s ? 'close under 50 EMA' : '20 EMA crossed under 50 EMA'}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Riding uptrend, 20 EMA ${spreadPct >= 0 ? '+' : ''}${(spreadPct * 100).toFixed(2)}% over 50 EMA`, strength: 0, metrics }
  }

  if (position === 'short') {
    if (f > s || bar.c > s) {
      return { action: 'exit', reason: `Trend broke: ${bar.c > s ? 'close over 50 EMA' : '20 EMA crossed over 50 EMA'}`, strength: 1, metrics }
    }
    return { action: 'hold', reason: `Riding downtrend, 20 EMA ${(spreadPct * 100).toFixed(2)}% under 50 EMA`, strength: 0, metrics }
  }

  if (uptrend && bar.c > f && (crossedUpRecently || reclaimedFast)) {
    return {
      action: 'enter_long',
      reason: crossedUpRecently ? 'Fresh 20/50 EMA bullish cross with rising 50 EMA' : 'Pullback reclaimed the 20 EMA inside an uptrend',
      strength: Math.min(1, Math.abs(spreadPct) * 50 + 0.3),
      metrics,
    }
  }

  if (market.allowShort && downtrend && bar.c < f && (crossedDownRecently || lostFast)) {
    return {
      action: 'enter_short',
      reason: crossedDownRecently ? 'Fresh 20/50 EMA bearish cross with falling 50 EMA' : 'Bounce failed at the 20 EMA inside a downtrend',
      strength: Math.min(1, Math.abs(spreadPct) * 50 + 0.3),
      metrics,
    }
  }

  const regime = uptrend ? 'Uptrend' : downtrend ? 'Downtrend' : 'No clean trend'
  return {
    action: 'hold',
    reason: `${regime}: 20 EMA ${(spreadPct * 100).toFixed(2)}% vs 50 EMA, waiting for a clean entry`,
    strength: 0,
    metrics,
  }
}
