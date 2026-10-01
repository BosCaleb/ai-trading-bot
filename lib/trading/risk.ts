import { MARKETS } from './markets'
import type { MarketConfig, PositionInfo, SignalAction } from './types'

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  const n = raw === undefined || raw === '' ? Number.NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

export const RISK = {
  /** Planned loss if a trade's initial stop is hit, as a fraction of equity (before slippage and fees). */
  riskPerTradePct: 0.01,
  /** Sum of every open position's initial-stop risk may not exceed this fraction of equity. */
  maxOpenRiskPct: 0.03,
  /** Total position value across all markets may not exceed this multiple of equity. Override with MAX_LEVERAGE. */
  maxLeverage: envNumber('MAX_LEVERAGE', 5),
  /**
   * Stops are never closer than this fraction of price, so a freak low-ATR reading cannot produce a
   * stop inside the spread and a huge position.
   */
  minStopPct: 0.002,
} as const

export const RISK_RULES = [
  {
    id: 'stop',
    title: 'Volatility-based stop on every trade',
    detail:
      'Each entry carries a good-til-cancelled stop a multiple of the market\'s ATR away, so normal noise does not stop it out. It lives at the broker, fires even if this app is down, and survives overnight. Every cycle re-checks coverage and restores any missing stop.',
  },
  {
    id: 'vol',
    title: '1% of equity at risk per trade',
    detail:
      'Position size = 1% of equity / distance to the stop, so a stop-out loses about 1% whatever the market or volatility. If the broker\'s minimum size would risk more, the trade is skipped. Sizes are never rounded up.',
  },
  {
    id: 'corr',
    title: 'No doubled-up index bets',
    detail:
      'S&P 500 and NASDAQ share a correlation group. If one is long the other cannot go long, and if one is short the other cannot go short, including entries placed earlier in the same cycle. Prevents a single macro move from hitting two positions.',
  },
  {
    id: 'openrisk',
    title: '3% combined open risk',
    detail: 'The planned losses of all open positions at their stops may not add up to more than 3% of equity. New entries wait until risk frees up.',
  },
  {
    id: 'gross',
    title: 'Leverage cap',
    detail: 'Total position value across all markets is capped at a fixed multiple of equity (MAX_LEVERAGE, default 5x), limiting damage from gaps and weekend moves.',
  },
  {
    id: 'one',
    title: 'One position per market',
    detail: 'A market must fully exit before it can re-enter. No pyramiding, no averaging down.',
  },
]

/** Distance from entry to the initial stop, in price units. */
export function stopDistanceFor(price: number, atrPct: number, market: MarketConfig): number {
  const atrDistance = price * atrPct * market.stopAtrMultiple
  return Math.max(atrDistance, price * RISK.minStopPct)
}

export function stopPriceFor(anchorPrice: number, side: 'long' | 'short', distance: number): number {
  const raw = side === 'long' ? anchorPrice - distance : anchorPrice + distance
  return Number(raw.toFixed(2))
}

/** Rounds down to the broker's quantity step; never up. */
export function roundDownToStep(qty: number, step: number): number {
  if (qty <= 0) return 0
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
  // Small epsilon absorbs float noise like 0.30000000000000004 / 0.1 = 2.9999999999999996.
  return Number((Math.floor(qty / step + 1e-9) * step).toFixed(decimals))
}

export interface SizingInput {
  equity: number
  /** Signal price the stop distance and size are computed from */
  price: number
  atrPct: number
  market: MarketConfig
}

export interface Sizing {
  qty: number
  notional: number
  /** Price distance to the initial stop */
  stopDistance: number
  /** Planned loss at the stop for `qty` */
  riskAmount: number
  /** riskAmount / equity */
  riskPct: number
  /** Set when the trade must be skipped (qty is 0) */
  skipReason: string | null
}

/**
 * Risk-based sizing: qty = (equity x 1%) / stop distance, rounded DOWN to the broker's step and
 * capped so one position alone never exceeds the leverage cap. If even the broker minimum would
 * risk more than the budget, the trade is skipped rather than forced.
 */
export function positionSize({ equity, price, atrPct, market }: SizingInput): Sizing {
  const stopDistance = stopDistanceFor(price, atrPct, market)
  const budget = equity * RISK.riskPerTradePct
  const empty = (skipReason: string): Sizing => ({ qty: 0, notional: 0, stopDistance, riskAmount: 0, riskPct: 0, skipReason })

  if (!(equity > 0) || !(price > 0)) return empty('No equity or price')

  const byRisk = budget / stopDistance
  const byLeverage = (equity * RISK.maxLeverage) / price
  const qty = roundDownToStep(Math.min(byRisk, byLeverage), market.qtyStep)

  if (qty < market.minQty) {
    const minRisk = market.minQty * stopDistance
    return empty(
      byRisk < market.minQty
        ? `Broker minimum ${market.minQty} would risk ${minRisk.toFixed(2)} (${((minRisk / equity) * 100).toFixed(2)}% of equity), above the ${RISK.riskPerTradePct * 100}% budget`
        : `Leverage cap ${RISK.maxLeverage}x leaves less than the broker minimum ${market.minQty}`,
    )
  }

  const riskAmount = qty * stopDistance
  return { qty, notional: qty * price, stopDistance, riskAmount, riskPct: riskAmount / equity, skipReason: null }
}

/** Planned loss if a position's stop is hit, measured from its entry. A stop trailed past entry carries no risk. */
export function positionRisk(position: Pick<PositionInfo, 'side' | 'qty' | 'avgEntry'>, stopPrice: number): number {
  const perUnit = position.side === 'long' ? position.avgEntry - stopPrice : stopPrice - position.avgEntry
  return Math.max(0, perUnit) * position.qty
}

export interface FilterInput {
  market: MarketConfig
  action: SignalAction
  positions: PositionInfo[]
  /** Entries placed earlier in this same cycle that may not yet appear in broker positions */
  pendingEntries: PendingEntry[]
  equity: number
  proposedNotional: number
  /** Planned loss of the proposed trade at its stop */
  proposedRisk: number
  /** Planned loss of everything already open (including entries earlier this cycle) */
  openRisk: number
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

  const riskCap = equity * RISK.maxOpenRiskPct
  if (input.openRisk + input.proposedRisk > riskCap + 1e-9) {
    return {
      ok: false,
      reason: `Open risk cap: ${(input.openRisk + input.proposedRisk).toFixed(2)} at stops would exceed ${riskCap.toFixed(2)} (${RISK.maxOpenRiskPct * 100}% of equity)`,
    }
  }

  const gross = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0)
  const grossCap = equity * RISK.maxLeverage
  if (gross + proposedNotional > grossCap) {
    return {
      ok: false,
      reason: `Leverage cap: ${(gross + proposedNotional).toFixed(0)} would exceed ${grossCap.toFixed(0)} (${RISK.maxLeverage}x equity)`,
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
