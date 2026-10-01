import { describe, expect, it } from 'vitest'
import { meanReversion } from '@/lib/trading/strategies/mean-reversion'
import { momentumBreakout } from '@/lib/trading/strategies/momentum-breakout'
import { trendFollowing } from '@/lib/trading/strategies/trend-following'
import type { Bar } from '@/lib/trading/types'
import { barsFromCloses, chop, market, pushBar, randomWalk } from './helpers'

const spx = market('spx')
const btc = market('btc')
const gold = market('gold')

describe('mean reversion (SPY/QQQ, 15m)', () => {
  /** Quiet range then a sharp three-bar flush, finishing with the given candle. */
  const flush = (last: Omit<Bar, 't'>, dir: 1 | -1 = -1) =>
    pushBar(barsFromCloses([...chop(80), 100 + dir * 0.5, 100 + dir * 1.0, 100 + dir * 1.5]), last)

  it('holds while warming up', () => {
    const s = meanReversion(barsFromCloses(chop(59)), 'flat', spx)
    expect(s.action).toBe('hold')
    expect(s.reason).toMatch(/Warming up \(59\/60/)
  })

  it('buys a 2-sigma flush with oversold RSI once the candle turns up', () => {
    const s = meanReversion(flush({ o: 98.3, h: 98.7, l: 98.2, c: 98.6, v: 1000 }), 'flat', spx)
    expect(s.metrics.zScore).toBeLessThanOrEqual(-2)
    expect(s.metrics.rsi).toBeLessThanOrEqual(30)
    expect(s.action).toBe('enter_long')
    expect(s.strength).toBeGreaterThan(0)
  })

  it('waits when the flush candle is still falling (no reversal yet)', () => {
    const s = meanReversion(flush({ o: 98.6, h: 98.65, l: 98.2, c: 98.3, v: 1000 }), 'flat', spx)
    expect(s.metrics.zScore).toBeLessThanOrEqual(-2)
    expect(s.action).toBe('hold')
  })

  it('shorts the mirror-image spike when shorting is allowed, and not when it is off', () => {
    const spike = flush({ o: 101.7, h: 101.8, l: 101.3, c: 101.4, v: 1000 }, 1)
    expect(meanReversion(spike, 'flat', spx).action).toBe('enter_short')
    expect(meanReversion(spike, 'flat', { ...spx, allowShort: false }).action).toBe('hold')
  })

  it('exits a long once price is back at the mean, holds while below it', () => {
    const below = flush({ o: 98.3, h: 98.7, l: 98.2, c: 98.6, v: 1000 })
    expect(meanReversion(below, 'long', spx).action).toBe('hold')
    const atOrAboveMean = barsFromCloses([...chop(80), 100.05]) // chop mean is 100
    expect(meanReversion(atOrAboveMean, 'long', spx).action).toBe('exit')
  })

  it('exits a short once price is back at the mean, holds while above it', () => {
    expect(meanReversion(barsFromCloses([...chop(80), 99.95]), 'short', spx).action).toBe('exit')
    const above = flush({ o: 101.7, h: 101.8, l: 101.3, c: 101.4, v: 1000 }, 1)
    expect(meanReversion(above, 'short', spx).action).toBe('hold')
  })
})

describe('momentum breakout (BTC, 1h)', () => {
  const base = () => barsFromCloses(chop(80, 100, 0.5), { wick: 0.5, volume: 100 })

  it('buys a close through the 20-bar high on heavy volume with a strong close', () => {
    const s = momentumBreakout(pushBar(base(), { o: 100.5, h: 103.2, l: 100.4, c: 103, v: 300 }), 'flat', btc)
    expect(s.action).toBe('enter_long')
    expect(s.metrics.volumeRatio).toBeCloseTo(3)
    expect(s.strength).toBe(1)
  })

  it('rejects a breakout on thin volume', () => {
    const s = momentumBreakout(pushBar(base(), { o: 100.5, h: 103.2, l: 100.4, c: 103, v: 120 }), 'flat', btc)
    expect(s.action).toBe('hold')
    expect(s.reason).toMatch(/rejected: volume/)
  })

  it('rejects a breakout that closes off the highs (a wick)', () => {
    const s = momentumBreakout(pushBar(base(), { o: 100.5, h: 106, l: 100.4, c: 101.6, v: 300 }), 'flat', btc)
    expect(s.action).toBe('hold')
    expect(s.reason).toMatch(/wick/)
  })

  it('never shorts BTC (shorting is disabled for crypto)', () => {
    const s = momentumBreakout(pushBar(base(), { o: 99.5, h: 99.6, l: 96.8, c: 97, v: 300 }), 'flat', btc)
    expect(s.action).toBe('hold')
  })

  it('exits a long when the close loses the 20 EMA', () => {
    const s = momentumBreakout(pushBar(base(), { o: 100, h: 100.1, l: 98, c: 98.2, v: 100 }), 'long', btc)
    expect(s.action).toBe('exit')
  })
})

describe('trend following (GLD/USO, 4h)', () => {
  const STEP = 4 * 60 * 60_000
  const rally = Array.from({ length: 100 }, (_, i) => 100 + 0.5 * i)

  it('buys a pullback that reclaims the 20 EMA inside an uptrend', () => {
    const closes = [...rally, 143, 150]
    const s = trendFollowing(barsFromCloses(closes, { stepMs: STEP }), 'flat', gold)
    expect(s.metrics.ema20).toBeGreaterThan(s.metrics.ema50)
    expect(s.action).toBe('enter_long')
    expect(s.reason).toMatch(/Pullback reclaimed/)
  })

  it('does not chase an established trend without a fresh cross or pullback', () => {
    const s = trendFollowing(barsFromCloses(rally, { stepMs: STEP }), 'flat', gold)
    expect(s.action).toBe('hold')
    expect(s.reason).toMatch(/^Uptrend/)
  })

  it('shorts a failed bounce inside a downtrend', () => {
    const decline = rally.map((c) => 200 - c)
    const closes = [...decline, 57, 50]
    expect(trendFollowing(barsFromCloses(closes, { stepMs: STEP }), 'flat', gold).action).toBe('enter_short')
  })

  it('exits a long when price closes under the 50 EMA', () => {
    const closes = [...rally, 110]
    const s = trendFollowing(barsFromCloses(closes, { stepMs: STEP }), 'long', gold)
    expect(s.action).toBe('exit')
    expect(s.reason).toMatch(/50 EMA/)
  })

  it('holds a long while the trend structure is intact', () => {
    expect(trendFollowing(barsFromCloses(rally, { stepMs: STEP }), 'long', gold).action).toBe('hold')
  })
})

describe('all strategies, property checks on random data', () => {
  const cases = [
    { name: 'mean reversion', fn: meanReversion, m: spx },
    { name: 'momentum breakout', fn: momentumBreakout, m: btc },
    { name: 'trend following', fn: trendFollowing, m: gold },
  ]

  for (const { name, fn, m } of cases) {
    it(`${name}: only enters when flat, only exits when in a position, metrics finite`, () => {
      for (let seed = 1; seed <= 5; seed++) {
        const bars = randomWalk(400, { seed })
        for (let i = 100; i < bars.length; i += 7) {
          const window = bars.slice(0, i)
          const flat = fn(window, 'flat', m)
          expect(['enter_long', 'enter_short', 'hold']).toContain(flat.action)
          if (!m.allowShort) expect(flat.action).not.toBe('enter_short')
          for (const side of ['long', 'short'] as const) {
            expect(['exit', 'hold']).toContain(fn(window, side, m).action)
          }
          expect(flat.strength).toBeGreaterThanOrEqual(0)
          expect(flat.strength).toBeLessThanOrEqual(1)
          for (const v of Object.values(flat.metrics)) expect(Number.isFinite(v)).toBe(true)
        }
      }
    })

    it(`${name}: is deterministic and ignores bars after the window (no lookahead)`, () => {
      const bars = randomWalk(300, { seed: 42 })
      const a = fn(bars.slice(0, 200), 'flat', m)
      const b = fn(bars.slice(0, 200), 'flat', m)
      expect(a).toEqual(b)
    })
  }
})
