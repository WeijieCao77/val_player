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
 * The queue as it stands, for a run that has to hand the screen back the moment a
 * new card is raised (me/week.ts runDays, me/auto.ts advanceUntil). A mark that
 * differs from the one taken before the day means a card was queued in it.
 *
 * Not the length: the queue is capped (MOMENTS_CAP), so the twelfth card pushes the
 * first out and the count never moves. The newest card's key does move, and one key
 * is queued once (pushMoment).
 */
export function momentMark(state: GameState): string {
  const list = state.me?.moments
  return list?.length ? `${list.length}:${list[list.length - 1].key}` : ''
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
 * My club is in a Masters', Champions' or LOCK//IN's field — the author's 出线大师赛 /
 * 冠军赛. Read each day (me/week.ts), once a career per event. An event my club is
 * already playing when it is first seen — a save loaded in the middle of one, a club
 * joined mid-event — is noted and not shown.
 *
 * The field has to be this world's, and it is this world's only from the day the event is
 * drawn here (circuit.ts begin). Until then `comp.teams` is history's booking, written
 * when the season is set up (circuit.ts bookEvent): the clubs that really played it. Read
 * before the draw, the card announced those. Reported 2026-09-16 — 「有成就弹窗我打进了
 * 冠军赛」 with no match ever following — and reproduced by scripts/probe_qualcard.ts:
 * 6 of 30 cards were for an event the club never played a tie in, among them 「打进伦敦
 * 大师赛」 on the first day of the season, 155 days before it opened and before anybody
 * had been drawn into it.
 *
 * A 'history' event is one this world keeps as it really went and plays no match of, and
 * its field is never the player's — begin makes it 'sim' whenever the draw seats him —
 * so 'sim' is the whole of the condition.
 */
export function noteQualify(state: GameState): void {
  const me = state.me
  const club = state.myTeam
  if (!me || me.phase !== 'pro' || !club) return
  for (const comp of Object.values(state.comps)) {
    // history's booking until the draw is made here — see above
    if (comp.circuit && comp.circuit.mode !== 'sim') continue
    if (!comp.teams.includes(club)) continue
    const cls = compClass(comp.name)
    if (cls !== 'masters' && cls !== 'champions' && cls !== 'lockin') continue
    const flag = `qual:${comp.key}`
    if (me.flags[flag]) continue
    me.flags[flag] = state.year
    if (comp.finished.length || comp.champion) continue
    // already playing in it: my club's own matches, not the event's — a club that comes up
    // through a qualifier plays its decider in this very competition (circuit.ts offerPlayIn)
    if (state.fixtures.some((f) => (f.comp === comp.key || f.comp === comp.name) && f.played
      && (f.teamA === club || f.teamB === club))) continue
    pushMoment(state, { kind: 'qualify', key: `qualify:${comp.key}`, comp: comp.name, teamId: club })
  }
}
