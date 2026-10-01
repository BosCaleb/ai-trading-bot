import type { Bar } from './types'

/** All indicator functions return arrays aligned with the input; leading values are NaN until warmed up. */

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN)
  if (values.length < period) return out
  const k = 2 / (period + 1)
  let seed = 0
  for (let i = 0; i < period; i++) seed += values[i]
  out[period - 1] = seed / period
  for (let i = period; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k)
  }
  return out
}

export function stdev(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN)
  const means = sma(values, period)
  for (let i = period - 1; i < values.length; i++) {
    let acc = 0
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - means[i]
      acc += d * d
    }
    out[i] = Math.sqrt(acc / period)
  }
  return out
}

/** Wilder RSI */
export function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(Number.NaN)
  if (closes.length <= period) return out
  let gain = 0
  let loss = 0
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1]
    if (d >= 0) gain += d
    else loss -= d
  }
  gain /= period
  loss /= period
  out[period] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1]
    gain = (gain * (period - 1) + Math.max(d, 0)) / period
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss)
  }
  return out
}

/** Wilder ATR */
export function atr(bars: Bar[], period = 14): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN)
  if (bars.length <= period) return out
  const tr: number[] = bars.map((b, i) => {
    if (i === 0) return b.h - b.l
    const prevClose = bars[i - 1].c
    return Math.max(b.h - b.l, Math.abs(b.h - prevClose), Math.abs(b.l - prevClose))
  })
  let acc = 0
  for (let i = 1; i <= period; i++) acc += tr[i]
  out[period] = acc / period
  for (let i = period + 1; i < bars.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + tr[i]) / period
  }
  return out
}

/** Highest high over the `period` bars strictly before index i (excludes the current bar). */
export function priorHigh(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN)
  for (let i = period; i < bars.length; i++) {
    let hi = -Infinity
    for (let j = i - period; j < i; j++) hi = Math.max(hi, bars[j].h)
    out[i] = hi
  }
  return out
}

/** Lowest low over the `period` bars strictly before index i (excludes the current bar). */
export function priorLow(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN)
  for (let i = period; i < bars.length; i++) {
    let lo = Infinity
    for (let j = i - period; j < i; j++) lo = Math.min(lo, bars[j].l)
    out[i] = lo
  }
  return out
}

/** Average volume over the `period` bars strictly before index i. */
export function priorAvgVolume(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(Number.NaN)
  for (let i = period; i < bars.length; i++) {
    let sum = 0
    for (let j = i - period; j < i; j++) sum += bars[j].v
    out[i] = sum / period
  }
  return out
}

export function last<T>(arr: T[], offset = 0): T {
  return arr[arr.length - 1 - offset]
}

export function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return n
  const f = 10 ** digits
  return Math.round(n * f) / f
}
