import { Rng, clamp } from '../rng'
import { defaultContract } from '../types'
import type { GameState, SquadRole } from '../types'
import { expectedSalary } from '../player'
import { recommendedTrainingFocus } from './focus'
import type { Deal } from './types'
import { pushLog } from './log'
import { pop } from './pending'
import { expectOf, tryoutSkill } from './prepro'
import { coachStarters } from './coach'
import { addMoney } from './money'
import { PLAYER_PRIZE_SHARE } from './prizes'
import { inVctLeague } from '../timeline'
import { regionIn } from '../era'

/**
 * A VCT partner club's lowest wage, from the 2023 season: US$50,000 in the
 * Americas, €50,000 in EMEA, ₩67,000,000 in Pacific (Dexerto, 2022-10-31) —
 * all about fifty thousand dollars, which is the one currency this game keeps.
 * China's league has a floor too, but its figure was never published, so no
 * number is made up for it. Rookie deals used to come in at $20–40k, under it.
 */
export const VCT_MIN_SALARY = 50000

export function salaryFloor(state: GameState, teamId: string, salary: number): number {
  const team = state.teams[teamId]
  if (!inVctLeague(state, team) || regionIn(team.region, state.year) === 'China') return salary
  return Math.max(salary, VCT_MIN_SALARY)
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
  const base = expectedSalary(p, team.tier)
  const salary = salaryFloor(state, teamId, Math.round(base * ROLE_PAY[role] * (0.7 + 0.6 * q) * (kind === 'renew' ? 1.05 : 1) / 1000) * 1000)
  const years = team.tier === 1 ? (rng.chance(0.5) ? 2 : 3) : (rng.chance(0.6) ? 1 : 2)
  const signBonus = Math.round(salary * rng.range(0, 0.3) / 500) * 500
  const buyout = Math.round(salary * (team.tier === 1 ? rng.range(4, 8) : rng.range(2, 4)) / 1000) * 1000
  const resume = me.pre.cups.reduce((s, c) => s + c.reached * 1.5 + (c.won ? 2 : 0), 0) + Math.min(me.pre.scoutSeen, 12) * 0.5
  const pro = me.seasons.reduce((s, x) => s + x.starts * 0.15, 0) + me.titles.length * 4
  const leverage = ({ 'A+': 26, A: 18, B: 10, C: 4, D: 0 }[grade] ?? 8) + Math.min(me.fans, 300) * 0.045 +
    me.pre.ladder * 0.05 + resume + pro + me.agentTier * 6
  return {
    id: `deal:${state.year}:${state.day}:${teamId}:${kind}`, teamId, kind, tier: team.tier, role,
    salary, signBonus, years, buyout, asks: [], blown: 0, leverage: Math.round(leverage), grade,
    day: state.day, expires: state.day + DEAL_DAYS, abroad: team.region !== me.region,
  }
}

export interface Ask { key: string; label: string; cost: number; blurb: string; apply: (d: Deal) => void; can: (d: Deal) => boolean }

export const ASKS: Ask[] = [
  { key: 'pay', label: '年薪 +25%', cost: 16, blurb: '最直接的一问。', can: () => true, apply: (d) => { d.salary = Math.round(d.salary * 1.25 / 1000) * 1000 } },
  { key: 'sign', label: '签字费翻倍', cost: 10, blurb: '到手的钱。', can: (d) => d.signBonus > 0, apply: (d) => { d.signBonus *= 2 } },
  { key: 'years', label: '缩短一年', cost: 13, blurb: '早点自由。', can: (d) => d.years > 1, apply: (d) => { d.years -= 1 } },
  { key: 'buyout', label: '违约金 −40%', cost: 14, blurb: '别的队来挖你时更容易成。', can: () => true, apply: (d) => { d.buyout = Math.round(d.buyout * 0.6 / 1000) * 1000 } },
  { key: 'role', label: '承诺首发', cost: 18, blurb: '写进合同的上场时间。', can: (d) => d.role === 'rotation', apply: (d) => { d.role = 'starter'; d.salary = Math.round(d.salary * ROLE_PAY.starter / ROLE_PAY.rotation / 1000) * 1000 } },
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
    return { ok: true, blown: false, text: `他们答应了：${ask.label}。（成功率 ${Math.round(p * 100)}%）` }
  }
  const blow = clamp((n - 1) * 0.24 + (ask.cost - d.leverage) / 70, 0.04, 0.55)
  if (rng.chance(blow)) {
    d.blown++
    if (d.blown >= 2) {
      me.deals = me.deals.filter((x) => x.id !== dealId)
      pop(state, 'deal', dealId)
      me.declined.push(d.teamId)
      pushLog(state, 'bad', `${state.teams[d.teamId]?.name} 撤回了报价：要得太多了。`)
      return { ok: false, blown: true, text: '他们收回了报价。谈崩了。' }
    }
    d.salary = salaryFloor(state, d.teamId, Math.round(d.salary * 0.9 / 1000) * 1000)
    return { ok: false, blown: true, text: `他们不高兴了：年薪反而降到 $${d.salary.toLocaleString()}。再来一次就撤回。（成功率 ${Math.round(p * 100)}%）` }
  }
  return { ok: false, blown: false, text: `他们没答应。（成功率 ${Math.round(p * 100)}%）` }
}

export function declineDeal(state: GameState, dealId: string): string {
  const me = state.me!
  const d = me.deals.find((x) => x.id === dealId)
  if (!d) return '这份报价已经不在了。'
  me.deals = me.deals.filter((x) => x.id !== dealId)
  pop(state, 'deal', dealId)
  if (d.kind === 'renew') {
    pushLog(state, 'info', `你拒绝了 ${state.teams[d.teamId]?.name} 的续约。合同到期后你会成为自由人。`)
    me.flags.refusedRenew = state.year
  } else {
    me.declined.push(d.teamId)
    pushLog(state, 'info', `你拒绝了 ${state.teams[d.teamId]?.name} 的报价。今年他们不会再来。`)
  }
  return '已拒绝。'
}

export function acceptDeal(state: GameState, dealId: string): string {
  const me = state.me!
  const d = me.deals.find((x) => x.id === dealId)
  if (!d) return '这份报价已经不在了。'
  me.deals = me.deals.filter((x) => x.id !== dealId)
  pop(state, 'deal', dealId)
  // a signed deal clears the table
  for (const other of me.deals.slice()) { pop(state, 'deal', other.id) }
  me.deals = []
  if (d.kind === 'renew') {
    applyTerms(state, d)
    me.tenure += 0
    pushLog(state, 'deal', `和 ${state.teams[d.teamId]?.name} 续约 ${d.years} 年，年薪 $${d.salary.toLocaleString()}${d.signBonus ? `，签字费 $${d.signBonus.toLocaleString()}` : ''}。`)
    me.flags.refusedRenew = 0
    return '已续约。'
  }
  joinClub(state, d)
  return `你签进了 ${state.teams[d.teamId]?.name}。`
}

function applyTerms(state: GameState, d: Deal): void {
  const me = state.me!
  const p = state.players[me.id]
  p.salary = d.salary
  p.contractYears = d.years
  p.expiredYear = undefined
  // releaseClause stays 0: the engine sells a man whose clause is met without asking him,
  // and in this game the man is me. The buyout is kept here and read by engine/me/transfer.
  p.contract = { ...defaultContract(d.salary, d.years), signingBonus: d.signBonus, promisedRole: d.role, releaseClause: 0, noPoach: true, bonusShare: PLAYER_PRIZE_SHARE }
  me.flags.buyout = d.buyout
  addMoney(state, 'sign', d.signBonus)
}

/**
 * Off one roster, onto another, with everything that belongs to the old
 * room left behind: the coach's regard, the trial, the bench lock, the duels.
 */
export function joinClub(state: GameState, d: Deal): void {
  const me = state.me!
  const p = state.players[me.id]
  const to = state.teams[d.teamId]
  const from = p.teamId ? state.teams[p.teamId] : null
  if (from) {
    from.roster = from.roster.filter((id) => id !== me.id)
    from.starters = from.starters.filter((id) => id !== me.id)
    if (from.starters.length < 5 && from.id !== to.id) {
      // the old club's five is the engine's business again
      from.starters = from.starters.slice()
    }
    const hist = p.clubHist?.find((h) => h.team === from.id && h.to === state.year)
    if (hist) hist.to = state.year
    if (d.kind === 'transfer' && me.flags.buyout) {
      pushLog(state, 'money', `${to.name} 向 ${from.name} 支付了 $${me.flags.buyout.toLocaleString()} 的违约金。`)
    }
  }
  p.teamId = to.id
  to.roster.push(me.id)
  applyTerms(state, d)
  p.loyalty = 38
  p.joinedYear = state.year
  p.grievance = 0
  ;(p.clubHist ??= []).push({ team: to.id, from: state.year, to: state.year })
  state.myTeam = to.id
  state.finances = { balance: to.budget, log: [] }
  state.offers = state.offers.filter((o) => o.status !== 'pending')
  state.startingSquad = [...to.roster]
  state.training = {}
  for (const id of to.roster) {
    const q = state.players[id]
    if (q) state.training[id] = id === me.id ? 'rest' : recommendedTrainingFocus(q)
  }
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
  me.freeYears = 0
  me.abroad = to.region !== me.region
  me.declined = []
  me.intents = []
  me.pre.invites = []
  me.tryout = undefined
  me.benchedStages = 0
  to.starters = coachStarters(state)
  const where = me.abroad ? `，这是外赛区，${me.flags.lang ? '好在语言不是问题' : '语言会是个问题'}` : ''
  pushLog(state, 'deal', `签约 ${to.name}（${to.tier === 1 ? 'VCT' : 'Challengers'}）：${ROLE_CN[d.role]}，${d.years} 年，年薪 $${d.salary.toLocaleString()}${d.signBonus ? `，签字费 $${d.signBonus.toLocaleString()}` : ''}，违约金 $${d.buyout.toLocaleString()}${where}。`)
  if (to.starters.includes(me.id)) pushLog(state, 'good', '教练看了你的第一次训练，把你放进了首发。')
  else pushLog(state, 'info', `首发是 ${to.starters.map((id) => state.players[id]?.ign).join('、')}，你从替补席开始。`)
}

/** The club lets me go. Back to the market, with a record this time. */
export function leaveClub(state: GameState, why: string): void {
  const me = state.me!
  const p = state.players[me.id]
  const from = p.teamId ? state.teams[p.teamId] : null
  if (from) {
    from.roster = from.roster.filter((id) => id !== me.id)
    from.starters = from.starters.filter((id) => id !== me.id)
  }
  p.teamId = null
  p.contractYears = 0
  p.expiredYear = undefined
  me.phase = 'free'
  me.pre.wasPro = true
  me.pre.year = 1
  me.pre.ladder = Math.max(me.pre.ladder, clamp(45 + (p.overall - 60) * 1.7 - 6, 0, 100))
  me.pre.invites = []
  me.declined = []
  me.tenure = 0
  me.trial = undefined
  me.benchLock = undefined
  me.proven = false
  pushLog(state, 'bad', `${from?.name ?? '俱乐部'}${why}。你成了自由人——在别的队来电话之前，天梯和训练赛是你唯一的舞台。`)
}
