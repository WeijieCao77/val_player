import { clamp } from '../rng'
import type { Rng } from '../rng'
import { ROLES } from '../types'
import type { GameState, Player } from '../types'
import { confidentRating } from '../world'
import { weightsFor } from '../player'
import { ATTR_KEYS } from '../types'
import type { MeMatchRecord } from './types'
import { pushLog } from './log'

/** duels won (net) before the coach agrees to a trial */
export const EDGE_NEED = 3
export const TRIAL_MATCHES = 2

/**
 * A player as the head coach sees him for selection.
 *
 * Everyone is read on the engine's own rule — rating, discounted while the
 * sample behind it is thin — plus this week's form and condition. I am the
 * exception in two ways: the coach's trust in me moves the number, and once I
 * have proven myself in a trial the rookie discount is gone for good.
 */
export function coachView(state: GameState, p: Player): number {
  const me = state.me
  let v = confidentRating(p)
  if (me && p.id === me.id) {
    if (me.proven) v = p.overall
    v += (me.coachTrust - 60) * 0.06
    if (me.benchLock && me.benchLock > state.day) v -= 40
  }
  v += (p.form - 70) * 0.05 - Math.max(0, p.fatigue - 60) * 0.05
  return v
}

/** Keep my sample size honest: the scouted rounds plus what the coach has seen since. */
export function refreshMyRounds(state: GameState): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  if (p) p.rounds = 400 + me.scrimRounds + p.career.rounds
}

/**
 * The five the coach names this week — world.ts autoStarters, read through
 * coachView, with the trial rule on top: a man on trial plays.
 */
export function coachStarters(state: GameState): string[] {
  const team = state.teams[state.myTeam]
  const me = state.me
  const squad = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
    .sort((a, b) => {
      const fit = (x: Player) => (x.injuredUntil > state.day ? 1 : 0)
      return fit(a) - fit(b) || coachView(state, b) - coachView(state, a)
    })

  const chosen: Player[] = []
  const core = ROLES.filter((r) => r !== '自由人')
  for (const role of core) {
    const p = squad.find((x) => x.role === role && !chosen.includes(x))
    if (p) chosen.push(p)
  }
  for (const role of core) {
    if (chosen.length >= 5) break
    if (chosen.some((x) => (x.roles ?? [x.role]).includes(role))) continue
    const p = squad.find((x) => !chosen.includes(x) && (x.roles ?? [x.role]).includes(role))
    if (p) chosen.push(p)
  }
  for (const p of squad) {
    if (chosen.length >= 5) break
    if (!chosen.includes(p)) chosen.push(p)
  }
  const five = chosen.slice(0, 5)

  const igl = squad.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  if (igl && !five.includes(igl)) {
    const covered = (without: Player) => {
      const rest = five.filter((x) => x !== without).concat(igl)
      const have = new Set(rest.flatMap((p) => p.roles ?? [p.role]))
      return core.every((r) => have.has(r))
    }
    const drop = five.slice().sort((a, b) => coachView(state, a) - coachView(state, b)).find(covered)
    if (drop) five[five.indexOf(drop)] = igl
  }

  // on trial: I play, in place of the man I beat in practice
  if (me?.trial) {
    const mine = state.players[me.id]
    if (mine && !five.includes(mine) && mine.injuredUntil <= state.day) {
      const out = five.find((p) => p.id === me.trial!.displaced)
        ?? five.filter((p) => !p.isIgl).sort((a, b) => coachView(state, a) - coachView(state, b))[0]
      if (out) five[five.indexOf(out)] = mine
    }
  }
  return five.map((p) => p.id)
}

/** The starter I am competing with: same role, lowest in the coach's eyes. */
export function duelTarget(state: GameState): Player | null {
  const me = state.me
  if (!me) return null
  const mine = state.players[me.id]
  const team = state.teams[state.myTeam]
  const starters = team.starters
    .filter((id) => id !== me.id)
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
  if (!starters.length) return null
  const sameRole = starters.filter((p) => (p.roles ?? [p.role]).includes(mine.role) && !p.isIgl)
  const pool = sameRole.length ? sameRole : starters.filter((p) => !p.isIgl)
  if (!pool.length) return null
  return pool.sort((a, b) => coachView(state, a) - coachView(state, b))[0]
}

/** Name this week's five and tell me if my place changed. */
export function weeklyLineup(state: GameState): void {
  const me = state.me
  if (!me) return
  const team = state.teams[state.myTeam]
  const was = team.starters.includes(me.id)
  team.starters = coachStarters(state)
  const now = team.starters.includes(me.id)
  if (now && !was) pushLog(state, 'good', me.trial ? '教练兑现了承诺：本周你在首发名单里，这是试用。' : '教练把你排进了本周的首发名单。')
  if (!now && was) pushLog(state, 'bad', '本周你回到替补席。')
  me.lastLineupIn = now
}

export interface DuelRound { dim: string; mine: number; his: number; p: number; ok: boolean }
export interface DuelResult {
  him: Player
  rounds: DuelRound[]
  won: boolean
  flash: boolean
  edge: number
  trial: boolean
}

/**
 * A practice duel against the starter in my slot — three tests, best of three.
 * 破晓's scrimOptP, with the attributes this game judges on.
 */
export function runDuel(state: GameState, rng: Rng): DuelResult | null {
  const me = state.me
  if (!me) return null
  const mine = state.players[me.id]
  const him = duelTarget(state)
  if (!him) return null
  const w = weightsFor(mine)
  const top = ATTR_KEYS.slice().sort((a, b) => w[b] - w[a])[0]
  const dims = [top, 'awareness', 'clutch'] as const
  const cn: Record<string, string> = {
    aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
    clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥',
  }
  const rounds: DuelRound[] = []
  let wins = 0
  for (const d of dims) {
    const a = mine.attrs[d]
    const b = him.attrs[d]
    const p = clamp(
      0.52 + (a - b) / 38 - Math.max(0, mine.fatigue - 55) * 0.003 +
        (mine.form - 70) / 400 + (me.mental - 50) / 400,
      0.12, 0.88,
    )
    const ok = rng.chance(p)
    if (ok) wins++
    rounds.push({ dim: cn[d], mine: a, his: b, p: Math.round(p * 100), ok })
  }
  const won = wins >= 2
  const flash = wins === 3
  me.edge = Math.max(0, me.edge + (won ? (flash ? 1.5 : 1) : -0.5))
  me.scrimRounds += 30
  me.coachTrust = clamp(me.coachTrust + (won ? 1.5 : 0.3), 0, 100)
  me.mental = clamp(me.mental + (won ? 0.4 : 0.2), 0, 100)
  mine.fatigue = clamp(mine.fatigue + 7, 0, 100)
  me.duelsThisWeek++

  const team = state.teams[state.myTeam]
  const starter = team.starters.includes(me.id)
  const locked = !!me.benchLock && me.benchLock > state.day
  let trial = false
  if (me.edge >= EDGE_NEED && !me.trial && !starter && !locked) {
    me.trial = { left: TRIAL_MATCHES, displaced: him.id, forgiven: false }
    me.edge = 0
    team.starters = coachStarters(state)
    trial = true
    pushLog(state, 'good', `训练赛里你连着压过 ${him.ign}，教练点头了：接下来 ${TRIAL_MATCHES} 场正赛你先打。赢下来就是你的。`)
  } else {
    pushLog(state, won ? 'team' : 'info',
      `对位挑战 vs ${him.ign}：${rounds.map((r) => `${r.dim}${r.ok ? '✓' : '✗'}`).join(' ')} —— ${won ? '赢了' : '输了'}，资本 ${me.edge.toFixed(1)}/${EDGE_NEED}。`)
  }
  return { him, rounds, won, flash, edge: me.edge, trial }
}

/**
 * What the coach makes of the match I just played (or watched): a trial
 * confirmed or ended, a run of bad nights costing my place.
 */
export function afterMyMatch(state: GameState, rec: MeMatchRecord): void {
  const me = state.me
  if (!me) return
  const team = state.teams[state.myTeam]
  const opp = Object.values(state.teams).find((t) => t.tag === rec.oppTag)

  if (rec.started) {
    let d = rec.won ? 1.5 : -0.5
    if (rec.rank === 1) d += 1.5
    else if (rec.rank >= 5) d -= 2
    me.coachTrust = clamp(me.coachTrust + d, 0, 100)
  }

  if (me.trial && rec.started) {
    const good = rec.won || rec.rank <= 2
    if (good) {
      me.trial.left--
      if (me.trial.left <= 0) {
        me.trial = undefined
        me.proven = true
        me.coachTrust = clamp(me.coachTrust + 6, 0, 100)
        pushLog(state, 'good', '试用期打完了，教练拍板：首发是你的。')
      } else {
        pushLog(state, 'info', `试用期还剩 ${me.trial.left} 场。`)
      }
    } else {
      const strong = !!opp && opp.rating >= team.rating + 6
      if (strong && !me.trial.forgiven) {
        me.trial.forgiven = true
        pushLog(state, 'info', `输给 ${rec.oppTag} 这种对手不算你的账，教练再给你一场。`)
      } else {
        me.trial = undefined
        me.edge = me.edge / 2
        team.starters = coachStarters(state)
        pushLog(state, 'bad', '试用期没打出来，你回到替补席。攒下的资本只剩一半。')
      }
    }
    return
  }

  if (rec.started) {
    if (!rec.won && rec.rank >= 5) me.badStreak++
    else me.badStreak = Math.max(0, me.badStreak - 1)
    if (me.badStreak >= 3) {
      me.badStreak = 0
      me.benchLock = state.day + 14
      team.starters = coachStarters(state)
      pushLog(state, 'bad', '连着三场你是全队最差，教练把你换下来了：两周之内不会再考虑你。')
    }
  }
}
