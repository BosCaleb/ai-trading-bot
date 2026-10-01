import { isRegularSession } from '@/lib/broker/alpaca'
import { positionSize, stopPriceFor } from '@/lib/trading/risk'
import { STRATEGIES } from '@/lib/trading/strategies'
import type { Bar, MarketConfig, PositionSide, StrategyFn, Timeframe } from '@/lib/trading/types'
import { computeMetrics, type BacktestMetrics } from './metrics'

/**
 * Single-market, bar-by-bar replay of a live strategy with the same rules the cron engine uses:
 *
 * - The strategy sees only closed bars, in the same trailing window the live engine requests
 *   (`windowSize`, default 250), so EMA seeding and warm-up behave exactly as in production.
 * - A signal on bar i's close fills at bar i+1's open (the live cron fires 1-3 minutes after the
 *   close and sends a market order), plus adverse slippage and fees.
 * - US equity signals are dropped when the regular session is closed at the bar's close, mirroring
 *   the live `market_closed` deferral. Crypto trades 24/7.
 * - Every entry carries the live ATR-based stop. The distance is fixed at the signal; equities
 *   anchor it to the signal close (what the OTO order uses), crypto to the fill (stop submitted
 *   after the fill). The stop is checked intrabar on every bar the position is open, including
 *   the entry bar; a gap through the stop fills at the open, not at the stop.
 * - Sizing uses the live risk-based `positionSize` (1% of marked-to-market equity at the stop,
 *   leverage-capped, broker minimums respected); trades it would skip are skipped here too.
 *
 * Not modelled: the portfolio-level correlation filter, combined open-risk cap and cross-market
 * leverage cap (they need several markets at once), borrow costs on shorts, partial fills, and stop-limit orders failing to fill in a
 * crypto gap (stops are treated as always filling).
 */

export interface BacktestCosts {
  /** Commission per side, in basis points of notional */
  feeBps: number
  /** Adverse price move per fill, in basis points */
  slippageBps: number
}

export const DEFAULT_COSTS: Record<MarketConfig['assetClass'], BacktestCosts> = {
  // Alpaca equities are commission-free; slippage covers spread on liquid ETFs.
  us_equity: { feeBps: 0, slippageBps: 2 },
  // Alpaca crypto taker fee at the entry tier is 25 bps; BTC/USD spreads are wider than ETFs.
  crypto: { feeBps: 25, slippageBps: 5 },
}

export interface BacktestOptions {
  market: MarketConfig
  bars: Bar[]
  initialEquity?: number
  costs?: Partial<BacktestCosts>
  /** Trailing bars handed to the strategy each step; the live engine uses 250 */
  windowSize?: number
  /** Override the market's strategy, e.g. to test parameter variants */
  strategy?: StrategyFn
  /** Override the session check (tests); defaults to the live regular-session rule for equities */
  canTrade?: (closeTimeMs: number) => boolean
}

export type ExitReason = 'signal' | 'stop' | 'end_of_data'

export interface Trade {
  side: 'long' | 'short'
  qty: number
  entryTime: number
  entryPrice: number
  stopPrice: number
  exitTime: number
  exitPrice: number
  exitReason: ExitReason
  barsHeld: number
  /** Net of fees and slippage */
  pnl: number
  /** pnl / entry notional */
  returnPct: number
  /** Planned loss at the initial stop (qty x stop distance) */
  riskAmount: number
  /** pnl in units of the planned risk */
  rMultiple: number
  entryReason: string
  exitDetail: string
}

export interface EquityPoint {
  t: number
  equity: number
}

export interface BacktestResult {
  market: MarketConfig
  from: number
  to: number
  bars: number
  initialEquity: number
  finalEquity: number
  costs: BacktestCosts
  trades: Trade[]
  equityCurve: EquityPoint[]
  /** Signals the session filter dropped (equities only) */
  skippedClosedSession: number
  /** Entries skipped because the broker minimum would risk more than the budget */
  skippedTooSmall: number
  metrics: BacktestMetrics
}

export const BAR_MS: Record<Timeframe, number> = {
  '15Min': 15 * 60_000,
  '1Hour': 60 * 60_000,
  '4Hour': 4 * 60 * 60_000,
}

interface OpenPosition {
  side: 'long' | 'short'
  qty: number
  entryTime: number
  entryIndex: number
  entryPrice: number
  stopPrice: number
  entryFee: number
  riskAmount: number
  entryReason: string
}

interface PendingOrder {
  kind: 'enter' | 'exit'
  side: 'long' | 'short'
  qty: number
  /** Signal-bar close: the reference price the live engine anchors equity stops to */
  referencePrice: number
  /** Stop distance fixed at the signal */
  stopDistance: number
  reason: string
}

function sideSign(side: 'long' | 'short'): 1 | -1 {
  return side === 'long' ? 1 : -1
}

export function runBacktest(opts: BacktestOptions): BacktestResult {
  const { market, bars } = opts
  const initialEquity = opts.initialEquity ?? 100_000
  const costs: BacktestCosts = { ...DEFAULT_COSTS[market.assetClass], ...opts.costs }
  const windowSize = opts.windowSize ?? 250
  const strategy = opts.strategy ?? STRATEGIES[market.strategy]
  const barMs = BAR_MS[market.timeframe]
  const canTrade =
    opts.canTrade ?? (market.assetClass === 'crypto' ? () => true : (closeTime: number) => isRegularSession(closeTime))

  const slip = costs.slippageBps / 10_000
  const fee = costs.feeBps / 10_000
  /** Fill price after slippage: buyers pay up, sellers receive less */
  const fillPrice = (price: number, buying: boolean) => price * (buying ? 1 + slip : 1 - slip)

  let cash = initialEquity
  let position: OpenPosition | null = null
  let pending: PendingOrder | null = null
  const trades: Trade[] = []
  const equityCurve: EquityPoint[] = []
  let skippedClosedSession = 0
  let skippedTooSmall = 0

  const markToMarket = (price: number) =>
    position ? cash + sideSign(position.side) * position.qty * price : cash

  const closeTrade = (exitTime: number, rawPrice: number, reason: ExitReason, exitIndex: number, detail: string) => {
    if (!position) return
    const buying = position.side === 'short'
    const exitPrice = fillPrice(rawPrice, buying)
    const exitFee = position.qty * exitPrice * fee
    const gross = sideSign(position.side) * position.qty * (exitPrice - position.entryPrice)
    const pnl = gross - position.entryFee - exitFee
    const entryNotional = position.qty * position.entryPrice
    // Cash already reflects the entry (long: paid notional; short: received notional).
    cash += sideSign(position.side) * position.qty * exitPrice - exitFee
    trades.push({
      side: position.side,
      qty: position.qty,
      entryTime: position.entryTime,
      entryPrice: position.entryPrice,
      stopPrice: position.stopPrice,
      exitTime,
      exitPrice,
      exitReason: reason,
      barsHeld: exitIndex - position.entryIndex + 1,
      pnl,
      returnPct: entryNotional > 0 ? pnl / entryNotional : 0,
      riskAmount: position.riskAmount,
      rMultiple: position.riskAmount > 0 ? pnl / position.riskAmount : 0,
      entryReason: position.entryReason,
      exitDetail: detail,
    })
    position = null
  }

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]

    // 1) Fill whatever the previous bar's close decided, at this bar's open.
    if (pending) {
      if (pending.kind === 'exit') {
        closeTrade(bar.t, bar.o, 'signal', i, pending.reason)
      } else {
        const buying = pending.side === 'long'
        const entryPrice = fillPrice(bar.o, buying)
        const anchor: number = market.assetClass === 'crypto' ? entryPrice : pending.referencePrice
        const entryFee: number = pending.qty * entryPrice * fee
        cash -= sideSign(pending.side) * pending.qty * entryPrice + entryFee
        position = {
          side: pending.side,
          qty: pending.qty,
          entryTime: bar.t,
          entryIndex: i,
          entryPrice,
          stopPrice: stopPriceFor(anchor, pending.side, pending.stopDistance),
          entryFee,
          riskAmount: pending.qty * pending.stopDistance,
          entryReason: pending.reason,
        }
      }
      pending = null
    }

    // 2) Broker-side stop, intrabar. A gap through the stop fills at the open.
    if (position) {
      const { side, stopPrice } = position
      if (side === 'long' && bar.l <= stopPrice) {
        closeTrade(bar.t, Math.min(bar.o, stopPrice), 'stop', i, `Stop ${stopPrice} hit`)
      } else if (side === 'short' && bar.h >= stopPrice) {
        closeTrade(bar.t, Math.max(bar.o, stopPrice), 'stop', i, `Stop ${stopPrice} hit`)
      }
    }

    equityCurve.push({ t: bar.t, equity: markToMarket(bar.c) })

    // 3) At the close: ask the strategy, exactly as the cron would.
    if (i === bars.length - 1) break
    const window = bars.slice(Math.max(0, i + 1 - windowSize), i + 1)
    const side: PositionSide = position ? position.side : 'flat'
    const signal = strategy(window, side, market)
    if (signal.action === 'hold') continue

    if (!canTrade(bar.t + barMs)) {
      skippedClosedSession++
      continue
    }

    if (signal.action === 'exit') {
      if (position) pending = { kind: 'exit', side: position.side, qty: position.qty, referencePrice: bar.c, stopDistance: 0, reason: signal.reason }
      continue
    }

    if (position) continue // one position per market
    const entrySide = signal.action === 'enter_long' ? 'long' : 'short'
    if (entrySide === 'short' && !market.allowShort) continue
    const atrPct = signal.metrics.atrPct ?? market.baselineAtrPct
    const sizing = positionSize({ equity: markToMarket(bar.c), price: bar.c, atrPct, market })
    if (sizing.skipReason) {
      skippedTooSmall++
      continue
    }
    pending = { kind: 'enter', side: entrySide, qty: sizing.qty, referencePrice: bar.c, stopDistance: sizing.stopDistance, reason: signal.reason }
  }

  const last = bars[bars.length - 1]
  if (position && last) {
    closeTrade(last.t, last.c, 'end_of_data', bars.length - 1, 'Closed at end of data')
    equityCurve[equityCurve.length - 1] = { t: last.t, equity: cash }
  }

  return {
    market,
    from: bars[0]?.t ?? 0,
    to: last?.t ?? 0,
    bars: bars.length,
    initialEquity,
    finalEquity: cash,
    costs,
    trades,
    equityCurve,
    skippedClosedSession,
    skippedTooSmall,
    metrics: computeMetrics({ trades, equityCurve, initialEquity, bars, barMs: BAR_MS[market.timeframe] }),
  }
}
