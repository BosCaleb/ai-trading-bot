import { BrokerNotConfiguredError } from '@/lib/broker/alpaca'
import { isAuthorizedCron, unauthorized } from '@/lib/cron-auth'
import { runCycle } from '@/lib/trading/engine'
import { TIMEFRAME_BY_SLUG } from '@/lib/trading/markets'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request, { params }: { params: Promise<{ timeframe: string }> }) {
  if (!isAuthorizedCron(request)) return unauthorized()

  const { timeframe: slug } = await params
  const timeframe = TIMEFRAME_BY_SLUG[slug]
  if (!timeframe) {
    return Response.json({ error: `Unknown timeframe "${slug}". Use 15m, 1h or 4h.` }, { status: 400 })
  }

  try {
    const result = await runCycle(timeframe)
    console.log(`[cron:${slug}]`, JSON.stringify(result.results.map((r) => ({ m: r.marketId, a: r.action, d: r.detail }))))
    return Response.json(result)
  } catch (err) {
    if (err instanceof BrokerNotConfiguredError) {
      return Response.json({ error: err.message }, { status: 503 })
    }
    console.error(`[cron:${slug}] failed`, err)
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
