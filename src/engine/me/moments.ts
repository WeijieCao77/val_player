/**
 * The career's big moments, queued for their full-screen card (大事卡). The author
 * settled which on 2026-09-14 (design page
 * https://claude.ai/code/artifact/7fdca3cb-f1b9-4d1f-a090-3891ffea8eaa): a title I
 * started in (from the bench, the event card), my first pro contract and every
 * move, an award won, the first time the ladder reaches 超凡入圣 / 神话 /
 * 辐能战魂, and my club's place in a Masters', Champions' or LOCK//IN's field.
 * Achievements keep their own book (me/achievements.ts).
 *
 * The engine writes what happened; ui/me/MomentQueue.tsx draws it. One card a
 * key, a dozen at most — a long 托管 run keeps the newest.
 */
import type { GameState } from '../types'
import type { MomentItem } from './types'
import { rankAt } from './rank'
import { compClass } from './compclass'

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
 * The ladder's best just rose (me/prepro.ts notePeak): the first arrival in a big tier is a
 * moment, once a career — the tier as the screen shows it that day, place and all (me/rank.ts
 * rankAt): a score whose RR would read 辐能战魂 on a board that has climbed past its place is no
 * 辐能战魂 (2026-09-14). Kept in flags rather than read off the board, since the board's size
 * drifts and the same best can read 神话 one month and 辐能战魂 the next.
 */
export function noteRankPeak(state: GameState, wasPeak: number): void {
  const me = state.me
  if (!me) return
  const now = rankAt(state)
  if (!BIG_TIERS.includes(now.tier) || rankAt(state, wasPeak).tier === now.tier) return
  const flag = `reached:${now.tier}`
  if (me.flags[flag]) return
  me.flags[flag] = state.year
  pushMoment(state, { kind: 'rank', key: `rank:${now.tier}`, rank: now.name, tier: now.tier, div: now.div, server: now.server.name, pos: now.pos })
}

/**
 * My club is in a Masters', Champions' or LOCK//IN's field (circuit.ts `begin` writes it
 * the day before) — the author's 出线大师赛 / 冠军赛. Read each day (me/week.ts), once a
 * career per event. An event already played or finished when first seen — a save
 * loaded in the middle of one, or one from before this card — is noted and not shown.
 */
export function noteQualify(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return
  for (const comp of Object.values(state.comps)) {
    if (!comp.teams.includes(state.myTeam)) continue
    const cls = compClass(comp.name)
    if (cls !== 'masters' && cls !== 'champions' && cls !== 'lockin') continue
    const flag = `qual:${comp.key}`
    if (me.flags[flag]) continue
    me.flags[flag] = state.year
    if (comp.finished.length || comp.champion) continue
    if (state.fixtures.some((f) => (f.comp === comp.key || f.comp === comp.name) && f.played)) continue
    pushMoment(state, { kind: 'qualify', key: `qualify:${comp.key}`, comp: comp.name, teamId: state.myTeam })
  }
}
