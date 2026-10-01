import { fmtDateTimeET, fmtPrice, fmtQty } from '@/lib/format'
import { marketBySymbol } from '@/lib/trading/markets'
import type { OrderInfo } from '@/lib/trading/types'
import { cn } from '@/lib/utils'

const STATUS_CLASS: Record<string, string> = {
  filled: 'text-positive',
  partially_filled: 'text-primary',
  new: 'text-primary',
  accepted: 'text-primary',
  held: 'text-muted-foreground',
  canceled: 'text-muted-foreground',
  expired: 'text-muted-foreground',
  rejected: 'text-negative',
}

function describeType(o: OrderInfo): string {
  if (o.type === 'stop' || o.type === 'stop_limit') return 'Stop'
  if (o.orderClass === 'oto') return 'Entry + stop'
  return o.type.charAt(0).toUpperCase() + o.type.slice(1)
}

export function OrdersTable({ orders }: { orders: OrderInfo[] }) {
  const rows = orders.slice(0, 12)
  return (
    <section aria-labelledby="orders-heading" className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-baseline justify-between">
        <h2 id="orders-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
          Recent orders
        </h2>
        <span className="text-xs text-muted-foreground">Source of truth: broker</span>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No orders yet. The first signal that passes the risk filters will show up here.</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="text-[11px] tracking-wider text-muted-foreground uppercase">
                <th className="pb-2 font-medium">Time</th>
                <th className="pb-2 font-medium">Market</th>
                <th className="pb-2 font-medium">Side</th>
                <th className="pb-2 font-medium">Type</th>
                <th className="pb-2 text-right font-medium">Qty</th>
                <th className="pb-2 text-right font-medium">Fill / stop</th>
                <th className="pb-2 text-right font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="font-mono text-xs tabular">
              {rows.map((o) => {
                const market = marketBySymbol(o.symbol)
                const display = market?.displaySymbol ?? o.symbol
                return (
                  <tr key={o.id} className="border-t border-border">
                    <td className="py-2 text-muted-foreground">{fmtDateTimeET(o.filledAt ?? o.submittedAt)}</td>
                    <td className="py-2">
                      <span className="font-sans">{market?.name ?? o.symbol}</span>{' '}
                      <span className="text-muted-foreground">{display}</span>
                    </td>
                    <td className={cn('py-2 uppercase', o.side === 'buy' ? 'text-positive' : 'text-negative')}>{o.side}</td>
                    <td className="py-2 font-sans text-muted-foreground">{describeType(o)}</td>
                    <td className="py-2 text-right">{fmtQty(o.filledQty || o.qty)}</td>
                    <td className="py-2 text-right">
                      {o.filledAvgPrice ? fmtPrice(o.filledAvgPrice, display) : o.stopPrice ? `stop ${fmtPrice(o.stopPrice, display)}` : '—'}
                    </td>
                    <td className={cn('py-2 text-right font-sans capitalize', STATUS_CLASS[o.status] ?? 'text-muted-foreground')}>
                      {o.status.replace('_', ' ')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
