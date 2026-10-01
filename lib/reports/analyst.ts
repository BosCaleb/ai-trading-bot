import { generateText } from 'ai'
import { STRATEGY_META, TIMEFRAME_META } from '@/lib/trading/markets'
import type { DashboardSnapshot } from '@/lib/trading/snapshot'

export type ReportType = 'morning' | 'evening'

const MODEL = process.env.ANALYST_MODEL ?? 'anthropic/claude-sonnet-5.5'

const ET_DATE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'long',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

const LOCAL_DATE = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Etc/GMT-2',
  weekday: 'long',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

function pct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a'
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'n/a'
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

/** Compact, model-readable state of the whole desk. */
export function describeSnapshot(snapshot: DashboardSnapshot): string {
  const lines: string[] = []
  const now = new Date(snapshot.generatedAt)
  lines.push(`Time: ${LOCAL_DATE.format(now)} GMT+2 (reader's local time; ${ET_DATE.format(now)} ET in New York). Quote times to the reader in GMT+2.`)
  lines.push(`Mode: ${snapshot.mode.toUpperCase()} trading. Bot ${snapshot.botEnabled ? 'active' : 'paused'}.`)
  if (snapshot.account) {
    const a = snapshot.account
    lines.push(
      `Account: equity ${money(a.equity)}, cash ${money(a.cash)}, day P&L ${money(a.dayPl)} (${pct(a.dayPlPct)}), leverage ${snapshot.risk.grossExposurePct.toFixed(2)}x (cap ${snapshot.risk.maxLeverage}x), open risk at stops ${money(snapshot.risk.openRisk)} (${pct(snapshot.risk.openRiskPct)}, cap ${pct(snapshot.risk.maxOpenRiskPct, 0)}).`,
    )
  }
  if (snapshot.clock) {
    lines.push(`US equity session: ${snapshot.clock.isOpen ? 'OPEN' : 'CLOSED'}. Next open ${snapshot.clock.nextOpen}, next close ${snapshot.clock.nextClose}.`)
  }
  if (snapshot.risk.correlation.active) {
    const c = snapshot.risk.correlation
    lines.push(`Correlation filter active: ${c.heldMarket} is ${c.side}, so ${c.blockedMarket} cannot also go ${c.side}.`)
  }

  lines.push('')
  lines.push('Markets:')
  for (const m of snapshot.markets) {
    const strat = STRATEGY_META[m.config.strategy].label
    const tf = TIMEFRAME_META[m.config.timeframe].label
    const head = `- ${m.config.name} (${m.config.displaySymbol}, ${strat} on ${tf})`
    if (m.error) {
      lines.push(`${head}: data error - ${m.error}`)
      continue
    }
    const parts: string[] = []
    parts.push(`price ${m.price?.toFixed(2) ?? 'n/a'}`)
    parts.push(`24h ${pct(m.change24hPct)}`)
    if (m.atrPct) parts.push(`ATR ${pct(m.atrPct)} per bar`)
    if (m.position) {
      parts.push(
        `POSITION ${m.position.side.toUpperCase()} ${m.position.qty} @ ${m.position.avgEntry.toFixed(2)}, unrealized ${money(m.position.unrealizedPl)} (${pct(m.position.unrealizedPlPct)}), ${m.stopCovered ? `stop ${m.stopPrice?.toFixed(2)}` : 'NO WORKING STOP (guardian will repair next cycle)'}`,
      )
    } else {
      parts.push('flat')
    }
    if (m.signal) parts.push(`signal: ${m.signal.action.replace('_', ' ')} - ${m.signal.reason}`)
    lines.push(`${head}: ${parts.join('; ')}`)
  }

  const today = new Date(snapshot.generatedAt).toISOString().slice(0, 10)
  const todaysFills = snapshot.orders.filter((o) => o.status === 'filled' && o.filledAt?.startsWith(today))
  lines.push('')
  lines.push(`Fills today: ${todaysFills.length}`)
  for (const o of todaysFills.slice(0, 15)) {
    lines.push(`- ${o.side.toUpperCase()} ${o.filledQty} ${o.symbol} @ ${o.filledAvgPrice?.toFixed(2) ?? '?'} (${o.type}${o.orderClass !== 'simple' ? `, ${o.orderClass}` : ''})`)
  }

  return lines.join('\n')
}

const INSTRUCTIONS = `You are the analyst for an automated five-market trading desk. The desk runs:
- Mean reversion on 15-minute candles for the S&P 500 (SPY) and NASDAQ 100 (QQQ)
- Momentum breakouts on 1-hour candles for Bitcoin
- Trend following on 4-hour candles for Gold (GLD) and Crude Oil (USO)
Every trade carries a broker-side stop a multiple of ATR away and is sized so hitting it loses about 1% of equity, open risk across all positions is capped at 3%, and SPY/QQQ can never hold positions in the same direction.

You write SMS messages for the desk owner. Rules:
- Plain text only. No markdown, no headers, no bullet symbols, no emojis.
- Be specific: cite prices, percentages, and dollar figures from the data. Never invent numbers.
- Short sentences. Confident, calm, professional. No hype, no financial advice, no disclaimers.
- Stay under the character limit you are given.`

export async function generateReport(type: ReportType, snapshot: DashboardSnapshot): Promise<string> {
  const state = describeSnapshot(snapshot)

  const prompt =
    type === 'morning'
      ? `Write the MORNING briefing (max 550 characters). Cover: what the five markets are doing right now, which strategies are close to a setup or already in a trade, any open positions and their stops, and whether any risk filter is active. Frame it as "what to expect today". Start with "Morning brief:".

Desk state:
${state}`
      : `Write the EVENING performance report (max 600 characters). Cover exactly how the portfolio performed today: day P&L in dollars and percent, ending equity, every fill today with its outcome, open positions carried overnight with unrealized P&L, and one sentence on what the bot is watching into tomorrow. Start with "Evening report:".

Desk state:
${state}`

  const { text } = await generateText({
    model: MODEL,
    instructions: INSTRUCTIONS,
    prompt,
    maxOutputTokens: 400,
  })

  return text.trim()
}
