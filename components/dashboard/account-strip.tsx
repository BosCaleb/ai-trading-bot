import { fmtMoney, fmtPct, plClass } from '@/lib/format'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'

export function AccountStrip({ snapshot }: { snapshot: DashboardSnapshot }) {
  const a = snapshot.account
  const openPositions = snapshot.markets.filter((m) => m.position).length
  const openRisk = snapshot.markets.reduce((sum, m) => sum + (m.position ? Math.abs(m.position.marketValue) * snapshot.risk.stopLossPct : 0), 0)

  return (
    <section aria-label="Account summary" className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
      <Stat label="Equity" value={fmtMoney(a?.equity)} />
      <Stat
        label="Day P&L"
        value={fmtMoney(a?.dayPl, { signed: true })}
        sub={fmtPct(a?.dayPlPct)}
        tone={plClass(a?.dayPl)}
      />
      <Stat
        label="Gross exposure"
        value={fmtPct(a ? snapshot.risk.grossExposurePct : null, 0, false)}
        sub={a ? `${fmtMoney(snapshot.risk.grossExposure, { compact: true })} of ${fmtMoney(a.equity, { compact: true })}` : undefined}
      />
      <Stat label="Open positions" value={a ? `${openPositions} / 5` : '—'} sub={a ? `${fmtMoney(openRisk, { compact: true })} at risk to stops` : undefined} />
      <Stat label="Cash" value={fmtMoney(a?.cash)} sub={a ? `${fmtMoney(a.buyingPower, { compact: true })} buying power` : undefined} />
    </section>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-1 bg-card px-4 py-3">
      <span className="text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{label}</span>
      <span className={cn('font-mono text-xl tabular leading-none sm:text-2xl', tone)}>{value}</span>
      {sub ? <span className="font-mono text-xs tabular text-muted-foreground">{sub}</span> : <span className="text-xs">&nbsp;</span>}
    </div>
  )
}
