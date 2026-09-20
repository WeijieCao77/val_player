import { Rng, clamp, hashStr } from '../rng'
import { ATTR_KEYS } from '../types'
import type { Attrs, GameState, Player, Team } from '../types'
import { ageDrift, ceilingOf, recomputeOverall, refreshValue, weightsFor } from '../player'
import { recommendedTrainingFocus } from './focus'
import { ceilingRoom } from './bottleneck'
import { bondBetween, duoBonded } from '../bonds'
import { squadOf } from '../roster'
import { ACTIONS, ACTION_BY_KEY } from './actions'
import type { MeAction, MeState } from './types'
import { pushLog } from './log'
import { traitMul } from './traits'
import { FLAT_RELIEF, RELIEF_FLOOR, courseMul, psychMul } from './shop'
import { ladderLabel, playRanked } from './prepro'
import { contentGross, payMedia, streamIncome, streamWeekMul, streamerHeatMul } from './stream'
import { questProgress } from './quests'
import { addMoney } from './money'
import { cny } from './moneyfmt'
import { cerRestMul } from './ceremony'
import { injuryTrainMul } from './injury'

/** How much a week of practice is worth at this age; me/life.ts says the year it drops. */
export const trainAgeMul = (age: number): number => (age <= 20 ? 1.35 : age <= 23 ? 1.1 : age <= 26 ? 0.8 : 0.45)

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
  const age = trainAgeMul(p.age)
  const tired = p.fatigue > 70 ? 0.5 : p.fatigue > 45 ? 0.8 : 1
  const motivated = 0.75 + p.morale / 200
  // a player with ceilings of his own trains each attribute against its own room (roomMul, where the hours land)
  return rng.range(7, 16) * age * tired * motivated * (1 + coach + facility) *
    (p.caps ? 1 : clamp(headroom / 12, 0.25, 1.6))
}

/** Room under a ceiling at which an hour is worth a full hour, in points.
 * Player-only pacing: soften the middle of the slowdown, without changing
 * ceilings, the final two-point floor, or the 1.3 maximum. Club/NPC training
 * has its own formula. This constant is read on each action, not saved.
 */
const ROOM_SCALE = 8
/** and the most an attribute far under its ceiling makes of one */
const ROOM_TOP = 1.3

/**
 * 破晓's gain(d): each attribute trains against its own room under its own
 * ceiling. It was the whole player's weighted room, so once a duelist's 枪法 and
 * 反应 sat at their ceilings every hour slowed to a quarter — the 沟通 thirty
 * points under its ceiling as much as the 枪法 at it — and a player who worked
 * at everything stopped where one who did not stopped (reported 2026-09-12:
 * 「不管怎么训练综合实力也就到89没法再高了」).
 */
export const roomMul = (p: Player, k: keyof Attrs): number =>
  clamp((ceilingOf(p, k) - p.attrs[k]) / ROOM_SCALE, 0.25, ROOM_TOP)

/**
 * Progress toward a point; a full bar is a point while there is room under the
 * ceiling. At his own ceiling (me/bottleneck.ts) the bar stays empty: the hours
 * there count toward breaking it, and nothing is stored to land when it moves.
 * Until 2026-09-14 they banked up to three points (300 xp), which filled
 * the new ceiling the moment it opened, so a break could not be seen (reported:
 * 「我都在突破瓶颈了有什么能存的，把这个存点数的功能去掉」).
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
  if (p.caps && p.attrs[k] >= p.caps[k]) p.xp[k] = 0
  if (rose) {
    recomputeOverall(p)
    refreshValue(p)
  }
  return rose
}

/**
 * The winter's ageing, for the 我的 page: from 27 the hands go first
 * (engine/training.ts seasonRollover: |ageDrift| / 2 a year that an attribute
 * is hit, by 0–2 for 枪法 and 反应, so a real slip two times in three). In words;
 * the chances only when the 数值 switch is on.
 */
export function ageNote(age: number, nums: boolean): string | null {
  if (age < 25) return null
  const words = age < 27
    ? '27 岁起，每个休赛期枪法和反应可能掉一两点，越往后越容易掉；意识还会随经验涨。'
    : `${age} 岁了：每个休赛期枪法和反应可能掉一两点，越往后越容易掉；意识还会随经验涨。`
  if (!nums) return words
  const slip = (a: number) => Math.round(Math.min(1, Math.abs(ageDrift({ age: a } as Player)) * 0.5) * 200 / 3)
  return `${words}（枪法、反应每个休赛期掉点的机会：27–28 岁约 ${slip(27)}%，29–30 岁约 ${slip(29)}%，31 岁起约 ${slip(31)}%。）`
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
 * 复盘 puts this share of an hour into 指挥 on top of 意识 and 残局, and the man
 * who calls twice that (decided 2026-09-14). It went to a caller only, at 0.25,
 * which left the career player's 指挥 where he started: now that his coach can
 * name him caller (me/igl.ts), 指挥 has to be able to grow before he is.
 */
export const IGL_STUDY = 0.35
export const IGL_CALL_STUDY = 0.5

/** what ranked puts into each of the role's three heaviest attributes, per game night, of a training week (runAction) */
const RANKED_SHARE = 0.18
/** and a scrim into 协同 and 沟通 */
const SCRIM_SHARE = 0.35

export interface HourValue {
  key: MeAction
  /** 综合 per action point, in units of a training week: the attributes it trains, by the role's weights, where they still have room */
  perPoint: number
  /** the attributes that hour still moves */
  attrs: (keyof Attrs)[]
}

/**
 * What an action point of each practice is worth to 综合 right now — the same
 * sums runAction books, weighted by what the role is judged on, counting
 * only attributes under their ceilings. The week board says which is worth the
 * most; the steady plan does not follow it, a player chasing his peak can.
 */
export function hourValues(state: GameState): HourValue[] {
  const me = state.me!
  const p = state.players[me.id]
  const pro = me.phase === 'pro'
  const w = weightsFor(p)
  const open = (k: keyof Attrs) => p.attrs[k] < ceilingOf(p, k)
  // what an hour on k is worth: the role's weight, where the hours land (roomMul)
  const worth = (k: keyof Attrs) => w[k] * (p.caps ? roomMul(p, k) : 1)
  const out: HourValue[] = []
  for (const key of ['aim', 'vod', 'util'] as const) {
    const split = SPLIT[key]!
    const mul = EXTRA * (pro ? 1 : 1.6)
    const attrs = (Object.keys(split) as (keyof Attrs)[]).filter(open)
    let v = attrs.reduce((s, k) => s + (split[k] ?? 0) * worth(k), 0) * mul
    if (key === 'vod' && open('igl')) { v += (p.isIgl ? IGL_CALL_STUDY : IGL_STUDY) * EXTRA * worth('igl'); attrs.push('igl') }
    out.push({ key, perPoint: v / ACTIONS.find((a) => a.key === key)!.cost, attrs })
  }
  const top3 = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 3).filter(open)
  out.push({ key: 'ranked', perPoint: RANKED_SHARE * top3.reduce((s, k) => s + worth(k), 0), attrs: top3 })
  if (pro) {
    const both = (['teamwork', 'communication'] as const).filter(open)
    out.push({ key: 'scrim', perPoint: SCRIM_SHARE * both.reduce((s, k) => s + worth(k), 0) / 3, attrs: [...both] })
  }
  return out.filter((h) => h.perPoint > 0).sort((a, b) => b.perPoint - a.perPoint)
}

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

/** tilt above 55 drags on the calls; 运动心理 takes a fifth off it (me/shop.ts) */
export const tiltDrag = (me: MeState): number => (me.tilt > 55 ? (me.tilt - 55) * 0.04 * psychMul(me.courses ?? []) : 0)

/**
 * This week's training base (gainBase), rolled once and kept.
 *
 * It used to be rolled at the weekly settlement, where one roll covered the
 * whole week's plan. A card now resolves the moment it is clicked
 * (me/week.ts doAction), so it is rolled at the week's first session and every
 * session of that week is worth exactly that much — otherwise a week's
 * practice would be worth less the more of it you did, because each session's
 * own fatigue would be reading back into the next one's base.
 *
 * The seed is the one the settlement used: this week's seventh day. The state
 * it reads is the week's as it stands at that first session rather than at the
 * settlement, so a week whose matches push fatigue past 45 or 70 is worth a
 * little more than it would have been (me/week.ts, 2026-09-19).
 */
export function weekGain(state: GameState): number {
  const me = state.me!
  if (me.trainWeek && me.trainWeek.week === me.week) return me.trainWeek.g
  const p = state.players[me.id]
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const end = state.day - me.weekDay + 7
  const rng = new Rng(hashStr(`me:${state.seed}:${state.year}:${end}`))
  const g = gainBase(p, team ?? { coach: null, facilities: 40 } as Team, rng) * traitMul(me, 'train') * (me.flags.trainMul ?? 1)
  me.trainWeek = { week: me.week, g }
  return g
}

/**
 * Who a 双排 goes to when nobody was picked: the team-mate at my club I get on
 * worst with, which is who the steady plan picks too (me/auto.ts). An evening
 * is played the moment it is clicked now, so a card clicked with the picker
 * left empty has to go to somebody — and this is the somebody it is worth
 * going to.
 */
export function duoMate(state: GameState): Player | undefined {
  const me = state.me!
  if (me.phase !== 'pro' || !state.myTeam) return undefined
  return squadOf(state, state.myTeam)
    .filter((x) => x.id !== me.id)
    .sort((a, b) => bondBetween(state, me.id, a.id) - bondBetween(state, me.id, b.id))[0]
}

const ROSE_CN: Record<keyof Attrs, string> = {
  aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
  clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥',
}

/**
 * One session of a week-board action, resolved on the click: what it gives,
 * what it costs the body, and the one line that says so.
 *
 * The author, 2026-09-19: 「玩家们表示都不喜欢每周的行动点了之后不执行要等点
 * 下一周才会统一执行这个方式，希望改成破晓那样点击就直接执行。」 破晓 does
 * exactly this — doTrain/doAction write the attributes, the money and the
 * fatigue and return — so this is that function, with our own two budgets in
 * front of it (me/week.ts actionBlock). me.plan has already counted this
 * session when this runs, so `me.plan[key] − 1` is which one of the week it is:
 * the second stream of a week is worth less than the first, as it always was.
 *
 * The draw has its own seed per session, so a save and the same clicks in the
 * same order play out the same way — 破晓's own guarantee (rng.ts:「同一份存档、
 * 同样的操作，结果一样」).
 */
export function runAction(state: GameState, key: MeAction): string {
  const me = state.me!
  const p = state.players[me.id]
  const def = ACTION_BY_KEY[key]
  const pro = me.phase === 'pro'
  // which one of the week this is, counting from zero
  const i = Math.max(0, (me.plan[key] ?? 1) - 1)
  const rng = new Rng(hashStr(`act:${state.seed}:${state.year}:${state.day}:${key}:${i}`))
  const was = Math.round(100 - p.fatigue)
  const g = weekGain(state)
  const w = weightsFor(p)
  const rose: (keyof Attrs)[] = []
  // hurt: hours into the sore part go almost nowhere, the rest count for less (me/injury.ts)
  const bump = (k: keyof Attrs, amt: number) => { if (addXp(p, k, amt * injuryTrainMul(state, k) * (p.caps ? roomMul(p, k) : 1)) && !rose.includes(k)) rose.push(k) }
  let fatigue = def.fatigue
  let line = ''
  switch (key) {
    case 'aim': case 'vod': case 'util': {
      const split = SPLIT[key]!
      // without a club the hours are mine alone: no team practice underneath them
      const alone = pro ? 1 : 1.6
      for (const [k, share] of Object.entries(split) as [keyof Attrs, number][]) bump(k, g * EXTRA * share * alone)
      // and 指挥 on top, twice as fast for the man who calls (IGL_STUDY)
      if (key === 'vod') bump('igl', g * EXTRA * (p.isIgl ? IGL_CALL_STUDY : IGL_STUDY))
      // 复盘方法 (me/shop.ts): a loss looked at properly is a loss put down; the hours train what they always did
      if (key === 'vod' && me.courses.includes('review')) me.tilt = clamp(me.tilt - 2, 0, 100)
      questProgress(state, 'train', 1)
      line = `练了一次${def.label}。`
      break
    }
    case 'ranked': {
      const top3 = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a]).slice(0, 3)
      for (const k of top3) bump(k, g * RANKED_SHARE)
      p.form = clamp(p.form + 0.8, 30, 99)
      me.tilt = clamp(me.tilt - 3, 0, 100)
      me.body = clamp(me.body + 0.1, 0, 100)
      const r = playRanked(state, rng)
      line = `排位 ${r.wins} 胜 ${r.losses} 负，${ladderLabel(state)}。`
      questProgress(state, 'ranked', 1)
      break
    }
    case 'content': {
      const { got, capped } = payMedia(state, contentGross(state, 1))
      addMoney(state, 'media', got)
      me.heat += 6
      line = `做了一期内容，热度涨了，收入 ${cny(got)}。${capped ? MEDIA_CAP_CN : ''}`
      break
    }
    case 'scrim':
      me.coachTrust = clamp(me.coachTrust + 2.5 * traitMul(me, 'trust') * courseMul(me.courses, 'talk', 1.2), 0, 100)
      questProgress(state, 'scrim', 1)
      me.scrimRounds += 40
      bump('teamwork', g * SCRIM_SHARE)
      bump('communication', g * SCRIM_SHARE)
      me.tilt = clamp(me.tilt - 1, 0, 100)
      line = '跟队打了一次训练赛，教练看在眼里。'
      break
    case 'duo':
      // nobody picked, or the man has left: the evening goes to whoever I get on worst with
      if (!me.duoWith || state.players[me.duoWith]?.teamId !== state.myTeam) me.duoWith = duoMate(state)?.id
      if (me.duoWith && state.players[me.duoWith]?.teamId === state.myTeam) {
        duoBonded(state, me.id, me.duoWith, 3 * traitMul(me, 'trust') * courseMul(me.courses, 'talk', 1.3))
        line = `和 ${state.players[me.duoWith].ign} 双排了一次，关系近了一点。`
      } else line = '双排了一次。'
      bump('communication', g * 0.3)
      break
    case 'stream': {
      // the same people watch every stream in a week: the second is worth less than the first (STREAM_WEEK_MUL)
      const { got, capped } = payMedia(state, streamIncome(state, streamWeekMul(i)))
      addMoney(state, 'media', got)
      // 小主播's room was there before the career was: it pays more and talks faster (me/stream.ts)
      me.heat += 9 * streamerHeatMul(state)
      me.stream.total += 1
      me.stream.thisStage += 1
      line = `直播了一次，收入 ${cny(got)}${i > 0 ? '（这周看的是同一批人，礼物少一些）' : ''}。${capped ? MEDIA_CAP_CN : ''}`
      questProgress(state, 'stream', 1)
      break
    }
    case 'rest':
      // 体质 makes rest worth more; nerve settles when the body does
      fatigue -= 14 * ((me.body - 50) / 200)
      fatigue -= 14 * (traitMul(me, 'rest') - 1)
      me.tilt = clamp(me.tilt - 10, 0, 100)
      me.mental = clamp(me.mental + 0.3, 0, 100)
      me.body = clamp(me.body + 0.3, 0, 100)
      line = '休息了一会儿。'
      break
    // played out the moment it is called, with its own wear (me/duel.ts startDuel)
    case 'duel': return ''
  }
  p.fatigue = clamp(p.fatigue + fatigue, 0, 100)
  if (rose.length) {
    const up = `${rose.map((k) => ROSE_CN[k]).join('、')}练上去了。`
    line += up
    pushLog(state, 'train', up)
  }
  return `${line}体力 ${was} → ${Math.round(100 - p.fatigue)}。`
}

/** said once, on the session that runs past the platform's weekly settlement (me/stream.ts) */
const MEDIA_CAP_CN = '这周直播和内容挣的钱超过了平台按你工资结算的额度，超出的部分只结了一成。'

/**
 * The week's own share of the body, at the settlement: what a week gives back
 * by itself, more with a better constitution — so an idle week is never a dead
 * week, and a full week of training is a real choice against it. The hours
 * themselves were booked as they were clicked (runAction).
 */
export function settleBody(state: GameState): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  if (!p) return
  // 出征仪式的时差：国际赛期间身体回得快一点或慢一点
  p.fatigue = clamp(p.fatigue - clamp(6 + (me.body - 50) / 10, 3, 12) * cerRestMul(state), 0, 100)
  // the flat's better sleep (me/shop.ts): a hard week given back faster, down to RELIEF_FLOOR and no further
  if (me.flags.relax_flat && p.fatigue > RELIEF_FLOOR) p.fatigue = Math.max(RELIEF_FLOOR, p.fatigue - FLAT_RELIEF)
}
