export type MarketId = 'spx' | 'ndx' | 'btc' | 'gold' | 'oil'
export type StrategyId = 'mean_reversion' | 'momentum_breakout' | 'trend_following'
export type Timeframe = '15Min' | '1Hour' | '4Hour'
export type AssetClass = 'us_equity' | 'crypto'
export type PositionSide = 'long' | 'short' | 'flat'
export type SignalAction = 'enter_long' | 'enter_short' | 'exit' | 'hold'

export interface Bar {
  /** Unix ms timestamp of bar open */
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface MarketConfig {
  id: MarketId
  name: string
  /** Tradable instrument at the broker (ETF proxy for indices/commodities, spot pair for crypto) */
  symbol: string
  displaySymbol: string
  assetClass: AssetClass
  timeframe: Timeframe
  strategy: StrategyId
  allowShort: boolean
  fractional: boolean
  /** Max notional exposure for this market as a fraction of account equity, before volatility scaling */
  exposurePct: number
  /** "Normal" ATR as a fraction of price on this timeframe. Higher current ATR shrinks position size. */
  baselineAtrPct: number
  /** Markets in the same group may not be long at the same time */
  correlationGroup?: string
  description: string
}

export interface Signal {
  action: SignalAction
  reason: string
  /** 0-1 confidence used to order execution when several markets fire in the same cycle */
  strength: number
  metrics: Record<string, number>
}

export interface PositionInfo {
  symbol: string
  side: 'long' | 'short'
  qty: number
  avgEntry: number
  currentPrice: number
  marketValue: number
  unrealizedPl: number
  unrealizedPlPct: number
}

export interface OrderInfo {
  id: string
  symbol: string
  side: 'buy' | 'sell'
  type: string
  qty: number | null
  notional: number | null
  filledQty: number
  filledAvgPrice: number | null
  stopPrice: number | null
  status: string
  orderClass: string
  submittedAt: string
  filledAt: string | null
}

export type StrategyFn = (bars: Bar[], position: PositionSide, market: MarketConfig) => Signal
