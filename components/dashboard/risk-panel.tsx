import { ShieldCheck } from 'lucide-react'
import { fmtPct } from '@/lib/format'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'
import { TradingControl } from './trading-control'

export function RiskPanel({ snapshot, onChanged }: { snapshot: DashboardSnapshot; onChanged?: () => void }) {
  const { risk, limits } = snapshot
  const openCount = snapshot.markets.filter((m) => m.position).length

  const liveState: Record<string, { text: string; tone: 'ok' | 'active' | 'idle' }> = {
    stop: {
      text: openCount ? `${openCount} broker-side stop${openCount > 1 ? 's' : ''} resting` : 'Armed on next entry',
      tone: openCount ? 'ok' : 'idle',
    },
    vol: {
      text: snapshot.configured
        ? `Next trade risk: ${snapshot.markets
            .filter((m) => m.nextSize)
            .map((m) => `${m.config.displaySymbol} ${m.nextSize?.skipReason ? 'skip' : fmtPct(m.nextSize?.riskPct ?? 0, 2, false)}`)
            .join(' · ') || 'waiting for data'}`
        : 'Waiting for broker',
      tone: snapshot.markets.some((m) => m.nextSize?.skipReason) ? 'active' : 'idle',
    },
    openrisk: {
      text: snapshot.account
        ? `${fmtPct(risk.openRiskPct, 2, false)} of ${fmtPct(risk.maxOpenRiskPct, 0, false)} cap in use`
        : 'Waiting for broker',
      tone: risk.openRiskPct > risk.maxOpenRiskPct * 0.8 ? 'active' : 'idle',
    },
    corr: risk.correlation.active
      ? {
          text: `${risk.correlation.heldMarket} ${risk.correlation.side}. ${risk.correlation.blockedMarket} ${risk.correlation.side} blocked.`,
          tone: 'active',
        }
      : { text: 'Neither index is in a position. Both eligible.', tone: 'idle' },
    gross: {
      text: snapshot.account ? `${risk.grossExposurePct.toFixed(2)}x of ${risk.maxLeverage}x cap in use` : 'Waiting for broker',
      tone: risk.grossExposurePct > risk.maxLeverage * 0.8 ? 'active' : 'idle',
    },
    one: { text: `${openCount} of 5 markets in a position`, tone: 'idle' },
    daily: limits.enabled
      ? {
          text:
            limits.haltReason === 'daily_loss'
              ? 'Triggered. Entries resume next trading day.'
              : `Today ${fmtPct(limits.dayChangePct, 2)} vs -${fmtPct(limits.dailyLossPct, 0, false)} limit`,
          tone: limits.haltReason === 'daily_loss' ? 'active' : 'idle',
        }
      : { text: 'Needs storage', tone: 'idle' },
    drawdown: limits.enabled
      ? {
          text:
            limits.haltReason === 'drawdown'
              ? 'Triggered. Review, then resume.'
              : `${fmtPct(limits.drawdownPct, 2)} from peak vs -${fmtPct(limits.maxDrawdownPct, 0, false)} limit`,
          tone: limits.haltReason === 'drawdown' ? 'active' : 'idle',
        }
      : { text: 'Needs storage', tone: 'idle' },
  }

  return (
    <section aria-labelledby="risk-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        <h2 id="risk-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Built-in protection
        </h2>
      </div>
      <TradingControl snapshot={snapshot} onChanged={onChanged} />
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
