/**
 * The career's big moments, queued for their full-screen card (大事卡). The author
 * settled which on 2026-09-14 (design page
 * https://claude.ai/code/artifact/7fdca3cb-f1b9-4d1f-a090-3891ffea8eaa): a title I
 * started in, my first pro contract and every move, an award won, the first time
 * the ladder reaches 超凡入圣 / 神话 / 辐能战魂. Achievements keep their own book
 * (me/achievements.ts); a Masters or Champions spot comes with the standings work.
 *
 * The engine writes what happened; ui/me/MomentQueue.tsx draws it. One card a
 * key, a dozen at most — a long 托管 run keeps the newest.
 */
import type { GameState } from '../types'
import type { MomentItem } from './types'
import { rankAt } from './rank'

export const MOMENTS_CAP = 12

/** the ladder tiers whose first arrival is a moment */
export const BIG_TIERS: readonly string[] = ['超凡入圣', '神话', '辐能战魂']

export function pushMoment(state: GameState, m: Omit<MomentItem, 'year' | 'day'>): void {
  const me = state.me
  if (!me || me.phase === 'retired') return
  const list = (me.moments ??= [])
  if (list.some((x) => x.key === m.key)) return
  list.push({ ...m, year: state.year, day: state.day })
  if (list.length > MOMENTS_CAP) list.splice(0, list.length - MOMENTS_CAP)
}

/** The card on screen was taken. */
export function takeMoment(state: GameState): void {
  state.me?.moments?.shift()
}

/**
 * The ladder's best just rose (me/prepro.ts): the first arrival in a big tier is a
 * moment, once a career. Kept in flags rather than read off the board, since the
 * board's size drifts and the same best can read 神话 one month and 辐能战魂 the next.
 */
export function noteRankPeak(state: GameState, wasPeak: number): void {
  const me = state.me
  if (!me) return
  const now = rankAt(state, me.pre.ladderPeak)
  if (!BIG_TIERS.includes(now.tier) || rankAt(state, wasPeak).tier === now.tier) return
  const flag = `reached:${now.tier}`
  if (me.flags[flag]) return
  me.flags[flag] = state.year
  pushMoment(state, { kind: 'rank', key: `rank:${now.tier}`, rank: now.name, tier: now.tier, div: now.div, server: now.server.name, pos: now.pos })
}
