import type { GameState } from '../types'

/** Permanent record books, not the one-year match-detail window. Missing legacy
 * totals are a verified lower bound; never reconstruct matches from guesses. */
const count = (n: unknown): number => typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0

export function careerMilestones(state: GameState) {
  const me = state.me
  const career = me && state.players[me.id]?.career
  const starts = (Array.isArray(me?.seasons) ? me.seasons.reduce((n, s) => n + count(s?.starts), 0) : 0) + count(me?.seasonStart?.starts)
  return [
    { key: 'matches100', name: '一百场', count: starts, target: 100, unit: '场' },
    { key: 'maps1000', name: '千图征途', count: count(career?.maps), target: 1000, unit: '图' },
    { key: 'kills10000', name: '万杀选手', count: count(career?.kills), target: 10000, unit: '击杀' },
  ]
}

export const milestoneReached = (state: GameState, key: string): boolean =>
  careerMilestones(state).some((m) => m.key === key && m.count >= m.target)
