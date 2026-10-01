import { Dashboard } from '@/components/dashboard/dashboard'
import { buildSnapshot } from '@/lib/trading/snapshot'

export const dynamic = 'force-dynamic'

export default async function Page() {
  const snapshot = await buildSnapshot()
  return (
    <main>
      <Dashboard initial={snapshot} />
    </main>
  )
}
