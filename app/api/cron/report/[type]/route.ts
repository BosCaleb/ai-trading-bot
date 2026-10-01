import { isAuthorizedCron, unauthorized } from '@/lib/cron-auth'
import { isSmsConfigured, sendSms } from '@/lib/notify/sms'
import { generateReport, type ReportType } from '@/lib/reports/analyst'
import { buildSnapshot } from '@/lib/trading/snapshot'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Scheduled twice daily: /api/cron/report/morning and /api/cron/report/evening. Generates the text and sends it by SMS. */
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  if (!isAuthorizedCron(request)) return unauthorized()

  const { type } = await params
  if (type !== 'morning' && type !== 'evening') {
    return Response.json({ error: 'Report type must be "morning" or "evening"' }, { status: 400 })
  }

  try {
    const snapshot = await buildSnapshot()
    const text = await generateReport(type as ReportType, snapshot)

    let sms: Awaited<ReturnType<typeof sendSms>> | null = null
    let smsError: string | null = null
    if (isSmsConfigured()) {
      try {
        sms = await sendSms(text)
      } catch (err) {
        smsError = (err as Error).message
      }
    } else {
      smsError = 'SMS not configured; report generated but not sent.'
    }

    console.log(`[cron:report:${type}] sent=${Boolean(sms)} chars=${text.length}`)
    return Response.json({ type, text, sms, smsError, generatedAt: snapshot.generatedAt })
  } catch (err) {
    console.error(`[cron:report:${type}] failed`, err)
    return Response.json({ error: (err as Error).message }, { status: 500 })
  }
}
