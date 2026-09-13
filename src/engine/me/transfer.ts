import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Player, Team } from '../types'
import { expectedSalary, ratingOf } from '../player'
import { regionIn } from '../era'
import { importBlock } from '../imports'
import { pushLog } from './log'
import { push } from './pending'
import { ROLE_PAY, buyoutDue, makeDeal, leaveClub, salaryFloor } from './contract'
import { gradeOf } from './tryout'
import { INVITE_DAYS, declinedNow, expectOf, tryoutSkill } from './prepro'
import { hasPlace, inVctLeague } from '../timeline'
import { compClass, isIntlComp } from './compclass'
import { compCn } from './compname'
import { leaguePool, seasonBar } from './nights'
import type { Invite } from './types'

/**
 * How the market reads a professional: 破晓's proPerf, on this game's scale.
 * Rating against the level, results, the line I post, what I did without
 * the ball, and what a buyer would have to pay to get me out.
 */
export function proPerf(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  if (!team) return 0
  const level = team.tier === 1 ? 80 : 66
  const season = me.matches.filter((m) => !m.friendly && m.year === state.year)
  const started = season.filter((m) => m.started)
  const wr = season.length ? season.filter((m) => m.won).length / season.length : 0.5
  const rating = started.length ? started.reduce((s, m) => s + m.rating, 0) / started.length : 0.9
  const carries = started.filter((m) => m.carried).length
  const titles = me.titles.filter((t) => t.year === state.year)
  const intl = titles.filter((t) => isIntlComp(t.title)).length
  const regional = titles.length - intl
  let v = (p.overall - level) * 1.2
  v += (wr - 0.5) * 20 * 0.55
  v += (rating - 1.0) * 26
  v += Math.min(carries, 4) * 1.5
  v += regional * 4 + intl * 9
  v += (p.form - 70) * 0.18
  v += Math.min(me.fans, 400) * 0.018
  v -= me.benchedStages * 6
  v += Math.min(me.scrimRounds / 40, 6) * 1.5
  v -= (me.flags.buyout ?? 0) / 50000
  return v
}

export const perfWord = (v: number): string =>
  v >= 15 ? '整个赛区都在看你' : v >= 8 ? '有几家俱乐部在打听' : v >= 3 ? '偶尔有人提到你' : v >= -3 ? '没什么人注意' : '没人问，也不奇怪'

/**
 * The season's transfer windows, by day. The career's own copy of the world's
 * calendar (engine/transfer.ts), so it reads no manager module to know when
 * the market is open.
 */
const TRANSFER_WINDOWS: [number, number][] = [
  [0, 20],    // 季前
  [63, 90],   // the break before Masters I and its Swiss round
  [165, 198], // the break before Masters II and its Swiss round
  [323, 363], // 休赛期
]

export function inWindow(state: GameState): boolean {
  return TRANSFER_WINDOWS.some(([a, b]) => state.day >= a && state.day <= b)
}

/** the two windows a player actually moves in: after Masters I, and the winter */
export const PLAYER_WINDOWS = [TRANSFER_WINDOWS[2], TRANSFER_WINDOWS[3]]
/** a window named by where it sits in the season, not by day numbers */
export const windowLabel = ([a]: [number, number]): string =>
  a === 165 ? '第一赛段结束后（第二站大师赛期间）' : a === 323 ? '休赛期' : a === 63 ? '揭幕赛结束后' : a === 0 ? '季前' : `第 ${a} 天起`

/** the next player window from today: its name, and how many weeks away */
export function nextWindow(state: GameState): { label: string; weeks: number } {
  const day = state.day
  const ahead = PLAYER_WINDOWS.filter(([a]) => a > day).sort((x, y) => x[0] - y[0])[0]
  if (ahead) return { label: windowLabel(ahead), weeks: Math.ceil((ahead[0] - day) / 7) }
  const first = PLAYER_WINDOWS.slice().sort((x, y) => x[0] - y[0])[0]
  return { label: `明年${windowLabel(first)}`, weeks: Math.ceil((first[0] + 364 - day) / 7) }
}

export function windowOpensToday(state: GameState): boolean {
  return PLAYER_WINDOWS.some(([a]) => state.day === a + 1)
}

/** At a stage's end: who was in the stands. */
export function noteScoutInterest(state: GameState, rng: Rng): void {
  const me = state.me!
  if (me.phase !== 'pro') return
  const perf = proPerf(state)
  if (me.playedThisStage > 0 && me.startedThisStage === 0) me.benchedStages++
  me.startedThisStage = 0
  me.playedThisStage = 0
  if (perf < 6) return
  if (!rng.chance(clamp(0.25 + (perf - 6) * 0.05, 0.25, 0.9))) return
  const t = pickBuyer(state, rng)
  if (!t) return
  me.intents.push({ teamId: t.id, day: state.day })
  pushLog(state, 'info', `${t.name} 的教练来看了你的比赛。转会窗开了再说。`)
}

/** Where a buyer plays, in the words an offer uses. */
const leagueWord = (t: Team): string => t.league ?? (t.tier === 1 ? '一线' : '二线')

function pickBuyer(state: GameState, rng: Rng, rut = false): Team | null {
  const me = state.me!
  const p = state.players[me.id]
  const mine = state.teams[state.myTeam]
  // a club with nowhere to play this year is not hiring
  const no = declinedNow(state)
  const pool = Object.values(state.teams).filter((t) => t.id !== state.myTeam && t.roster.length <= 7 && !no.has(t.id)
    && !t.dormant && hasPlace(state, t))
  const fit = rut
    ? pool.filter((t) => t.tier === 2 || t.rating <= mine.rating - 4)
    : pool.filter((t) => expectOf(t) <= p.overall + 4 && (t.tier === 1 || mine.tier === 2))
  if (!fit.length) return null
  const w = fit.map((t) => {
    let v = 10 + Math.max(0, t.rating - mine.rating) * (rut ? 0 : 3) + (t.tier === 1 ? 6 : 0)
    if (foreignLeague(state, t)) v *= me.flags.lang || me.agentTier >= 2 ? 0.12 : 0.015
    else v *= 1.5
    if (me.intents.some((i) => i.teamId === t.id)) v *= 4
    return v
  })
  return rng.weighted(fit, w)
}

/**
 * A club in another league from mine: not my club's league and not my home
 * region's. A 赛区 is a league — VCT EMEA is Europe, Türkiye, CIS and MENA
 * alike, VCT Americas North America, Brazil and LATAM — so a club in the league
 * I play in is never foreign to me, nor one in the league I come from. It used
 * to be read off the club's home country (the author, 2026-09-13: a bug): a
 * Turkish club in a French player's own league weighed 0.015 of a French one,
 * and a man playing outside his home league had every club of it weighed so —
 * 53 of 185 windows at a Challengers club, in sixteen careers, found every VCT
 * club of his league 「foreign」.
 */
function foreignLeague(state: GameState, t: Team): boolean {
  const me = state.me!
  const league = regionIn(t.region, state.year)
  const mine = state.teams[state.myTeam]
  if (mine && regionIn(mine.region, state.year) === league) return false
  return regionIn(me.region, state.year) !== league
}

/* ------------------------------------------------------------------ */
/*  A Challengers man the VCT clubs would start                         */
/* ------------------------------------------------------------------ */

/**
 * A Challengers man who is clearly a VCT starter is signed by a VCT club, not
 * left to win Challengers year after year (the author, 2026-09-13).
 *
 * It used to be pickBuyer's alone, and there a Challengers man is shopped to
 * every Challengers club in the world whose bar he clears as much as to the VCT
 * clubs, and nobody asks whether a VCT club has a place for him. Read over
 * sixteen careers played to the end (seeds 101–116, from the ladder): of 185
 * windows at a Challengers club 22 brought a VCT offer and 92 only Challengers
 * clubs; of 53 in which the market rated him highly and a VCT club of his league
 * had a starter in his job he out-rated, 10 brought one.
 *
 * 破晓's rule for a second-team man is the model (tryout.ts rollProOffers): his
 * way out is the first tier, it comes when a window opens, and a club that has
 * seen enough skips the tryout. Here the window opens on a Challengers man who
 * reads as a VCT starter — his 综合 at his league's median VCT starter less
 * VCT_MARGIN, a Challengers title this year he started as one of his side's
 * best two, or the best season line in his Challengers league — and the VCT
 * clubs of his league that need him come first: one with a starter in his job
 * he out-rates or nobody in it, or one under its five and a sixth with the money
 * for his wage. An offer when he clears the club's bar by a margin, a tryout
 * when he is near it. A buyout still owed is paid out of a budget that has it,
 * however recently he signed; a deal that runs out with the season is free in
 * the winter window. A club he turned down does not come back that year (me/prepro.ts declinedNow).
 */

/** How far under his league's median VCT starter a Challengers man's 综合 can sit and still read as one. */
export const VCT_MARGIN = 2
/** Official starts this season before the VCT clubs read him at all. */
export const VCT_SEEN = 4
/** A VCT club's squad after New Year: a five and a sixth (me/market.ts TOP_SQUAD). Under it a place is open. */
const VCT_SQUAD = 6

/** The VCT clubs of a league: its partners and visitors from 2023, its first tier before. */
function vctClubsOf(state: GameState, league: string): Team[] {
  return Object.values(state.teams).filter((t) => t.tier === 1 && !t.dormant && t.roster.length >= 5 && hasPlace(state, t)
    && (state.year < 2023 || inVctLeague(state, t)) && regionIn(t.region, state.year) === league)
}

/** The median starter at a league's VCT clubs, as the season stands. */
export function vctStarterMedian(state: GameState, league: string): number {
  const os = vctClubsOf(state, league)
    .flatMap((t) => t.starters.map((id) => state.players[id]?.overall ?? 0))
    .filter((o) => o > 0)
    .sort((a, b) => a - b)
  if (!os.length) return 0
  const m = Math.floor(os.length / 2)
  return os.length % 2 ? os[m] : (os[m - 1] + os[m]) / 2
}

/**
 * The best season line in his Challengers league, by rating or by ACS, among the league's players (me/nights.ts
 * leaguePool). A line counts once it has 60% of the median starter's maps — the awards night's bar, the one
 * table both read (me/nights.ts seasonBar).
 */
function bestInLeague(state: GameState, club: Team): boolean {
  const me = state.me!
  const pool = leaguePool(state, club)
  const ids = new Set<string>([me.id])
  for (const t of pool) for (const id of t.roster) ids.add(id)
  const rows = [...ids].map((id) => state.players[id]).filter((q): q is Player => !!q && q.season.rounds > 0)
  const need = seasonBar(state, pool)
  if (rows.length < 6 || need === null) return false
  const field = rows.filter((q) => q.season.maps >= need)
  const mine = field.find((q) => q.id === me.id)
  if (!mine || field.length < 6) return false
  const acs = (q: Player) => q.season.damage / q.season.rounds
  return field.every((q) => ratingOf(q.season) <= ratingOf(mine.season)) || field.every((q) => acs(q) <= acs(mine))
}

/** A title he started as one of his side's best two, by where his ACS ranked over the event's matches. */
function keyStarter(state: GameState, title: string, year: number): boolean {
  const ms = state.me!.matches.filter((m) => !m.friendly && m.year === year && m.comp === title && m.started && m.rank > 0)
  return ms.length > 0 && ms.reduce((s, m) => s + m.rank, 0) / ms.length <= 2
}

export interface VctRead {
  /** his club's league */
  league: string
  /** the median VCT starter in it, and the 综合 that reads as one */
  median: number
  bar: number
  /** why a VCT club would call, if one would */
  by: 'rating' | 'title' | 'results' | null
  title?: string
  /** official starts this season, against VCT_SEEN */
  starts: number
}

/** Where a Challengers man stands against his league's VCT starters: for the window, and the transfer screen. */
export function vctRead(state: GameState): VctRead | null {
  const me = state.me!
  const p = state.players[me.id]
  const club = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  if (!p || !club || club.tier !== 2) return null
  const league = regionIn(club.region, state.year)
  const median = vctStarterMedian(state, league)
  if (!median) return null
  const bar = Math.ceil(median - VCT_MARGIN)
  const read: VctRead = { league, median: Math.round(median), bar, by: null, starts: me.seasonStart.starts }
  if (p.overall >= bar) read.by = 'rating'
  else {
    const t = me.titles.find((x) => x.year === state.year && x.started && compClass(x.title) === 'chal' && keyStarter(state, x.title, x.year))
    if (t) { read.by = 'title'; read.title = t.title }
    else if (bestInLeague(state, club)) read.by = 'results'
  }
  return read
}

export interface VctNeed {
  team: Team
  /** a starter in his job he out-rates, nobody in it, or a place under the club's five and a sixth */
  kind: 'beat' | 'hole' | 'place'
  mate?: Player
  /** the buyout the club would pay (me/contract.ts buyoutDue) */
  fee: number
}

/** The VCT clubs of his league that need him and can pay for him. */
export function vctNeeds(state: GameState, league: string): VctNeed[] {
  const me = state.me!
  const p = state.players[me.id]
  const fee = buyoutDue(state)
  const skill = tryoutSkill(state)
  const no = declinedNow(state)
  const out: VctNeed[] = []
  for (const team of vctClubsOf(state, league)) {
    if (team.id === state.myTeam || no.has(team.id) || importBlock(state, team.id, p)) continue
    // a man this far under the club's bar is not asked (me/auto.ts turns such a tryout down)
    if (skill < expectOf(team) - 6) continue
    // a buyout still owed comes out of the buyer's budget; nothing is owed on a deal that runs out this winter
    if (fee > 0 && team.budget < fee) continue
    const mate = team.starters.map((id) => state.players[id])
      .filter((q): q is Player => !!q && q.id !== me.id && (q.roles ?? [q.role]).includes(p.role))
      .sort((a, b) => a.overall - b.overall)[0]
    if (!mate) { out.push({ team, kind: 'hole', fee }); continue }
    if (p.overall > mate.overall) { out.push({ team, kind: 'beat', mate, fee }); continue }
    const wage = salaryFloor(state, team.id, Math.round(expectedSalary(p, 1) * ROLE_PAY.rotation / 1000) * 1000)
    if (team.roster.length < VCT_SQUAD && team.budget >= fee + wage) out.push({ team, kind: 'place', fee })
  }
  return out
}

/**
 * A player window opens on a Challengers man (me/week.ts): the VCT clubs of his
 * league that need him come first, on a draw of their own, before the market
 * turns over, and the market leaves the job alone while he answers (me/market.ts).
 * Returns how many came; with VCT clubs calling, nobody shops him to the
 * Challengers clubs that window (me/week.ts does not roll rollOffers).
 */
export function vctApproach(state: GameState, rng: Rng): number {
  const me = state.me!
  const read = vctRead(state)
  if (!read?.by || read.starts < VCT_SEEN) return 0
  const needs = vctNeeds(state, read.league)
  if (!needs.length) return 0
  // not every window: a club has its own plans, and results alone convince fewer of them than a rating or a trophy
  const odds = read.by === 'results' ? Math.min(0.85, 0.7 + 0.05 * (needs.length - 1)) : 0.9
  if (!rng.chance(odds)) return 0
  const p = state.players[me.id]
  const count = needs.length > 1 && rng.chance(0.25 + me.agentTier * 0.2) ? 2 : 1
  let pool = needs
  for (let i = 0; i < count; i++) {
    const w = pool.map((x) => {
      let v = 10 + Math.max(0, x.team.rating - 75) + (x.mate ? (p.overall - x.mate.overall) * 4 : x.kind === 'hole' ? 12 : 0)
      if (x.kind === 'place') v *= 0.5
      if (me.intents.some((it) => it.teamId === x.team.id)) v *= 2
      return v
    })
    const pick = rng.weighted(pool, w)
    pool = pool.filter((x) => x !== pick)
    approach(state, read, pick, rng)
  }
  // whoever wrote my name down this season has been answered, one way or the other (rollOffers)
  me.flags.dryWindows = 0
  me.intents = []
  return count
}

/** One VCT club comes: terms on the table when he clears its bar by a margin, a tryout when he is near it. */
function approach(state: GameState, read: VctRead, need: VctNeed, rng: Rng): void {
  const me = state.me!
  const p = state.players[me.id]
  const t = need.team
  const top = state.year >= 2023 ? 'VCT ' : '一线队'
  const why = read.by === 'rating' ? `你的水平已经是${top}首发的样子`
    : read.by === 'title' ? `你是${compCn(read.title ?? '')}冠军队的主力`
    : '你这个赛季的数据是联赛里最好的'
  const room = need.kind === 'beat' ? `他们${p.role}位置上的首发 ${need.mate?.ign} 不如你`
    : need.kind === 'hole' ? `他们缺一个${p.role}`
    : '他们名单上还空着一个位置'
  const pay = need.fee ? `$${need.fee.toLocaleString()} 的违约金他们来付` : '你的合同今年到期，不用付违约金'
  const where = `${t.name}（${leagueWord(t)}）`
  const skill = tryoutSkill(state)
  if (skill >= expectOf(t) + 4 || read.by === 'title') {
    const deal = makeDeal(state, t.id, 'transfer', gradeOf(skill - expectOf(t) + 4), rng)
    // a club that came for a starter says so in the contract (the 承诺首发 ask's terms, me/contract.ts ASKS)
    if (need.kind !== 'place' && deal.role === 'rotation') {
      deal.role = 'starter'
      deal.salary = salaryFloor(state, t.id, Math.round(deal.salary * ROLE_PAY.starter / ROLE_PAY.rotation / 1000) * 1000)
    }
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    pushLog(state, 'deal', `转会窗：${where} 来找你——${why}，${room}。${pay}，直接开了报价。`)
    return
  }
  const inv: Invite = { id: `inv:${state.year}:${state.day}:${t.id}`, teamId: t.id, via: 'scout', day: state.day, expires: state.day + INVITE_DAYS, direct: false }
  me.pre.invites.push(inv)
  push(state, { kind: 'invite', id: inv.id })
  pushLog(state, 'deal', `转会窗：${where} 的教练组看过你这个赛季的比赛，想请你去试训——${why}，${room}。签下来的话${pay}。${INVITE_DAYS} 天内答复。`)
}

/**
 * The window opens: whoever wrote my name down comes with terms, and a bad
 * year still gets a call from somewhere lower. A champion is never left
 * waiting. A player who asked to be listed is answered first.
 */
export function rollOffers(state: GameState, rng: Rng, listed = false): number {
  const me = state.me!
  if (me.phase !== 'pro') return 0
  const perf = proPerf(state)
  const team = state.teams[state.myTeam]
  const benched = !team.starters.includes(me.id)
  // a club does not shop a man who signed this season unless he is rotting on the bench
  if (me.tenure < 1 && !benched && !listed) { me.intents = []; return 0 }
  let p = clamp(0.10 + perf * 0.03 + me.heat / 1500 + Math.min(me.intents.length, 3) * 0.12, 0.02, 0.85)
  if (me.titles.some((t) => t.year === state.year && isIntlComp(t.title))) p = 1
  else if (me.titles.some((t) => t.year === state.year)) p = Math.max(p, 0.96)
  if (perf >= 13 && (me.flags.dryWindows ?? 0) >= 2) p = Math.max(p, 0.92)
  if (listed) p = Math.min(0.97, p * 1.3 + 0.15)
  // a club with no league this year: the market knows its players are free to talk
  const nowhere = !!team && !hasPlace(state, team)
  if (nowhere) p = Math.max(p, 0.6)
  const rut = nowhere || (perf < 3 && (me.benchedStages > 0 || state.teams[state.myTeam]?.tier === 2))
  let n = 0
  const count = rng.chance(p) ? 1 + (rng.chance(0.3 + me.agentTier * 0.2) ? 1 : 0) : 0
  for (let i = 0; i < count; i++) {
    const t = pickBuyer(state, rng, false)
    if (!t) break
    const d = tryoutSkill(state) - expectOf(t)
    const deal = makeDeal(state, t.id, 'transfer', gradeOf(d + 4), rng)
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    pushLog(state, 'deal', `转会窗：${t.name}（${leagueWord(t)}）${foreignLeague(state, t) ? '（外赛区）' : ''} 开价了。`)
    n++
  }
  if (!n && rut && rng.chance(0.26)) {
    const t = pickBuyer(state, rng, true)
    if (t) {
      const deal = makeDeal(state, t.id, 'transfer', 'B', rng)
      deal.role = t.tier === 2 ? 'star' : 'starter'
      me.deals.push(deal)
      push(state, { kind: 'deal', id: deal.id })
      pushLog(state, 'deal', nowhere
        ? `你的俱乐部今年没有联赛可打。${t.name}（${leagueWord(t)}）来问了：那边给首发。`
        : `${t.name}（${leagueWord(t)}）来问了：那边给首发。低谷期的退路，接不接看你。`)
      n++
    }
  }
  me.flags.dryWindows = n ? 0 : (me.flags.dryWindows ?? 0) + 1
  me.intents = []
  return n
}

/** Put myself on the market inside a window. The manager remembers. */
export function listSelf(state: GameState): string {
  const me = state.me!
  if (me.phase !== 'pro') return '你现在没有合同可挂。'
  if (!inWindow(state)) return '转会窗没开，挂牌没人看。'
  if (me.listedYear === state.year) return '今年已经挂过牌了。'
  me.listedYear = state.year
  me.gmTrust = clamp(me.gmTrust - 8, 0, 100)
  const n = rollOffers(state, new Rng(hashStr(`list:${state.seed}:${state.year}:${state.day}`)), true)
  pushLog(state, 'info', `你向经理提出了转会申请，经理不太高兴。${n ? `很快有 ${n} 家来问。` : '暂时没有人接。'}`)
  return n ? `${n} 家俱乐部来问了。` : '暂时没人接。'
}

/**
 * The winter: a club that still rates me offers new terms; one that does not
 * lets the contract run out. The engine's own rule (rating within six of the
 * club, seven in ten) gets the coach's regard and a title added to it.
 */
export function seasonContractCheck(state: GameState, rng: Rng): void {
  const me = state.me!
  if (me.phase !== 'pro') return
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  if (!team) return
  me.tenure++
  if (p.contractYears > 0) return
  const title = me.titles.some((t) => t.year === state.year)
  const keep = title || (me.coachTrust >= 42 && (me.proven || p.overall >= team.rating - 8) && rng.chance(0.85)) || (p.overall >= team.rating - 3)
  if (keep && !me.flags.refusedRenew) {
    const d = tryoutSkill(state) - expectOf(team) + (me.proven ? 6 : 0)
    const deal = makeDeal(state, team.id, 'renew', gradeOf(d), rng)
    if (title) deal.salary = Math.round(deal.salary * 1.15 / 1000) * 1000
    me.deals.push(deal)
    push(state, { kind: 'deal', id: deal.id })
    pushLog(state, 'deal', `合同到期，${team.name} 想续约。`)
    // the contract is held a year only while the answer is pending: signed, the new terms replace it
    // (me/contract.ts applyTerms); refused, I leave on the spot (me/contract.ts renewalGone). A save
    // refused under the old rule played the held year out, and is let go below the next winter.
    p.contractYears = 1
    p.expiredYear = undefined
    me.flags.renewPending = 1
    return
  }
  me.flags.refusedRenew = 0
  leaveClub(state, title ? '没有续约' : '决定不续约')
  push(state, { kind: 'released' })
}
