import { getAccount, tradingMode } from '@/lib/broker/alpaca'
import { getStateStore } from '@/lib/state/supabase-store'
import { haltMessage, pauseTrading, resumeTrading } from '@/lib/trading/loss-limits'

export const dynamic = 'force-dynamic'

/**
 * Pause or resume new entries from the dashboard (behind the dashboard password, see proxy.ts).
 * Resuming re-bases the peak and the day's start to current equity so the limits measure fresh.
 */
export async function POST(request: Request) {
  // Browsers resend cached Basic-auth credentials on cross-site requests, so additionally require a
  // same-origin JSON request: a forged form post from another site can satisfy neither check.
  const origin = request.headers.get('origin')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  let sameOrigin = false
  try {
    sameOrigin = Boolean(origin && host && new URL(origin).host === host)
  } catch {
    sameOrigin = false
  }
  if (!sameOrigin) return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ error: 'Expected application/json' }, { status: 415 })
  }

  let action: unknown
  try {
    action = ((await request.json()) as { action?: unknown }).action
  } catch {
    action = undefined
  }
  if (action !== 'pause' && action !== 'resume') {
    return Response.json({ error: 'action must be "pause" or "resume"' }, { status: 400 })
  }

  const store = getStateStore()
  if (!store) return Response.json({ error: 'Storage is not configured (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)' }, { status: 503 })

  try {
    const mode = tradingMode()
    const now = new Date()
    const current = await store.getState(mode)
    const next = action === 'resume' ? resumeTrading(current, (await getAccount()).equity, now) : pauseTrading(current, now)
    await store.saveState(next)
    console.warn(`[bot:${action}] mode=${mode} previous=${haltMessage(current) ?? 'running'}`)
    return Response.json({ mode, action, halted: next.haltReason !== null, reason: haltMessage(next) })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
