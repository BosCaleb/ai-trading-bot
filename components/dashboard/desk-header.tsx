'use client'

import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { fmtRelative, fmtTimeET } from '@/lib/format'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'

export function DeskHeader({
  snapshot,
  refreshing,
  onRefresh,
}: {
  snapshot: DashboardSnapshot
  refreshing: boolean
  onRefresh: () => void
}) {
  const live = snapshot.mode === 'live'
  const running = snapshot.configured && snapshot.botEnabled && !snapshot.error

  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Five Desk</h1>
          <span
            className={cn(
              'rounded-sm px-2 py-0.5 font-mono text-[11px] font-medium tracking-wider uppercase',
              live ? 'bg-negative/15 text-negative' : 'bg-primary/15 text-primary',
            )}
          >
            {live ? 'Live' : 'Paper'}
          </span>
        </div>
        <p className="text-sm text-muted-foreground text-pretty">
          Autonomous desk across S&amp;P 500, NASDAQ, Bitcoin, gold and oil. Claude writes the briefs, the broker holds the stops.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
        <Status
          dot={running ? 'bg-positive' : snapshot.configured ? 'bg-primary' : 'bg-muted-foreground'}
          pulse={running}
          label={running ? 'Bot running' : snapshot.configured ? (snapshot.botEnabled ? 'Broker error' : 'Bot paused') : 'Broker offline'}
        />
        <Status
          dot={snapshot.clock?.isOpen ? 'bg-positive' : 'bg-muted-foreground'}
          label={
            snapshot.clock
              ? snapshot.clock.isOpen
                ? `US session open until ${fmtTimeET(snapshot.clock.nextClose)}`
                : `US session closed, opens ${fmtTimeET(snapshot.clock.nextOpen)}`
              : 'US session —'
          }
        />
        <Status dot="bg-positive" label="Bitcoin 24/7" />
        <div className="flex items-center gap-2">
          <span className="font-mono tabular">Synced {fmtRelative(snapshot.generatedAt)}</span>
          <Button variant="ghost" size="icon-sm" onClick={onRefresh} aria-label="Refresh data" disabled={refreshing}>
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </div>
    </header>
  )
}

function Status({ dot, label, pulse }: { dot: string; label: string; pulse?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span className="relative flex size-2">
        {pulse ? <span className={cn('absolute inline-flex size-full animate-ping rounded-full opacity-60', dot)} /> : null}
        <span className={cn('relative inline-flex size-2 rounded-full', dot)} />
      </span>
      {label}
    </span>
  )
}
