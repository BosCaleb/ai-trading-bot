import { ShieldCheck } from 'lucide-react'
import { fmtPct } from '@/lib/format'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'

export function RiskPanel({ snapshot }: { snapshot: DashboardSnapshot }) {
  const { risk } = snapshot
  const openCount = snapshot.markets.filter((m) => m.position).length

  const liveState: Record<string, { text: string; tone: 'ok' | 'active' | 'idle' }> = {
    stop: {
      text: openCount ? `${openCount} broker-side stop${openCount > 1 ? 's' : ''} resting` : 'Armed on next entry',
      tone: openCount ? 'ok' : 'idle',
    },
    vol: {
      text: snapshot.configured
        ? `Scalars: ${snapshot.markets
            .filter((m) => m.nextSize)
            .map((m) => `${m.config.displaySymbol} ${Math.round((m.nextSize?.volScalar ?? 0) * 100)}%`)
            .join(' · ') || 'waiting for data'}`
        : 'Waiting for broker',
      tone: 'idle',
    },
    corr: risk.correlation.active
      ? {
          text: `${risk.correlation.heldMarket} ${risk.correlation.side}. ${risk.correlation.blockedMarket} ${risk.correlation.side} blocked.`,
          tone: 'active',
        }
      : { text: 'Neither index is in a position. Both eligible.', tone: 'idle' },
    gross: {
      text: snapshot.account ? `${fmtPct(risk.grossExposurePct, 0, false)} of 100% cap in use` : 'Waiting for broker',
      tone: risk.grossExposurePct > 0.8 ? 'active' : 'idle',
    },
    one: { text: `${openCount} of 5 markets in a position`, tone: 'idle' },
  }

  return (
    <section aria-labelledby="risk-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        <h2 id="risk-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Built-in protection
        </h2>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {risk.rules.map((rule) => {
          const state = liveState[rule.id]
          return (
            <li key={rule.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm font-medium">{rule.title}</span>
                <span
                  className={cn(
                    'mt-1 size-2 shrink-0 rounded-full',
                    state?.tone === 'ok' && 'bg-positive',
                    state?.tone === 'active' && 'bg-primary',
                    state?.tone === 'idle' && 'bg-muted-foreground/50',
                  )}
                  aria-hidden="true"
                />
              </div>
              <p className="text-xs leading-relaxed text-pretty text-muted-foreground">{rule.detail}</p>
              {state ? <p className="font-mono text-xs tabular text-foreground/80">{state.text}</p> : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
