import { type NextRequest, NextResponse } from 'next/server'
import { DASHBOARD_REALM, checkDashboardAuth, dashboardAuthEnv } from '@/lib/dashboard-auth'

/**
 * Gates the dashboard page and every API route behind DASHBOARD_PASSWORD.
 * Cron routes are excluded by the matcher: Vercel cannot send Basic auth, and they already
 * require the CRON_SECRET bearer token (see lib/cron-auth.ts).
 */
export async function proxy(request: NextRequest) {
  const result = await checkDashboardAuth(request.headers.get('authorization'), dashboardAuthEnv())
  if (result.ok) return NextResponse.next()

  if (result.reason === 'not_configured') {
    return new NextResponse('Dashboard locked: set DASHBOARD_PASSWORD in the environment to enable access.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    })
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${DASHBOARD_REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}

export const config = {
  matcher: ['/((?!api/cron/|_next/static|_next/image|favicon\\.ico|icon|apple-icon|placeholder).*)'],
}
