import type { MarketConfig, MarketId, StrategyId, Timeframe } from './types'

export const MARKETS: MarketConfig[] = [
  {
    id: 'spx',
    name: 'S&P 500',
    symbol: 'SPY',
    displaySymbol: 'SPY',
    assetClass: 'us_equity',
    timeframe: '15Min',
    strategy: 'mean_reversion',
    allowShort: true,
    fractional: false,
    exposurePct: 0.2,
    baselineAtrPct: 0.0015,
    correlationGroup: 'us_index',
    description: 'Fades 2-sigma stretches from the 20-bar mean and exits when price snaps back.',
  },
  {
    id: 'ndx',
    name: 'NASDAQ 100',
    symbol: 'QQQ',
    displaySymbol: 'QQQ',
    assetClass: 'us_equity',
    timeframe: '15Min',
    strategy: 'mean_reversion',
    allowShort: true,
    fractional: false,
    exposurePct: 0.2,
    baselineAtrPct: 0.002,
    correlationGroup: 'us_index',
    description: 'Fades 2-sigma stretches from the 20-bar mean and exits when price snaps back.',
  },
  {
    id: 'btc',
    name: 'Bitcoin',
    symbol: 'BTC/USD',
    displaySymbol: 'BTC',
    assetClass: 'crypto',
    timeframe: '1Hour',
    strategy: 'momentum_breakout',
    allowShort: false,
    fractional: true,
    exposurePct: 0.15,
    baselineAtrPct: 0.006,
    description: 'Buys closes through the 20-bar high on 1.5x volume with a strong candle body; exits below the 20 EMA.',
  },
  {
    id: 'gold',
    name: 'Gold',
    symbol: 'GLD',
    displaySymbol: 'GLD',
    assetClass: 'us_equity',
    timeframe: '4Hour',
    strategy: 'trend_following',
    allowShort: true,
    fractional: false,
    exposurePct: 0.2,
    baselineAtrPct: 0.004,
    description: 'Rides 20/50 EMA trends with pullback entries; exits when the trend structure breaks.',
  },
  {
    id: 'oil',
    name: 'Crude Oil',
    symbol: 'USO',
    displaySymbol: 'USO',
    assetClass: 'us_equity',
    timeframe: '4Hour',
    strategy: 'trend_following',
    allowShort: true,
    fractional: false,
    exposurePct: 0.2,
    baselineAtrPct: 0.008,
    description: 'Rides 20/50 EMA trends with pullback entries; exits when the trend structure breaks.',
  },
]

export const MARKET_BY_ID = Object.fromEntries(MARKETS.map((m) => [m.id, m])) as Record<MarketId, MarketConfig>

export function marketsForTimeframe(timeframe: Timeframe): MarketConfig[] {
  return MARKETS.filter((m) => m.timeframe === timeframe)
}

export function marketBySymbol(symbol: string): MarketConfig | undefined {
  const normalized = symbol.replace('/', '')
  return MARKETS.find((m) => m.symbol.replace('/', '') === normalized)
}

export const STRATEGY_META: Record<StrategyId, { label: string; short: string; summary: string }> = {
  mean_reversion: {
    label: 'Mean Reversion',
    short: 'MR',
    summary: 'Catches the snapback when price stretches too far. Small moves, consistent returns.',
  },
  momentum_breakout: {
    label: 'Momentum Breakout',
    short: 'MB',
    summary: 'Waits for price to blast through a key level on heavy volume. Real moves only, no fakeouts.',
  },
  trend_following: {
    label: 'Trend Following',
    short: 'TF',
    summary: 'Slow, clean waves. Filters out entry noise and holds through the trend.',
  },
}

export const TIMEFRAME_META: Record<Timeframe, { label: string; barsPerDay: number; lookbackDays: number; slug: string }> = {
  '15Min': { label: '15m', barsPerDay: 26, lookbackDays: 14, slug: '15m' },
  '1Hour': { label: '1H', barsPerDay: 24, lookbackDays: 45, slug: '1h' },
  '4Hour': { label: '4H', barsPerDay: 6, lookbackDays: 150, slug: '4h' },
}

export const TIMEFRAME_BY_SLUG: Record<string, Timeframe> = {
  '15m': '15Min',
  '1h': '1Hour',
  '4h': '4Hour',
}
