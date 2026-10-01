import { type SupabaseClient, createClient } from '@supabase/supabase-js'
import type { MarketId } from '@/lib/trading/types'
import { type BotState, type NewTrade, type StateStore, type TradeExit, type TradeRecord, type TradingMode, emptyState } from './store'

/**
 * Supabase-backed state. Server-only: it uses the service-role key, which must never reach the
 * browser. Tables and RLS are defined in supabase/migrations.
 */

export function isStateStoreConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

interface StateRow {
  mode: TradingMode
  peak_equity: number | string | null
  peak_at: string | null
  day_key: string | null
  day_start_equity: number | string | null
  halt_reason: BotState['haltReason']
  halt_detail: string | null
  halted_at: string | null
}

interface TradeRow {
  id: string
  mode: TradingMode
  market_id: MarketId
  symbol: string
  side: 'long' | 'short'
  qty: number | string
  entry_order_id: string
  entry_price: number | string | null
  stop_price: number | string
  stop_distance: number | string
  risk_amount: number | string
  equity_at_entry: number | string
  entry_reason: string | null
  opened_at: string
  closed_at: string | null
  exit_price: number | string | null
  exit_reason: string | null
  pnl: number | string | null
}

/** Postgres numerics arrive as strings over PostgREST. */
const num = (v: number | string | null): number | null => (v === null ? null : Number(v))

function toTrade(r: TradeRow): TradeRecord {
  return {
    id: r.id,
    mode: r.mode,
    marketId: r.market_id,
    symbol: r.symbol,
    side: r.side,
    qty: Number(r.qty),
    entryOrderId: r.entry_order_id,
    entryPrice: num(r.entry_price),
    stopPrice: Number(r.stop_price),
    stopDistance: Number(r.stop_distance),
    riskAmount: Number(r.risk_amount),
    equityAtEntry: Number(r.equity_at_entry),
    entryReason: r.entry_reason ?? '',
    openedAt: r.opened_at,
    closedAt: r.closed_at,
    exitPrice: num(r.exit_price),
    exitReason: r.exit_reason,
    pnl: num(r.pnl),
  }
}

function fail(action: string, error: { message: string } | null): void {
  if (error) throw new Error(`State store ${action} failed: ${error.message}`)
}

export class SupabaseStore implements StateStore {
  constructor(private readonly db: SupabaseClient) {}

  async getState(mode: TradingMode): Promise<BotState> {
    const { data, error } = await this.db.from('bot_state').select('*').eq('mode', mode).maybeSingle<StateRow>()
    fail('read state', error)
    if (!data) return emptyState(mode)
    return {
      mode,
      peakEquity: num(data.peak_equity),
      peakAt: data.peak_at,
      dayKey: data.day_key,
      dayStartEquity: num(data.day_start_equity),
      haltReason: data.halt_reason,
      haltDetail: data.halt_detail,
      haltedAt: data.halted_at,
    }
  }

  async saveState(s: BotState): Promise<void> {
    const { error } = await this.db.from('bot_state').upsert({
      mode: s.mode,
      peak_equity: s.peakEquity,
      peak_at: s.peakAt,
      day_key: s.dayKey,
      day_start_equity: s.dayStartEquity,
      halt_reason: s.haltReason,
      halt_detail: s.haltDetail,
      halted_at: s.haltedAt,
      updated_at: new Date().toISOString(),
    })
    fail('save state', error)
  }

  async recordEquity(mode: TradingMode, equity: number, source: string): Promise<void> {
    const { error } = await this.db.from('equity_snapshots').insert({ mode, equity, source })
    fail('record equity', error)
  }

  async openTrade(t: NewTrade): Promise<void> {
    const { error } = await this.db.from('trades').insert({
      mode: t.mode,
      market_id: t.marketId,
      symbol: t.symbol,
      side: t.side,
      qty: t.qty,
      entry_order_id: t.entryOrderId,
      entry_price: t.entryPrice,
      stop_price: t.stopPrice,
      stop_distance: t.stopDistance,
      risk_amount: t.riskAmount,
      equity_at_entry: t.equityAtEntry,
      entry_reason: t.entryReason,
    })
    fail('open trade', error)
  }

  async closeTrade(mode: TradingMode, marketId: MarketId, exit: TradeExit): Promise<void> {
    const { error } = await this.db
      .from('trades')
      .update({ closed_at: new Date().toISOString(), exit_price: exit.exitPrice, exit_reason: exit.exitReason, pnl: exit.pnl })
      .eq('mode', mode)
      .eq('market_id', marketId)
      .is('closed_at', null)
    fail('close trade', error)
  }

  async openTrades(mode: TradingMode): Promise<TradeRecord[]> {
    const { data, error } = await this.db.from('trades').select('*').eq('mode', mode).is('closed_at', null).returns<TradeRow[]>()
    fail('list open trades', error)
    return (data ?? []).map(toTrade)
  }
}

let cached: SupabaseStore | null = null

/** The configured store, or null when Supabase env vars are missing. */
export function getStateStore(): StateStore | null {
  if (!isStateStoreConfigured()) return null
  cached ??= new SupabaseStore(
    createClient(process.env.SUPABASE_URL as string, process.env.SUPABASE_SERVICE_ROLE_KEY as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  )
  return cached
}
