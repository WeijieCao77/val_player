import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import { pushLog } from './log'
import { push } from './pending'
import { makeDeal, leaveClub } from './contract'
import { gradeOf } from './tryout'
import { expectOf, tryoutSkill } from './prepro'
import { hasPlace } from '../timeline'
import { isIntlComp } from './compclass'

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
  const pool = Object.values(state.teams).filter((t) => t.id !== state.myTeam && t.roster.length <= 7 && !me.declined.includes(t.id)
    && !t.dormant && hasPlace(state, t))
  const fit = rut
    ? pool.filter((t) => t.tier === 2 || t.rating <= mine.rating - 4)
    : pool.filter((t) => expectOf(t) <= p.overall + 4 && (t.tier === 1 || mine.tier === 2))
  if (!fit.length) return null
  const w = fit.map((t) => {
    let v = 10 + Math.max(0, t.rating - mine.rating) * (rut ? 0 : 3) + (t.tier === 1 ? 6 : 0)
    if (t.region !== me.region) v *= me.flags.lang || me.agentTier >= 2 ? 0.12 : 0.015
    else v *= 1.5
    if (me.intents.some((i) => i.teamId === t.id)) v *= 4
    return v
  })
  return rng.weighted(fit, w)
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
    pushLog(state, 'deal', `转会窗：${t.name}（${leagueWord(t)}）${t.region !== me.region ? '（外赛区）' : ''} 开价了。`)
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
