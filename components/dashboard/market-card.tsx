import { fmtDateTimeET, fmtMoney, fmtPct, fmtPrice, fmtQty, plClass } from '@/lib/format'
import { STRATEGY_META, TIMEFRAME_META } from '@/lib/trading/markets'
import type { MarketSnapshot } from '@/lib/trading/snapshot'
import { cn } from '@/lib/utils'

type Tone = 'positive' | 'negative' | 'primary' | 'muted'

function stateFor(m: MarketSnapshot, configured: boolean): { label: string; tone: Tone } {
  if (!configured) return { label: 'Offline', tone: 'muted' }
  if (m.error) return { label: 'No data', tone: 'negative' }
  if (m.position) return m.position.side === 'long' ? { label: 'In long', tone: 'positive' } : { label: 'In short', tone: 'negative' }
  switch (m.signal?.action) {
    case 'enter_long':
      return { label: 'Long setup', tone: 'primary' }
    case 'enter_short':
      return { label: 'Short setup', tone: 'primary' }
    case 'exit':
      return { label: 'Exit', tone: 'primary' }
    default:
      return { label: 'Watching', tone: 'muted' }
  }
}

const TONE_CLASS: Record<Tone, string> = {
  positive: 'bg-positive/15 text-positive',
  negative: 'bg-negative/15 text-negative',
  primary: 'bg-primary/15 text-primary',
  muted: 'bg-muted text-muted-foreground',
}

export function MarketCard({ market, configured }: { market: MarketSnapshot; configured: boolean }) {
  const { config, price, change24hPct, signal, position, stopPrice, nextSize, atrPct } = market
  const state = stateFor(market, configured)
  const strategy = STRATEGY_META[config.strategy]
  const tf = TIMEFRAME_META[config.timeframe]

  return (
    <article
      aria-label={`${config.name} ${strategy.label}`}
      className={cn(
        'flex flex-col gap-4 rounded-lg border bg-card p-4 transition-colors',
        state.tone === 'primary' ? 'border-primary/50' : position ? 'border-border' : 'border-border',
      )}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h3 className="text-base font-semibold leading-tight">{config.name}</h3>
          <span className="font-mono text-xs text-muted-foreground">
            {config.displaySymbol} · {tf.label} · {strategy.label}
          </span>
        </div>
        <span className={cn('shrink-0 rounded-sm px-2 py-0.5 font-mono text-[11px] font-medium tracking-wider uppercase', TONE_CLASS[state.tone])}>
          {state.label}
        </span>
      </header>

      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-2xl tabular leading-none">{fmtPrice(price, config.displaySymbol)}</span>
        <span className={cn('font-mono text-sm tabular', plClass(change24hPct))}>{fmtPct(change24hPct)}</span>
      </div>

      <p className="min-h-10 text-sm leading-relaxed text-pretty text-muted-foreground">
        {market.error ? market.error : signal?.reason ?? strategy.summary}
      </p>

      {position ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-background/60 p-3 font-mono text-xs tabular">
          <Row label="Size" value={`${fmtQty(position.qty)} @ ${fmtPrice(position.avgEntry, config.displaySymbol)}`} />
          <Row label="Unrealized" value={`${fmtMoney(position.unrealizedPl, { signed: true })}`} tone={plClass(position.unrealizedPl)} />
          <Row label="Stop" value={fmtPrice(stopPrice, config.displaySymbol)} tone="text-negative" />
          <Row label="Notional" value={fmtMoney(Math.abs(position.marketValue), { compact: true })} />
        </dl>
      ) : (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-md bg-background/60 p-3 font-mono text-xs tabular">
          <Row label="Next size" value={nextSize ? `${fmtQty(nextSize.qty)} (${fmtMoney(nextSize.notional, { compact: true })})` : '—'} />
          <Row label="Vol scalar" value={nextSize ? `${Math.round(nextSize.volScalar * 100)}%` : '—'} />
          <Row label="ATR / bar" value={fmtPct(atrPct, 2, false)} />
          <Row label="Shorts" value={config.allowShort ? 'Allowed' : 'Off'} />
        </dl>
      )}

      <footer className="mt-auto flex items-center justify-between text-[11px] text-muted-foreground">
        <span>Last {tf.label} close</span>
        <span className="font-mono tabular">{fmtDateTimeET(market.lastBarAt)}</span>
      </footer>
    </article>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] tracking-wider text-muted-foreground uppercase">{label}</dt>
      <dd className={cn('truncate', tone)}>{value}</dd>
    </div>
  )
}
