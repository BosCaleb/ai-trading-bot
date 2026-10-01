import { describe, expect, it } from 'vitest'
import { atr, ema, priorAvgVolume, priorHigh, priorLow, rsi, sma, stdev } from '@/lib/trading/indicators'
import { barsFromCloses } from './helpers'

describe('indicators', () => {
  it('sma averages the trailing window and is NaN until warm', () => {
    const out = sma([1, 2, 3, 4, 5], 3)
    expect(out.slice(0, 2).every(Number.isNaN)).toBe(true)
    expect(out.slice(2)).toEqual([2, 3, 4])
  })

  it('ema seeds with the sma, then applies the 2/(n+1) smoothing', () => {
    const out = ema([2, 4, 6, 8], 3)
    expect(out[2]).toBe(4) // seed = mean(2,4,6)
    expect(out[3]).toBeCloseTo(8 * 0.5 + 4 * 0.5) // k = 0.5
    expect(Number.isNaN(out[1])).toBe(true)
  })

  it('stdev is the population deviation of the window', () => {
    const out = stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)
    expect(out[7]).toBeCloseTo(2)
  })

  it('rsi is 100 in a straight rally and 0 in a straight decline', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i)
    const down = Array.from({ length: 30 }, (_, i) => 100 - i)
    expect(rsi(up, 14)[29]).toBe(100)
    expect(rsi(down, 14)[29]).toBe(0)
    expect(Number.isNaN(rsi(up, 14)[13])).toBe(true)
  })

  it('rsi sits at 50 when gains and losses balance', () => {
    const zigzag = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? 100 : 101))
    expect(rsi(zigzag, 14)[59]).toBeGreaterThan(45)
    expect(rsi(zigzag, 14)[59]).toBeLessThan(55)
  })

  it('atr equals the constant true range of a steady series', () => {
    const bars = barsFromCloses(Array(40).fill(100), { wick: 0.5 })
    expect(atr(bars, 14)[39]).toBeCloseTo(1)
  })

  it('prior high/low/volume exclude the current bar', () => {
    const bars = barsFromCloses([1, 2, 3, 10], { wick: 0, volume: 5 })
    expect(priorHigh(bars, 3)[3]).toBe(3) // not 10
    expect(priorLow(bars, 3)[3]).toBe(1)
    expect(priorAvgVolume(bars, 3)[3]).toBe(5)
  })
})
