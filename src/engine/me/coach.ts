import { Rng, clamp, hashStr } from '../rng'
import { ROLES } from '../types'
import type { GameState, Player } from '../types'
import { confidentRating } from '../world'
import { weightsFor } from '../player'
import { ATTR_KEYS } from '../types'
import type { MeMatchRecord } from './types'
import { pushLog } from './log'
import { traitMul } from './traits'
import { fireEvent } from './events'
import { roomEdge } from './room'
import { myCall } from './igl'

/** duels won (net) before the coach agrees to a trial */
export const EDGE_NEED = 3
export const TRIAL_MATCHES = 2

/**
 * How hard a week pulls the coach's regard back toward 60 (me/week.ts
 * settleWeek) — and why the two directions are not the same rate (2026-09-16).
 *
 * It used to be 3% whichever side of 60 the regard sat on. Halving it to 1.5%
 * both ways was tried first, to make trust earned by playing well last long
 * enough to be felt, and measured worse than what it replaced: a career
 * player's regard sits under 60 far more often than over it, so that pull is
 * mostly the way back up, and halving it halved the recovery along with the
 * decay. Over the same careers (scripts/probe_room.ts) the weeks at 「信任」 or
 * better fell 10.0% → 4.5% and the weeks at 50 or worse rose 23.5% → 32.6% —
 * the opposite of what the change was for. A man on the bench shows why: the
 * week takes 1 off a substitute the coach never sees, so his regard settles
 * where the pull balances that, which is 27 at 3% and the floor at 1.5%.
 *
 * So the directions are split. Below 60 the way back is what it always was;
 * above it, what a player earned by playing well leaks away at half the old
 * rate — half gone in 46 weeks instead of 23, which is what wanting trust to
 * last until the next selection decision actually asked for.
 */
export const TRUST_UP = 0.03
export const TRUST_DOWN = 0.015

/**
 * A player as the head coach sees him for selection.
 *
 * Everyone is read on the engine's own rule — rating, discounted while the
 * sample behind it is thin — plus this week's form and condition. I am the
 * exception in two ways: the coach's trust in me moves the number, and once I
 * have proven myself in a trial the rookie discount is gone for good.
 *
 * And the room (2026-09-14, me/room.ts roomEdge): between two of about the same
 * level he picks the one who is easy to play with and gets on with the squad —
 * at most ROOM_EDGE_MAX, a close call and never a clearly better player. `room`
 * false leaves it out, to tell whether it settled a place (roomCall).
 */
export function coachView(state: GameState, p: Player, room = true): number {
  const me = state.me
  let v = confidentRating(p)
  if (me && p.id === me.id) {
    if (me.proven) v = p.overall
    v += (me.coachTrust - 60) * 0.06
    if (me.benchLock && me.benchLock > state.day) v -= 40
  }
  v += (p.form - 70) * 0.05 - Math.max(0, p.fatigue - 60) * 0.05
  if (room) v += roomEdge(state, p)
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
export function coachStarters(state: GameState, room = true): string[] {
  const team = state.teams[state.myTeam]
  const me = state.me
  const squadAll = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
  // read once: the room term reads every bond in the squad
  const view = new Map(squadAll.map((p) => [p.id, coachView(state, p, room)]))
  const cv = (p: Player) => view.get(p.id) ?? coachView(state, p, room)
  const squad = squadAll.sort((a, b) => {
    const fit = (x: Player) => (x.injuredUntil > state.day ? 1 : 0)
    return fit(a) - fit(b) || cv(b) - cv(a)
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

  // The caller goes out with the team: the loudest flagged man — or me, once
  // the coach has named me his caller (me/igl.ts), over a louder deputy.
  const mine = me ? squad.find((p) => p.id === me.id) : undefined
  const igl = mine?.isIgl && mine.iglSource === 'appointed'
    ? mine
    : squad.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  if (igl && !five.includes(igl)) {
    const covered = (without: Player) => {
      const rest = five.filter((x) => x !== without).concat(igl)
      const have = new Set(rest.flatMap((p) => p.roles ?? [p.role]))
      return core.every((r) => have.has(r))
    }
    const drop = five.slice().sort((a, b) => cv(a) - cv(b)).find(covered)
    if (drop) five[five.indexOf(drop)] = igl
  }

  // on trial: I play, in place of the man I beat in practice
  if (me?.trial) {
    const mine = state.players[me.id]
    if (mine && !five.includes(mine) && mine.injuredUntil <= state.day) {
      const out = five.find((p) => p.id === me.trial!.displaced)
        ?? five.filter((p) => !p.isIgl).sort((a, b) => cv(a) - cv(b))[0]
      if (out) five[five.indexOf(out)] = mine
    }
  }
  // a starting place written into my contract is kept — every Challengers signing, and 「承诺首发」
  // bought at the table — unless the coach has just benched me for my form or to try another five.
  // Until 2026-09-11 nothing read it: a rookie signed as a starter sat on the bench from day one
  const promised = me ? state.players[me.id]?.contract?.promisedRole : undefined
  if (me && !me.trial && (promised === 'starter' || promised === 'star') && !(me.benchLock && me.benchLock > state.day)) {
    const mine = state.players[me.id]
    if (mine && !five.includes(mine) && mine.injuredUntil <= state.day) {
      const sameRole = five.filter((p) => !p.isIgl && (p.roles ?? [p.role]).includes(mine.role))
      const out = (sameRole.length ? sameRole : five.filter((p) => !p.isIgl))
        .sort((a, b) => cv(a) - cv(b))[0]
      if (out) five[five.indexOf(out)] = mine
    }
  }
  return five.map((p) => p.id)
}

/**
 * Whether the room settled my place, in the coach's words: the five he names
 * with the room counted (coachView) and without it differ on me. Null when my
 * level decided it — or when a trial did.
 */
export function roomCall(state: GameState): string | null {
  const me = state.me
  const team = state.teams[state.myTeam]
  if (!me || me.phase !== 'pro' || me.trial || !team) return null
  const withRoom = coachStarters(state)
  const plain = coachStarters(state, false)
  const inNow = withRoom.includes(me.id)
  if (plain.includes(me.id) === inNow) return null
  // the man whose place turned on it: in one five and not the other
  const otherId = inNow ? plain.find((id) => !withRoom.includes(id)) : withRoom.find((id) => !plain.includes(id))
  const who = (otherId && state.players[otherId]?.ign) || '另一个人'
  return inNow
    ? `教练的说法：你和 ${who} 能力差不多，他用了和队伍更合得来的你——协同、沟通、和队友处得怎么样，他都看在眼里。`
    : `教练的说法：你和 ${who} 能力差不多，他用了和队伍更合得来的 ${who}——协同、沟通、和队友处得怎么样，他都看在眼里。`
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

/** Name this week's five and tell me if my place changed — and, when the room settled it, why. */
export function weeklyLineup(state: GameState): void {
  const me = state.me
  if (!me) return
  const team = state.teams[state.myTeam]
  const was = team.starters.includes(me.id)
  team.starters = coachStarters(state)
  const now = team.starters.includes(me.id)
  if (now && !was) pushLog(state, 'good', me.trial ? '教练兑现了承诺：本周你在首发名单里，这是试用。' : '教练把你排进了本周的首发名单。')
  if (!now && was) pushLog(state, 'bad', '本周你回到替补席。')
  const why = now !== was ? roomCall(state) : null
  if (why) pushLog(state, now ? 'good' : 'bad', why)
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
 *
 * A caller is judged on the result, not on where his line sits in the five
 * (2026-09-14): the man who calls is often the lowest fragger on the server,
 * and a coach who named him does not bench him for it. While I call, the rank
 * terms of his trust and the bottom-of-the-five benching and rotation below
 * pass me by; a run of defeats since I took the calls is what costs them
 * (me/igl.ts revokeWhy).
 */
export function afterMyMatch(state: GameState, rec: MeMatchRecord): void {
  const me = state.me
  if (!me) return
  const team = state.teams[state.myTeam]
  const opp = Object.values(state.teams).find((t) => t.tag === rec.oppTag)
  const calling = myCall(state)

  if (rec.started) {
    let d = rec.won ? 1.5 : -0.5
    if (!calling) {
      if (rec.rank === 1) d += 1.5
      else if (rec.rank >= 5) d -= 2
    }
    if (d > 0) d *= traitMul(me, 'trust')
    me.coachTrust = clamp(me.coachTrust + d, 0, 100)
    const opp = Object.values(state.teams).find((t) => t.tag === rec.oppTag)
    if (rec.won && opp && opp.rating >= state.teams[state.myTeam].rating + 8) fireEvent(state, 'after_upset')
    const last3 = me.matches.filter((m) => !m.friendly && m.started).slice(-3)
    if (!rec.won && last3.length === 3 && last3.every((m) => !m.won)) fireEvent(state, 'after_skid')
  }

  if (me.trial && rec.started) {
    const good = rec.won || rec.rank <= 2
    if (good) {
      me.trial.left--
      if (me.trial.left <= 0) {
        me.trial = undefined
        me.proven = true
        me.flags.trialPassed = 1
        if (me.flags.benchedOnce) me.flags.cameBack = 1
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

  if (rec.started && !rec.friendly) {
    // A starter the coach keeps naming becomes his own starter without a trial (2026-09-14). A man
    // signed as a starter never had one, and read 「教练没把你当自己人」 under 「完全信任」 for good.
    // A save from before counts from this season's starts.
    me.startsHere = (me.startsHere ?? Math.max(0, me.seasonStart.starts - 1)) + 1
    if (me.graceMatches) me.graceMatches = Math.max(0, me.graceMatches - 1)
    earnProven(state)
  }

  if (rec.started && !calling) {
    // straight after a title won as a starter, a bad night is a bad night (coachAfterTitle)
    const grace = (me.graceMatches ?? 0) > 0
    if (!rec.won && rec.rank >= 5 && !grace) me.badStreak++
    else me.badStreak = Math.max(0, me.badStreak - 1)
    if (me.badStreak >= 3) {
      me.badStreak = 0
      me.benchLock = state.day + 14
      me.flags.benchedOnce = 1
      team.starters = coachStarters(state)
      pushLog(state, 'bad', '连着三场你是全队最差，教练把你换下来了：两周之内不会再考虑你。')
      fireEvent(state, 'after_bench')
      return
    }
    // losing with me in the bottom half, again: a coach who keeps losing
    // starts trying other fives to see who is dragging the team — but not with the
    // starter he has settled on and trusts, nor one who has just won him a title
    // (2026-09-14: 「拿了世界冠军fmvp但是一样被轮换」)
    if (!rec.won && rec.rank >= 4) me.rotateHeat = (me.rotateHeat ?? 0) + 1
    else if (rec.won) me.rotateHeat = 0
    if (grace || (me.proven && me.coachTrust >= PROVEN_TRUST)) me.rotateHeat = 0
    if ((me.rotateHeat ?? 0) >= 2 && !(me.benchLock && me.benchLock > state.day)) {
      const r = new Rng(hashStr(`rotate:${state.seed}:${state.year}:${state.day}`))
      if (r.chance(0.4)) {
        me.rotateHeat = 0
        me.benchLock = state.day + 7
        team.starters = coachStarters(state)
        pushLog(state, 'bad', '连着输了几场，教练要试新阵容：这一周先换人打，看看到底是谁在拖累。')
      }
    }
  }
}

/** trust at 「信任」 and this many official starts at the club: the coach's own starter, trial or not (2026-09-14) */
export const PROVEN_TRUST = 66
export const PROVEN_STARTS = 8
/** official starts after a title won as a starter in which a bad run costs no place: any title, an international one, the final's MVP on top */
export const GRACE_TITLE = 4
export const GRACE_BIG = 8
export const GRACE_FMVP = 4

/** A starter who has started enough here, and whom the coach trusts, is his own: the rookie discount goes, as a trial passed takes it. */
function earnProven(state: GameState): void {
  const me = state.me
  if (!me || me.proven || me.trial) return
  if ((me.startsHere ?? 0) < PROVEN_STARTS || me.coachTrust < PROVEN_TRUST) return
  me.proven = true
  pushLog(state, 'good', `以首发打了 ${me.startsHere} 场，教练拍板：你是他认定的首发。`)
}

/**
 * A title won as a starter, as the coach takes it (2026-09-14, 「拿了世界冠军fmvp但是一样被轮换」):
 * trust up — more for an international title, more again for the final's MVP — the place his for
 * good, and a run of official starts after it in which a bad night costs no place. `cls` is the
 * title's me/compclass.ts compClass.
 */
export function coachAfterTitle(state: GameState, cls: string, fmvp: boolean): void {
  const me = state.me
  if (!me || me.phase !== 'pro') return
  const big = cls === 'champions' || cls === 'masters' || cls === 'lockin'
  me.coachTrust = clamp(me.coachTrust + (cls === 'champions' ? 10 : big ? 8 : 5) + (fmvp ? 4 : 0), 0, 100)
  const was = me.proven
  me.proven = true
  me.trial = undefined
  me.badStreak = 0
  me.rotateHeat = 0
  me.graceMatches = Math.max(me.graceMatches ?? 0, (big ? GRACE_BIG : GRACE_TITLE) + (fmvp ? GRACE_FMVP : 0))
  pushLog(state, 'good', `${fmvp ? '决赛 MVP 是你' : '首发拿下冠军'}，${was ? '教练更信你了' : '教练认定你是他的首发'}：接下来 ${me.graceMatches} 场正赛，不会因为几场状态起伏把你换下。`)
}

/**
 * Where I stand with the coach, in one sentence, for the week screen's 「教练怎么看你」 and the team
 * screen's 「首发之争」 alike (2026-09-14). Both used to read `proven` alone, so a starter never put
 * on trial read 「教练没把你当自己人」 beside 「完全信任」.
 */
export function standingLine(state: GameState, where: 'week' | 'team'): string {
  const me = state.me
  const team = state.teams[state.myTeam]
  if (!me || !team) return ''
  if (me.trial) return `试用期，还剩 ${me.trial.left} 场。赢下比赛或打出队内前二就算过。`
  if (!team.starters.includes(me.id)) {
    if (me.benchLock && me.benchLock > state.day) return `教练暂时把你换下来了，${me.benchLock - state.day} 天后重新考虑。`
    return where === 'team'
      ? `再赢约 ${Math.max(1, Math.ceil(EDGE_NEED - me.edge))} 场对位，教练给试用期。`
      : '你还在替补席：训练赛、对位、正赛都能改变这一点。'
  }
  if (me.proven) {
    return (me.graceMatches ?? 0) > 0
      ? `你是教练认定的首发。刚以首发拿下冠军，接下来 ${me.graceMatches} 场正赛不会因为状态起伏被换下。`
      : '你是教练认定的首发。'
  }
  const left = Math.max(0, PROVEN_STARTS - (me.startsHere ?? 0))
  if (me.coachTrust >= PROVEN_TRUST) {
    return left > 0
      ? `你在首发里，教练也信任你：再以首发打 ${left} 场，就是他认定的首发。`
      : '你在首发里，教练也信任你：下一场首发打完，就是他认定的首发。'
  }
  return `你在首发里，教练还在观察：信任到「信任」、以首发打满 ${PROVEN_STARTS} 场，就是他认定的首发。`
}
