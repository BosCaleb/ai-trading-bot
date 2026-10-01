import type { StrategyFn, StrategyId } from '../types'
import { meanReversion } from './mean-reversion'
import { momentumBreakout } from './momentum-breakout'
import { trendFollowing } from './trend-following'

export const STRATEGIES: Record<StrategyId, StrategyFn> = {
  mean_reversion: meanReversion,
  momentum_breakout: momentumBreakout,
  trend_following: trendFollowing,
}
