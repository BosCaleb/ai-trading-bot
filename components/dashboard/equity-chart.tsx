import type { AccountInfo, EquityPoint } from '@/lib/broker/alpaca'
import { fmtMoney, fmtPct, plClass } from '@/lib/format'
import { cn } from '@/lib/utils'

const W = 600
const H = 160
const PAD = 6

export function EquityChart({ history, account }: { history: EquityPoint[]; account: AccountInfo | null }) {
  const points = history.length ? history : []
  const first = points[0]?.equity ?? null
  const lastPoint = points[points.length - 1]?.equity ?? account?.equity ?? null
  const periodPl = first !== null && lastPoint !== null ? lastPoint - first : null
  const periodPct = first && periodPl !== null ? periodPl / first : null

  const min = points.length ? Math.min(...points.map((p) => p.equity)) : 0
  const max = points.length ? Math.max(...points.map((p) => p.equity)) : 1
  const span = max - min || 1

  const coords = points.map((p, i) => {
    const x = points.length > 1 ? PAD + (i / (points.length - 1)) * (W - PAD * 2) : W / 2
    const y = PAD + (1 - (p.equity - min) / span) * (H - PAD * 2)
    return [x, y] as const
  })
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = coords.length ? `${line} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z` : ''
  const up = (periodPl ?? 0) >= 0

  return (
    <section aria-labelledby="equity-heading" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="equity-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Equity curve · 30 days
          </h2>
          <span className="font-mono text-2xl tabular leading-none">{fmtMoney(lastPoint)}</span>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <span className="text-[11px] tracking-wider text-muted-foreground uppercase">Period</span>
          <span className={cn('font-mono text-sm tabular', plClass(periodPl))}>
            {fmtMoney(periodPl, { signed: true })} · {fmtPct(periodPct)}
          </span>
        </div>
      </div>

      {points.length > 1 ? (
        <div className="flex flex-col gap-1">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Portfolio equity over the last 30 days">
            <path d={area} className={up ? 'fill-positive/15' : 'fill-negative/15'} />
            <path d={line} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className={up ? 'stroke-positive' : 'stroke-negative'} />
          </svg>
          <div className="flex justify-between font-mono text-[11px] tabular text-muted-foreground">
            <span>{new Date(points[0].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            <span>
              lo {fmtMoney(min, { compact: true })} · hi {fmtMoney(max, { compact: true })}
            </span>
            <span>{new Date(points[points.length - 1].t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
          </div>
        </div>
      ) : (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
          {account ? 'Equity history appears after the first full trading day.' : 'Connect the broker to see the equity curve.'}
        </div>
      )}
    </section>
  )
}
