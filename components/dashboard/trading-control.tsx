'use client'

import { Pause, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'

/** Halt status with a pause / resume switch for new entries. Stops and exits always keep running. */
export function TradingControl({ snapshot, onChanged }: { snapshot: DashboardSnapshot; onChanged?: () => void }) {
  const { limits } = snapshot
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!snapshot.stateConfigured) {
    return (
      <p className="rounded-md bg-background/60 px-3 py-2 text-xs text-muted-foreground">
        Loss limits are off until storage is connected.{snapshot.mode === 'live' ? ' Live entries are blocked until then.' : ''}
      </p>
    )
  }

  async function send(action: 'pause' | 'resume') {
    if (action === 'resume' && !window.confirm('Resume new entries? The drawdown and daily limits restart from current equity.')) return
    setPending(true)
    setError(null)
    try {
      const res = await fetch('/api/bot/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = (await res.json()) as { error?: string }
      if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`)
      onChanged?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-2 rounded-md px-3 py-2 text-xs',
        limits.halted ? 'border border-negative/40 bg-negative/10' : 'bg-background/60',
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={cn('font-medium', limits.halted ? 'text-negative' : 'text-foreground')}>
          {limits.halted ? 'New entries halted' : 'Entries allowed'}
        </span>
        {limits.halted ? (
          limits.haltReason === 'daily_loss' ? (
            <span className="text-muted-foreground">Resets 00:00 UTC</span>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => send('resume')}>
              <Play className="size-3.5" aria-hidden="true" /> Resume
            </Button>
          )
        ) : (
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => send('pause')}>
            <Pause className="size-3.5" aria-hidden="true" /> Pause
          </Button>
        )}
      </div>
      {limits.reason || limits.error ? <p className="text-pretty text-muted-foreground">{limits.error ?? limits.reason}</p> : null}
      {error ? <p className="text-negative">{error}</p> : null}
    </div>
  )
}
