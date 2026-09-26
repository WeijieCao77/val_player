import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Player, Role, Team } from '../types'
import { squadOf, callerOf } from '../roster'
import { importBlock } from '../imports'
import { expectedSalary } from '../player'
import { ensureMinimumRosters } from '../season'
import { bondBetween, duoBonded } from '../bonds'
import { dateOf, offPool } from '../staffStints'
import { CLUB_CEILING, feeOf, joinRoster, leaveRoster } from './club'
import { isRecentClubDeparture } from './clubDepartures'
import { coachStarters, coachView } from './coach'
import { absentPlayer, activeAbsence } from './absence'
import { sealWeek } from './undo'
import { pushLog } from './log'
import { clubOpen, dateCn, nextPeriodAbs, periodKey, windowBlock } from './window'
import { leagueCurOf } from './currency'
import { worldMoney } from './moneyfmt'
import type { MeMatchRecord } from './types'

/**
 * Two more things a player can say about his club's roster, under the two 破晓 gave us (me/clout.ts), and what
 * all of them leave behind in a year history has the roster for (the author, 2026-09-26).
 *
 *  - 提议补强, to the manager: name a position — never your own — and he goes looking. No 威望 gate: it is the
 *    everyday ask, and a club losing more than it wins is readier to spend (「越输越不能要」 was the complaint,
 *    07ee9b12). Whether anybody fits is known before a point is spent: the button says who is missing and why.
 *  - 推荐替补首发, to the coach: a man on the bench for a starter at his position — never yours. It moves the
 *    five for two matches, not the roster.
 *
 * And the world-line rule for every ask that moves a man (the author: 「类似俱乐部去挖人」, as 破晓's tlIn /
 * tlOut): whoever an ask brings in is pinned to my club — history's rosters never take him back (engine/
 * timeline.ts pinsOf) — and whoever an ask sends away stays away from it. A club he is taken from refills at
 * its own level (engine/season.ts ensureMinimumRosters). 托管 asks for none of it.
 */

const jobsOf = (p: Player): Role[] => p.roles ?? [p.role]
export const FIELD: Role[] = ['决斗者', '先锋', '控场', '哨卫']

export interface Gate { ok: boolean; why?: string }

/* ------------------------------------------------------------------ */
/*  pins                                                               */
/* ------------------------------------------------------------------ */

function pinsHere(state: GameState): { club: string; ids: string[]; out: string[] } {
  const me = state.me!
  if (me.pinned?.club !== state.myTeam) me.pinned = { club: state.myTeam, ids: [], out: [] }
  return me.pinned
}

/** Brought in by my ask: history leaves him at my club. */
export function pinIn(state: GameState, id: string): void {
  const p = pinsHere(state)
  if (!p.ids.includes(id)) p.ids.push(id)
  p.out = p.out.filter((x) => x !== id)
}

/** Sent away by my ask: history does not bring him back to my club. */
export function pinOut(state: GameState, id: string): void {
  const p = pinsHere(state)
  if (!p.out.includes(id)) p.out.push(id)
  p.ids = p.ids.filter((x) => x !== id)
}

export interface Moved { ok: true; fee: number; from?: Team; out?: Player }

/**
 * A man onto my club by my ask — the one move every ask makes (提议补强, 点名要人). From another club, its fee out of
 * my club's budget into his; a full roster sends the weakest man at his position the other way, or onto the free
 * list when he was a free agent. Both are pinned (pinIn, pinOut), and the club he left refills at its level.
 */
export function bringIn(state: GameState, target: Player, team: Team, rng: Rng): Moved | { ok: false; why: string } {
  const me = state.me!
  const seller = target.teamId ? state.teams[target.teamId] : undefined
  const fee = seller ? feeOf(target) : 0
  if (fee > team.budget) return { ok: false, why: '俱乐部出不起这个价。' }
  if (importBlock(state, team.id, target)) return { ok: false, why: '外援名额已满，注册不了。' }
  const full = team.roster.length >= CLUB_CEILING
  const out = full
    ? squadOf(state, team.id).filter((q) => q.id !== me.id && jobsOf(q).includes(target.role)).sort((a, b) => a.overall - b.overall)[0]
    : undefined
  if (full && !out) return { ok: false, why: '名单已满七人，这个位置没有人可以腾出来。' }
  if (out) {
    if (seller) joinRoster(state, out, seller, rng)
    else {
      leaveRoster(state, out, true)
      state.news.push({ year: state.year, day: state.day, kind: 'transfer', text: `${team.name} 与 ${out.ign} 解约，该选手成为自由人。` })
    }
    pinOut(state, out.id)
  }
  joinRoster(state, target, team, rng)
  pinIn(state, target.id)
  if (seller) {
    team.budget -= fee
    seller.budget += fee
    // the club he was taken from fields five again, a man of its own level (engine/season.ts refillPick)
    ensureMinimumRosters(state, rng, new Set([seller.id]))
  }
  return { ok: true, fee, from: seller, out }
}

/* ------------------------------------------------------------------ */
/*  提议补强                                                            */
/* ------------------------------------------------------------------ */

export const REINFORCE_GM = 60
export const REINFORCE_AP = 2
/** a man the manager looks for is at least this much better than the club's starter at that position */
export const REINFORCE_UP = 3
/** a losing season: the manager is readier to spend */
export const REINFORCE_LOSING = 0.45
export const REINFORCE_LOSING_BONUS = 0.15
export const REINFORCE_ODDS = { base: 0.40, min: 0.15, max: 0.80 } as const
/** a no costs this much of the manager's regard: the smallest ask, the smallest cost */
export const REINFORCE_FAIL_GM = 2

/** The club's official record this season, or null before three matches say anything. */
export function seasonWinRate(state: GameState): number | null {
  const me = state.me
  if (!me) return null
  const games = me.matches.filter((m) => !m.friendly && m.year === state.year)
  return games.length >= 3 ? games.filter((m) => m.won).length / games.length : null
}

export function reinforceOdds(state: GameState): number {
  const me = state.me!
  const wr = seasonWinRate(state)
  let p = REINFORCE_ODDS.base + (me.gmTrust - REINFORCE_GM) / 100
  if (wr != null && wr < REINFORCE_LOSING) p += REINFORCE_LOSING_BONUS
  return clamp(p, REINFORCE_ODDS.min, REINFORCE_ODDS.max)
}

/** Why the manager will not hear a 提议补强 today, or ok. Asked before any position. */
export function reinforceGate(state: GameState): Gate {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.teams[state.myTeam]) return { ok: false, why: '你还没有队伍。' }
  const gm = Math.round(me.gmTrust)
  if (gm < REINFORCE_GM) return { ok: false, why: `经理还不够信任你（${gm}/${REINFORCE_GM}）。赛段打出成绩、找经理沟通，都能让他更信你。` }
  if (me.reinforceAsked === periodKey(state.year, state.day)) return { ok: false, why: `这个转会期已经提过，下个转会期（${dateCn(nextPeriodAbs(state), state.year)}起）再说。` }
  if (me.moveAfter) return { ok: false, why: '你已经谈妥了下一家，经理不会再按你的意思补人。' }
  if (activeAbsence(state)) return { ok: false, why: '缺席期间不能找经理谈补强。' }
  const shut = windowBlock(state)
  if (shut) return { ok: false, why: `${shut}。现在签不了人。` }
  if (me.ap < REINFORCE_AP) return { ok: false, why: `本周行动点不够（需 ${REINFORCE_AP}，剩 ${me.ap}）。` }
  return { ok: true }
}

export interface ReinforceOption { role: Role; pick?: Player; fee: number; why?: string }

/**
 * Whom the manager would go for at `role`, or why nobody: a man at that position (his main one) at least
 * REINFORCE_UP better than the club's starter there, a free agent or under contract at a club whose window is
 * open, not at a club of a higher league, within the import limit, that the club can pay — the fee out of what is
 * left after 60% of the wages, the wage as the club's own free-market signing measures it (me/club.ts clubWindow).
 * Of those, the best player for the money he is: level, half his headroom, and a little for his being from the club's 赛区.
 */
export function reinforceFor(state: GameState, role: Role): ReinforceOption {
  const me = state.me!
  const team = state.teams[state.myTeam]
  const mine = state.players[me.id]
  if (role === mine?.role) return { role, fee: 0, why: '这是你自己的位置：首发之争是你和教练的事，经理不会替你找对手。' }
  const bar = team.starters.map((id) => state.players[id])
    .filter((p): p is Player => !!p && p.id !== me.id && jobsOf(p).includes(role))
    .reduce((m, p) => Math.max(m, p.overall), 0)
  const wages = squadOf(state, team.id).reduce((s, p) => s + p.salary, 0)
  const room = team.budget - wages * 0.6
  const cur = leagueCurOf(team.region)
  if (room <= 0) return { role, fee: 0, why: '留出现有阵容的薪水之后，俱乐部没有补强的预算。' }
  const out = new Set(me.pinned?.club === team.id ? me.pinned.out : [])
  const today = dateOf(state.year, state.day)
  const better = Object.values(state.players).filter((p) => p.role === role && !p.retiring && p.id !== me.id
    && p.teamId !== team.id && !(p.teamId ?? '').startsWith('CUP_') && p.overall >= bar + REINFORCE_UP
    && !out.has(p.id) && !isRecentClubDeparture(state, team.id, p.id) && !offPool(p.id, today))
  if (!better.length) return { role, fee: 0, why: `找不到比现在的${role}首发强一截的人。` }
  const legal = better.filter((p) => !importBlock(state, team.id, p))
  if (!legal.length) return { role, fee: 0, why: `比现在强的${role}都要占外援名额，名额已经满了。` }
  const level = legal.filter((p) => { const t = p.teamId ? state.teams[p.teamId] : undefined; return !t || (!t.dormant && t.tier >= team.tier) })
  if (!level.length) return { role, fee: 0, why: `比现在强的${role}都在更高一级联赛的俱乐部，不会过来。` }
  const open = level.filter((p) => clubOpen(state, p.teamId))
  if (!open.length) return { role, fee: 0, why: `比现在强的${role}，所在俱乐部眼下都锁着名单。` }
  const wageCap = Math.min(room, Math.max(40000, room * 0.25))
  const cost = (p: Player) => (p.teamId ? feeOf(p) : 0)
  const afford = open.filter((p) => expectedSalary(p, team.tier) < wageCap && cost(p) + expectedSalary(p, team.tier) <= room)
  if (!afford.length) return { role, fee: 0, why: `比现在强的${role}，俱乐部都出不起（能动用的钱约 ${worldMoney(Math.max(0, room), cur, state.year)}）。` }
  if (team.roster.length >= CLUB_CEILING && !squadOf(state, team.id).some((q) => q.id !== me.id && jobsOf(q).includes(role))) {
    return { role, fee: 0, why: '名单已满七人，这个位置没有人可以腾出来。' }
  }
  // his own 赛区 first, as the club's own refill weighs it (me/club.ts fillSquad): a man from abroad has to be clearly better
  const value = (p: Player) => p.overall + Math.max(0, p.potential - p.overall) * 0.5 + (p.region === team.region ? 4 : 0)
  const pick = afford.sort((a, b) => value(b) - value(a) || Number(!!a.teamId) - Number(!!b.teamId) || (a.id < b.id ? -1 : 1))[0]
  return { role, pick, fee: cost(pick) }
}

/** Every position but mine, each with its man or its reason — the screen greys the ones with a reason. */
export function reinforceOptions(state: GameState): ReinforceOption[] {
  return FIELD.map((r) => reinforceFor(state, r))
}

/** Ask the manager for a man at `role`. Returns the line for the screen. */
export function doReinforce(state: GameState, role: Role): string {
  const gate = reinforceGate(state)
  if (!gate.ok) return gate.why ?? '现在提不了。'
  const me = state.me!
  const team = state.teams[state.myTeam]
  const opt = reinforceFor(state, role)
  if (!opt.pick) return opt.why ?? '经理找不到合适的人。'
  const odds = reinforceOdds(state)
  sealWeek(state)
  me.ap -= REINFORCE_AP
  me.reinforceAsked = periodKey(state.year, state.day)
  const rng = new Rng(hashStr(`recruit:reinforce:${state.seed}:${state.year}:${state.day}:${role}`))
  if (!rng.chance(odds)) {
    me.gmTrust = clamp(me.gmTrust - REINFORCE_FAIL_GM, 0, 100)
    pushLog(state, 'bad', `你向经理提议补强${role}。他想了想：「这个转会期先不动，钱要留着续约。」`)
    return `经理说这个转会期先不动。队伍一直不行的话，自荐、主动接触别家，或者挂牌，是你自己的出路。`
  }
  const pick = opt.pick
  const moved = bringIn(state, pick, team, rng)
  if (!moved.ok) {
    // bringIn asks what reinforceFor already did; a no here is a change since, and the ask is given back
    me.reinforceAsked = undefined
    return moved.why
  }
  const cur = leagueCurOf(team.region)
  const where = moved.from ? `从 ${moved.from.name} 签下` : '签下自由人'
  const money = moved.fee ? `，转会费 ${worldMoney(moved.fee, cur, state.year)}` : ''
  const away = moved.out ? `${moved.out.ign} ${moved.from ? `去了 ${moved.from.name}` : '被放走'}。` : ''
  state.news.push({ year: state.year, day: state.day, kind: 'transfer', important: true,
    text: `${team.name} ${where} ${pick.ign}（${pick.role}）${money}。` })
  const line = `经理按你说的去找了${role}，${where} ${pick.ign}${money}。${away}`
  pushLog(state, 'team', line)
  me.weekNotes.push(line)
  return line
}

/* ------------------------------------------------------------------ */
/*  推荐替补首发                                                        */
/* ------------------------------------------------------------------ */

/** 「信任」, the coach's own threshold (me/coach.ts PROVEN_TRUST) — a literal, not the import: coach.ts and this file import each other's functions, and a value read at load could be read before coach.ts has one */
export const PUSH_TRUST = 66
/** a 认定首发 in the five needs the coach at 「中立」 or better (me/words.ts trustLabel) */
export const PUSH_PROVEN_TRUST = 48
export const PUSH_AP = 1
/** the coach agrees when the man on the bench is at most this far under the starter in his eyes */
export const PUSH_GAP = 3
/** a trial's length, as mine is (me/coach.ts TRIAL_MATCHES) */
export const PUSH_MATCHES = 2
export const PUSH_FAIL_TRUST = 3
export const PUSH_BENCHED_BOND = 8
export const PUSH_SUB_BOND = 8

export function pushGate(state: GameState): Gate {
  const me = state.me
  const team = me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!me || !team) return { ok: false, why: '你还没有队伍。' }
  const push = me.subPush
  if (push && push.club === team.id && !push.kept) {
    return { ok: false, why: `${state.players[push.sub]?.ign ?? '你推荐的人'} 的试用还没打完（还剩 ${push.left} 场）。` }
  }
  const ct = Math.round(me.coachTrust)
  const trusted = ct >= PUSH_TRUST || (me.proven && team.starters.includes(me.id) && ct >= PUSH_PROVEN_TRUST)
  if (!trusted) return { ok: false, why: `教练还不够信任你（${ct}/${PUSH_TRUST}）。到「信任」，或者成了他认定的首发，他才会听你排人。` }
  if ((me.cloutCd?.push ?? 0) > 0) return { ok: false, why: '这个赛段已经推荐过一次，下个赛段再说。' }
  if (activeAbsence(state)) return { ok: false, why: '缺席期间不能找教练谈首发。' }
  if (me.ap < PUSH_AP) return { ok: false, why: `本周行动点不够（需 ${PUSH_AP}，剩 ${me.ap}）。` }
  return { ok: true }
}

export interface PushOption { sub: Player; out?: Player; why?: string }

/**
 * Each man on the bench, and the starter at his position he would take the place of — the one the coach rates
 * lowest, never the caller — or why not: my position, hurt, nobody at his, or too far short in the coach's eyes.
 */
export function pushOptions(state: GameState): PushOption[] {
  const me = state.me!
  const team = state.teams[state.myTeam]
  const mine = state.players[me.id]
  if (!team || !mine) return []
  const caller = callerOf(state, team.id)
  const bench = team.roster.filter((id) => id !== me.id && !team.starters.includes(id))
    .map((id) => state.players[id]).filter((p): p is Player => !!p)
  return bench.map((sub): PushOption => {
    if (sub.role === mine.role) return { sub, why: '和你同一个位置——你自己的位置，靠你自己去争。' }
    if (sub.injuredUntil > state.day || absentPlayer(state, sub.id)) return { sub, why: '他现在上不了场。' }
    const same = team.starters.map((id) => state.players[id])
      .filter((p): p is Player => !!p && p.id !== me.id && p.role === sub.role)
    if (!same.length) return { sub, why: `首发里没有打${sub.role}的人可以换。` }
    const outs = same.filter((p) => p.id !== caller?.id)
    if (!outs.length) return { sub, why: `首发的${sub.role}是队里的指挥，教练不会换下他。` }
    const out = outs.sort((a, b) => coachView(state, a) - coachView(state, b))[0]
    if (coachView(state, sub) < coachView(state, out) - PUSH_GAP) return { sub, out, why: `他比 ${out.ign} 还差一截，教练不会冒这个险。` }
    return { sub, out }
  })
}

/** Recommend a man on the bench for the five. Returns the line for the screen. */
export function doPush(state: GameState, subId: string): string {
  const gate = pushGate(state)
  if (!gate.ok) return gate.why ?? '现在提不了。'
  const me = state.me!
  const team = state.teams[state.myTeam]
  const opt = pushOptions(state).find((o) => o.sub.id === subId)
  if (!opt) return '他不在替补席上。'
  if (opt.why || !opt.out) return opt.why ?? '现在换不了。'
  sealWeek(state)
  me.ap -= PUSH_AP
  me.cloutCd ??= { list: 0, sign: 0 }
  me.cloutCd.push = 1
  me.subPush = { club: team.id, sub: opt.sub.id, out: opt.out.id, left: PUSH_MATCHES, good: 0 }
  // he is benched on my word, and he knows it
  duoBonded(state, me.id, opt.out.id, -PUSH_BENCHED_BOND)
  team.starters = coachStarters(state)
  const line = `你向教练推荐 ${opt.sub.ign} 顶替 ${opt.out.ign} 首发。教练点头：「接下来 ${PUSH_MATCHES} 场正赛让他上。」${opt.out.ign} 知道是你提的。`
  pushLog(state, 'team', line)
  return line
}

/** After each official match of my club: his trial counts the matches he played, and ends as they went. */
export function pushAfterMatch(state: GameState, rec: MeMatchRecord): void {
  const me = state.me
  const push = me?.subPush
  if (!me || !push || push.kept || rec.friendly) return
  const team = state.teams[state.myTeam]
  const sub = state.players[push.sub]
  if (!team || push.club !== team.id || !sub || !team.roster.includes(sub.id)) {
    me.subPush = undefined
    return
  }
  const row = rec.box?.find((r) => r.mine && r.id === sub.id)
  if (!row) return
  const mine = (rec.box ?? []).filter((r) => r.mine).sort((a, b) => b.rating - a.rating)
  const rank = mine.findIndex((r) => r.id === sub.id) + 1
  push.left--
  if (rec.won || (rank > 0 && rank <= 2)) push.good++
  const out = state.players[push.out]?.ign ?? '原来的首发'
  if (push.left > 0) {
    pushLog(state, 'info', `${sub.ign} 的首发试用还剩 ${push.left} 场。`)
    return
  }
  if (push.good > 0) {
    push.kept = true
    duoBonded(state, me.id, sub.id, PUSH_SUB_BOND)
    pushLog(state, 'good', `${sub.ign} 的首发试用打出来了：教练让他首发到这个赛段结束。他记着是你推荐的。`)
    return
  }
  me.coachTrust = clamp(me.coachTrust - PUSH_FAIL_TRUST, 0, 100)
  me.subPush = undefined
  team.starters = coachStarters(state)
  pushLog(state, 'bad', `${sub.ign} 两场都没打出来，教练把 ${out} 换了回来。「下回推荐人，先看准了。」`)
}

/** A stage over: a trial passed held the seat to here, and the coach reads everyone afresh. */
export function subPushStage(state: GameState): void {
  const me = state.me
  if (me?.subPush?.kept) me.subPush = undefined
}

/* ------------------------------------------------------------------ */
/*  former team-mates                                                  */
/* ------------------------------------------------------------------ */

/** 很铁 (engine/bonds.ts bondWord): a former team-mate this close can be named, and helps a 自荐 to his club */
export const MATE_BOND = 45
export const MATE_SIGN_BONUS = 0.10

/** A man I shared a roster with, not on my club now, whom I am still 很铁 with. */
export function closeFormerMate(state: GameState, id: string): boolean {
  const me = state.me
  if (!me || id === me.id || !me.mates?.[id]) return false
  const p = state.players[id]
  if (!p || p.teamId === state.myTeam) return false
  return bondBetween(state, me.id, id) >= MATE_BOND
}
