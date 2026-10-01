import { buildSnapshot } from '@/lib/trading/snapshot'

export const dynamic = 'force-dynamic'

export async function GET() {
  const snapshot = await buildSnapshot()
  return Response.json(snapshot)
}
