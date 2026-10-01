import { MARKETS } from './markets'
import type { MarketConfig, PositionInfo, SignalAction } from './types'

export const RISK = {
  /** Every entry carries a broker-side stop this far from the fill price. */
  stopLossPct: 0.01,
  /** Volatility scalar bounds: size shrinks toward 25% of budget when ATR is elevated, never above 100%. */
  minVolScalar: 0.25,
  maxVolScalar: 1,
  /** Total absolute exposure across all markets may not exceed this fraction of equity. */
  maxGrossExposurePct: 1,
} as const

export const RISK_RULES = [
  {
    id: 'stop',
    title: 'Hard 1% stop on every trade',
    detail:
      'Each entry is submitted with a good-til-cancelled stop 1% from the fill. It lives at the broker, so it fires even if this app is down, and survives overnight. Every cycle re-checks coverage and restores any missing stop.',
  },
  {
    id: 'vol',
    title: 'Volatility-scaled sizing',
    detail: 'Position size = market budget x (baseline ATR / current ATR), clamped to 25-100%. Wild markets get smaller trades automatically.',
  },
  {
    id: 'corr',
    title: 'No doubled-up index bets',
    detail:
      'S&P 500 and NASDAQ share a correlation group. If one is long the other cannot go long, and if one is short the other cannot go short, including entries placed earlier in the same cycle. Prevents a single macro move from hitting two positions.',
  },
  {
    id: 'gross',
    title: 'Gross exposure cap',
    detail: 'Combined notional across all five markets is capped at 100% of equity. No hidden leverage stacking.',
  },
  {
    id: 'one',
    title: 'One position per market',
    detail: 'A market must fully exit before it can re-enter. No pyramiding, no averaging down.',
  },
]

export function stopPriceFor(entryPrice: number, side: 'long' | 'short'): number {
  const raw = side === 'long' ? entryPrice * (1 - RISK.stopLossPct) : entryPrice * (1 + RISK.stopLossPct)
  return Number(raw.toFixed(2))
}

export interface SizingInput {
  equity: number
  price: number
  atrPct: number
  market: MarketConfig
}

export interface Sizing {
  qty: number
  notional: number
  volScalar: number
  budget: number
  maxLoss: number
}

export function positionSize({ equity, price, atrPct, market }: SizingInput): Sizing {
  const budget = equity * market.exposurePct
  const rawScalar = atrPct > 0 ? market.baselineAtrPct / atrPct : 1
  const volScalar = Math.min(RISK.maxVolScalar, Math.max(RISK.minVolScalar, rawScalar))
  const targetNotional = budget * volScalar
  const qty = market.fractional
    ? Number((targetNotional / price).toFixed(6))
    : Math.floor(targetNotional / price)
  const notional = qty * price
  return {
    qty,
    notional,
    volScalar: Number(volScalar.toFixed(3)),
    budget,
    maxLoss: notional * RISK.stopLossPct,
  }
}

export interface FilterInput {
  market: MarketConfig
  action: SignalAction
  positions: PositionInfo[]
  /** Entries placed earlier in this same cycle that may not yet appear in broker positions */
  pendingEntries: PendingEntry[]
  equity: number
  proposedNotional: number
}

export interface PendingEntry {
  marketId: string
  side: 'long' | 'short'
}

export interface FilterResult {
  ok: boolean
  reason: string
}

function positionForMarket(positions: PositionInfo[], market: MarketConfig): PositionInfo | undefined {
  const target = market.symbol.replace('/', '')
  return positions.find((p) => p.symbol.replace('/', '') === target)
}

export function applyFilters(input: FilterInput): FilterResult {
  const { market, action, positions, pendingEntries, equity, proposedNotional } = input

  if (action !== 'enter_long' && action !== 'enter_short') return { ok: true, reason: 'No entry to filter' }

  if (positionForMarket(positions, market)) {
    return { ok: false, reason: 'Already holding a position in this market' }
  }

  if (action === 'enter_short' && !market.allowShort) {
    return { ok: false, reason: 'Shorting disabled for this market' }
  }

  if (market.correlationGroup) {
    const side = action === 'enter_long' ? 'long' : 'short'
    const siblings = MARKETS.filter((m) => m.id !== market.id && m.correlationGroup === market.correlationGroup)
    for (const sibling of siblings) {
      const held = positionForMarket(positions, sibling)?.side === side
      const pending = pendingEntries.some((p) => p.marketId === sibling.id && p.side === side)
      if (held || pending) {
        return { ok: false, reason: `Correlation filter: ${sibling.name} is already ${side}` }
      }
    }
  }

  const gross = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0)
  if (gross + proposedNotional > equity * RISK.maxGrossExposurePct) {
    return {
      ok: false,
      reason: `Gross exposure cap: ${(gross + proposedNotional).toFixed(0)} would exceed ${(equity * RISK.maxGrossExposurePct).toFixed(0)}`,
    }
  }

  return { ok: true, reason: 'Passed all filters' }
}

export interface CorrelationState {
  active: boolean
  side?: 'long' | 'short'
  heldMarket?: MarketConfig
  blockedMarket?: MarketConfig
}

/** Whether the correlation filter is currently blocking one index market from matching the other's direction. */
export function correlationFilterState(positions: PositionInfo[]): CorrelationState {
  const indexMarkets = MARKETS.filter((m) => m.correlationGroup === 'us_index')
  for (const m of indexMarkets) {
    const pos = positionForMarket(positions, m)
    if (pos) {
      const blocked = indexMarkets.find((x) => x.id !== m.id)
      return { active: true, side: pos.side, heldMarket: m, blockedMarket: blocked }
    }
  }
  return { active: false }
}
