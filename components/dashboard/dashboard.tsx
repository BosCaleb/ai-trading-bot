'use client'

import useSWR from 'swr'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'
import { AccountStrip } from './account-strip'
import { DeskHeader } from './desk-header'
import { EquityChart } from './equity-chart'
import { MarketCard } from './market-card'
import { OrdersTable } from './orders-table'
import { ReportsPanel } from './reports-panel'
import { RiskPanel } from './risk-panel'
import { SetupNotice } from './setup-notice'

const fetcher = (url: string) => fetch(url).then((r) => r.json() as Promise<DashboardSnapshot>)

export function Dashboard({ initial }: { initial: DashboardSnapshot }) {
  const { data, isValidating, mutate } = useSWR<DashboardSnapshot>('/api/dashboard', fetcher, {
    fallbackData: initial,
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  })
  const snapshot = data ?? initial

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
      <DeskHeader snapshot={snapshot} refreshing={isValidating} onRefresh={() => mutate()} />

      {!snapshot.configured ? <SetupNotice smsConfigured={snapshot.smsConfigured} stateConfigured={snapshot.stateConfigured} /> : null}
      {snapshot.configured && snapshot.error ? (
        <div role="alert" className="rounded-lg border border-negative/40 bg-negative/10 px-4 py-3 text-sm text-foreground">
          <span className="font-medium">Broker error:</span> {snapshot.error}
        </div>
      ) : null}

      <AccountStrip snapshot={snapshot} />

      <section aria-labelledby="markets-heading" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 id="markets-heading" className="text-sm font-medium tracking-wide text-muted-foreground uppercase">
            Five markets, five strategies
          </h2>
          <p className="text-xs text-muted-foreground">Closed candles only. Signals re-evaluated every cycle.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {snapshot.markets.map((m) => (
            <MarketCard key={m.config.id} market={m} configured={snapshot.configured} />
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <EquityChart history={snapshot.history} account={snapshot.account} />
          <OrdersTable orders={snapshot.orders} />
        </div>
        <div className="flex flex-col gap-6">
          <RiskPanel snapshot={snapshot} />
          <ReportsPanel smsConfigured={snapshot.smsConfigured} configured={snapshot.configured} />
        </div>
      </div>
    </div>
  )
}
