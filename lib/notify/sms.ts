/** Comma- or semicolon-separated list of recipients in international format, e.g. "+27821234567, +27831234567". */
export function alertRecipients(): string[] {
  const raw = process.env.ALERT_TO_NUMBERS ?? process.env.ALERT_TO_NUMBER ?? ''
  return Array.from(
    new Set(
      raw
        .split(/[,;\s]+/)
        .map((n) => n.replace(/[^\d+]/g, ''))
        .filter((n) => n.length >= 8),
    ),
  )
}

export function isSmsConfigured(): boolean {
  return Boolean(process.env.BULKSMS_TOKEN_ID && process.env.BULKSMS_TOKEN_SECRET && alertRecipients().length > 0)
}

export interface SmsResult {
  recipients: string[]
  messageIds: string[]
  segments: number
}

interface BulkSmsMessage {
  id: string
  to?: string
  numberOfParts?: number
  status?: { type?: string }
}

/** Sends a text to every configured recipient through the BulkSMS JSON API. Long bodies are split into parts automatically. */
export async function sendSms(body: string): Promise<SmsResult> {
  if (!isSmsConfigured()) {
    throw new Error('SMS is not configured. Set BULKSMS_TOKEN_ID, BULKSMS_TOKEN_SECRET and ALERT_TO_NUMBERS.')
  }
  const tokenId = process.env.BULKSMS_TOKEN_ID as string
  const tokenSecret = process.env.BULKSMS_TOKEN_SECRET as string
  const recipients = alertRecipients()

  const payload: Record<string, unknown> = {
    to: recipients,
    body: body.slice(0, 1600),
    encoding: 'UNICODE',
    longMessageMaxParts: 10,
  }
  if (process.env.BULKSMS_FROM) payload.from = process.env.BULKSMS_FROM

  const res = await fetch('https://api.bulksms.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${tokenId}:${tokenSecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`BulkSMS send failed (${res.status}): ${text.slice(0, 300)}`)
  }

  const json = (await res.json()) as BulkSmsMessage | BulkSmsMessage[]
  const messages = Array.isArray(json) ? json : [json]
  return {
    recipients,
    messageIds: messages.map((m) => m?.id).filter(Boolean),
    segments: Number(messages[0]?.numberOfParts ?? 1),
  }
}
