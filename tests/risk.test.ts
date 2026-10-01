import { describe, expect, it, vi } from 'vitest'
import {
  applyFilters,
  correlationFilterState,
  positionRisk,
  positionSize,
  roundDownToStep,
  stopDistanceFor,
  stopPriceFor,
} from '@/lib/trading/risk'
import { market, position } from './helpers'

describe('stops', () => {
  it('places the stop a multiple of ATR away, never closer than 0.2% of price', () => {
    const spx = market('spx') // 2.5x ATR
    expect(stopDistanceFor(500, 0.002, spx)).toBeCloseTo(2.5)
    expect(stopDistanceFor(500, 0.0001, spx)).toBeCloseTo(1) // floored at 0.2%
  })

  it('puts the stop on the losing side of the anchor', () => {
    expect(stopPriceFor(200, 'long', 3)).toBe(197)
    expect(stopPriceFor(200, 'short', 3)).toBe(203)
  })
})

describe('roundDownToStep', () => {
  it('rounds down, never up, and survives float noise', () => {
    expect(roundDownToStep(4.99, 1)).toBe(4)
    expect(roundDownToStep(0.0138889, 0.000001)).toBe(0.013888)
    expect(roundDownToStep(0.3, 0.1)).toBe(0.3)
    expect(roundDownToStep(-1, 1)).toBe(0)
  })
})

describe('positionSize (1% of equity at the stop)', () => {
  const spx = market('spx') // 2.5x ATR stop, whole shares

  it('sizes so that hitting the stop loses 1% of equity', () => {
    const s = positionSize({ equity: 100_000, price: 500, atrPct: 0.002, market: spx })
    expect(s.stopDistance).toBeCloseTo(2.5)
    expect(s.qty).toBe(400) // 1,000 / 2.5
    expect(s.riskAmount).toBeCloseTo(1000)
    expect(s.riskPct).toBeCloseTo(0.01)
    expect(s.skipReason).toBeNull()
  })

  it('halves the size when volatility doubles, keeping the same money at risk', () => {
    const s = positionSize({ equity: 100_000, price: 500, atrPct: 0.004, market: spx })
    expect(s.qty).toBe(200)
    expect(s.riskAmount).toBeCloseTo(1000)
  })

  it('rounds down, so actual risk is at most the budget', () => {
    const s = positionSize({ equity: 1_000, price: 500, atrPct: 0.0023, market: spx }) // budget 10, distance 2.875
    expect(s.qty).toBe(3)
    expect(s.riskAmount).toBeLessThanOrEqual(10)
  })

  it('skips instead of rounding up when the broker minimum would risk too much', () => {
    const s = positionSize({ equity: 100, price: 500, atrPct: 0.002, market: spx }) // budget 1, one share risks 2.50
    expect(s.qty).toBe(0)
    expect(s.riskAmount).toBe(0)
    expect(s.skipReason).toMatch(/Broker minimum 1 would risk 2\.50/)
  })

  it('sizes fractional crypto to the broker step', () => {
    const s = positionSize({ equity: 1_000, price: 60_000, atrPct: 0.006, market: market('btc') }) // 2x ATR = 720
    expect(s.qty).toBe(0.013888)
    expect(s.riskAmount).toBeLessThanOrEqual(10)
  })

  it('caps a single position at MAX_LEVERAGE x equity', async () => {
    vi.stubEnv('MAX_LEVERAGE', '2')
    vi.resetModules()
    const risk = await import('@/lib/trading/risk')
    expect(risk.RISK.maxLeverage).toBe(2)
    // 0.2% floor stop wants 1,000 shares (500k notional); 2x of 100k allows 400.
    const s = risk.positionSize({ equity: 100_000, price: 500, atrPct: 0.0001, market: spx })
    expect(s.qty).toBe(400)
    expect(s.riskPct).toBeCloseTo(0.004)
    vi.unstubAllEnvs()
    vi.resetModules()
  })
})

describe('positionRisk', () => {
  it('measures planned loss from entry to stop, zero once the stop is past entry', () => {
    expect(positionRisk({ side: 'long', qty: 10, avgEntry: 100 }, 98)).toBeCloseTo(20)
    expect(positionRisk({ side: 'long', qty: 10, avgEntry: 100 }, 101)).toBe(0)
    expect(positionRisk({ side: 'short', qty: 10, avgEntry: 100 }, 103)).toBeCloseTo(30)
  })
})

describe('applyFilters', () => {
  const base = { positions: [], pendingEntries: [], equity: 100_000, proposedNotional: 10_000, proposedRisk: 1_000, openRisk: 0 }

  it('passes a clean entry', () => {
    expect(applyFilters({ ...base, market: market('spx'), action: 'enter_long' }).ok).toBe(true)
  })

  it('ignores non-entry actions', () => {
    expect(applyFilters({ ...base, market: market('spx'), action: 'exit', positions: [position()] }).ok).toBe(true)
  })

  it('blocks a second position in the same market', () => {
    const r = applyFilters({ ...base, market: market('spx'), action: 'enter_long', positions: [position({ symbol: 'SPY' })] })
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('Already holding') })
  })

  it('blocks shorts where shorting is disabled', () => {
    expect(applyFilters({ ...base, market: market('btc'), action: 'enter_short' }).ok).toBe(false)
  })

  it('blocks QQQ long while SPY is long, but allows the opposite direction', () => {
    const positions = [position({ symbol: 'SPY', side: 'long' })]
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_long', positions }).reason).toMatch(/Correlation.*already long/)
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_short', positions }).ok).toBe(true)
  })

  it('blocks QQQ short while SPY is short, but allows a QQQ long', () => {
    const positions = [position({ symbol: 'SPY', side: 'short', marketValue: -5000 })]
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_short', positions }).reason).toMatch(/Correlation.*already short/)
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_long', positions }).ok).toBe(true)
  })

  it('counts same-direction entries placed earlier in the same cycle that the broker does not show yet', () => {
    const at = (side: 'long' | 'short') => [{ marketId: 'spx', side }]
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_long', pendingEntries: at('long') }).ok).toBe(false)
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_short', pendingEntries: at('short') }).ok).toBe(false)
    expect(applyFilters({ ...base, market: market('ndx'), action: 'enter_short', pendingEntries: at('long') }).ok).toBe(true)
  })

  it('does not apply the correlation filter to markets outside the group', () => {
    const positions = [position({ symbol: 'SPY', side: 'long' })]
    expect(applyFilters({ ...base, market: market('gold'), action: 'enter_long', positions }).ok).toBe(true)
  })

  it('enforces the leverage cap (5x by default) using absolute values', () => {
    const positions = [position({ symbol: 'GLD', marketValue: 300_000 }), position({ symbol: 'USO', side: 'short', marketValue: -195_000 })]
    expect(applyFilters({ ...base, market: market('btc'), action: 'enter_long', positions, proposedNotional: 6_000 }).reason).toMatch(/Leverage cap/)
    expect(applyFilters({ ...base, market: market('btc'), action: 'enter_long', positions, proposedNotional: 5_000 }).ok).toBe(true)
  })

  it('caps combined open risk at 3% of equity', () => {
    expect(applyFilters({ ...base, market: market('gold'), action: 'enter_long', openRisk: 2_500 }).reason).toMatch(/Open risk cap/)
    expect(applyFilters({ ...base, market: market('gold'), action: 'enter_long', openRisk: 2_000 }).ok).toBe(true)
  })
})

describe('correlationFilterState', () => {
  it('reports which index market is blocked and in which direction', () => {
    const long = correlationFilterState([position({ symbol: 'QQQ', side: 'long' })])
    expect(long).toMatchObject({ active: true, side: 'long' })
    expect(long.heldMarket?.id).toBe('ndx')
    expect(long.blockedMarket?.id).toBe('spx')
    expect(correlationFilterState([position({ symbol: 'QQQ', side: 'short' })])).toMatchObject({ active: true, side: 'short' })
    expect(correlationFilterState([position({ symbol: 'GLD' })]).active).toBe(false)
  })
})
