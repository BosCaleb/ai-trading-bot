import { describe, expect, it } from 'vitest'
import { type BotState, emptyState } from '@/lib/state/store'
import { evaluateLimits, pauseTrading, resumeTrading, tradingDayKey } from '@/lib/trading/loss-limits'

const DAY1 = new Date('2026-10-01T10:00:00Z')
const DAY1_LATE = new Date('2026-10-01T23:30:00Z') // 01:30 SAST on the 2nd, still the Exness 1st
const DAY2 = new Date('2026-10-02T00:10:00Z')

const state = (o: Partial<BotState> = {}): BotState => ({ ...emptyState('paper'), ...o })

describe('trading day', () => {
  it('follows Exness server time (UTC), not South African time', () => {
    expect(tradingDayKey(DAY1_LATE)).toBe('2026-10-01')
    expect(tradingDayKey(DAY2)).toBe('2026-10-02')
  })
})

describe('evaluateLimits', () => {
  it('starts the day and the peak from the first equity it sees', () => {
    const e = evaluateLimits(state(), 1000, DAY1)
    expect(e.state).toMatchObject({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1000 })
    expect(e.entriesAllowed).toBe(true)
    expect(e.newlyHalted).toBeNull()
  })

  it('tracks new equity highs as the peak', () => {
    const e = evaluateLimits(state({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1000 }), 1100, DAY1)
    expect(e.state.peakEquity).toBe(1100)
    expect(e.drawdownPct).toBe(0)
  })

  describe('3% daily loss', () => {
    const today = state({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1000 })

    it('allows a 2.9% loss and halts at 3%', () => {
      expect(evaluateLimits(today, 971, DAY1).entriesAllowed).toBe(true)
      const e = evaluateLimits(today, 970, DAY1)
      expect(e.entriesAllowed).toBe(false)
      expect(e.newlyHalted).toBe('daily_loss')
      expect(e.reason).toMatch(/Daily loss limit: equity 970.00 is down 3.00% today/)
    })

    it('stays halted for the rest of the day without re-alerting, even if equity recovers', () => {
      const halted = evaluateLimits(today, 960, DAY1).state
      const later = evaluateLimits(halted, 990, DAY1_LATE)
      expect(later.entriesAllowed).toBe(false)
      expect(later.newlyHalted).toBeNull()
    })

    it('clears at the next trading day and re-bases on that day’s equity', () => {
      const halted = evaluateLimits(today, 960, DAY1).state
      const next = evaluateLimits(halted, 960, DAY2)
      expect(next.entriesAllowed).toBe(true)
      expect(next.state).toMatchObject({ dayKey: '2026-10-02', dayStartEquity: 960, haltReason: null, haltedAt: null })
    })
  })

  describe('10% drawdown', () => {
    const peaked = state({ dayKey: '2026-10-01', dayStartEquity: 905, peakEquity: 1000 })

    it('halts at 10% below peak and does not clear overnight', () => {
      expect(evaluateLimits(peaked, 901, DAY1).entriesAllowed).toBe(true)
      const e = evaluateLimits(peaked, 900, DAY1)
      expect(e.newlyHalted).toBe('drawdown')
      expect(e.reason).toMatch(/Drawdown halt: equity 900.00 is 10.00% below its peak of 1000.00/)
      const nextDay = evaluateLimits(e.state, 950, DAY2)
      expect(nextDay.entriesAllowed).toBe(false)
      expect(nextDay.state.haltReason).toBe('drawdown')
    })

    it('escalates a daily-loss halt to a drawdown halt', () => {
      const daily = evaluateLimits(state({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1050 }), 960, DAY1).state
      expect(daily.haltReason).toBe('daily_loss')
      const worse = evaluateLimits(daily, 940, DAY1)
      expect(worse.newlyHalted).toBe('drawdown')
    })
  })

  it('never overrides a manual pause', () => {
    const paused = pauseTrading(state({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1000 }), DAY1)
    const e = evaluateLimits(paused, 800, DAY2)
    expect(e.state.haltReason).toBe('manual')
    expect(e.newlyHalted).toBeNull()
    expect(e.entriesAllowed).toBe(false)
  })
})

describe('resumeTrading', () => {
  it('clears the halt and re-bases peak and day so the same loss does not re-trigger', () => {
    const halted = evaluateLimits(state({ dayKey: '2026-10-01', dayStartEquity: 1000, peakEquity: 1000 }), 880, DAY1).state
    const resumed = resumeTrading(halted, 880, DAY1)
    expect(resumed).toMatchObject({ haltReason: null, haltDetail: null, haltedAt: null, peakEquity: 880, dayStartEquity: 880 })
    expect(evaluateLimits(resumed, 880, DAY1).entriesAllowed).toBe(true)
  })
})
