import { clamp } from '../rng'
import type { GameState } from '../types'
import { HEALTH_LOSS_MUL } from '../player'
import { pushLog } from './log'
import { addMoney } from './money'
import { cny } from './moneyfmt'
import { wageCny } from './paytable'
import { sealWeek } from './undo'
import { seasonLeft } from './outlets'
import { CAMP_MUL } from './bottleneck'
import type { MeAction } from './types'

/**
 * 训练与团队 (2026-09-26). The rule was 「钱买不到实力」; the author's, now: money only speeds reaching a ceiling,
 * or slows a ceiling's fall — it never raises one. Reported, 24 votes: 「花了钱想看到属性涨一点」; measured
 * before (the research of 2026-09-26): an autopilot career sat on ¥5–9 million at 27 with nothing left worth
 * buying, the shop's useful things all bought by 19.
 *
 * Three things a professional really pays for, each priced off the wage (W, a year of it in RMB) so it keeps
 * costing as the career earns:
 *  - 私人教练: my own practice — 枪法训练, 复盘, 道具与跑图 — books COACH_MUL of what it would. 排位 and 训练赛
 *    are not his. Paid a week ahead, every week, max(¥500, W×6%÷52); no contract needed.
 *  - 休赛期训练营: once a year, in the off-season; that week's sessions count CAMP_MUL times toward the break
 *    paths (me/bottleneck.ts campMul). The pool a path can open, MECH_VALUE_MAX, is the same size.
 *  - 康复与体能团队: from 24, a year at a time; from 27 the winter takes HEALTH_LOSS_MUL of the 枪法 and 反应 it
 *    would (engine/training.ts healthCovered), and the ceilings come down by what was really lost.
 * None of them writes a ceiling (scripts/check_shop_budget.ts reads this file for it); scripts/check_buy.ts
 * holds what all of it, the gear's 上手 with it, may add to a career's peak.
 */

/** a year of my wage, RMB (me/paytable.ts); 0 without a contract */
const wage = (state: GameState): number => wageCny(state)
const round1k = (n: number): number => Math.round(n / 1000) * 1000

/* ------------------------------------------------------------------ */
/*  私人教练                                                            */
/* ------------------------------------------------------------------ */

export const COACH_MUL = 1.1
/** the cards that are my own practice; 排位 and 训练赛 are not the coach's */
export const COACH_ACTIONS: readonly MeAction[] = ['aim', 'vod', 'util']
export const COACH_SHARE = 0.06
export const COACH_FLOOR = 500

/** a week of him, on the wage I am on now */
export const coachWeekly = (state: GameState): number => Math.max(COACH_FLOOR, Math.round((wage(state) * COACH_SHARE) / 52))

/** He is mine this week: hired, and the week paid for. */
export const coachOn = (state: GameState): boolean => {
  const me = state.me
  return !!me && !!me.flags.coach && me.flags.coachPaid === me.week
}

/** what this card's session is worth with him, as a multiple (me/growth.ts runAction and hourValues read the same) */
export const coachMul = (state: GameState, key: MeAction): number => (coachOn(state) && COACH_ACTIONS.includes(key) ? COACH_MUL : 1)

export function coachLocked(state: GameState): string | null {
  const me = state.me!
  if (me.phase === 'retired') return '已经退役了'
  if (me.flags.coach) return null
  const fee = coachWeekly(state)
  return me.money < fee ? `还差 ${cny(fee - me.money)}` : null
}

/** Hire him (this week paid now) or let him go (no refund: the week is his). */
export function setCoach(state: GameState, on: boolean): string | null {
  const me = state.me!
  if (!!me.flags.coach === on) return on ? '已经请了。' : '现在没请。'
  if (on) {
    const why = coachLocked(state)
    if (why) return `${why}。`
    sealWeek(state)
    const fee = coachWeekly(state)
    addMoney(state, 'crew', -fee)
    me.flags.coach = 1
    me.flags.coachPaid = me.week
    pushLog(state, 'money', `请了私人教练（每周 ${cny(fee)}）：从这次起，枪法训练、复盘、道具与跑图的收获 ×${COACH_MUL}。`)
  } else {
    sealWeek(state)
    delete me.flags.coach
    delete me.flags.coachPaid
    pushLog(state, 'money', '不再请私人教练了。')
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  休赛期训练营                                                        */
/* ------------------------------------------------------------------ */

export const CAMP_SHARE = 0.08
export const CAMP_FLOOR = 15_000
export const CAMP_CAP = 250_000
export const campPrice = (state: GameState): number => clamp(round1k(wage(state) * CAMP_SHARE), CAMP_FLOOR, CAMP_CAP)
export const inCamp = (state: GameState): boolean => !!state.me && state.me.flags.campWeek === state.me.week

export function campLocked(state: GameState): string | null {
  const me = state.me!
  if (me.phase !== 'pro') return '有了职业合同再说'
  if (me.flags.campYear === state.year) return inCamp(state) ? '这周就在训练营' : '今年去过了'
  const left = seasonLeft(state)
  if (left === 'playing') return '队里这个赛季还有比赛，休赛期才去得了'
  if (left === 'maybe') return '这个赛季还可能打进比赛，等抽签定下来'
  const price = campPrice(state)
  return me.money < price ? `还差 ${cny(price - me.money)}` : null
}

export function goCamp(state: GameState): string | null {
  const why = campLocked(state)
  if (why) return `${why}。`
  const me = state.me!
  sealWeek(state)
  const price = campPrice(state)
  addMoney(state, 'crew', -price)
  me.flags.campYear = state.year
  me.flags.campWeek = me.week
  pushLog(state, 'money', `去了休赛期训练营（${cny(price)}）：这一周练的次数，算进「怎么破」时算 ${CAMP_MUL} 份。`)
  return null
}

/* ------------------------------------------------------------------ */
/*  康复与体能团队                                                      */
/* ------------------------------------------------------------------ */

export const HEALTH_SHARE = 0.10
export const HEALTH_FLOOR = 30_000
export const HEALTH_CAP = 300_000
/** old enough for one to be worth it */
export const HEALTH_AGE = 24
export { HEALTH_LOSS_MUL }
export const healthPrice = (state: GameState): number => clamp(round1k(wage(state) * HEALTH_SHARE), HEALTH_FLOOR, HEALTH_CAP)
/** paid for this year: this year's winter is the one it softens */
export const healthPaid = (state: GameState): boolean => !!state.me && state.me.flags.healthYear === state.year

export function healthLocked(state: GameState): string | null {
  const me = state.me!
  if (me.phase === 'retired') return '已经退役了'
  if (me.flags.healthOn) return null
  if ((state.players[me.id]?.age ?? 0) < HEALTH_AGE) return `${HEALTH_AGE} 岁起才请`
  if (healthPaid(state)) return null
  const price = healthPrice(state)
  return me.money < price ? `还差 ${cny(price - me.money)}` : null
}

/** Sign on for the year (paid now, unless this year is already paid) or stop renewing. */
export function setHealth(state: GameState, on: boolean): string | null {
  const me = state.me!
  if (!!me.flags.healthOn === on) return on ? '已经请了。' : '现在没请。'
  if (on) {
    const why = healthLocked(state)
    if (why) return `${why}。`
    sealWeek(state)
    me.flags.healthOn = 1
    if (!healthPaid(state)) {
      const price = healthPrice(state)
      addMoney(state, 'crew', -price)
      me.flags.healthYear = state.year
      pushLog(state, 'money', `请了康复与体能团队（今年 ${cny(price)}）：27 岁起，每个休赛期枪法、反应少掉两成。`)
    } else pushLog(state, 'money', '康复与体能团队明年接着请。')
  } else {
    sealWeek(state)
    delete me.flags.healthOn
    pushLog(state, 'money', `康复与体能团队明年不续了${healthPaid(state) ? '，今年已经付过的照常管到年底' : ''}。`)
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  the week, the winter, and the autopilot                            */
/* ------------------------------------------------------------------ */

/** A new week has begun (me/week.ts settleWeek): the coach is paid for it, or goes. */
export function crewWeek(state: GameState): void {
  const me = state.me!
  if (!me.flags.coach) return
  const fee = coachWeekly(state)
  if (me.phase === 'retired' || me.money < fee) {
    delete me.flags.coach
    delete me.flags.coachPaid
    if (me.phase !== 'retired') pushLog(state, 'bad', `存款不够付这周的私教费（${cny(fee)}），私人教练先停了。`)
    return
  }
  addMoney(state, 'crew', -fee)
  me.flags.coachPaid = me.week
}

/** The new year (me/week.ts onSeasonEnd, after the winter): the health team is renewed for it, or lapses. */
export function crewSeason(state: GameState): void {
  const me = state.me!
  if (!me.flags.healthOn || healthPaid(state)) return
  const price = healthPrice(state)
  if (me.phase === 'retired' || me.money < price) {
    delete me.flags.healthOn
    if (me.phase !== 'retired') pushLog(state, 'bad', `存款不够续康复与体能团队（${cny(price)}），今年先不请了。`)
    return
  }
  addMoney(state, 'crew', -price)
  me.flags.healthYear = state.year
  pushLog(state, 'money', `康复与体能团队续了一年（${cny(price)}）。`)
}

/** savings a steady player wants behind a year of any of these before paying for it (me/auto.ts autoBuy) */
export const AUTO_CREW_YEARS = 6

/**
 * 托管 pays for these too, so a career on autopilot is not quietly the weaker one (the research, 3.4): the coach
 * once savings are six years of him, the health team from 24 the same way, a camp in the off-season out of six
 * of its price. Nothing else here is a luxury; the luxuries (me/outlets.ts) it never buys.
 */
export function autoCrew(state: GameState): string[] {
  const me = state.me!
  const out: string[] = []
  if (me.phase === 'retired') return out
  if (!me.flags.coach && !coachLocked(state) && me.money >= coachWeekly(state) * 52 * AUTO_CREW_YEARS && !setCoach(state, true)) out.push('请了私人教练')
  if (!me.flags.healthOn && !healthLocked(state) && me.money >= healthPrice(state) * AUTO_CREW_YEARS && !setHealth(state, true)) out.push('请了康复与体能团队')
  if (!campLocked(state) && me.money >= campPrice(state) * AUTO_CREW_YEARS && !goCamp(state)) out.push('去了休赛期训练营')
  return out
}
