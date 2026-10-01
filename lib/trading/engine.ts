import {
  closePosition,
  closedBars,
  getAccount,
  getBars,
  getClock,
  getOpenOrders,
  getPositions,
  submitEntry,
  tradingMode,
} from '@/lib/broker/alpaca'
import { marketsForTimeframe } from './markets'
import { type ProtectionResult, ensureStops } from './protection'
import { applyFilters, positionSize, stopPriceFor } from './risk'
import { STRATEGIES } from './strategies'
import type { MarketConfig, PositionInfo, PositionSide, Signal, Timeframe } from './types'

export type CycleAction = 'opened_long' | 'opened_short' | 'closed' | 'blocked' | 'market_closed' | 'none' | 'error'

export interface MarketCycleResult {
  marketId: string
  name: string
  symbol: string
  price: number | null
  position: PositionSide
  signal: Signal | null
  action: CycleAction
  detail: string
  order?: { id: string; qty: number; stopPrice: number; fillPrice: number | null }
}

export interface CycleResult {
  timeframe: Timeframe
  mode: 'paper' | 'live'
  ranAt: string
  botEnabled: boolean
  equityMarketOpen: boolean
  /** Stop-guardian pass over every open position, run before any new signals */
  protection: ProtectionResult[]
  results: MarketCycleResult[]
}

export function botEnabled(): boolean {
  return process.env.BOT_ENABLED !== 'false'
}

export function positionFor(positions: PositionInfo[], market: MarketConfig): PositionInfo | undefined {
  const target = market.symbol.replace('/', '')
  return positions.find((p) => p.symbol.replace('/', '') === target)
}

export function evaluateMarket(market: MarketConfig, bars: ReturnType<typeof closedBars>, position: PositionInfo | undefined): Signal {
  const side: PositionSide = position ? position.side : 'flat'
  return STRATEGIES[market.strategy](bars, side, market)
}

/**
 * One scheduled pass for every market on a timeframe: pull closed candles, ask the market's
 * strategy for a signal, run it through the risk filters, then act at the broker.
 */
export async function runCycle(timeframe: Timeframe): Promise<CycleResult> {
  const markets = marketsForTimeframe(timeframe)
  const [account, allPositions, clock, openOrders] = await Promise.all([getAccount(), getPositions(), getClock(), getOpenOrders()])
  const enabled = botEnabled()

  // Protect what is already open before acting on anything new. Positions the guardian had to
  // close are dropped so strategies don't also try to exit them.
  const protection = await ensureStops(allPositions, openOrders, clock.isOpen)
  const closedByGuardian = new Set(protection.filter((p) => p.action === 'closed_breached').map((p) => p.symbol))
  const positions = allPositions.filter((p) => !closedByGuardian.has(p.symbol))

  const evaluations = await Promise.all(
    markets.map(async (market) => {
      try {
        const bars = closedBars(await getBars(market, 250), market.timeframe)
        const position = positionFor(positions, market)
        const signal = evaluateMarket(market, bars, position)
        return { market, bars, position, signal, error: null as string | null }
      } catch (err) {
        return { market, bars: [], position: positionFor(positions, market), signal: null, error: (err as Error).message }
      }
    }),
  )

  // Exits first so freed capital and cleared correlation locks are visible to entries in the same pass.
  const ordered = [...evaluations].sort((a, b) => {
    const rank = (s: Signal | null) => (s?.action === 'exit' ? 0 : s?.action?.startsWith('enter') ? 1 : 2)
    const diff = rank(a.signal) - rank(b.signal)
    return diff !== 0 ? diff : (b.signal?.strength ?? 0) - (a.signal?.strength ?? 0)
  })

  const pendingLongs: string[] = []
  const livePositions = [...positions]
  const results: MarketCycleResult[] = []

  for (const ev of ordered) {
    const { market, bars, position, signal, error } = ev
    const price = bars.length ? bars[bars.length - 1].c : position?.currentPrice ?? null
    const base: MarketCycleResult = {
      marketId: market.id,
      name: market.name,
      symbol: market.symbol,
      price,
      position: position ? position.side : 'flat',
      signal,
      action: 'none',
      detail: '',
    }

    if (error || !signal) {
      results.push({ ...base, action: 'error', detail: error ?? 'No signal produced' })
      continue
    }

    if (signal.action === 'hold') {
      results.push({ ...base, detail: signal.reason })
      continue
    }

    if (!enabled) {
      results.push({ ...base, action: 'blocked', detail: `Bot paused (BOT_ENABLED=false). Would ${signal.action.replace('_', ' ')}: ${signal.reason}` })
      continue
    }

    if (market.assetClass === 'us_equity' && !clock.isOpen) {
      results.push({ ...base, action: 'market_closed', detail: `US session closed. Signal ${signal.action.replace('_', ' ')} deferred: ${signal.reason}` })
      continue
    }

    try {
      if (signal.action === 'exit') {
        if (!position) {
          results.push({ ...base, detail: 'Exit signal with no open position' })
          continue
        }
        const order = await closePosition(market)
        const idx = livePositions.findIndex((p) => p.symbol === position.symbol)
        if (idx >= 0) livePositions.splice(idx, 1)
        results.push({
          ...base,
          action: 'closed',
          detail: signal.reason,
          order: order ? { id: order.id, qty: order.qty ?? position.qty, stopPrice: 0, fillPrice: order.filledAvgPrice } : undefined,
        })
        continue
      }

      const side = signal.action === 'enter_long' ? 'long' : 'short'
      const atrPct = signal.metrics.atrPct ?? market.baselineAtrPct
      const sizing = positionSize({ equity: account.equity, price: price ?? 0, atrPct, market })

      const filter = applyFilters({
        market,
        action: signal.action,
        positions: livePositions,
        pendingLongMarketIds: pendingLongs,
        equity: account.equity,
        proposedNotional: sizing.notional,
      })
      if (!filter.ok) {
        results.push({ ...base, action: 'blocked', detail: `${filter.reason}. Signal: ${signal.reason}` })
        continue
      }
      if (sizing.qty <= 0 || !price) {
        results.push({ ...base, action: 'blocked', detail: 'Volatility-scaled size rounded to zero' })
        continue
      }

      const stop = stopPriceFor(price, side)
      const placed = await submitEntry({ market, side, qty: sizing.qty, referencePrice: price, stopPrice: stop })

      if (side === 'long') pendingLongs.push(market.id)
      livePositions.push({
        symbol: market.symbol.replace('/', ''),
        side,
        qty: sizing.qty,
        avgEntry: placed.fillPrice ?? price,
        currentPrice: price,
        marketValue: (side === 'long' ? 1 : -1) * sizing.notional,
        unrealizedPl: 0,
        unrealizedPlPct: 0,
      })

      results.push({
        ...base,
        position: side,
        action: side === 'long' ? 'opened_long' : 'opened_short',
        detail: `${signal.reason}. Size ${sizing.qty} (${Math.round(sizing.volScalar * 100)}% of budget, ATR ${(atrPct * 100).toFixed(2)}%). Stop ${placed.stopPrice}.`,
        order: { id: placed.orderId, qty: sizing.qty, stopPrice: placed.stopPrice, fillPrice: placed.fillPrice },
      })
    } catch (err) {
      results.push({ ...base, action: 'error', detail: (err as Error).message })
    }
  }

  return {
    timeframe,
    mode: tradingMode(),
    ranAt: new Date().toISOString(),
    botEnabled: enabled,
    equityMarketOpen: clock.isOpen,
    protection,
    results,
  }
}
