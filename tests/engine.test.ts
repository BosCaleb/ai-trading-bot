import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCycle } from '@/lib/trading/engine'
import { type NewTrade, MemoryStore } from '@/lib/state/store'
import { openRiskFor } from '@/lib/trading/protection'
import type { OrderInfo } from '@/lib/trading/types'
import { position } from './helpers'

const H4 = 4 * 60 * 60_000

/** Uptrend with a pullback that reclaims the 20 EMA on the last closed bar: a trend-following long. */
function pullbackBars(endMs: number) {
  const closes = [...Array.from({ length: 100 }, (_, i) => 100 + 0.5 * i), 143, 150]
  const start = endMs - closes.length * H4
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    return { t: new Date(start + i * H4).toISOString(), o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v: 1000 }
  })
}

interface Call {
  method: string
  url: string
  body: Record<string, unknown> | null
}

function mockAlpaca(opts: { positions?: unknown[]; openOrders?: unknown[] } = {}) {
  const calls: Call[] = []
  const bars = pullbackBars(Date.now() - H4) // every bar already closed
  let orderSeq = 0
  const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200 })

  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null })

    if (url.endsWith('/v2/account')) return json({ equity: '100000', cash: '100000', last_equity: '100000', buying_power: '400000', status: 'ACTIVE' })
    if (url.endsWith('/v2/positions')) return json(opts.positions ?? [])
    if (url.endsWith('/v2/clock')) return json({ is_open: true, next_open: '', next_close: '', timestamp: '' })
    if (url.includes('/v2/orders?status=open')) return json(opts.openOrders ?? [])
    if (url.includes('/v2/stocks/bars')) {
      const symbols = new URL(url).searchParams.get('symbols') ?? ''
      return json({ bars: { [symbols]: bars }, next_page_token: null })
    }
    if (url.endsWith('/v2/orders') && method === 'POST') return json({ id: `o${++orderSeq}`, legs: [{ id: `leg${orderSeq}` }] })
    if (url.includes('/v2/orders/')) {
      return json({ id: 'x', symbol: 'X', side: 'buy', type: 'market', qty: '1', filled_qty: '1', filled_avg_price: '150', status: 'filled', order_class: 'oto', submitted_at: '' })
    }
    throw new Error(`Unmocked ${method} ${url}`)
  })
  return calls
}

describe('runCycle with risk-based sizing', () => {
  beforeEach(() => {
    vi.stubEnv('ALPACA_API_KEY', 'test')
    vi.stubEnv('ALPACA_API_SECRET', 'test')
    vi.stubEnv('BOT_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sizes each entry to risk 1% of equity and sends a GTC OTO with the ATR stop', async () => {
    const calls = mockAlpaca()
    const result = await runCycle('4Hour')

    const opened = result.results.filter((r) => r.action === 'opened_long')
    expect(opened.map((r) => r.marketId).sort()).toEqual(['gold', 'oil'])

    const entries = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/v2/orders')).map((c) => c.body!)
    expect(entries).toHaveLength(2)
    for (const e of entries) {
      expect(e).toMatchObject({ side: 'buy', type: 'market', order_class: 'oto', time_in_force: 'gtc' })
      const qty = Number(e.qty)
      const stop = Number((e.stop_loss as { stop_price: string }).stop_price)
      const risk = qty * (150 - stop)
      expect(risk).toBeLessThanOrEqual(1000 + qty * 0.01) // 1% of 100k, allowing for 2dp stop rounding
      expect(risk).toBeGreaterThan(950)
      expect(150 - stop).toBeGreaterThan(150 * 0.002) // never inside the 0.2% floor
    }
  })

  it('blocks a second entry once combined open risk would pass 3%', async () => {
    // An existing SPY long risking 1,500 (100 shares, 500 entry, stop 485) at the broker.
    const calls = mockAlpaca({
      positions: [{ symbol: 'SPY', qty: '100', side: 'long', avg_entry_price: '500', current_price: '505', market_value: '50500', unrealized_pl: '500', unrealized_plpc: '0.01' }],
      openOrders: [{ id: 's1', symbol: 'SPY', side: 'sell', type: 'stop', qty: '100', filled_qty: '0', stop_price: '485', status: 'new', order_class: 'oto', submitted_at: '' }],
    })
    const result = await runCycle('4Hour')

    expect(result.protection).toEqual([expect.objectContaining({ symbol: 'SPY', action: 'covered' })])
    const actions = result.results.map((r) => r.action).sort()
    expect(actions).toEqual(['blocked', 'opened_long'])
    expect(result.results.find((r) => r.action === 'blocked')?.detail).toMatch(/Open risk cap/)
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1)
  })
})

describe('openRiskFor', () => {
  const stop = (o: Partial<OrderInfo>): OrderInfo => ({
    id: 's', symbol: 'GLD', side: 'sell', type: 'stop', qty: 10, notional: null, filledQty: 0, filledAvgPrice: null,
    stopPrice: 195, status: 'new', orderClass: 'oto', submittedAt: '', filledAt: null, ...o,
  })

  it('uses the working broker stop, falls back to the typical-ATR stop, ignores non-bot symbols', () => {
    const gld = position({ symbol: 'GLD', qty: 10, avgEntry: 200 })
    expect(openRiskFor([gld], [stop({})])).toBeCloseTo(50)
    // No stop: GLD baseline ATR 0.4% x 3 = 1.2% of 200 = 2.40 per share.
    expect(openRiskFor([gld], [])).toBeCloseTo(24)
    expect(openRiskFor([position({ symbol: 'TSLA' })], [])).toBe(0)
  })
})

describe('runCycle trade journal', () => {
  beforeEach(() => {
    vi.stubEnv('ALPACA_API_KEY', 'test')
    vi.stubEnv('ALPACA_API_SECRET', 'test')
    vi.stubEnv('BOT_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const journaled = (o: Partial<NewTrade>): NewTrade => ({
    mode: 'paper', marketId: 'spx', symbol: 'SPY', side: 'long', qty: 100, entryOrderId: 'old', entryPrice: 500,
    stopPrice: 490, stopDistance: 10, riskAmount: 1000, equityAtEntry: 100_000, entryReason: 'earlier', ...o,
  })

  it('records each entry with its stop, risk and the equity it was sized on, plus an equity snapshot', async () => {
    mockAlpaca()
    const store = new MemoryStore()
    const result = await runCycle('4Hour', { store })

    expect(result.journal).toEqual({ enabled: true, errors: [] })
    const trades = await store.openTrades('paper')
    expect(trades.map((t) => t.marketId).sort()).toEqual(['gold', 'oil'])
    for (const t of trades) {
      expect(t.equityAtEntry).toBe(100_000)
      expect(t.riskAmount).toBeGreaterThan(900)
      expect(t.riskAmount).toBeLessThanOrEqual(1000)
      expect(t.stopPrice).toBeCloseTo(150 - t.stopDistance, 2)
      expect(t.entryOrderId).toMatch(/^o\d$/)
    }
    expect(store.equity).toEqual([expect.objectContaining({ mode: 'paper', equity: 100_000, source: 'cycle:4Hour' })])
  })

  it('restores a missing stop at the journaled original stop, not the generic fallback', async () => {
    const calls = mockAlpaca({
      positions: [{ symbol: 'SPY', qty: '100', side: 'long', avg_entry_price: '500', current_price: '505', market_value: '50500', unrealized_pl: '500', unrealized_plpc: '0.01' }],
    })
    const store = new MemoryStore()
    await store.openTrade(journaled({}))
    const result = await runCycle('4Hour', { store })

    expect(result.protection[0]).toMatchObject({ symbol: 'SPY', action: 'stop_placed' })
    const stop = calls.find((c) => c.method === 'POST' && c.body?.symbol === 'SPY')?.body
    expect(stop).toMatchObject({ type: 'stop', side: 'sell', qty: '100', stop_price: '490.00', time_in_force: 'gtc' })
  })

  it('closes journal entries whose position disappeared (stopped out at the broker)', async () => {
    mockAlpaca() // broker shows no positions
    const store = new MemoryStore()
    await store.openTrade(journaled({ marketId: 'spx', symbol: 'SPY' }))
    await runCycle('4Hour', { store })

    const spx = store.trades.find((t) => t.marketId === 'spx')
    expect(spx).toMatchObject({ exitReason: 'closed_at_broker', exitPrice: null })
    expect(spx?.closedAt).not.toBeNull()
  })

  it('keeps trading when the journal is down, and reports the failure', async () => {
    mockAlpaca()
    const store = new MemoryStore()
    store.openTrade = async () => {
      throw new Error('database unavailable')
    }
    const result = await runCycle('4Hour', { store })

    expect(result.results.filter((r) => r.action === 'opened_long')).toHaveLength(2)
    expect(result.journal.errors).toEqual([expect.stringMatching(/open (gold|oil): database unavailable/), expect.stringMatching(/database unavailable/)])
  })
})

describe('runCycle loss limits', () => {
  beforeEach(() => {
    vi.stubEnv('ALPACA_API_KEY', 'test')
    vi.stubEnv('ALPACA_API_SECRET', 'test')
    vi.stubEnv('BOT_ENABLED', 'true')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const NOW = new Date()
  const today = NOW.toISOString().slice(0, 10)

  it('blocks new entries after a 3% daily loss, alerts once, and keeps guarding open positions', async () => {
    const calls = mockAlpaca({
      positions: [{ symbol: 'SPY', qty: '10', side: 'long', avg_entry_price: '500', current_price: '505', market_value: '5050', unrealized_pl: '50', unrealized_plpc: '0.01' }],
    })
    const store = new MemoryStore()
    // Day started at 104,000; the mocked account is at 100,000 (-3.85%).
    await store.saveState({ ...(await store.getState('paper')), dayKey: today, dayStartEquity: 104_000, peakEquity: 104_000 })
    const sent: string[] = []
    const notify = async (text: string) => sent.push(text)

    const first = await runCycle('4Hour', { store, now: NOW, notify })
    expect(first.limits).toMatchObject({ enabled: true, entriesAllowed: false, newlyHalted: 'daily_loss' })
    expect(first.results.every((r) => r.action === 'blocked')).toBe(true)
    expect(first.results[0].detail).toMatch(/Daily loss limit/)
    expect(first.protection[0]).toMatchObject({ symbol: 'SPY', action: 'stop_placed' }) // still protected
    expect(calls.some((c) => c.method === 'POST' && c.body?.order_class === 'oto')).toBe(false) // no entries
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatch(/PAPER: Daily loss limit.*New entries are paused.*00:00 UTC/)

    const second = await runCycle('4Hour', { store, now: NOW, notify })
    expect(second.limits.entriesAllowed).toBe(false)
    expect(sent).toHaveLength(1) // no repeat alert
    expect((await store.getState('paper')).haltReason).toBe('daily_loss')
  })

  it('fails closed: live trading without storage takes no new entries', async () => {
    vi.stubEnv('ALPACA_PAPER', 'false')
    mockAlpaca()
    const result = await runCycle('4Hour', { store: null })
    expect(result.mode).toBe('live')
    expect(result.limits).toMatchObject({ enabled: false, entriesAllowed: false })
    expect(result.results.every((r) => r.action === 'blocked' && /connect Supabase/.test(r.detail))).toBe(true)
  })

  it('paper trading without storage still trades (limits off)', async () => {
    mockAlpaca()
    const result = await runCycle('4Hour', { store: null })
    expect(result.limits).toMatchObject({ enabled: false, entriesAllowed: true })
    expect(result.results.filter((r) => r.action === 'opened_long')).toHaveLength(2)
  })

  it('fails closed when the limit state cannot be read', async () => {
    mockAlpaca()
    const store = new MemoryStore()
    store.getState = async () => {
      throw new Error('timeout')
    }
    const result = await runCycle('4Hour', { store })
    expect(result.limits.entriesAllowed).toBe(false)
    expect(result.results.every((r) => r.action === 'blocked' && /could not be checked \(timeout\)/.test(r.detail))).toBe(true)
  })
})
