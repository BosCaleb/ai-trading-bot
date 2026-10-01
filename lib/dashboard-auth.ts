/**
 * HTTP Basic auth for the dashboard and its APIs. The desk has a single owner, so a long random
 * DASHBOARD_PASSWORD over HTTPS is enough and needs no database or session store.
 * Fails closed: in production, a missing password locks everyone out rather than exposing the account.
 */

export const DASHBOARD_REALM = 'Trading desk'

export type DashboardAuthResult = { ok: true } | { ok: false; reason: 'not_configured' | 'missing' | 'invalid' }

export interface DashboardAuthEnv {
  password?: string
  user?: string
  production: boolean
}

export function dashboardAuthEnv(): DashboardAuthEnv {
  return {
    password: process.env.DASHBOARD_PASSWORD || undefined,
    user: process.env.DASHBOARD_USER || undefined,
    production: process.env.NODE_ENV === 'production',
  }
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** Compares SHA-256 digests in constant time so response timing leaks neither content nor length. */
async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([digest(a), digest(b)])
  let diff = 0
  for (let i = 0; i < da.length; i++) diff |= da[i] ^ db[i]
  return diff === 0
}

function decodeBasic(header: string | null): { user: string; password: string } | null {
  if (!header?.startsWith('Basic ')) return null
  let decoded: string
  try {
    decoded = atob(header.slice(6).trim())
  } catch {
    return null
  }
  const sep = decoded.indexOf(':')
  if (sep < 0) return null
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) }
}

export async function checkDashboardAuth(authorization: string | null, env: DashboardAuthEnv): Promise<DashboardAuthResult> {
  if (!env.password) return env.production ? { ok: false, reason: 'not_configured' } : { ok: true }

  const creds = decodeBasic(authorization)
  if (!creds) return { ok: false, reason: 'missing' }

  // Check both fields every time so a wrong username takes as long as a wrong password.
  const [userOk, passwordOk] = await Promise.all([
    env.user ? safeEqual(creds.user, env.user) : Promise.resolve(true),
    safeEqual(creds.password, env.password),
  ])
  return userOk && passwordOk ? { ok: true } : { ok: false, reason: 'invalid' }
}
