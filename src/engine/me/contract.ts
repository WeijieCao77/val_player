import { Rng, clamp } from '../rng'
import { defaultContract } from '../types'
import type { GameState, SquadRole } from '../types'
import { expectedSalary } from '../player'
import type { Deal } from './types'
import { pushLog } from './log'
import { pop, push } from './pending'
import { daysLeft, dealWord } from './aside'
import { awayWord, expectOf, markDeclined, tryoutSkill } from './prepro'
import { coachStarters } from './coach'
import { makeRoom } from './club'
import { iglDrop } from './igl'
import { ensureCaller } from '../world'
import { addMoney } from './money'
import { PLAYER_PRIZE_SHARE } from './prizes'
import { keepInBand, offerOf, payOf, payBand } from './paytable'
import { convert, roundPay, toCny, toUsd } from './currency'
import { money as fmtMoney } from './moneyfmt'
import { dateCn, lockLifts, lockSaid, periodKey, windowAt } from './window'
import { pushMoment } from './moments'
import { standAtLeast, standingOf } from './rank'
import { dropPitch } from './pitchbook'
import { countOffer } from './telemetry'
import { pitchAdmission } from './pitchAdmission'
import { isIntlComp } from './compclass'

/**
 * A wage in a club's own currency kept inside its league's band: the partner
 * leagues' published floors ($50,000 · €50,000 · ₩67,000,000 from 2023; China's
 * ¥30 万 暂定, its figure unpublished), the second tier's monthly floors, and a
 * cap at ten times a floor (me/paytable.ts).
 */
export function salaryFloor(state: GameState, teamId: string, salary: number): number {
  const team = state.teams[teamId]
  return team ? keepInBand(team, state.year, salary) : salary
}

/**
 * What a buyer pays my club to take me now: the buyout written into my deal —
 * except in the winter, when a deal that runs out with the season is free to
 * talk (day 300 on, the winter as me/week.ts reads it).
 */
export function buyoutDue(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  if (me.phase !== 'pro' || !p?.teamId) return 0
  if (state.day >= 300 && p.contractYears <= 1) return 0
  return me.flags.buyout ?? 0
}

/** what each standing pays, against a starter's expected wage */
export const ROLE_PAY: Record<SquadRole, number> = { star: 1.0, starter: 0.8, rotation: 0.55, bench: 0.4 }
export const ROLE_CN: Record<SquadRole, string> = { star: '核心', starter: '首发', rotation: '轮换', bench: '替补' }
export const DEAL_DAYS = 14

/**
 * The terms a club puts down. The grade decides where in the club's range I
 * land; the club's tier decides the range; years and buyout follow the tier.
 */
export function makeDeal(state: GameState, teamId: string, kind: Deal['kind'], grade: string, rng: Rng): Deal {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[teamId]
  const d = tryoutSkill(state) - expectOf(team) + { 'A+': 8, A: 4, B: 0, C: -5, D: -10 }[grade]!
  const q = clamp((d + 10) / 26, 0, 1)
  const role: SquadRole = team.tier === 1
    ? (d >= 8 || (kind !== 'sign' && me.proven) ? 'starter' : 'rotation')
    : (d >= 8 ? 'star' : 'starter')
  // the world's dollar wage, moved to the club's league level and written in its currency (me/paytable.ts)
  const base = expectedSalary(p, team.tier)
  let { cur, salary } = offerOf(team, state.year, base * ROLE_PAY[role] * (0.7 + 0.6 * q) * (kind === 'renew' ? 1.05 : 1))
  // The normal 2026 wage curve stays compressed; sustained international
  // success can justify an exceptional contract, equally on renewal or a move.
  if (state.year >= 2026 && team.tier === 1 && p.overall >= 90 && tryoutSkill(state) >= expectOf(team) + 4) {
    const recent = (year: number) => year >= state.year - 2 && year <= state.year
    const titles = new Set(me.titles.filter(t => t.started && recent(t.year) && isIntlComp(t.title))
      .map(t => `${t.year}:${t.title}`))
    const starts = me.seasons.filter(s => recent(s.year) && s.year < state.year && s.tier === 1)
      .reduce((sum, s) => sum + s.starts, 0)
      + me.matches.filter(m => m.year === state.year && m.started && !m.friendly).length
    if (titles.size >= 3 && starts >= 60) {
      const band = payBand(team.region, team.tier, state.year)
      salary = Math.max(salary, keepInBand(team, state.year, band.cap * 0.8 * ROLE_PAY[role] / ROLE_PAY.starter))
    }
  }
  if (kind === 'renew' && me.phase === 'pro' && state.myTeam === teamId && p.teamId === teamId && team.starters.includes(me.id)) {
    const current = payOf(state)
    if (current && current.tier === team.tier && (p.contract?.promisedRole === 'starter' || p.contract?.promisedRole === 'star') && ROLE_PAY[role] >= ROLE_PAY[p.contract!.promisedRole] && Number.isFinite(current.salary) && current.salary > 0) {
      const protectedSalary = keepInBand(team, state.year, convert(current.salary, current.cur, cur, state.year))
      salary = Math.max(salary, protectedSalary)
    }
  }
  const years = team.tier === 1 ? (rng.chance(0.5) ? 2 : 3) : (rng.chance(0.6) ? 1 : 2)
  const signBonus = roundPay(salary * rng.range(0, 0.3), cur)
  const buyout = roundPay(salary * (team.tier === 1 ? rng.range(4, 8) : rng.range(2, 4)), cur)
  const resume = me.pre.cups.reduce((s, c) => s + c.reached * 1.5 + (c.won ? 2 : 0), 0) + Math.min(me.pre.scoutSeen, 12) * 0.5
  const pro = me.seasons.reduce((s, x) => s + x.starts * 0.15, 0) + me.titles.length * 4
  const leverage = ({ 'A+': 26, A: 18, B: 10, C: 4, D: 0 }[grade] ?? 8) + Math.min(me.fans, 300) * 0.045 +
    standingOf(state) * 0.05 + resume + pro + me.agentTier * 6
  return {
    id: `deal:${state.year}:${state.day}:${teamId}:${kind}`, teamId, kind, tier: team.tier, role, cur,
    salary, signBonus, years, buyout, asks: [], blown: 0, leverage: Math.round(leverage), grade,
    // a move abroad is by country (「出海按国家」); the card's 「外赛区」 or 「国外俱乐部」 is by league (me/prepro.ts awayWord).
    // `year` is the year `day` and `expires` count in: a winter offer runs past the year's last day (me/aside.ts yearOf)
    day: state.day, year: state.year, expires: state.day + DEAL_DAYS, abroad: team.region !== me.region,
  }
}

export interface Ask { key: string; label: string; cost: number; blurb: string; apply: (d: Deal) => void; can: (d: Deal) => boolean }

export const ASKS: Ask[] = [
  { key: 'pay', label: '年薪 +25%', cost: 16, blurb: '最直接的一问。', can: () => true, apply: (d) => { d.salary = roundPay(d.salary * 1.25, d.cur) } },
  { key: 'sign', label: '签字费翻倍', cost: 10, blurb: '到手的钱。', can: (d) => d.signBonus > 0, apply: (d) => { d.signBonus *= 2 } },
  { key: 'years', label: '缩短一年', cost: 13, blurb: '早点自由。', can: (d) => d.years > 1, apply: (d) => { d.years -= 1 } },
  { key: 'buyout', label: '违约金 −40%', cost: 14, blurb: '别的队来挖你时更容易成。', can: () => true, apply: (d) => { d.buyout = roundPay(d.buyout * 0.6, d.cur) } },
  { key: 'role', label: '承诺首发', cost: 18, blurb: '写进合同的上场时间。', can: (d) => d.role === 'rotation', apply: (d) => { d.role = 'starter'; d.salary = roundPay(d.salary * ROLE_PAY.starter / ROLE_PAY.rotation, d.cur) } },
]

/**
 * Push on one term. Odds fall with every ask; a refusal is not the end but a
 * step down — the second refusal is.
 */
export function askDeal(state: GameState, dealId: string, askKey: string, rng: Rng): { ok: boolean; blown: boolean; text: string } {
  const me = state.me!
  const d = me.deals.find((x) => x.id === dealId)
  const ask = ASKS.find((a) => a.key === askKey)
  if (!d || !ask) return { ok: false, blown: false, text: '没有这一项。' }
  if (d.asks.includes(askKey)) return { ok: false, blown: false, text: '这条已经谈过了。' }
  if (!ask.can(d)) return { ok: false, blown: false, text: '这份合同上没这一项可谈。' }
  const n = d.asks.length + 1
  const p = clamp((d.leverage - ask.cost - (n - 1) * 14) / 40 + 0.5, 0.06, 0.93)
  d.asks.push(askKey)
  if (rng.chance(p)) {
    ask.apply(d)
    // a raise still stops at the league's cap
    d.salary = salaryFloor(state, d.teamId, d.salary)
    return { ok: true, blown: false, text: `他们答应了：${ask.label}。（成功率 ${Math.round(p * 100)}%）` }
  }
  const blow = clamp((n - 1) * 0.24 + (ask.cost - d.leverage) / 70, 0.04, 0.55)
  if (rng.chance(blow)) {
    d.blown++
    if (d.blown >= 2) {
      me.deals = me.deals.filter((x) => x.id !== dealId)
      pop(state, 'deal', dealId)
      markDeclined(state, d.teamId)
      pushLog(state, 'bad', `${state.teams[d.teamId]?.name} 撤回了报价：要得太多了。`)
      if (d.kind === 'renew') renewalGone(state, d, '不再续约')
      return { ok: false, blown: true, text: '他们收回了报价。谈崩了。' }
    }
    d.salary = salaryFloor(state, d.teamId, roundPay(d.salary * 0.9, d.cur))
    return { ok: false, blown: true, text: `他们不高兴了：年薪反而降到 ${fmtMoney(d.salary, d.cur, state.year)}。再来一次就撤回。（成功率 ${Math.round(p * 100)}%）` }
  }
  return { ok: false, blown: false, text: `他们没答应。（成功率 ${Math.round(p * 100)}%）` }
}

export function declineDeal(state: GameState, dealId: string): string {
  const me = state.me!
  const d = me.deals.find((x) => x.id === dealId)
  if (!d) return '这份报价已经不在了。'
  countOffer('decline')
  me.deals = me.deals.filter((x) => x.id !== dealId)
  pop(state, 'deal', dealId)
  if (d.kind === 'renew') {
    renewalGone(state, d, '的续约，你没有签')
  } else {
    markDeclined(state, d.teamId)
    pushLog(state, 'info', `你拒绝了 ${state.teams[d.teamId]?.name} 的报价。今年他们不会再来。`)
  }
  return '已拒绝。'
}

/**
 * An offer nobody answered, on the morning after its last day. A card in front of me never ages — the clock does
 * not move while one is up — so this is for the offers set aside on the 转会 page (me/aside.ts): it comes off the
 * table, the club does not come back this year, and the 转会动态 says so. A renewal left to run out goes the way
 * a refused one goes (renewalGone): the contract it was to replace has run out, and I am a free agent — with the
 * 自由人 card of my own to say it, since nobody chose it.
 *
 * `ahead`: the day it is counted from — 0 today, 1 as tomorrow begins (me/week.ts runDays).
 */
export function expireDeals(state: GameState, ahead = 0): void {
  const me = state.me
  if (!me) return
  for (const d of me.deals.slice()) {
    if (daysLeft(state, d) >= ahead) continue
    me.deals = me.deals.filter((x) => x.id !== d.id)
    pop(state, 'deal', d.id)
    countOffer('expire')
    const name = state.teams[d.teamId]?.name ?? '那家俱乐部'
    if (d.kind === 'renew') {
      pushLog(state, 'deal', `${name} 的续约过期了。`)
      const mine = me.phase === 'pro' && state.myTeam === d.teamId
      renewalGone(state, d, '的续约放到过期，你没有签')
      if (mine && me.phase !== 'pro') push(state, { kind: 'released', id: 'lapse' })
    } else {
      markDeclined(state, d.teamId)
      pushLog(state, 'deal', `${name} 的${dealWord(d)}过期了，今年他们不会再来。`)
    }
  }
}

/**
 * A renewal refused, or talked into the ground. The contract it was to replace
 * ran out this winter — that is why it was offered — so I go now, the way any
 * other club's man out of contract goes (engine/season.ts endSeason), and the
 * club does not ask again this year.
 *
 * It used to keep me a season on the year seasonContractCheck lends while the
 * answer is pending (me/transfer.ts): the card after a refusal read 「合同还剩
 * 1 年」, the season was played at the club on it, and the refusal looked like
 * a renewal — 「已经拒绝续约……推动了一个月后又自动续上了」 (reported 2026-09-12).
 */
function renewalGone(state: GameState, d: Deal, why: string): void {
  const me = state.me!
  me.flags.renewPending = 0
  me.flags.refusedRenew = 0
  if (me.phase === 'pro' && state.myTeam === d.teamId) leaveClub(state, why)
  else pushLog(state, 'info', `${state.teams[d.teamId]?.name ?? '俱乐部'}${why}。`)
  // offered at the turn of the year (me/week.ts onSeasonEnd), so 「今年」 is the whole season ahead
  markDeclined(state, d.teamId)
}

export function acceptDeal(state: GameState, dealId: string): string {
  const me = state.me!
  const d = me.deals.find((x) => x.id === dealId)
  if (!d) return '这份报价已经不在了。'
  let selfPitchBenchId: string | undefined
  if (d.selfPitched) {
    const to = state.teams[d.teamId]
    if (!to) return '对方俱乐部已经不在了。'
    const window = windowAt(state, to.id)
    if (!window.open && !window.lock) return '转会窗口已经关闭，暂时不能签约。'
    const admission = pitchAdmission(state, to, {
      fee: buyoutDue(state),
      salaryUsd: toUsd(d.salary, d.cur, state.year),
      signBonusUsd: toUsd(d.signBonus, d.cur, state.year),
    })
    if (admission.reason) {
      return admission.reason
    }
    selfPitchBenchId = admission.replaceId
  }
  countOffer('accept')
  me.deals = me.deals.filter((x) => x.id !== dealId)
  pop(state, 'deal', dealId)
  // a signed deal clears the table
  for (const other of me.deals.slice()) { pop(state, 'deal', other.id) }
  me.deals = []
  if (d.kind === 'renew') {
    // a renewal is the same spell at the same club, so the promise's floor is not handed
    // out again (me/coach.ts PROMISE_FLOOR) — unless the new deal promises a different
    // standing, which is a new promise and gets its own matches to be worth something
    const was = state.players[me.id]?.contract?.promisedRole
    applyTerms(state, d)
    if (was !== d.role) me.promiseMatches = 0
    me.tenure += 0
    pushLog(state, 'deal', `和 ${state.teams[d.teamId]?.name} 续约 ${d.years} 年，年薪 ${fmtMoney(d.salary, d.cur, state.year)}${d.signBonus ? `，签字费 ${fmtMoney(d.signBonus, d.cur, state.year)}` : ''}。`)
    me.flags.refusedRenew = 0
    return '已续约。'
  }
  // a club under a roster lock registers nobody until its event is over — from 2023, and any event after it with no
  // day between (me/window.ts lockLifts): agreed now, made then
  const w = windowAt(state, d.teamId)
  if (w.lock) {
    me.moveAfter = { deal: d, event: w.lock.event, until: w.lock.until, year: state.year }
    // agreed is as good as signed for a 自荐 still waiting on its answer (me/pitchbook.ts)
    dropPitch(state, d.teamId, '谈妥了')
    const to = state.teams[d.teamId]?.name ?? '对方'
    const when = dateCn(lockLifts(state, w), state.year)
    pushLog(state, 'deal', `和 ${to} 谈妥了。${lockSaid(w.lock, w.side === 'other' ? `${to} ` : '你的俱乐部', `名单锁定到 ${when}，锁定解除再正式转会。`)}`)
    return `谈妥了：名单锁定解除（${when}后）正式去 ${to}。`
  }
  const failure = joinClub(state, d, selfPitchBenchId ? { benchId: selfPitchBenchId } : {})
  return failure ?? `你签进了 ${state.teams[d.teamId]?.name}。`
}

/**
 * A move agreed under a roster lock, made the day the lock lifts (me/week.ts, each
 * day) — or, `now`, at the turn of the year, when no event holds anybody. A buyer
 * that has gone quiet since takes nobody.
 */
export function settleMove(state: GameState, now = false): void {
  const me = state.me
  const m = me?.moveAfter
  if (!me || !m) return
  const to = state.teams[m.deal.teamId]
  if (me.phase === 'retired' || !to || to.dormant || state.myTeam === to.id) {
    me.moveAfter = undefined
    if (me.phase !== 'retired' && state.myTeam !== to?.id) pushLog(state, 'bad', `${to?.name ?? '那家俱乐部'} 那边出了变故，谈好的转会没能成行。`)
    return
  }
  const w = now ? null : windowAt(state, to.id)
  if (w?.lock) {
    m.event = w.lock.event
    m.until = w.lock.until
    return
  }
  if (m.deal.selfPitched && w && !w.open) return
  let benchId: string | undefined
  if (m.deal.selfPitched) {
    const admission = pitchAdmission(state, to, {
      fee: buyoutDue(state),
      salaryUsd: toUsd(m.deal.salary, m.deal.cur, state.year),
      signBonusUsd: toUsd(m.deal.signBonus, m.deal.cur, state.year),
    })
    if (admission.reason) {
      me.moveAfter = undefined
      pushLog(state, 'bad', `和 ${to.name} 谈好的自荐签约在生效前被取消：${admission.reason}，名单和预算都不变。`)
      return
    }
    benchId = admission.replaceId
  }
  me.moveAfter = undefined
  pushLog(state, 'deal', `${m.event} 的名单锁定解除了，转会正式生效。`)
  joinClub(state, m.deal, { benchId, seasonTurn: now })
}

function applyTerms(state: GameState, d: Deal): void {
  const me = state.me!
  const p = state.players[me.id]
  const y = state.year
  // the world keeps its books in dollars — my club's wage bill, a buyer's budget — and the career
  // keeps the contract as it was signed, in the club's currency (me/paytable.ts payOf)
  p.salary = Math.round(toUsd(d.salary, d.cur, y) / 1000) * 1000
  p.contractYears = d.years
  p.expiredYear = undefined
  // releaseClause stays 0: the engine sells a man whose clause is met without asking him,
  // and in this game the man is me. The buyout is kept here and read by engine/me/transfer.
  p.contract = { ...defaultContract(p.salary, d.years), signingBonus: toUsd(d.signBonus, d.cur, y), promisedRole: d.role, releaseClause: 0, noPoach: true, bonusShare: PLAYER_PRIZE_SHARE }
  me.pay = { cur: d.cur, salary: d.salary, sign: d.signBonus, buyout: d.buyout, year: y, tier: d.tier }
  me.flags.buyout = toUsd(d.buyout, d.cur, y)
  addMoney(state, 'sign', toCny(d.signBonus, d.cur, y))
}

/**
 * Off one roster, onto another, with everything that belongs to the old
 * room left behind: the coach's regard, the trial, the bench lock, the duels.
 */
export function joinClub(state: GameState, d: Deal, opts: { quiet?: boolean; benchId?: string; seasonTurn?: boolean } = {}): string | null {
  const me = state.me!
  const p = state.players[me.id]
  const to = state.teams[d.teamId]
  // Public entry points also validate: a caller cannot bypass acceptDeal and
  // release a starter or move into a malformed eight-player roster.
  if (d.selfPitched) {
    if (!to) return '对方俱乐部已经不在了。'
    if (!opts.seasonTurn && !windowAt(state, to.id).open) return '转会窗口或名单锁定尚未解除，暂时不能签约。'
    const admission = pitchAdmission(state, to, {
      fee: buyoutDue(state), salaryUsd: toUsd(d.salary, d.cur, state.year),
      signBonusUsd: toUsd(d.signBonus, d.cur, state.year),
    })
    if (admission.reason) return admission.reason
    opts = { ...opts, benchId: admission.replaceId }
  }
  const from = p.teamId ? state.teams[p.teamId] : null
  // the word the offer's card put on the club, read before it is my club (me/prepro.ts awayWord reads my club's league)
  const word = awayWord(state, to)
  if (from) {
    from.roster = from.roster.filter((id) => id !== me.id)
    from.starters = from.starters.filter((id) => id !== me.id)
    // the calls stay at the club I leave, and it names its own caller again (me/igl.ts)
    if (from.id !== to.id) { iglDrop(state, from.id); ensureCaller(state, from.id) }
    if (from.starters.length < 5 && from.id !== to.id) {
      // the old club's five is the engine's business again
      from.starters = from.starters.slice()
    }
    // A club's line is carried to a year at the year's end (engine/season.ts), so a club left during the year still
    // ended the year before: a man who won 2024 at NRG and moved to G2 that winter had NRG 2023–2023 and G2 from 2024,
    // and his 2024 trophy read as G2's (reported 2026-09-24). A year I played in here is a year here. It looked for a
    // line already ending this year and set it to this year, which never changed anything.
    const hist = [...(p.clubHist ?? [])].reverse().find((h) => h.team === from.id)
    if (hist && hist.to < state.year && me.seasonStart.year === state.year && me.seasonStart.matches > 0) hist.to = state.year
    // the buyout still owed, out of the buyer's budget and into the seller's, as the world's own moves pay (me/market.ts)
    const fee = d.kind === 'transfer' && from.id !== to.id ? buyoutDue(state) : 0
    if (fee) {
      // the clubs settle in the world's dollars; the line says it the way my old contract wrote it
      const owed = payOf(state)
      to.budget -= fee
      from.budget += fee
      pushLog(state, 'money', `${to.name} 向 ${from.name} 支付了 ${owed ? fmtMoney(owed.buyout, owed.cur, state.year) : fmtMoney(fee, 'USD', state.year)} 的违约金。`)
    }
  }
  // a club already carrying its registered seven lets its weakest man off the five go to register me (me/club.ts)
  if (!from || from.id !== to.id) makeRoom(state, to, opts.benchId)
  p.teamId = to.id
  to.roster.push(me.id)
  applyTerms(state, d)
  p.loyalty = 38
  p.joinedYear = state.year
  p.grievance = 0
  ;(p.clubHist ??= []).push({ team: to.id, from: state.year, to: state.year })
  state.myTeam = to.id
  // my own programme is my week's (me/growth.ts); the club's is the world's, as at every club
  state.training[me.id] = 'rest'
  me.phase = 'pro'
  me.coachTrust = 50 + (d.role === 'star' ? 12 : d.role === 'starter' ? 6 : 0)
  me.gmTrust = 55
  me.proven = d.role === 'star'
  me.edge = 0
  me.trial = undefined
  me.benchLock = undefined
  me.badStreak = 0
  me.scrimRounds = 0
  me.tenure = 0
  me.startsHere = 0
  me.graceMatches = 0
  // a new spell is a new promise: its floor of matches starts here (me/coach.ts PROMISE_FLOOR)
  me.promiseMatches = 0
  me.flags.promiseLost = 0
  me.flags.promiseWon = 0
  me.freeYears = 0
  me.abroad = to.region !== me.region
  // a club I turned down this year stays away this year, at this club too (me/prepro.ts declinedNow)
  me.intents = []
  // a new contract is a new question: a renewal refused at the last club is not this one's answer
  me.flags.refusedRenew = 0
  me.flags.renewPending = 0
  me.pre.invites = []
  me.tryout = undefined
  // the transfer period I signed in: no club asks me to a tryout again until the next (me/window.ts signedThisPeriod) —
  // a career opening at its club (`quiet`) has signed nothing in play
  if (!opts.quiet) me.flags.signedPeriod = periodKey(state.year, state.day)
  // a 自荐 or a contact still waiting on its answer is called off, with a line unless it was to this club (me/pitchbook.ts)
  dropPitch(state, to.id)
  // and their cards with them: a tryout's card left behind could not be answered or closed (found 2026-09-14)
  me.pending = me.pending.filter((x) => x.kind !== 'invite' && x.kind !== 'tryout')
  me.benchedStages = 0
  to.starters = coachStarters(state)
  // going abroad is by country, the word on the club by league: a club of my league from another country is 「国外俱乐部」
  const where = me.abroad ? `，这是${word || '外赛区'}，${me.flags.lang ? '好在语言不是问题' : '语言会是个问题'}` : ''
  const y = state.year
  pushLog(state, 'deal', `签约 ${to.name}（${to.tier === 1 ? 'VCT' : 'Challengers'}）：${ROLE_CN[d.role]}，${d.years} 年，年薪 ${fmtMoney(d.salary, d.cur, y)}${d.signBonus ? `，签字费 ${fmtMoney(d.signBonus, d.cur, y)}` : ''}，违约金 ${fmtMoney(d.buyout, d.cur, y)}${where}。`)
  if (to.starters.includes(me.id)) pushLog(state, 'good', '教练看了你的第一次训练，把你放进了首发。')
  else pushLog(state, 'info', `首发是 ${to.starters.map((id) => state.players[id]?.ign).join('、')}，你从替补席开始。`)
  // a signing gets its card, the first club of a career said so (me/moments.ts); a career opening at its club does not
  if (!opts.quiet) {
    const first = (p.clubHist?.length ?? 0) <= 1
    pushMoment(state, { kind: 'sign', key: `sign:${y}:${state.day}:${to.id}`, teamId: to.id, fromId: from?.id, first, years: d.years, pay: fmtMoney(d.salary, d.cur, y), role: ROLE_CN[d.role] })
  }
  return null
}

/** The club lets me go. Back to the market, with a record this time. */
export function leaveClub(state: GameState, why: string): void {
  const me = state.me!
  const p = state.players[me.id]
  const from = p.teamId ? state.teams[p.teamId] : null
  if (from) {
    from.roster = from.roster.filter((id) => id !== me.id)
    from.starters = from.starters.filter((id) => id !== me.id)
    // the calls stay behind, and the club names its own caller again (me/igl.ts)
    iglDrop(state, from.id)
    ensureCaller(state, from.id)
  }
  p.teamId = null
  // nobody's club again: the world keeps no club for a free agent
  state.myTeam = ''
  p.contractYears = 0
  p.expiredYear = undefined
  me.phase = 'free'
  me.pre.wasPro = true
  me.pre.year = 1
  // back on the ladder where the skill puts it, less a season off the top — where I stand, a place the board has climbed
  // past counting for what it reads: lifted to that line if it is under, and no RR taken (me/rank.ts standAtLeast)
  standAtLeast(state, clamp(45 + (p.overall - 60) * 1.7 - 6, 0, 100))
  me.pre.invites = []
  // nobody's man any more: no tryout in the period I signed in is a rule for a man under contract (me/window.ts signedThisPeriod)
  me.flags.signedPeriod = 0
  me.tenure = 0
  me.startsHere = 0
  me.graceMatches = 0
  me.promiseMatches = 0
  me.trial = undefined
  me.benchLock = undefined
  me.proven = false
  pushLog(state, 'bad', `${from?.name ?? '俱乐部'}${why}。你成了自由人。天梯照打，等电话。`)
}
