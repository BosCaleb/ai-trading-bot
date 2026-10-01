import { closePosition, submitProtectiveStop } from '@/lib/broker/alpaca'
import { marketBySymbol } from './markets'
import { positionRisk, stopDistanceFor, stopPriceFor } from './risk'
import type { MarketConfig, MarketId, OrderInfo, PositionInfo } from './types'

/**
 * Stop guardian. Every cycle re-checks that each open position has a working stop at the broker
 * and repairs any gap: positions opened before stops were GTC, stops cancelled by hand, partial
 * fills, or a crypto stop that failed to submit right after its entry filled.
 */

const STOP_TYPES = new Set(['stop', 'stop_limit', 'trailing_stop'])

function normalize(symbol: string): string {
  return symbol.replace('/', '')
}

/** Original stop per symbol from the trade journal, keyed by symbol without '/'. */
export type KnownStops = Map<string, number>

export function knownStopsFrom(trades: { symbol: string; stopPrice: number }[]): KnownStops {
  return new Map(trades.map((t) => [normalize(t.symbol), t.stopPrice]))
}

export interface StopCoverage {
  /** Tightest working stop price, or null when nothing protects the position */
  stopPrice: number | null
  /** Quantity the working stops would flatten */
  coveredQty: number
}

export function stopCoverage(position: PositionInfo, openOrders: OrderInfo[]): StopCoverage {
  const exitSide = position.side === 'long' ? 'sell' : 'buy'
  const stops = openOrders.filter(
    (o) => normalize(o.symbol) === normalize(position.symbol) && o.side === exitSide && STOP_TYPES.has(o.type),
  )
  const coveredQty = stops.reduce((sum, o) => sum + Math.max(0, (o.qty ?? 0) - o.filledQty), 0)
  const prices = stops.map((o) => o.stopPrice).filter((p): p is number => p !== null)
  const stopPrice = prices.length === 0 ? null : position.side === 'long' ? Math.max(...prices) : Math.min(...prices)
  return { stopPrice, coveredQty }
}

export type ProtectionPlan =
  | { kind: 'covered'; stopPrice: number | null }
  | { kind: 'place_stop'; qty: number; stopPrice: number }
  | { kind: 'close'; stopPrice: number }
  | { kind: 'wait_for_open'; stopPrice: number }

/** Quantities below this are treated as fully covered (fractional crypto rounding). */
const QTY_EPSILON = 1e-6

/**
 * Where a stop belongs when the broker has none for a position. The original ATR at entry is not
 * known here, so the market's typical ATR stands in until trade records are persisted.
 */
export function fallbackStopPrice(position: PositionInfo, market: MarketConfig): number {
  return stopPriceFor(position.avgEntry, position.side, stopDistanceFor(position.avgEntry, market.baselineAtrPct, market))
}

function roundToStep(qty: number, step: number): number {
  const decimals = Math.max(0, Math.ceil(-Math.log10(step)))
  return Number((Math.round(qty / step) * step).toFixed(decimals))
}

/** Where the stop for a position belongs: its journaled original stop, else the typical-ATR fallback. */
export function intendedStopPrice(position: PositionInfo, market: MarketConfig, knownStops?: KnownStops): number {
  return knownStops?.get(normalize(position.symbol)) ?? fallbackStopPrice(position, market)
}

/**
 * Planned loss of every open bot position at its stop: the working broker stop when there is one,
 * otherwise where the guardian would place it. Feeds the combined open-risk cap.
 */
export function openRiskFor(positions: PositionInfo[], openOrders: OrderInfo[], knownStops?: KnownStops): number {
  return positions.reduce((sum, position) => {
    const market = marketBySymbol(position.symbol)
    if (!market) return sum
    const stop = stopCoverage(position, openOrders).stopPrice ?? intendedStopPrice(position, market, knownStops)
    return sum + positionRisk(position, stop)
  }, 0)
}

/**
 * Decides how to protect one position. If price has already traded through where the stop
 * belongs, a new stop would trigger immediately (or be rejected), so the 1% rule is honoured by
 * closing at market instead, or by waiting for the session to open when the market is closed.
 */
export function planProtection(
  position: PositionInfo,
  market: MarketConfig,
  openOrders: OrderInfo[],
  canTradeNow: boolean,
  knownStops?: KnownStops,
): ProtectionPlan {
  const coverage = stopCoverage(position, openOrders)
  const missing = position.qty - coverage.coveredQty
  if (missing <= QTY_EPSILON) return { kind: 'covered', stopPrice: coverage.stopPrice }

  const stopPrice = coverage.stopPrice ?? intendedStopPrice(position, market, knownStops)
  const breached = position.side === 'long' ? position.currentPrice <= stopPrice : position.currentPrice >= stopPrice
  if (breached) return canTradeNow ? { kind: 'close', stopPrice } : { kind: 'wait_for_open', stopPrice }

  const qty = market.qtyStep >= 1 ? Math.ceil(missing - QTY_EPSILON) : roundToStep(missing, market.qtyStep)
  return { kind: 'place_stop', qty, stopPrice }
}

export type ProtectionAction = 'covered' | 'stop_placed' | 'closed_breached' | 'breached_market_closed' | 'unmanaged' | 'error'

export interface ProtectionResult {
  symbol: string
  marketId: MarketId | null
  action: ProtectionAction
  detail: string
}

export async function ensureStops(
  positions: PositionInfo[],
  openOrders: OrderInfo[],
  equityMarketOpen: boolean,
  knownStops?: KnownStops,
): Promise<ProtectionResult[]> {
  return Promise.all(
    positions.map(async (position): Promise<ProtectionResult> => {
      const market = marketBySymbol(position.symbol)
      if (!market) {
        return { symbol: position.symbol, marketId: null, action: 'unmanaged', detail: 'Not a bot market; left untouched' }
      }
      const base = { symbol: position.symbol, marketId: market.id }
      const canTradeNow = market.assetClass === 'crypto' || equityMarketOpen

      try {
        const plan = planProtection(position, market, openOrders, canTradeNow, knownStops)
        switch (plan.kind) {
          case 'covered':
            return { ...base, action: 'covered', detail: `Stop working at ${plan.stopPrice ?? '?'}` }
          case 'place_stop': {
            const order = await submitProtectiveStop({ market, side: position.side, qty: plan.qty, stopPrice: plan.stopPrice })
            return { ...base, action: 'stop_placed', detail: `Missing stop restored: ${plan.qty} at ${plan.stopPrice} (order ${order.id})` }
          }
          case 'close':
            await closePosition(market)
            return { ...base, action: 'closed_breached', detail: `Unprotected and already through its stop level (${plan.stopPrice}); closed at market` }
          case 'wait_for_open':
            return {
              ...base,
              action: 'breached_market_closed',
              detail: `Unprotected and through its stop level (${plan.stopPrice}); will close when the session opens`,
            }
        }
      } catch (err) {
        return { ...base, action: 'error', detail: `Stop repair failed: ${(err as Error).message}` }
      }
    }),
  )
}
