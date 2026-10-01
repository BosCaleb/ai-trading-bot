/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when the env var is set.
 * In production the secret is mandatory so nobody can trigger trades by hitting the URL.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return process.env.NODE_ENV !== 'production'
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export function unauthorized(): Response {
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}
