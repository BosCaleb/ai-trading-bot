import { describe, expect, it } from 'vitest'
import { applyFilters, correlationFilterState, positionSize, stopPriceFor } from '@/lib/trading/risk'
import { market, position } from './helpers'

describe('stopPriceFor', () => {
  it('puts the stop 1% beyond entry on the losing side', () => {
    expect(stopPriceFor(200, 'long')).toBe(198)
    expect(stopPriceFor(200, 'short')).toBe(202)
  })
})

describe('positionSize', () => {
  const spx = market('spx') // 20% budget, baseline ATR 0.15%

  it('uses the full budget when volatility is at or below baseline', () => {
    const s = positionSize({ equity: 100_000, price: 500, atrPct: 0.001, market: spx })
    expect(s.volScalar).toBe(1)
    expect(s.qty).toBe(40) // 20,000 / 500
    expect(s.maxLoss).toBeCloseTo(200)
  })

  it('shrinks size in proportion to excess volatility', () => {
    const s = positionSize({ equity: 100_000, price: 500, atrPct: 0.003, market: spx })
    expect(s.volScalar).toBe(0.5)
    expect(s.qty).toBe(20)
  })

  it('never goes below 25% of budget', () => {
    const s = positionSize({ equity: 100_000, price: 500, atrPct: 0.05, market: spx })
    expect(s.volScalar).toBe(0.25)
    expect(s.qty).toBe(10)
  })

  it('rounds equities down to whole shares and keeps crypto fractional', () => {
    expect(positionSize({ equity: 1_000, price: 500, atrPct: 0.001, market: spx }).qty).toBe(0)
    const btc = positionSize({ equity: 1_000, price: 60_000, atrPct: 0.006, market: market('btc') })
    expect(btc.qty).toBeCloseTo(0.0025, 6)
  })
})

describe('applyFilters', () => {
  const base = { positions: [], pendingEntries: [], equity: 100_000, proposedNotional: 10_000 }

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

  it('enforces the gross exposure cap using absolute values', () => {
    const positions = [position({ symbol: 'GLD', marketValue: 60_000 }), position({ symbol: 'USO', side: 'short', marketValue: -35_000 })]
    expect(applyFilters({ ...base, market: market('btc'), action: 'enter_long', positions, proposedNotional: 6_000 }).reason).toMatch(/Gross exposure/)
    expect(applyFilters({ ...base, market: market('btc'), action: 'enter_long', positions, proposedNotional: 5_000 }).ok).toBe(true)
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
