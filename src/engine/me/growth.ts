import { Rng, clamp } from '../rng'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player, Team } from '../types'
import { ceilingOf, recomputeOverall, refreshValue, weightsFor } from '../player'
import { recommendedTrainingFocus } from '../training'
import { ceilingRoom } from './bottleneck'
import { duoBonded } from '../bonds'
import { ACTIONS } from './actions'
import type { MeAction, MeState } from './types'
import { pushLog } from './log'
import { traitMul } from './traits'
import { courseMul, gearTrainMul } from './shop'
import { playRanked } from './prepro'
import { streamIncome } from './stream'
import { questProgress } from './quests'
import { addMoney } from './money'
import { cerRestMul } from './ceremony'
import { injuryTrainMul } from './injury'

/**
 * The same week-of-practice base the club engine uses (training.ts
 * trainPlayer), without the focus: age, condition, mood, coaching, facility
 * and headroom. My own hours are priced against it, so a rookie at a
 * well-coached club grows faster from the same eight points — as he should.
 */
export function gainBase(p: Player, team: Team, rng: Rng): number {
  // with ceilings of his own the headroom is what is left under them (me/bottleneck.ts)
  const headroom = p.caps ? ceilingRoom(p) : p.potential - p.overall
  if (headroom <= 0) return 0
  const coach = ((team.coach?.development ?? 55) - 55) / 100
  const facility = (team.facilities - 55) / 130
  const age = p.age <= 20 ? 1.35 : p.age <= 23 ? 1.1 : p.age <= 26 ? 0.8 : 0.45
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200
  return rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    clamp(headroom / 12, 0.25, 1.6)
}

/**
 * Progress toward a point; a full bar is a point while there is room under the
 * ceiling. At his own ceiling (me/bottleneck.ts) the bar fills and waits — one
 * point banked, the rest of the hours go nowhere — and turns into its point the
 * moment the ceiling moves.
 */
export function addXp(p: Player, k: keyof Attrs, amount: number): boolean {
  if (amount <= 0) return false
  p.xp[k] = (p.xp[k] ?? 0) + amount
  let rose = false
  while ((p.xp[k] ?? 0) >= 100 && (p.caps || p.overall < p.potential) && p.attrs[k] < ceilingOf(p, k)) {
    p.xp[k] = (p.xp[k] ?? 0) - 100
    p.attrs[k] += 1
    rose = true
  }
  if (p.caps && p.attrs[k] >= p.caps[k]) p.xp[k] = Math.min(p.xp[k] ?? 0, 100)
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
  // the coach does not spend the club's hours on an attribute sitting at its
  // ceiling: the next one that session trains, or the heaviest with room
  const open = (k: keyof Attrs) => p.attrs[k] < ceilingOf(p, k)
  let best: keyof Attrs | null = null
  let bestN = 0
  for (const a of ACTIONS) {
    const n = me.plan[a.key] ?? 0
    const k = a.attrs?.find(open)
    if (!k || !n) continue
    if (n > bestN) { bestN = n; best = k }
  }
  if (best) return best
  if ((me.plan.rest ?? 0) >= 2) return 'rest'
  const rec = recommendedTrainingFocus(p)
  if (rec === 'rest' || open(rec)) return rec
  const w = weightsFor(p)
  return ATTR_KEYS.filter((k) => open(k) && (k !== 'igl' || p.isIgl)).sort((a, b) => w[b] - w[a])[0] ?? 'rest'
}

export const tiltDrag = (me: MeState): number => (me.tilt > 55 ? (me.tilt - 55) * 0.04 : 0)

/** Apply the week's plan at the weekly settlement. */
export function settleTraining(state: GameState, rng: Rng, notes: string[]): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!p) return
  const pro = me.phase === 'pro'
  const g = gainBase(p, team ?? { coach: null, facilities: 40 } as Team, rng) * traitMul(me, 'train') * gearTrainMul(me.gear) * (me.flags.trainMul ?? 1)
  const w = weightsFor(p)
  const top3 = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 3)
  let fatigue = 0
  const rose: (keyof Attrs)[] = []
  // hurt: hours into the sore part go almost nowhere, the rest count for less (me/injury.ts)
  const bump = (k: keyof Attrs, amt: number) => { if (addXp(p, k, amt * injuryTrainMul(state, k)) && !rose.includes(k)) rose.push(k) }

  for (const a of ACTIONS) {
    const n = me.plan[a.key] ?? 0
    if (!n) continue
    fatigue += a.fatigue * n
    switch (a.key) {
      case 'aim': case 'vod': case 'util': {
        const split = SPLIT[a.key]!
        const mul = a.key === 'vod' ? courseMul(me.courses, 'review', 1.25) : 1
        // without a club the hours are mine alone: no team practice underneath them
        const alone = pro ? 1 : 1.6
        for (const [k, share] of Object.entries(split) as [keyof Attrs, number][]) {
          bump(k, g * EXTRA * n * share * mul * alone)
        }
        if (a.key === 'vod' && p.isIgl) bump('igl', g * EXTRA * n * 0.25)
        questProgress(state, 'train', n)
        break
      }
      case 'ranked': {
        for (const k of top3) bump(k, g * 0.18 * n)
        p.form = clamp(p.form + 0.8 * n, 30, 99)
        me.tilt = clamp(me.tilt - 3 * n, 0, 100)
        me.body = clamp(me.body + 0.1 * n, 0, 100)
        let w = 0, l = 0
        for (let i = 0; i < n; i++) { const r = playRanked(state, rng); w += r.wins; l += r.losses }
        notes.push(`排位 ${w} 胜 ${l} 负，天梯 ${Math.round(me.pre.ladder)}。`)
        questProgress(state, 'ranked', n)
        break
      }
      case 'content': {
        const income = Math.round((80 + me.fans * 1.2) * n)
        addMoney(state, 'media', income)
        me.heat += 6 * n
        notes.push(`做了 ${n} 期内容，热度涨了，收入 $${income.toLocaleString()}。`)
        break
      }
      case 'scrim':
        me.coachTrust = clamp(me.coachTrust + 2.5 * n * traitMul(me, 'trust') * courseMul(me.courses, 'talk', 1.2), 0, 100)
        questProgress(state, 'scrim', n)
        me.scrimRounds += 40 * n
        bump('teamwork', g * 0.35 * n)
        bump('communication', g * 0.35 * n)
        me.tilt = clamp(me.tilt - 1 * n, 0, 100)
        break
      case 'duo':
        if (me.duoWith && state.players[me.duoWith]?.teamId === state.myTeam) {
          duoBonded(state, me.id, me.duoWith, 3 * n * traitMul(me, 'trust') * courseMul(me.courses, 'talk', 1.3))
          notes.push(`和 ${state.players[me.duoWith].ign} 双排了 ${n} 次，关系近了一点。`)
        }
        bump('communication', g * 0.3 * n)
        break
      case 'stream': {
        let income = 0
        for (let i = 0; i < n; i++) income += streamIncome(state)
        addMoney(state, 'media', income)
        me.heat += 9 * n
        me.stream.total += n
        me.stream.thisStage += n
        notes.push(`直播 ${n} 次，收入 $${income.toLocaleString()}。`)
        questProgress(state, 'stream', n)
        break
      }
      case 'rest':
        // 体质 makes rest worth more; nerve settles when the body does
        fatigue -= 14 * n * ((me.body - 50) / 200)
        fatigue -= 14 * n * (traitMul(me, 'rest') - 1)
        me.tilt = clamp(me.tilt - 10 * n, 0, 100)
        me.mental = clamp(me.mental + 0.3 * n, 0, 100)
        me.body = clamp(me.body + 0.3 * n, 0, 100)
        break
      case 'duel':
        // resolved the moment it was called — only the wear is booked here
        break
    }
  }
  if (me.flags.relax_flat) fatigue -= 3
  // a week passes: the body gets some of it back on its own, more with a
  // better constitution — so an idle week is never a dead week, and a full
  // week of training is a real choice against it
  // 出征仪式的时差：国际赛期间身体回得快一点或慢一点
  fatigue -= clamp(6 + (me.body - 50) / 10, 3, 12) * cerRestMul(state)
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
