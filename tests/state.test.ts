import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import { MemoryStore } from '@/lib/state/store'
import { SupabaseStore } from '@/lib/state/supabase-store'

const MIGRATIONS = path.join(process.cwd(), 'supabase', 'migrations')

describe('supabase migration (run on an in-memory Postgres)', () => {
  let db: PGlite

  beforeAll(async () => {
    db = new PGlite()
    for (const file of readdirSync(MIGRATIONS).sort()) {
      await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    }
  })

  const trade = (overrides: Record<string, unknown> = {}) => {
    const row = {
      mode: 'paper', market_id: 'gold', symbol: 'GLD', side: 'long', qty: 10, entry_order_id: `o-${Math.random()}`,
      stop_price: 195, stop_distance: 5, risk_amount: 50, equity_at_entry: 5000, ...overrides,
    }
    const cols = Object.keys(row)
    return db.query(`insert into public.trades (${cols.join(',')}) values (${cols.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(row))
  }

  it('is idempotent and seeds one state row per mode', async () => {
    for (const file of readdirSync(MIGRATIONS).sort()) {
      await db.exec(readFileSync(path.join(MIGRATIONS, file), 'utf8'))
    }
    const { rows } = await db.query<{ mode: string }>('select mode from public.bot_state order by mode')
    expect(rows.map((r) => r.mode)).toEqual(['live', 'paper'])
  })

  it('enables row level security on every table', async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class where relname in ('bot_state', 'trades', 'equity_snapshots') order by relname`,
    )
    expect(rows).toEqual([
      { relname: 'bot_state', relrowsecurity: true },
      { relname: 'equity_snapshots', relrowsecurity: true },
      { relname: 'trades', relrowsecurity: true },
    ])
  })

  it('allows only one open trade per market and mode', async () => {
    await trade({ market_id: 'oil', symbol: 'USO' })
    await expect(trade({ market_id: 'oil', symbol: 'USO' })).rejects.toThrow(/trades_one_open_per_market/)
    await trade({ market_id: 'oil', symbol: 'USO', mode: 'live' }) // other mode is independent
    await db.query(`update public.trades set closed_at = now(), exit_reason = 'test' where market_id = 'oil' and mode = 'paper'`)
    await trade({ market_id: 'oil', symbol: 'USO' }) // re-entry after close is fine
  })

  it('rejects inconsistent rows', async () => {
    await expect(trade({ side: 'sideways' })).rejects.toThrow()
    await expect(trade({ qty: 0, market_id: 'spx' })).rejects.toThrow()
    await expect(db.query(`update public.bot_state set halt_reason = 'drawdown' where mode = 'paper'`)).rejects.toThrow() // needs halted_at
    await expect(db.query(`update public.bot_state set halt_reason = 'bored', halted_at = now() where mode = 'paper'`)).rejects.toThrow()
  })
})

describe('SupabaseStore (PostgREST calls against a stubbed fetch)', () => {
  function stubbed(handler: (url: URL, init: RequestInit) => unknown) {
    const calls: { url: URL; method: string; body: unknown }[] = []
    const fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(String(input))
      calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : null })
      const data = handler(url, init)
      return new Response(data === undefined ? null : JSON.stringify(data), { status: data === undefined ? 204 : 200, headers: { 'content-type': 'application/json' } })
    }
    const store = new SupabaseStore(createClient('https://project.supabase.co', 'service-key', { global: { fetch }, auth: { persistSession: false } }))
    return { store, calls }
  }

  it('maps numeric strings from Postgres to numbers', async () => {
    const { store } = stubbed(() => ({
      mode: 'live', peak_equity: '1050.25', peak_at: null, day_key: '2026-10-01', day_start_equity: '1000.00',
      halt_reason: null, halt_detail: null, halted_at: null,
    }))
    expect(await store.getState('live')).toEqual({
      mode: 'live', peakEquity: 1050.25, peakAt: null, dayKey: '2026-10-01', dayStartEquity: 1000,
      haltReason: null, haltDetail: null, haltedAt: null,
    })
  })

  it('closes only the open trade for the market', async () => {
    const { store, calls } = stubbed(() => undefined)
    await store.closeTrade('paper', 'gold', { exitPrice: 210, exitReason: 'signal', pnl: 100 })
    const c = calls[0]
    expect(c.method).toBe('PATCH')
    expect(c.url.pathname).toBe('/rest/v1/trades')
    expect(c.url.searchParams.get('mode')).toBe('eq.paper')
    expect(c.url.searchParams.get('market_id')).toBe('eq.gold')
    expect(c.url.searchParams.get('closed_at')).toBe('is.null')
    expect(c.body).toMatchObject({ exit_price: 210, exit_reason: 'signal', pnl: 100 })
  })

  it('surfaces database errors instead of swallowing them', async () => {
    const fetch = async () => new Response(JSON.stringify({ message: 'permission denied', code: '42501' }), { status: 401 })
    const store = new SupabaseStore(createClient('https://project.supabase.co', 'bad', { global: { fetch }, auth: { persistSession: false } }))
    await expect(store.recordEquity('paper', 1000, 'test')).rejects.toThrow(/record equity failed: permission denied/)
  })
})

describe('MemoryStore', () => {
  it('mirrors the one-open-trade-per-market rule', async () => {
    const s = new MemoryStore()
    const t = {
      mode: 'paper' as const, marketId: 'gold' as const, symbol: 'GLD', side: 'long' as const, qty: 1, entryOrderId: 'o1',
      entryPrice: 100, stopPrice: 97, stopDistance: 3, riskAmount: 3, equityAtEntry: 300, entryReason: 'x',
    }
    await s.openTrade(t)
    await expect(s.openTrade({ ...t, entryOrderId: 'o2' })).rejects.toThrow()
    await s.closeTrade('paper', 'gold', { exitPrice: 101, exitReason: 'signal', pnl: 1 })
    expect(await s.openTrades('paper')).toHaveLength(0)
  })
})
