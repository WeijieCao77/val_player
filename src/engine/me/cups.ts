import { Rng, clamp, hashStr } from '../rng'
import { defaultTactics, emptyStats, ROLES } from '../types'
import type { GameState, Player, Role, Team } from '../types'
import { MAPS } from '../content'
import { recomputeOverall } from '../player'
import type { CupRun, PickupMate } from './types'
import { pushLog } from './log'
import { push, pop } from './pending'
import { addMoney } from './money'

/**
 * The amateur calendar: what a player with no club can enter, week by week.
 * The bands are the opponents' ratings; the deeper the run the more likely
 * somebody at a club hears about it (prepro.ts cupInvite).
 */
export interface CupDef {
  key: string
  name: string
  /** week of the year it opens */
  week: number
  fee: number
  rounds: { bo: 1 | 3; label: string }[]
  band: [number, number]
  /** by rounds won */
  prize: number[]
  /** followers needed to be invited; 0 = open */
  minFans: number
  heat: number
  blurb: string
}

export const CUPS: CupDef[] = [
  { key: 'city', name: '城市争霸赛', week: 6, fee: 800, minFans: 0, heat: 6,
    rounds: [{ bo: 1, label: '首轮' }, { bo: 1, label: '八强' }, { bo: 3, label: '四强' }, { bo: 3, label: '决赛' }],
    band: [60, 72], prize: [0, 200, 800, 2000, 5000], blurb: '线下网吧赛，路人车队打路人车队。赢两轮就有人看你。' },
  { key: 'premier', name: '官方业余联赛挑战者组', week: 14, fee: 0, minFans: 0, heat: 10,
    rounds: [{ bo: 3, label: '小组赛' }, { bo: 3, label: '小组赛' }, { bo: 3, label: '半决赛' }, { bo: 3, label: '决赛' }],
    band: [66, 78], prize: [0, 0, 500, 2500, 8000], blurb: '官方业余联赛的最高组，挑战者联赛的俱乐部都在看。' },
  { key: 'streamer', name: '主播杯', week: 26, fee: 0, minFans: 60, heat: 18,
    rounds: [{ bo: 3, label: '八强' }, { bo: 3, label: '四强' }, { bo: 3, label: '决赛' }],
    band: [64, 76], prize: [0, 1000, 3000, 8000], blurb: '邀请制。观众多，队友不一定强。' },
  { key: 'open', name: '秋季公开赛', week: 36, fee: 500, minFans: 0, heat: 8,
    rounds: [{ bo: 1, label: '首轮' }, { bo: 3, label: '八强' }, { bo: 3, label: '四强' }, { bo: 3, label: '决赛' }],
    band: [64, 76], prize: [0, 300, 1200, 3000, 7000], blurb: '转会窗前最后一场公开赛，签约季的敲门砖。' },
  { key: 'allstar', name: '全明星表演赛', week: 44, fee: 0, minFans: 150, heat: 30,
    rounds: [{ bo: 1, label: '表演赛' }],
    band: [72, 82], prize: [0, 3000], blurb: '邀请制，输赢不重要，镜头很多。' },
]

export const cupOf = (key: string): CupDef | undefined => CUPS.find((c) => c.key === key)

const MATE_NAMES = ['Kite', 'Nozomi', 'Vex', 'Aki', 'Bolt', 'Rin', 'Sable', 'Juno', 'Tao', 'Miro', 'Zed', 'Lumi', 'Pako', 'Yui', 'Kuro', 'Neo', 'Sora', 'Ivo', 'Nix', 'Ollie']
const OPP_NAMES = ['网吧联队', '路人王', '深夜车队', '高校联合', '前青训', '夜猫', '老哥们', '主播联队', '钢枪队', '三段位', '业余王朝', '断线重连']

/** A temporary player for a cup: enough of a Player for the match engine, nothing more. */
function tempPlayer(state: GameState, id: string, ign: string, role: Role, overall: number, rng: Rng): Player {
  const model = Object.values(state.players).find((p) => p.role === role && (p.agentPool?.length ?? 0) >= 3)
  const attrs = { aim: 0, reaction: 0, awareness: 0, utility: 0, clutch: 0, teamwork: 0, communication: 0, igl: 0 }
  for (const k of Object.keys(attrs) as (keyof typeof attrs)[]) attrs[k] = clamp(Math.round(overall + rng.norm(0, 5)), 35, 95)
  attrs.igl = Math.min(attrs.igl, 60)
  const p: Player = {
    id, ign, teamId: null, region: state.me!.region, role, roles: [role], age: rng.int(17, 24), isIgl: false,
    attrs, overall: 0, potential: overall, form: 70, morale: 70, fatigue: 20, salary: 0, value: 0, contractYears: 0,
    loyalty: 40, ambition: 50, agentPool: model ? [...model.agentPool] : [], season: emptyStats(), career: emptyStats(),
    injuredUntil: 0, xp: {}, rounds: 2000,
  }
  recomputeOverall(p)
  return p
}

function tempTeam(state: GameState, id: string, name: string, tag: string, roster: string[], rating: number): Team {
  const mapPrefs: Record<string, number> = {}
  for (const m of MAPS) mapPrefs[m] = 50
  return {
    id, name, tag, region: state.me!.region, tier: 2, league: 'cup', rating, budget: 0, reputation: 20,
    roster, starters: roster.slice(0, 5), coach: null, facilities: 40, tactics: defaultTactics(), sponsors: [],
    mapPrefs, seasonPrize: 0, champPoints: 0, igl: null,
  }
}

/** The four I am given for this cup. Their level tracks the cup's band and my own. */
export function makePickupMates(state: GameState, cup: CupDef, rng: Rng): PickupMate[] {
  const me = state.me!
  const p = state.players[me.id]
  const roles: Role[] = ROLES.filter((r) => r !== '自由人' && r !== p.role)
  if (roles.length < 4) roles.push('决斗者')
  const base = (cup.band[0] + cup.band[1]) / 2 - 3
  return roles.slice(0, 4).map((role, i) => ({
    id: `PU${i}`, ign: MATE_NAMES[rng.int(0, MATE_NAMES.length - 1)] + (i + 1), role,
    overall: clamp(Math.round(base + rng.norm(0, 4) + (me.pre.tac - 20) * 0.1), 50, 85),
  }))
}

export const TEMP_MINE = 'CUP_ME'
export const TEMP_OPP = 'CUP_OPP'

/** Stand up both fives in the world for one match, and take them down after. */
export function mountCupMatch(state: GameState, cup: CupDef, round: number, rng: Rng): { bo: 1 | 3; label: string; opp: string } {
  const me = state.me!
  dropTempTeams(state)
  const mates = me.pre.cup!.mates
  const ids: string[] = [me.id]
  for (const m of mates) {
    state.players[m.id] = tempPlayer(state, m.id, m.ign, m.role as Role, m.overall, rng)
    ids.push(m.id)
  }
  state.teams[TEMP_MINE] = tempTeam(state, TEMP_MINE, `${state.players[me.id].ign} 的车队`, 'ME', ids, 60)
  // opponents get stronger every round
  const r = cup.rounds[round]
  const lo = cup.band[0] + (cup.band[1] - cup.band[0]) * (round / Math.max(1, cup.rounds.length - 1))
  const oppIds: string[] = []
  const oppRoles: Role[] = ['决斗者', '先锋', '控场', '哨卫', '决斗者']
  for (let i = 0; i < 5; i++) {
    const id = `OP${i}`
    state.players[id] = tempPlayer(state, id, `${MATE_NAMES[rng.int(0, MATE_NAMES.length - 1)]}`, oppRoles[i], clamp(Math.round(lo + rng.norm(2, 3)), 50, 90), rng)
    oppIds.push(id)
  }
  const name = OPP_NAMES[rng.int(0, OPP_NAMES.length - 1)]
  state.teams[TEMP_OPP] = tempTeam(state, TEMP_OPP, name, name.slice(0, 3), oppIds, Math.round(lo))
  return { bo: r.bo, label: `${cup.name} ${r.label}`, opp: name }
}

export function dropTempTeams(state: GameState): void {
  for (const tid of [TEMP_MINE, TEMP_OPP]) {
    const t = state.teams[tid]
    if (!t) continue
    for (const pid of t.roster) if (pid !== state.me?.id) delete state.players[pid]
    delete state.teams[tid]
  }
}

/** Sign up, pay, meet the four. */
export function enterCup(state: GameState, key: string, rng: Rng): string | null {
  void rng
  const me = state.me!
  const cup = cupOf(key)
  if (!cup) return '没有这项赛事。'
  if (me.pre.cup) return '你已经在打一项赛事了。'
  if (me.money < cup.fee) return `报名费 $${cup.fee}，你的钱不够。`
  if (me.fans < cup.minFans) return `这是邀请赛，要有 ${cup.minFans} 以上的粉丝。`
  addMoney(state, 'fee', -cup.fee)
  me.pre.seen.push(`${state.year}:${key}`)
  me.pre.cup = { key, round: 0, alive: true, mates: makePickupMates(state, cup, rng), results: [] }
  pop(state, 'cup', key)
  pushLog(state, 'cup', `报名了${cup.name}${cup.fee ? `（$${cup.fee}）` : ''}。抽到的队友：${me.pre.cup.mates.map((m) => `${m.ign}（${m.role} ${m.overall}）`).join('、')}。`)
  return null
}

export function skipCup(state: GameState, key: string): void {
  const me = state.me!
  me.pre.seen.push(`${state.year}:${key}`)
  pop(state, 'cup', key)
}

/** After a round: on to the next, or out — and then the prize, the followers and the phone. */
export function afterCupMatch(state: GameState, won: boolean, score: string, rng: Rng): CupRun | null {
  void rng
  const me = state.me!
  const run = me.pre.cup
  if (!run) return null
  const cup = cupOf(run.key)!
  run.results.push(`${cup.rounds[run.round].label} ${won ? '胜' : '负'} ${score}`)
  if (won) run.round++
  const over = !won || run.round >= cup.rounds.length
  if (!over) return null
  dropTempTeams(state)
  const reached = run.round
  const prize = cup.prize[Math.min(reached, cup.prize.length - 1)] ?? 0
  const rec: CupRun = { key: run.key, year: state.year, reached, rounds: cup.rounds.length, won: won && reached >= cup.rounds.length, prize }
  me.pre.cups.push(rec)
  me.pre.cup = undefined
  addMoney(state, 'prize', prize)
  me.heat += cup.heat * (0.4 + reached / cup.rounds.length)
  me.pre.tac = clamp(me.pre.tac + 1.5 + reached, 0, 60)
  const line = rec.won
    ? `${cup.name}冠军！奖金 $${prize}。`
    : `${cup.name}止步${cup.rounds[Math.min(reached, cup.rounds.length - 1)].label}${prize ? `，奖金 $${prize}` : ''}。`
  pushLog(state, rec.won ? 'good' : 'cup', line)
  return rec
}

export const cupRng = (state: GameState, tag: string) =>
  new Rng(hashStr(`cup:${tag}:${state.seed}:${state.year}:${state.day}`))

/** Offer this week's cup, once. */
export function offerCup(state: GameState, key: string): void {
  push(state, { kind: 'cup', id: key })
}
