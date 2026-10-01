'use client'

import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { fmtTimeLocal } from '@/lib/format'
import { cn } from '@/lib/utils'

type ReportType = 'morning' | 'evening'

interface ReportResult {
  type: ReportType
  text: string
  generatedAt: string
}

export function ReportsPanel({ smsConfigured, configured }: { smsConfigured: boolean; configured: boolean }) {
  const [pending, setPending] = useState<ReportType | null>(null)
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function preview(type: ReportType) {
    setPending(type)
    setError(null)
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      })
      const json = (await res.json()) as ReportResult & { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`)
      setResult(json)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(null)
    }
  }

  // Cron fires at 05:00 and 19:00 UTC, i.e. 07:00 and 21:00 SA time (GMT+2).
  const morningUtc = new Date()
  morningUtc.setUTCHours(5, 0, 0, 0)
  const eveningUtc = new Date()
  eveningUtc.setUTCHours(19, 0, 0, 0)

  return (
    <section aria-labelledby="reports-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <MessageSquareText className="size-4 text-primary" aria-hidden="true" />
        <h2 id="reports-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Daily texts from Claude
        </h2>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-xs">
        <div className="flex flex-col gap-0.5">
          <dt className="tracking-wider text-muted-foreground uppercase">Morning</dt>
          <dd className="font-mono tabular">{fmtTimeLocal(morningUtc.toISOString())}</dd>
          <dd className="text-muted-foreground">What&apos;s happening today</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="tracking-wider text-muted-foreground uppercase">Evening</dt>
          <dd className="font-mono tabular">{fmtTimeLocal(eveningUtc.toISOString())}</dd>
          <dd className="text-muted-foreground">Exactly how the day went</dd>
        </div>
      </dl>

      <p className={cn('rounded-md px-3 py-2 text-xs', smsConfigured ? 'bg-positive/10 text-positive' : 'bg-muted text-muted-foreground')}>
        {smsConfigured ? 'SMS delivery connected via BulkSMS.' : 'SMS not connected yet. Add the BulkSMS variables to receive the texts. Previews still work.'}
      </p>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" disabled={!configured || pending !== null} onClick={() => preview('morning')}>
          {pending === 'morning' ? 'Writing…' : 'Preview morning'}
        </Button>
        <Button variant="outline" size="sm" className="flex-1" disabled={!configured || pending !== null} onClick={() => preview('evening')}>
          {pending === 'evening' ? 'Writing…' : 'Preview evening'}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-negative">
          {error}
        </p>
      ) : null}

      {result ? (
        <figure className="flex flex-col gap-2">
          <blockquote className="rounded-lg rounded-tl-sm bg-secondary px-3 py-2 text-sm leading-relaxed text-pretty whitespace-pre-wrap">
            {result.text}
          </blockquote>
          <figcaption className="flex justify-between font-mono text-[11px] tabular text-muted-foreground">
            <span>{result.type === 'morning' ? 'Morning brief' : 'Evening report'}</span>
            <span>{result.text.length} chars</span>
          </figcaption>
        </figure>
      ) : (
        <p className="text-xs text-muted-foreground text-pretty">
          {configured
            ? 'Generate a preview to see exactly what the next text will say, built from live broker data.'
            : 'Previews unlock once the broker is connected.'}
        </p>
      )}
    </section>
  )
}
