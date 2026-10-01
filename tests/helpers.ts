import { MARKET_BY_ID } from '@/lib/trading/markets'
import type { Bar, MarketConfig, MarketId, PositionInfo } from '@/lib/trading/types'

export const T0 = Date.UTC(2025, 0, 6, 15, 0) // a Monday, 10:00 ET
export const MIN15 = 15 * 60_000

/** Builds bars from closes: open = previous close, wick of `wick` either side, constant volume. */
export function barsFromCloses(closes: number[], opts: { wick?: number; volume?: number; stepMs?: number; start?: number } = {}): Bar[] {
  const { wick = 0.05, volume = 1000, stepMs = MIN15, start = T0 } = opts
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    return { t: start + i * stepMs, o, h: Math.max(o, c) + wick, l: Math.min(o, c) - wick, c, v: volume }
  })
}

/** Appends one fully specified bar after the last one. */
export function pushBar(bars: Bar[], bar: Omit<Bar, 't'>, stepMs = MIN15): Bar[] {
  const t = bars.length ? bars[bars.length - 1].t + stepMs : T0
  return [...bars, { t, ...bar }]
}

/** Quiet range: alternates around `level` by +/- `amp`. */
export function chop(n: number, level = 100, amp = 0.05): number[] {
  return Array.from({ length: n }, (_, i) => level + (i % 2 === 0 ? amp : -amp))
}

/** Deterministic PRNG so "random" fixtures are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Geometric random walk with realistic intrabar ranges and volume spikes. */
export function randomWalk(n: number, opts: { seed?: number; start?: number; vol?: number; stepMs?: number } = {}): Bar[] {
  const rand = mulberry32(opts.seed ?? 1)
  const vol = opts.vol ?? 0.004
  const stepMs = opts.stepMs ?? MIN15
  let price = opts.start ?? 100
  const bars: Bar[] = []
  for (let i = 0; i < n; i++) {
    const o = price
    const c = o * (1 + (rand() - 0.5) * 2 * vol * 1.7)
    const h = Math.max(o, c) * (1 + rand() * vol)
    const l = Math.min(o, c) * (1 - rand() * vol)
    bars.push({ t: T0 + i * stepMs, o, h, l, c, v: 1000 * (0.5 + rand() * (rand() > 0.95 ? 4 : 1)) })
    price = c
  }
  return bars
}

export function market(id: MarketId, overrides: Partial<MarketConfig> = {}): MarketConfig {
  return { ...MARKET_BY_ID[id], ...overrides }
}

export function position(overrides: Partial<PositionInfo> = {}): PositionInfo {
  return {
    symbol: 'SPY',
    side: 'long',
    qty: 10,
    avgEntry: 500,
    currentPrice: 500,
    marketValue: 5000,
    unrealizedPl: 0,
    unrealizedPlPct: 0,
    ...overrides,
  }
}
