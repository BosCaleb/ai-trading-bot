import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/bot/control/route'
import { MemoryStore } from '@/lib/state/store'

const store = new MemoryStore()
// Hoisted above the imports; `store` is only read when the route calls getStateStore().
vi.mock('@/lib/state/supabase-store', () => ({
  getStateStore: () => store,
  isStateStoreConfigured: () => true,
}))

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://desk.example.com/api/bot/control', {
    method: 'POST',
    headers: { host: 'desk.example.com', origin: 'https://desk.example.com', 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('POST /api/bot/control', () => {
  beforeEach(() => {
    vi.stubEnv('ALPACA_API_KEY', 'test')
    vi.stubEnv('ALPACA_API_SECRET', 'test')
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ equity: '880', cash: '880', last_equity: '900', buying_power: '880', status: 'ACTIVE' })))
    store.states.clear()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects cross-site requests even with valid dashboard credentials (CSRF)', async () => {
    expect((await POST(req({ action: 'resume' }, { origin: 'https://evil.example' }))).status).toBe(403)
    const noOrigin = req({ action: 'resume' })
    noOrigin.headers.delete('origin')
    expect((await POST(noOrigin)).status).toBe(403)
  })

  it('rejects form posts (only JSON is accepted)', async () => {
    const res = await POST(req('action=resume', { 'content-type': 'application/x-www-form-urlencoded' }))
    expect(res.status).toBe(415)
  })

  it('validates the action', async () => {
    expect((await POST(req({ action: 'liquidate' }))).status).toBe(400)
  })

  it('pauses, then resumes with peak and day re-based to current equity', async () => {
    const paused = await POST(req({ action: 'pause' }))
    expect(await paused.json()).toMatchObject({ action: 'pause', halted: true, reason: expect.stringMatching(/Paused manually/) })
    expect((await store.getState('paper')).haltReason).toBe('manual')

    const resumed = await POST(req({ action: 'resume' }))
    expect(await resumed.json()).toMatchObject({ action: 'resume', halted: false, reason: null })
    expect(await store.getState('paper')).toMatchObject({ haltReason: null, peakEquity: 880, dayStartEquity: 880 })
  })
})
