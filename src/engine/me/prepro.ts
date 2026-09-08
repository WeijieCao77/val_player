import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import type { CupRun, Invite } from './types'
import { pushLog } from './log'
import { push } from './pending'
import { CUPS } from './cups'

export const AP_PRE = 12
/** the earliest a club will pick up the phone, in weeks of the first year */
export const PRE_EARLIEST = 12
export const INVITE_DAYS = 21

/** Where a player of this rating settles on the ladder, 0-100. */
export const skillToLadder = (overall: number): number => clamp(45 + (overall - 60) * 1.7, 0, 100)

/**
 * The real ladder, in the names the CN client uses: 铂金 / 钻石 / 超凡 / 神话
 * each split into 1–3, then 赋能 with a leaderboard rank once inside the top
 * 500. Bands below 赋能 carry `sub: 3`; the tier function turns 44.5 into 神话1.
 */
export const LADDER_TIERS: { at: number; name: string; k: string; sub?: number }[] = [
  { at: 92, name: '赋能第一梯队', k: 'top' },
  { at: 82, name: '赋能前 10', k: 'top10' },
  { at: 72, name: '赋能前 100', k: 'top100' },
  { at: 62, name: '赋能前 500', k: 'top500' },
  { at: 52, name: '赋能', k: 'radiant' },
  { at: 42, name: '神话', k: 'immortal', sub: 3 },
  { at: 30, name: '超凡', k: 'ascendant', sub: 3 },
  { at: 16, name: '钻石', k: 'diamond', sub: 3 },
  { at: 0, name: '铂金', k: 'platinum', sub: 3 },
]

export function ladderTier(l: number): { name: string; k: string } {
  const i = LADDER_TIERS.findIndex((t) => l >= t.at)
  const t = LADDER_TIERS[i < 0 ? LADDER_TIERS.length - 1 : i]
  if (!t.sub) return { name: t.name, k: t.k }
  const top = i > 0 ? LADDER_TIERS[i - 1].at : 100
  const n = clamp(1 + Math.floor((t.sub * (l - t.at)) / (top - t.at)), 1, t.sub)
  return { name: `${t.name}${n}`, k: t.k }
}

/** The line the HUD shows: tier, and a rank number once inside the top 500. */
export function ladderLabel(l: number): string {
  if (l >= 96) return '国服第一'
  if (l >= 62) {
    const rank = Math.max(2, Math.round(500 * Math.pow((100 - l) / 38, 2.2)))
    return `赋能 第 ${rank}`
  }
  return ladderTier(l).name
}

/** One action point of ranked: six games against the ladder's own pull. */
export function playRanked(state: GameState, rng: Rng): { wins: number; losses: number; delta: number } {
  const me = state.me!
  const p = state.players[me.id]
  const target = skillToLadder(p.overall + (p.form - 70) * 0.15 - Math.max(0, p.fatigue - 50) * 0.08)
  let wins = 0
  let losses = 0
  let delta = 0
  for (let g = 0; g < 6; g++) {
    const l = me.pre.ladder
    const pw = clamp(0.5 + (target - l) / 60, 0.2, 0.8)
    // the climb slows near the top and losing costs a little less than winning pays
    const step = clamp(2.2 - l * 0.012, 0.9, 2.2)
    if (rng.chance(pw)) { wins++; delta += step } else { losses++; delta -= step * 0.82 }
  }
  me.pre.ladder = clamp(me.pre.ladder + delta, 0, 100)
  me.pre.ladderPeak = Math.max(me.pre.ladderPeak, me.pre.ladder)
  return { wins, losses, delta }
}

/** A week without ranked leaks a little toward where the skill says it should sit. */
export function ladderWeekly(state: GameState, played: boolean): void {
  const me = state.me!
  const p = state.players[me.id]
  const target = skillToLadder(p.overall)
  if (!played) me.pre.ladder = clamp(me.pre.ladder + (target - me.pre.ladder) * 0.06 - 0.4, 0, 100)
}

/** What a club's people see when they look at me: the eight, plus what a five taught me, plus the ladder. */
export function tryoutSkill(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  return p.overall + me.pre.tac * 0.15 + me.pre.ladder * 0.05
}

/** What this club expects of a signing: a bench place at a VCT side, a starter at a Challengers one. */
/**
 * What a club wants to see before it signs me. A Challengers side asks for a
 * little more than its own level — nobody signs a rookie to be exactly as
 * good as the bench — so a day-one player (about 60) is under every bar and
 * has a season of climbing in front of him.
 */
export function expectOf(team: Team): number {
  return team.tier === 1 ? team.rating - 2 : team.rating + 1
}

export const CLUB_TIER_CN = (team: Team): string =>
  team.tier === 2 ? 'Challengers' : team.rating >= 86 ? '豪门' : team.rating >= 79 ? '中游' : '弱队'

/** Clubs whose bar I am within reach of, my own region first. */
export function reachableClubs(state: GameState, slack = 6): Team[] {
  const me = state.me!
  const skill = tryoutSkill(state)
  return Object.values(state.teams)
    .filter((t) => t.roster.length <= 7 && !me.declined.includes(t.id))
    .filter((t) => expectOf(t) <= skill + slack)
    .sort((a, b) => (Number(b.region === me.region) - Number(a.region === me.region)) || b.rating - a.rating)
}

function makeInvite(state: GameState, team: Team, via: Invite['via'], rng: Rng): Invite {
  void rng
  const me = state.me!
  const skill = tryoutSkill(state)
  const direct = skill >= expectOf(team) + 10 || (via === 'cup' && me.pre.cups.slice(-1)[0]?.won === true && team.tier === 2)
  return { id: `inv:${state.year}:${state.day}:${team.id}`, teamId: team.id, via, day: state.day, expires: state.day + INVITE_DAYS, direct }
}

function pickClub(state: GameState, rng: Rng, prefer: 1 | 2 | 0): Team | null {
  const me = state.me!
  const pool = reachableClubs(state).filter((t) => !me.pre.invites.some((i) => i.teamId === t.id))
  if (!pool.length) return null
  const w = pool.map((t) => {
    let v = 10 + Math.max(0, tryoutSkill(state) - expectOf(t)) * 2
    if (prefer && t.tier === prefer) v *= 4
    if (!prefer && t.tier === 1) v *= 0.5
    if (t.region !== me.region) v *= me.flags.lang ? 0.2 : 0.04
    return v
  })
  return rng.weighted(pool, w)
}

function offerInvite(state: GameState, team: Team, via: Invite['via'], rng: Rng): void {
  const me = state.me!
  const inv = makeInvite(state, team, via, rng)
  me.pre.invites.push(inv)
  push(state, { kind: 'invite', id: inv.id })
  const how = via === 'cup' ? '看了你的杯赛' : via === 'rank' ? '在天梯上注意到你' : via === 'fans' ? '看了你的直播' : via === 'free' ? '知道你在找队' : '教练组推荐'
  pushLog(state, 'good', `${team.name} 的人${how}，${inv.direct ? '直接给了报价' : '邀请你去试训'}。${INVITE_DAYS} 天内答复。`)
}

/** After a cup: a deep run is what gets a name written down. */
export function cupInvite(state: GameState, run: CupRun, rng: Rng): void {
  const me = state.me!
  const depth = run.rounds ? run.reached / run.rounds : 0
  me.pre.scoutSeen += depth >= 0.5 ? 1 : 0
  if (me.pre.invites.length) return
  const p = clamp(0.08 + depth * 0.45 + (run.won ? 0.30 : 0) + me.pre.scoutSeen * 0.04, 0.05, 0.96)
  if (!rng.chance(p)) return
  const team = pickClub(state, rng, run.won ? 0 : 2)
  if (team) offerInvite(state, team, 'cup', rng)
}

/** The weekly channels: the ladder, the following, and being a known free agent. */
export function rollInvites(state: GameState, rng: Rng): void {
  const me = state.me!
  if (me.pre.invites.length) return
  const weeksIn = me.pre.year === 1 ? me.week : 99
  if (weeksIn < PRE_EARLIEST && !me.pre.wasPro) return
  const l = me.pre.ladder
  if (l >= 74 && rng.chance(0.04 + (l - 74) * 0.01)) {
    const team = pickClub(state, rng, l >= 88 ? 1 : 2)
    if (team) { offerInvite(state, team, 'rank', rng); return }
  }
  if (me.fans >= 180 && rng.chance(me.fans >= 400 ? 0.05 : 0.03)) {
    const team = pickClub(state, rng, me.fans >= 400 ? 1 : 2)
    if (team) { offerInvite(state, team, 'fans', rng); return }
  }
  if (me.pre.wasPro && rng.chance(0.12)) {
    const team = pickClub(state, rng, 0)
    if (team) { offerInvite(state, team, 'free', rng); return }
  }
}

export function expireInvites(state: GameState): void {
  const me = state.me!
  for (const inv of me.pre.invites.slice()) {
    if (inv.expires < state.day && !me.tryout) {
      me.pre.invites = me.pre.invites.filter((x) => x.id !== inv.id)
      me.pending = me.pending.filter((x) => !(x.kind === 'invite' && x.id === inv.id))
      pushLog(state, 'bad', `${state.teams[inv.teamId]?.name ?? '那家俱乐部'} 的邀请过期了，他们没再来电话。`)
    }
  }
}

/** The cup that opens this week, if one does and I have not answered it. */
export function cupThisWeek(state: GameState): typeof CUPS[number] | null {
  const me = state.me!
  const week = Math.floor(state.day / 7)
  for (const c of CUPS) {
    if (c.week !== week) continue
    const key = `${state.year}:${c.key}`
    if (me.pre.seen.includes(key)) continue
    return c
  }
  return null
}

export const preRng = (state: GameState, tag: string) =>
  new Rng(hashStr(`pre:${tag}:${state.seed}:${state.year}:${state.day}`))
