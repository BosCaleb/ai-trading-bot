import { describe, expect, it } from 'vitest'
import { runBacktest } from '@/lib/backtest/engine'
import { maxDrawdown } from '@/lib/backtest/metrics'
import { applyLiveBarFilter, parseBarsCsv } from '@/lib/backtest/history'
import type { Bar, Signal, StrategyFn } from '@/lib/trading/types'
import { MIN15, T0, market, randomWalk } from './helpers'

const ZERO_COSTS = { feeBps: 0, slippageBps: 0 }
const always = () => true
const hold = (): Signal => ({ action: 'hold', reason: 'hold', strength: 0, metrics: {} })

/** Strategy that fires scripted actions on given bar indexes (index = last bar of the window). */
function scripted(actions: Record<number, Signal['action']>, bars: Bar[]): StrategyFn {
  return (window) => {
    const i = bars.findIndex((b) => b.t === window[window.length - 1].t)
    const action = actions[i]
    return action ? { action, reason: `scripted ${action}`, strength: 1, metrics: { atrPct: 0.004 } } : hold()
  }
}

function bars(rows: [o: number, h: number, l: number, c: number][]): Bar[] {
  return rows.map(([o, h, l, c], i) => ({ t: T0 + i * MIN15, o, h, l, c, v: 1000 }))
}

// GLD: 20% budget, baseline ATR 0.4% -> with atrPct 0.004 the full budget is used.
const gld = market('gold')

describe('backtest execution model', () => {
  const path = bars([
    [100, 100.5, 99.5, 100],
    [100, 100.5, 99.5, 100], // signal bar (i=1), close 100
    [101, 102, 100.5, 101.5], // entry fills at this open: 101
    [101.5, 104, 101, 103.5],
    [105, 106, 104.5, 105.5], // exit fills at this open: 105
    [105.5, 106, 105, 105.5],
  ])

  it('fills entries and exits at the NEXT bar open, never the signal close', () => {
    const r = runBacktest({ market: gld, bars: path, initialEquity: 100_000, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_long', 3: 'exit' }, path) })
    expect(r.trades).toHaveLength(1)
    const t = r.trades[0]
    expect(t.qty).toBe(200) // floor(20,000 / 100)
    expect(t.entryPrice).toBe(101)
    expect(t.exitPrice).toBe(105)
    expect(t.exitReason).toBe('signal')
    expect(t.pnl).toBeCloseTo(800)
    expect(r.finalEquity).toBeCloseTo(100_800)
  })

  it('anchors equity stops to the signal close (as the OTO order does) and fills them intrabar', () => {
    const p = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [100.2, 100.4, 98.5, 99], // stop 99.00 (1% under the 100 signal close) is hit here
      [99, 99.5, 98, 98.5],
    ])
    const r = runBacktest({ market: gld, bars: p, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_long' }, p) })
    expect(r.trades[0]).toMatchObject({ exitReason: 'stop', stopPrice: 99, exitPrice: 99, barsHeld: 1 })
  })

  it('fills a gap through the stop at the open, not at the stop price', () => {
    const p = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [100.2, 100.4, 99.6, 100],
      [97, 97.5, 96, 96.5], // gaps straight through 99
    ])
    const r = runBacktest({ market: gld, bars: p, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_long' }, p) })
    expect(r.trades[0]).toMatchObject({ exitReason: 'stop', exitPrice: 97 })
    expect(r.trades[0].rMultiple).toBeLessThan(-1) // worse than the planned 1% risk
  })

  it('handles shorts: profit on a fall, stop above entry', () => {
    const p = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [100, 100.5, 98, 98.5],
      [98, 98.5, 97, 97.5],
      [97, 97.5, 96.5, 97],
    ])
    const r = runBacktest({ market: gld, bars: p, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_short', 3: 'exit' }, p) })
    expect(r.trades[0]).toMatchObject({ side: 'short', entryPrice: 100, exitPrice: 97, stopPrice: 101 })
    expect(r.trades[0].pnl).toBeCloseTo(200 * 3)
    expect(r.finalEquity).toBeCloseTo(100_600)

    const stopped = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [100, 101.5, 99.8, 101.2],
      [101, 101.5, 100.5, 101],
    ])
    const s = runBacktest({ market: gld, bars: stopped, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_short' }, stopped) })
    expect(s.trades[0]).toMatchObject({ exitReason: 'stop', exitPrice: 101 })
  })

  it('anchors crypto stops to the actual fill (stop is placed after the fill)', () => {
    const p = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [102, 102.5, 101.5, 102], // fills at 102, stop at 100.98
      [102, 102.5, 100.9, 101],
    ])
    const r = runBacktest({ market: market('btc'), bars: p, costs: ZERO_COSTS, strategy: scripted({ 1: 'enter_long' }, p) })
    expect(r.trades[0]).toMatchObject({ stopPrice: 100.98, exitReason: 'stop', exitPrice: 100.98 })
  })

  it('charges fees and slippage on both sides', () => {
    const costs = { feeBps: 10, slippageBps: 5 }
    const r = runBacktest({ market: gld, bars: path, costs, canTrade: always, strategy: scripted({ 1: 'enter_long', 3: 'exit' }, path) })
    const t = r.trades[0]
    expect(t.entryPrice).toBeCloseTo(101 * 1.0005)
    expect(t.exitPrice).toBeCloseTo(105 * 0.9995)
    const fees = 200 * t.entryPrice * 0.001 + 200 * t.exitPrice * 0.001
    expect(t.pnl).toBeCloseTo(200 * (t.exitPrice - t.entryPrice) - fees)
    expect(r.finalEquity).toBeCloseTo(100_000 + t.pnl)
  })

  it('drops equity signals when the session is closed at the bar close, like the live cron', () => {
    const r = runBacktest({ market: gld, bars: path, costs: ZERO_COSTS, canTrade: () => false, strategy: scripted({ 1: 'enter_long' }, path) })
    expect(r.trades).toHaveLength(0)
    expect(r.skippedClosedSession).toBe(1)
  })

  it('closes any open position at the end of the data', () => {
    const r = runBacktest({ market: gld, bars: path, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_long' }, path) })
    expect(r.trades[0]).toMatchObject({ exitReason: 'end_of_data', exitPrice: 105.5 })
    expect(r.equityCurve.at(-1)?.equity).toBeCloseTo(r.finalEquity)
  })

  it('never hands the strategy a bar from the future, and respects the window size', () => {
    const data = randomWalk(400, { seed: 7 })
    let calls = 0
    const spy: StrategyFn = (window, side, m) => {
      calls++
      const lastT = window[window.length - 1].t
      const i = data.findIndex((b) => b.t === lastT)
      expect(window).toEqual(data.slice(Math.max(0, i + 1 - 250), i + 1))
      return hold()
    }
    runBacktest({ market: gld, bars: data, canTrade: always, strategy: spy })
    expect(calls).toBe(data.length - 1)
  })
})

describe('backtest with the real strategies', () => {
  for (const id of ['spx', 'ndx', 'btc', 'gold', 'oil'] as const) {
    it(`${id}: produces a consistent ledger on random data`, () => {
      const m = market(id)
      const data = randomWalk(2_000, { seed: 3, vol: m.baselineAtrPct * 2 })
      const r = runBacktest({ market: m, bars: data, canTrade: always })

      expect(Number.isFinite(r.finalEquity)).toBe(true)
      expect(r.equityCurve).toHaveLength(data.length)
      // Ledger reconciles: equity change equals the sum of trade P&L.
      const pnl = r.trades.reduce((a, t) => a + t.pnl, 0)
      expect(r.finalEquity - r.initialEquity).toBeCloseTo(pnl, 4)
      // One position at a time: trades never overlap.
      for (let k = 1; k < r.trades.length; k++) expect(r.trades[k].entryTime).toBeGreaterThanOrEqual(r.trades[k - 1].exitTime)
      // Stop discipline: a non-gap stop exit never loses more than the stop distance plus costs.
      for (const t of r.trades.filter((t) => t.exitReason === 'stop')) {
        const gapped = t.side === 'long' ? t.exitPrice < t.stopPrice * 0.999 : t.exitPrice > t.stopPrice * 1.001
        if (gapped) continue
        const stopDistance = Math.abs(t.entryPrice - t.stopPrice) / t.entryPrice
        expect(t.returnPct).toBeGreaterThan(-(stopDistance + 0.01))
      }
      if (!m.allowShort) expect(r.trades.every((t) => t.side === 'long')).toBe(true)
    })
  }
})

describe('metrics', () => {
  it('maxDrawdown measures the worst peak-to-trough fall', () => {
    const curve = [100, 120, 90, 130, 117].map((equity, t) => ({ t, equity }))
    expect(maxDrawdown(curve)).toBeCloseTo(-0.25)
  })

  it('reports win rate, profit factor and stop counts', () => {
    const p = bars([
      [100, 100.5, 99.5, 100],
      [100, 100.5, 99.5, 100],
      [101, 102, 100.5, 101.5],
      [101.5, 104, 101, 103.5],
      [105, 106, 104.5, 105.5],
      [105.5, 106, 105, 105.5],
      [105.5, 105.6, 103, 103.5], // stopped: stop at 104.45 from the 105.5 signal close
      [103.5, 104, 103, 103.5],
    ])
    const r = runBacktest({ market: gld, bars: p, costs: ZERO_COSTS, canTrade: always, strategy: scripted({ 1: 'enter_long', 3: 'exit', 5: 'enter_long' }, p) })
    expect(r.metrics.trades).toBe(2)
    expect(r.metrics.winRatePct).toBe(50)
    expect(r.metrics.exitsByReason).toEqual({ signal: 1, stop: 1, end_of_data: 0 })
    expect(r.metrics.profitFactor).toBeGreaterThan(1)
  })
})

describe('history helpers', () => {
  it('parses CSV with flexible headers and unix-second timestamps', () => {
    const csv = 'Date,Open,High,Low,Close,Volume\n1736175600,2,3,1,2.5,10\n2025-01-06T14:30:00Z,1,2,0.5,1.5,20\n'
    const out = parseBarsCsv(csv)
    expect(out.map((b) => b.c)).toEqual([1.5, 2.5]) // sorted by time
    expect(out[1].t).toBe(1736175600 * 1000)
  })

  it('applies the live regular-session filter to 15m index bars only', () => {
    const preMarket = Date.UTC(2025, 0, 6, 13, 0) // 08:00 ET
    const session = Date.UTC(2025, 0, 6, 15, 0) // 10:00 ET
    const rows: Bar[] = [preMarket, session].map((t) => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 }))
    expect(applyLiveBarFilter(market('spx'), rows)).toHaveLength(1)
    expect(applyLiveBarFilter(market('gold'), rows)).toHaveLength(2)
    expect(applyLiveBarFilter(market('btc'), rows)).toHaveLength(2)
  })
})
