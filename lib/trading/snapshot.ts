import {
  type AccountInfo,
  type ClockInfo,
  type EquityPoint,
  closedBars,
  getAccount,
  getBars,
  getClock,
  getOrders,
  getPortfolioHistory,
  getPositions,
  isBrokerConfigured,
  tradingMode,
} from '@/lib/broker/alpaca'
import { isSmsConfigured } from '@/lib/notify/sms'
import { botEnabled, evaluateMarket, positionFor } from './engine'
import { MARKETS, TIMEFRAME_META } from './markets'
import { RISK, RISK_RULES, correlationFilterState, positionSize, stopPriceFor } from './risk'
import type { MarketConfig, OrderInfo, PositionInfo, Signal } from './types'

export interface MarketSnapshot {
  config: MarketConfig
  price: number | null
  change24hPct: number | null
  atrPct: number | null
  signal: Signal | null
  position: PositionInfo | null
  stopPrice: number | null
  nextSize: { qty: number; notional: number; volScalar: number } | null
  lastBarAt: string | null
  error: string | null
}

export interface DashboardSnapshot {
  configured: boolean
  mode: 'paper' | 'live'
  botEnabled: boolean
  smsConfigured: boolean
  generatedAt: string
  account: AccountInfo | null
  clock: ClockInfo | null
  markets: MarketSnapshot[]
  orders: OrderInfo[]
  history: EquityPoint[]
  risk: {
    rules: typeof RISK_RULES
    stopLossPct: number
    grossExposure: number
    grossExposurePct: number
    correlation: { active: boolean; longMarket?: string; blockedMarket?: string }
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
    generatedAt: new Date().toISOString(),
    account: null,
    clock: null,
    markets: MARKETS.map((m) => emptyMarket(m)),
    orders: [],
    history: [],
    risk: {
      rules: RISK_RULES,
      stopLossPct: RISK.stopLossPct,
      grossExposure: 0,
      grossExposurePct: 0,
      correlation: { active: false },
    },
    error: null,
  }

  if (!base.configured) return base

  try {
    const [account, positions, clock, orders, history] = await Promise.all([
      getAccount(),
      getPositions(),
      getClock(),
      getOrders(40),
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
          const nextSize =
            price && atrPct ? positionSize({ equity: account.equity, price, atrPct, market: config }) : null
          return {
            config,
            price,
            change24hPct,
            atrPct,
            signal,
            position,
            stopPrice: position ? stopPriceFor(position.avgEntry, position.side) : null,
            nextSize: nextSize ? { qty: nextSize.qty, notional: nextSize.notional, volScalar: nextSize.volScalar } : null,
            lastBarAt: lastBar ? new Date(lastBar.t).toISOString() : null,
            error: null,
          }
        } catch (err) {
          return emptyMarket(config, (err as Error).message)
        }
      }),
    )

    const gross = positions.reduce((sum, p) => sum + Math.abs(p.marketValue), 0)
    const corr = correlationFilterState(positions)

    return {
      ...base,
      account,
      clock,
      orders,
      history,
      markets,
      risk: {
        ...base.risk,
        grossExposure: gross,
        grossExposurePct: account.equity > 0 ? gross / account.equity : 0,
        correlation: { active: corr.active, longMarket: corr.longMarket?.name, blockedMarket: corr.blockedMarket?.name },
      },
    }
  } catch (err) {
    return { ...base, error: (err as Error).message }
  }
}
