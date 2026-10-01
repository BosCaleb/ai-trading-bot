import type { MarketId } from '@/lib/trading/types'

/**
 * Persistent desk state. The trading engine only talks to this interface: Supabase in production
 * (see supabase-store.ts), an in-memory copy in tests.
 */

export type TradingMode = 'paper' | 'live'
export type HaltReason = 'daily_loss' | 'drawdown' | 'manual'

export interface BotState {
  mode: TradingMode
  peakEquity: number | null
  peakAt: string | null
  /** UTC date (YYYY-MM-DD) the daily loss limit is measuring */
  dayKey: string | null
  dayStartEquity: number | null
  haltReason: HaltReason | null
  haltDetail: string | null
  haltedAt: string | null
}

export interface NewTrade {
  mode: TradingMode
  marketId: MarketId
  symbol: string
  side: 'long' | 'short'
  qty: number
  entryOrderId: string
  entryPrice: number | null
  stopPrice: number
  stopDistance: number
  riskAmount: number
  equityAtEntry: number
  entryReason: string
}

export interface TradeRecord extends NewTrade {
  id: string
  openedAt: string
  closedAt: string | null
  exitPrice: number | null
  exitReason: string | null
  pnl: number | null
}

export interface TradeExit {
  exitPrice: number | null
  exitReason: string
  pnl: number | null
}

export interface StateStore {
  getState(mode: TradingMode): Promise<BotState>
  saveState(state: BotState): Promise<void>
  recordEquity(mode: TradingMode, equity: number, source: string): Promise<void>
  openTrade(trade: NewTrade): Promise<void>
  /** Closes the open trade for a market, if the journal has one. */
  closeTrade(mode: TradingMode, marketId: MarketId, exit: TradeExit): Promise<void>
  openTrades(mode: TradingMode): Promise<TradeRecord[]>
}

export function emptyState(mode: TradingMode): BotState {
  return { mode, peakEquity: null, peakAt: null, dayKey: null, dayStartEquity: null, haltReason: null, haltDetail: null, haltedAt: null }
}

/** Non-persistent store for tests and local experiments. */
export class MemoryStore implements StateStore {
  states = new Map<TradingMode, BotState>()
  trades: TradeRecord[] = []
  equity: { mode: TradingMode; equity: number; source: string; at: string }[] = []
  private seq = 0

  async getState(mode: TradingMode): Promise<BotState> {
    return { ...(this.states.get(mode) ?? emptyState(mode)) }
  }

  async saveState(state: BotState): Promise<void> {
    this.states.set(state.mode, { ...state })
  }

  async recordEquity(mode: TradingMode, equity: number, source: string): Promise<void> {
    this.equity.push({ mode, equity, source, at: new Date().toISOString() })
  }

  async openTrade(trade: NewTrade): Promise<void> {
    if (this.trades.some((t) => t.mode === trade.mode && t.marketId === trade.marketId && !t.closedAt)) {
      throw new Error(`Journal already has an open ${trade.marketId} trade`)
    }
    this.trades.push({ ...trade, id: `t${++this.seq}`, openedAt: new Date().toISOString(), closedAt: null, exitPrice: null, exitReason: null, pnl: null })
  }

  async closeTrade(mode: TradingMode, marketId: MarketId, exit: TradeExit): Promise<void> {
    const t = this.trades.find((x) => x.mode === mode && x.marketId === marketId && !x.closedAt)
    if (t) Object.assign(t, { closedAt: new Date().toISOString(), ...exit })
  }

  async openTrades(mode: TradingMode): Promise<TradeRecord[]> {
    return this.trades.filter((t) => t.mode === mode && !t.closedAt).map((t) => ({ ...t }))
  }
}
