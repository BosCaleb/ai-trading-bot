import { generateReport } from '@/lib/reports/analyst'
import { buildSnapshot } from '@/lib/trading/snapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * On-demand preview from the dashboard. Generates the text only; the scheduled cron
 * route is the one that actually sends SMS, so this endpoint cannot be abused to text the owner.
 */
export async function POST(request: Request) {
  let body: { type?: string } = {}
  try {
    body = await request.json()
  } catch {
    // empty body falls through to validation below
  }

  const type = body.type
  if (type !== 'morning' && type !== 'evening') {
    return Response.json({ error: 'type must be "morning" or "evening"' }, { status: 400 })
  }

  try {
    const snapshot = await buildSnapshot()
    const text = await generateReport(type, snapshot)
    return Response.json({ type, text, generatedAt: snapshot.generatedAt })
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
