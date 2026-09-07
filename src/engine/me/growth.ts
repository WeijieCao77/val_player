import { Rng, clamp } from '../rng'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player, Team } from '../types'
import { recomputeOverall, refreshValue, weightsFor } from '../player'
import { recommendedTrainingFocus } from '../training'
import { duoBonded } from '../bonds'
import { ACTIONS } from './actions'
import type { MeAction, MeState } from './types'
import { pushLog } from './log'

/**
 * The same week-of-practice base the club engine uses (training.ts
 * trainPlayer), without the focus: age, condition, mood, coaching, facility
 * and headroom. My own hours are priced against it, so a rookie at a
 * well-coached club grows faster from the same eight points — as he should.
 */
export function gainBase(p: Player, team: Team, rng: Rng): number {
  const headroom = p.potential - p.overall
  if (headroom <= 0) return 0
  const coach = ((team.coach?.development ?? 55) - 55) / 100
  const facility = (team.facilities - 55) / 130
  const age = p.age <= 20 ? 1.35 : p.age <= 23 ? 1.1 : p.age <= 26 ? 0.8 : 0.45
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200
  return rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6)
}

/** Progress toward a point; a full bar is a point while there is room under the ceiling. */
export function addXp(p: Player, k: keyof Attrs, amount: number): boolean {
  if (amount <= 0) return false
  p.xp[k] = (p.xp[k] ?? 0) + amount
  let rose = false
  while ((p.xp[k] ?? 0) >= 100 && p.overall < p.potential && p.attrs[k] < 99) {
    p.xp[k] = (p.xp[k] ?? 0) - 100
    p.attrs[k] += 1
    rose = true
  }
  if (rose) {
    recomputeOverall(p)
    refreshValue(p)
  }
  return rose
}

/** How each extra hour splits across attributes. */
const SPLIT: Partial<Record<MeAction, Partial<Record<keyof Attrs, number>>>> = {
  aim: { aim: 0.65, reaction: 0.35 },
  vod: { awareness: 0.6, clutch: 0.4 },
  util: { utility: 0.5, teamwork: 0.3, communication: 0.2 },
}

/** my extra hours are worth this much of a club training week, per point */
const EXTRA = 0.55

/**
 * The club's own programme for me this week — the engine's trainPlayer runs it
 * — points at whatever I put the most hours into; with no plan the coach picks
 * the way he picks for everyone.
 */
export function primaryFocus(me: MeState, p: Player): keyof Attrs | 'rest' {
  let best: keyof Attrs | null = null
  let bestN = 0
  for (const a of ACTIONS) {
    const n = me.plan[a.key] ?? 0
    if (!a.attrs || !n) continue
    if (n > bestN) { bestN = n; best = a.attrs[0] }
  }
  if (best) return best
  if ((me.plan.rest ?? 0) >= 2) return 'rest'
  return recommendedTrainingFocus(p)
}

export const tiltDrag = (me: MeState): number => (me.tilt > 55 ? (me.tilt - 55) * 0.04 : 0)

/** Apply the week's plan at the weekly settlement. */
export function settleTraining(state: GameState, rng: Rng, notes: string[]): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  if (!p || !team) return
  const g = gainBase(p, team, rng)
  const w = weightsFor(p)
  const top3 = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 3)
  let fatigue = 0
  const rose: (keyof Attrs)[] = []
  const bump = (k: keyof Attrs, amt: number) => { if (addXp(p, k, amt) && !rose.includes(k)) rose.push(k) }

  for (const a of ACTIONS) {
    const n = me.plan[a.key] ?? 0
    if (!n) continue
    fatigue += a.fatigue * n
    switch (a.key) {
      case 'aim': case 'vod': case 'util': {
        const split = SPLIT[a.key]!
        for (const [k, share] of Object.entries(split) as [keyof Attrs, number][]) {
          bump(k, g * EXTRA * n * share)
        }
        if (a.key === 'vod' && p.isIgl) bump('igl', g * EXTRA * n * 0.25)
        break
      }
      case 'ranked':
        for (const k of top3) bump(k, g * 0.18 * n)
        p.form = clamp(p.form + 0.8 * n, 30, 99)
        me.tilt = clamp(me.tilt - 3 * n, 0, 100)
        me.body = clamp(me.body + 0.1 * n, 0, 100)
        break
      case 'scrim':
        me.coachTrust = clamp(me.coachTrust + 2.5 * n, 0, 100)
        me.scrimRounds += 40 * n
        bump('teamwork', g * 0.35 * n)
        bump('communication', g * 0.35 * n)
        me.tilt = clamp(me.tilt - 1 * n, 0, 100)
        break
      case 'duo':
        if (me.duoWith && state.players[me.duoWith]?.teamId === state.myTeam) {
          duoBonded(state, me.id, me.duoWith, 3 * n)
          notes.push(`和 ${state.players[me.duoWith].ign} 双排了 ${n} 次，关系近了一点。`)
        }
        bump('communication', g * 0.3 * n)
        break
      case 'stream': {
        const income = Math.round((300 + me.fans * 4 + me.heat * 2) * n)
        me.money += income
        me.heat += 9 * n
        notes.push(`直播 ${n} 次，礼物收入 $${income.toLocaleString()}。`)
        break
      }
      case 'rest':
        // 体质 makes rest worth more; nerve settles when the body does
        fatigue -= 14 * n * ((me.body - 50) / 200)
        me.tilt = clamp(me.tilt - 10 * n, 0, 100)
        me.mental = clamp(me.mental + 0.3 * n, 0, 100)
        me.body = clamp(me.body + 0.3 * n, 0, 100)
        break
      case 'duel':
        // resolved the moment it was called — only the wear is booked here
        break
    }
  }
  p.fatigue = clamp(p.fatigue + fatigue, 0, 100)
  if (rose.length) {
    const cn: Record<keyof Attrs, string> = {
      aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
      clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥',
    }
    const line = `${rose.map((k) => `${cn[k]} ${p.attrs[k]}`).join('、')} —— 练上去了（综合 ${p.overall}）。`
    notes.push(line)
    pushLog(state, 'train', line)
  }
}
