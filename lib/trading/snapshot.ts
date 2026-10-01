import {
  type AccountInfo,
  type ClockInfo,
  type EquityPoint,
  closedBars,
  getAccount,
  getBars,
  getClock,
  getOpenOrders,
  getOrders,
  getPortfolioHistory,
  getPositions,
  isBrokerConfigured,
  tradingMode,
} from '@/lib/broker/alpaca'
import { isSmsConfigured } from '@/lib/notify/sms'
import type { HaltReason } from '@/lib/state/store'
import { getStateStore, isStateStoreConfigured } from '@/lib/state/supabase-store'
import { LIMITS, LOSS_LIMIT_RULES, evaluateLimits } from './loss-limits'
import { botEnabled, evaluateMarket, positionFor } from './engine'
import { MARKETS, TIMEFRAME_META } from './markets'
import { openRiskFor, stopCoverage } from './protection'
import { RISK, RISK_RULES, correlationFilterState, positionSize } from './risk'
import type { MarketConfig, OrderInfo, PositionInfo, Signal } from './types'

export interface MarketSnapshot {
  config: MarketConfig
  price: number | null
  change24hPct: number | null
  atrPct: number | null
  signal: Signal | null
  position: PositionInfo | null
  /** Tightest stop actually working at the broker for the open position */
  stopPrice: number | null
  /** False when a position is open without full stop coverage at the broker */
  stopCovered: boolean
  /** What the next entry would look like under the risk rules (qty 0 with skipReason when it would be skipped) */
  nextSize: { qty: number; notional: number; riskAmount: number; riskPct: number; stopDistance: number; skipReason: string | null } | null
  lastBarAt: string | null
  error: string | null
}

export interface DashboardSnapshot {
  configured: boolean
  mode: 'paper' | 'live'
  botEnabled: boolean
  smsConfigured: boolean
  /** Supabase connected: trade journal, equity history and loss-limit state persist */
  stateConfigured: boolean
  generatedAt: string
  account: AccountInfo | null
  clock: ClockInfo | null
  markets: MarketSnapshot[]
  orders: OrderInfo[]
  history: EquityPoint[]
  /** Loss-limit status as the next cycle will see it (read-only; only the cron saves state) */
  limits: {
    enabled: boolean
    halted: boolean
    haltReason: HaltReason | null
    reason: string | null
    dayChangePct: number | null
    drawdownPct: number | null
    dailyLossPct: number
    maxDrawdownPct: number
    error: string | null
  }
  risk: {
    rules: { id: string; title: string; detail: string }[]
    riskPerTradePct: number
    maxOpenRiskPct: number
    maxLeverage: number
    /** Planned loss of all open positions at their stops */
    openRisk: number
    openRiskPct: number
    grossExposure: number
    /** Gross exposure / equity, i.e. current leverage */
    grossExposurePct: number
    correlation: { active: boolean; side?: 'long' | 'short'; heldMarket?: string; blockedMarket?: string }
  }
  error: string | null
}

function emptyMarket(config: MarketConfig, error: string | null = null): MarketSnapshot {
  return {
    config,
    price: null,
    change24hPct: null,
    atrPct: null,
    signal: null,
    position: null,
    stopPrice: null,
    stopCovered: true,
    nextSize: null,
    lastBarAt: null,
    error,
  }
}

export async function buildSnapshot(): Promise<DashboardSnapshot> {
  const base: DashboardSnapshot = {
    configured: isBrokerConfigured(),
    mode: tradingMode(),
    botEnabled: botEnabled(),
    smsConfigured: isSmsConfigured(),
    stateConfigured: isStateStoreConfigured(),
    generatedAt: new Date().toISOString(),
    account: null,
    clock: null,
    markets: MARKETS.map((m) => emptyMarket(m)),
    orders: [],
    history: [],
    limits: {
      enabled: false,
      halted: false,
      haltReason: null,
      reason: null,
      dayChangePct: null,
      drawdownPct: null,
      dailyLossPct: LIMITS.dailyLossPct,
      maxDrawdownPct: LIMITS.maxDrawdownPct,
      error: null,
    },
    risk: {
      rules: [...RISK_RULES, ...LOSS_LIMIT_RULES],
      riskPerTradePct: RISK.riskPerTradePct,
      maxOpenRiskPct: RISK.maxOpenRiskPct,
      maxLeverage: RISK.maxLeverage,
      openRisk: 0,
      openRiskPct: 0,
      grossExposure: 0,
      grossExposurePct: 0,
      correlation: { active: false },
    },
    error: null,
  }

  if (!base.configured) return base

  try {
    const [account, positions, clock, orders, openOrders, history] = await Promise.all([
      getAccount(),
      getPositions(),
      getClock(),
      getOrders(40),
      getOpenOrders(),
      getPortfolioHistory('1M', '1D').catch(() => [] as EquityPoint[]),
    ])

    const markets = await Promise.all(
      MARKETS.map(async (config): Promise<MarketSnapshot> => {
        try {
          const bars = closedBars(await getBars(config, 250), config.timeframe)
          const position = positionFor(positions, config) ?? null
          const signal = evaluateMarket(config, bars, position ?? undefined)
          const lastBar = bars[bars.length - 1]
          const price = position?.currentPrice ?? lastBar?.c ?? null
          const barsBack = TIMEFRAME_META[config.timeframe].barsPerDay
          const ref = bars[bars.length - 1 - barsBack]
          const change24hPct = ref && lastBar ? (lastBar.c - ref.c) / ref.c : null
          const atrPct = signal.metrics.atrPct ?? null
          const coverage = position ? stopCoverage(position, openOrders) : null
          const nextSize =
            price && atrPct ? positionSize({ equity: account.equity, price, atrPct, market: config }) : null
          return {
            config,
            price,
            change24hPct,
            atrPct,
            signal,
            position,
            stopPrice: coverage?.stopPrice ?? null,
            stopCovered: !position || !coverage || coverage.coveredQty >= position.qty - 1e-6,
            nextSize: nextSize
              ? {
                  qty: nextSize.qty,
                  notional: nextSize.notional,
                  riskAmount: nextSize.riskAmount,
                  riskPct: nextSize.riskPct,
                  stopDistance: nextSize.stopDistance,
                  skipReason: nextSize.skipReason,
                }
              : null,
            lastBarAt: lastBar ? new Date(lastBar.t).toISOString() : null,
            error: null,
          }
        } catch (err) {
          return emptyMarket(config, (err as Error).message)
        }
      }),
    )

    let limits = base.limits
    const store = getStateStore()
    if (store) {
      try {
        const evaluation = evaluateLimits(await store.getState(base.mode), account.equity, new Date())
        limits = {
          ...limits,
          enabled: true,
          halted: !evaluation.entriesAllowed,
          haltReason: evaluation.state.haltReason,
          reason: evaluation.reason,
          dayChangePct: evaluation.dayChangePct,
          drawdownPct: evaluation.drawdownPct,
        }
      } catch (err) {
        limits = { ...limits, enabled: true, halted: true, error: (err as Error).message }
      }
    }

    const gross = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0)
    const openRisk = openRiskFor(positions, openOrders)
    const corr = correlationFilterState(positions)

    return {
      ...base,
      account,
      clock,
      limits,
      orders,
      history,
      markets,
      risk: {
        ...base.risk,
        openRisk,
        openRiskPct: account.equity > 0 ? openRisk / account.equity : 0,
        grossExposure: gross,
        grossExposurePct: account.equity > 0 ? gross / account.equity : 0,
        correlation: { active: corr.active, side: corr.side, heldMarket: corr.heldMarket?.name, blockedMarket: corr.blockedMarket?.name },
      },
    }
  } catch (err) {
    return { ...base, error: (err as Error).message }
  }
}
