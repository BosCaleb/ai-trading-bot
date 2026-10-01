import type { BotState, HaltReason } from '@/lib/state/store'

/**
 * Account-level circuit breakers. Pure functions over the persisted BotState so they can be tested
 * without a database or broker; the engine loads, evaluates and saves the state each cycle.
 *
 * - Daily loss: equity 3% below where the trading day started halts new entries until the next
 *   day. The day follows Exness server time (UTC), so it rolls over at 00:00 UTC / 02:00 SAST.
 * - Drawdown: equity 10% below its peak halts new entries until someone resumes the bot.
 * Halts never stop exits or the stop guardian: existing positions keep being managed.
 */
export const LIMITS = {
  dailyLossPct: 0.03,
  maxDrawdownPct: 0.1,
} as const

export const LOSS_LIMIT_RULES = [
  {
    id: 'daily',
    title: '3% daily loss limit',
    detail:
      'If equity falls 3% below where the trading day started (00:00 UTC, Exness server time), new entries stop until the next day. Open positions and their stops are still managed.',
  },
  {
    id: 'drawdown',
    title: '10% drawdown halt',
    detail: 'If equity falls 10% below its highest point, new entries stop until you review and resume the bot from the dashboard.',
  },
]

/** Trading day key: the UTC calendar date, matching Exness server time. */
export function tradingDayKey(now: Date): string {
  return now.toISOString().slice(0, 10)
}

export interface LimitEvaluation {
  /** State to persist */
  state: BotState
  entriesAllowed: boolean
  /** Why entries are blocked, for logs, the dashboard and SMS */
  reason: string | null
  /** Set only on the cycle a halt starts, so the alert is sent once */
  newlyHalted: HaltReason | null
  /** Day-to-date change vs the day's starting equity */
  dayChangePct: number
  /** Distance below peak (0 or negative) */
  drawdownPct: number
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`
}

export function haltMessage(state: Pick<BotState, 'haltReason' | 'haltDetail'>): string | null {
  if (!state.haltReason) return null
  const label = { daily_loss: 'Daily loss limit', drawdown: 'Drawdown halt', manual: 'Paused manually' }[state.haltReason]
  return state.haltDetail ? `${label}: ${state.haltDetail}` : label
}

export function evaluateLimits(previous: BotState, equity: number, now: Date): LimitEvaluation {
  const state: BotState = { ...previous }
  const at = now.toISOString()
  const today = tradingDayKey(now)

  // New trading day: re-base the daily limit. A daily-loss halt ends with the day it belonged to.
  if (state.dayKey !== today || state.dayStartEquity === null) {
    state.dayKey = today
    state.dayStartEquity = equity
    if (state.haltReason === 'daily_loss') {
      state.haltReason = null
      state.haltDetail = null
      state.haltedAt = null
    }
  }

  if (state.peakEquity === null || equity > state.peakEquity) {
    state.peakEquity = equity
    state.peakAt = at
  }

  const dayStart = state.dayStartEquity as number
  const peak = state.peakEquity as number
  const dayChangePct = dayStart > 0 ? equity / dayStart - 1 : 0
  const drawdownPct = peak > 0 ? equity / peak - 1 : 0

  // Exactly hitting a limit counts as hitting it: 900 / 1000 - 1 is -0.0999... in floating point.
  const EPS = 1e-9
  let newlyHalted: HaltReason | null = null
  const halt = (reason: HaltReason, detail: string) => {
    state.haltReason = reason
    state.haltDetail = detail
    state.haltedAt = at
    newlyHalted = reason
  }

  // Drawdown outranks a daily halt (it does not clear overnight); a manual pause is never overridden.
  if (drawdownPct <= -LIMITS.maxDrawdownPct + EPS && state.haltReason !== 'drawdown' && state.haltReason !== 'manual') {
    halt('drawdown', `equity ${equity.toFixed(2)} is ${pct(-drawdownPct)} below its peak of ${peak.toFixed(2)}`)
  } else if (dayChangePct <= -LIMITS.dailyLossPct + EPS && state.haltReason === null) {
    halt('daily_loss', `equity ${equity.toFixed(2)} is down ${pct(-dayChangePct)} today (started at ${dayStart.toFixed(2)})`)
  }

  return {
    state,
    entriesAllowed: state.haltReason === null,
    reason: haltMessage(state),
    newlyHalted,
    dayChangePct,
    drawdownPct,
  }
}

/**
 * Lifts any halt after a human review. The peak and the day's start are re-based to current
 * equity, otherwise the next cycle would measure the same loss and halt again immediately.
 */
export function resumeTrading(previous: BotState, equity: number, now: Date): BotState {
  return {
    ...previous,
    peakEquity: equity,
    peakAt: now.toISOString(),
    dayKey: tradingDayKey(now),
    dayStartEquity: equity,
    haltReason: null,
    haltDetail: null,
    haltedAt: null,
  }
}

/** Stops new entries until resumed, without touching open positions. */
export function pauseTrading(previous: BotState, now: Date, detail = 'paused from the dashboard'): BotState {
  return { ...previous, haltReason: 'manual', haltDetail: detail, haltedAt: now.toISOString() }
}
