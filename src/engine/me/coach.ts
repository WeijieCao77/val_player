import { Rng, clamp, hashStr } from '../rng'
import { absentPlayer, activeAbsence } from './absence'
import { SEASON_DAYS } from '../calendar'
import { ROLES, SQUAD_ROLE_CN } from '../types'
import type { GameState, Player } from '../types'
import { confidentRating } from '../world'
import { underPar } from '../performance'
import type { MeMatchRecord } from './types'
import { pushLog } from './log'
import { traitMul } from './traits'
import { fireEvent } from './events'
import { roomEdge } from './room'
import { myCall } from './igl'
import { roleCoreDims } from './roleCore'

/** duels won (net) before the coach agrees to a trial */
export const EDGE_NEED = 3
export const TRIAL_MATCHES = 2

/**
 * How many of a club's matches a contract's promised standing is worth (decided
 * 2026-09-17): 「允许承诺打破，比如签的首发合同那就先稳定首发三场保底，后面如果竞争
 * 不行，那就去替补，替补也是同理，替补合同也是先稳定替补三场，后面竞争」
 *
 * A promise used to be the whole contract. `promisedRole` seated the career
 * player for as long as it was written, so his place at a club was not the
 * coach's to decide in 99.4% of his weeks there (scripts/probe_room.ts,
 * me/room.ts) — nothing the dressing room, his form or his practice did could
 * reach it, and the answer to 「我会不会丢掉位置」 was structurally no.
 *
 * It is a floor now: the club keeps its word for this many of the matches it
 * plays, and after that the five is the coach's own reading (coachView). Both
 * ways round, because a promise is a promise either way — a man signed as a
 * starter can be benched once the floor is spent, and a man signed as a
 * substitute sits out exactly as long before he is allowed to compete for a
 * start. 轮换 is the exception on both sides: it promises neither, so it holds
 * nothing and the coach reads the man from his first match (promiseSeat).
 * Counted in matches the club actually played (MeState.promiseMatches),
 * not in weeks: a floor measured in weeks would run out over a break with
 * nothing played, and would be worth twice as much in a busy stage as in a
 * quiet one.
 */
export const PROMISE_FLOOR = 3

/**
 * What a practice duel won inside a substitute's floor says, on the button's path (me/duel.ts
 * endDuel) and 托管's (runDuel) alike. The floor holds back the one step that would move the
 * five — a won duel starting a trial — and nothing else: practice is his to play. Without the
 * sentence, a won duel that moves nothing reads as a bug.
 */
export const PROMISE_HELD = `赢了也先不动：合同说好的 ${PROMISE_FLOOR} 场替补还没打完，这几场名单不会变。`

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
 * Matches of the contract's promise still to come — PROMISE_FLOOR at the start
 * of a spell, counting down with every match the club plays (afterMyMatch).
 *
 * A save from before the counter reads as already spent. A career in progress
 * keeps the place it has and the coach decides from its next match on, which is
 * the change this is; the other default — handing every old save a fresh three —
 * would have re-armed a guarantee nobody signed for, and on the substitute side
 * would have pulled a man out of a five he had been starting in for a season.
 */
export function promiseFloorLeft(state: GameState): number {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return 0
  return Math.max(0, PROMISE_FLOOR - (me.promiseMatches ?? PROMISE_FLOOR))
}

/**
 * Which way the contract seats me while its floor still holds, and null once my
 * place is the coach's to decide: 'start' for 核心 and 首发, 'bench' for 替补.
 * A benching for form outranks a starting promise, as it always did.
 *
 * 轮换 holds nothing, either way. The decision named two contracts —
 * 「签的首发合同」 and 「替补合同」 — and 轮换 is neither: it is the standing a club
 * writes down when it is promising nothing about selection, which is why
 * scripts/check_igl.ts sets it to read the coach's own eye with the contract out
 * of the way. Seating a 轮换 signing on the bench for three matches would have
 * benched a man 3.5 clear of his rival on a contract that never promised it.
 */
export function promiseSeat(state: GameState): 'start' | 'bench' | null {
  const me = state.me
  if (!me || promiseFloorLeft(state) <= 0) return null
  const role = state.players[me.id]?.contract?.promisedRole
  if (role === 'starter' || role === 'star') return me.benchLock && me.benchLock > state.day ? null : 'start'
  return role === 'bench' ? 'bench' : null
}

/** Whether this week's place is the contract's rather than the coach's — what scripts/probe_place.ts counts. */
export function promiseHolds(state: GameState): boolean {
  return promiseSeat(state) !== null
}

/** the four jobs a five has to cover; 自由人 is "covers anything", never a slot (world.ts autoStarters) */
const CORE = ROLES.filter((r) => r !== '自由人')
const jobs = (p: Player) => p.roles ?? [p.role]
const coverCount = (five: Player[]): number => {
  const have = new Set(five.flatMap(jobs))
  return CORE.filter((r) => have.has(r)).length
}

/**
 * world.ts autoStarters' way, kept for a squad with fewer than five fit: one man a main role, then the gaps by a
 * second role, then the best of the rest.
 */
function firstFive(squad: Player[]): Player[] {
  const chosen: Player[] = []
  for (const role of CORE) {
    const p = squad.find((x) => x.role === role && !chosen.includes(x))
    if (p) chosen.push(p)
  }
  for (const role of CORE) {
    if (chosen.length >= 5) break
    if (chosen.some((x) => jobs(x).includes(role))) continue
    const p = squad.find((x) => !chosen.includes(x) && jobs(x).includes(role))
    if (p) chosen.push(p)
  }
  for (const p of squad) {
    if (chosen.length >= 5) break
    if (!chosen.includes(p)) chosen.push(p)
  }
  return chosen.slice(0, 5)
}

/**
 * The best five of the fit men that covers the four jobs, second roles counted as the match engine counts them
 * (match.ts compositionScore) — then the caller in it where a covering five can have him, then the most the coach
 * sees in them. Null with fewer than five fit.
 *
 * It was world.ts's way, which seats one man per MAIN role first and only then looks at second roles, so a weak
 * specialist started over a better man because the job he covered was also covered by someone's second role
 * (reported 2026-09-24:「得多看点副位置，不然会出现能力低的当首发」「比赛打完后获胜了，让能力低的替补我有点没法
 * 理解」). Over six three-season careers (seeds 7 and 3, 2021 强队替补 EMEA and 2024 Challengers 中国) the five
 * the coach named was not the best covering five in 200 of 618 professional weeks, by 4.9 of the coach's own
 * points a week, and 12 of those weeks benched me for it.
 */
function bestFive(squad: Player[], cv: (p: Player) => number, day: number, igl: Player | undefined): Player[] | null {
  // squad is in the coach's order already: the fit first, best first; a dozen is more than any roster holds
  const fit = squad.filter((p) => p.injuredUntil <= day).slice(0, 12)
  if (fit.length < 5) return null
  let best: Player[] | null = null
  let key = [-1, -1, -Infinity]
  const n = fit.length
  const pick: Player[] = []
  const walk = (from: number) => {
    if (pick.length === 5) {
      const k = [coverCount(pick), igl && pick.includes(igl) ? 1 : 0, pick.reduce((s, p) => s + cv(p), 0)]
      if (k[0] > key[0] || (k[0] === key[0] && (k[1] > key[1] || (k[1] === key[1] && k[2] > key[2] + 1e-9)))) { key = k; best = pick.slice() }
      return
    }
    for (let i = from; i <= n - (5 - pick.length); i++) { pick.push(fit[i]); walk(i + 1); pick.pop() }
  }
  walk(0)
  // in the coach's order, so a later swap by position reads the way it always did
  return best ? (best as Player[]).sort((a, b) => fit.indexOf(a) - fit.indexOf(b)) : null
}

/**
 * The five the coach names this week — the best covering five in the coach's eyes (bestFive), with the caller,
 * the trial rule, the contract's promise and a held seat on top: a man on trial plays.
 */
export function coachStarters(state: GameState, room = true): string[] {
  const team = state.teams[state.myTeam]
  const me = state.me
  const squadAll = team.roster
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p && !absentPlayer(state, p.id))
  // read once: the room term reads every bond in the squad
  const view = new Map(squadAll.map((p) => [p.id, coachView(state, p, room)]))
  const cv = (p: Player) => view.get(p.id) ?? coachView(state, p, room)
  const squad = squadAll.sort((a, b) => {
    const fit = (x: Player) => (x.injuredUntil > state.day ? 1 : 0)
    return fit(a) - fit(b) || cv(b) - cv(a)
  })

  // The caller goes out with the team: the loudest flagged man — or me, once
  // the coach has named me his caller (me/igl.ts), over a louder deputy.
  const mine = me ? squad.find((p) => p.id === me.id) : undefined
  const igl = mine?.isIgl && mine.iglSource === 'appointed'
    ? mine
    : squad.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
  const five = bestFive(squad, cv, state.day, igl) ?? firstFive(squad)

  if (igl && !five.includes(igl)) {
    const covered = (without: Player) => {
      const rest = five.filter((x) => x !== without).concat(igl)
      const have = new Set(rest.flatMap((p) => p.roles ?? [p.role]))
      return CORE.every((r) => have.has(r))
    }
    const drop = five.slice().sort((a, b) => cv(a) - cv(b)).find(covered)
    if (drop) five[five.indexOf(drop)] = igl
  }

  // on trial: I play, in place of the man I beat in practice
  if (me?.trial) {
    const mine = state.players[me.id]
    if (mine && !five.includes(mine) && mine.injuredUntil <= state.day && !absentPlayer(state, mine.id)) {
      const out = five.find((p) => p.id === me.trial!.displaced)
        ?? five.filter((p) => !p.isIgl).sort((a, b) => cv(a) - cv(b))[0]
      if (out) five[five.indexOf(out)] = mine
    }
  }
  // What the contract promised, for as long as it is still a promise (PROMISE_FLOOR): a
  // starting place written into it is kept — every Challengers signing, and 「承诺首发」
  // bought at the table — unless the coach has just benched me for my form or to try
  // another five. Until 2026-09-11 nothing read `promisedRole` and a rookie signed as a
  // starter sat on the bench from day one; until 2026-09-17 it read it for the whole
  // contract, and the place could not be lost.
  const seat = me && !me.trial ? promiseSeat(state) : null
  if (seat === 'start' && mine && !five.includes(mine) && mine.injuredUntil <= state.day) {
    const sameRole = five.filter((p) => !p.isIgl && (p.roles ?? [p.role]).includes(mine.role))
    const out = (sameRole.length ? sameRole : five.filter((p) => !p.isIgl))
      .sort((a, b) => cv(a) - cv(b))[0]
    if (out) five[five.indexOf(out)] = mine
  }
  // And the same promise the other way round: signed as a substitute, I am one for as
  // long as the floor holds. Two things outrank it — a club that cannot field five
  // without me plays me, and the man the coach has named his caller goes out with the
  // team whatever his contract says.
  if (seat === 'bench' && mine && five.includes(mine) && !(mine.isIgl && mine.iglSource === 'appointed')) {
    const spare = squad.filter((p) => !five.includes(p) && p.injuredUntil <= state.day)
    const sameRole = spare.filter((p) => (p.roles ?? [p.role]).includes(mine.role))
    const inst = (sameRole.length ? sameRole : spare).sort((a, b) => cv(b) - cv(a))[0]
    if (inst) five[five.indexOf(mine)] = inst
  }
  // A starter who is in the five keeps his place against a man history signed onto the club
  // (engine/timeline.ts followBook): I am the one man history never had, so the seat I take is one of theirs,
  // and that man takes the bench. I still lose it the ordinary ways — a benching for form or a coach trying
  // another five (benchLock), an injury, a trial — and then compete for it on merit like anyone.
  // Measured 2026-09-24, eighteen 2021 careers of five seasons, 192f963 against the club following history:
  // with no hold the share of club matches started fell 89.0% → 83.7% and a recognised starter was benched
  // 7 → 11 times; holding it for the recognised and trusted only, still 83.7%; for whoever is in the five,
  // 89.4% and 3 (scratchpad fb-week_measure_*.jsonl).
  //
  // Refined 2026-09-24 by the author: 「如果是同位置的引援就作为替补然后轮换，其他位置的引援就照历史执行」.
  // Only a man at my position yields his seat to me — history's signings at the other four play where history
  // has them — and he is not parked: he rotates in (rotationCall) and takes the seat for good once he clearly
  // outplays me on the field (outplayedBy). Measured over the same eighteen careers, f7d06c2 against this:
  // share of club matches started 89.2% → 82.9%, most of it the rotation — the seat was held against a
  // same-position signing in 2031 of 4570 professional weeks and he was named to start in 333 of them (16%);
  // a recognised starter benched outside a rotation week 2 → 12 times; history's signings at the other four
  // positions played 74% → 76% of the matches they were there for; 综合 after five seasons 83.7 → 83.6
  // (scratchpad club-rotation_m_*.jsonl).
  if (mine && heldSeat(state)) {
    const rivals = sameRoleArrivals(state, mine).filter((p) => !(p.isIgl && p === igl))
    const turn = rotationCall(state)
    if (!five.includes(mine) && !turn) {
      const taken = rivals.filter((p) => five.includes(p) && !outplayedBy(state, p))
      const out = taken.sort((a, b) => cv(a) - cv(b))[0]
      if (out) five[five.indexOf(out)] = mine
    } else if (five.includes(mine) && turn && !five.includes(turn.sub)) {
      five[five.indexOf(mine)] = turn.sub
    }
  }
  return five.map((p) => p.id)
}

/**
 * Clearly outplayed, over time: across the club's official matches of the last OUTPLAY_DAYS, the 替补 at my
 * position rated at least HOLD_CLEAR above me on average, from at least OUTPLAY_MATCHES starts each — his come
 * from the rotation. Then he takes the seat on merit. Read off what was played, not off 综合 or the coach's eye:
 * the eye moves with every match's fatigue, and read that way the seat went back and forth inside a week; and
 * a star signing measured on 综合 took it on arrival — 194 of 4569 professional weeks in eighteen careers —
 * which is not 「作为替补然后轮换」.
 */
export const HOLD_CLEAR = 0.15
export const OUTPLAY_MATCHES = 3
export const OUTPLAY_DAYS = 84
export function outplayedBy(state: GameState, rival: Player): boolean {
  const me = state.me
  if (!me) return false
  const now = state.year * SEASON_DAYS + state.day
  const recent = me.matches.filter((m) => !m.friendly && now - (m.year * SEASON_DAYS + m.day) <= OUTPLAY_DAYS)
  const mineR = recent.filter((m) => m.started).map((m) => m.rating)
  const hisR = recent.map((m) => m.box?.find((r) => r.mine && r.id === rival.id)?.rating).filter((r): r is number => r != null)
  if (mineR.length < OUTPLAY_MATCHES || hisR.length < OUTPLAY_MATCHES) return false
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  return avg(hisR) - avg(mineR) >= HOLD_CLEAR
}
/** a held seat's scheduled rotation: the 替补 at my position starts one week in this many… */
export const ROTATE_EVERY = 4
/** …and one in this many once I am the coach's own, trusted starter (认定首发) */
export const ROTATE_EVERY_TRUSTED = 6
/** a week this tired or this far off form, he starts instead whatever the schedule says */
export const ROTATE_FATIGUE = 65
export const ROTATE_FORM = 58

/** History's signings at my position — the same main role — on the roster, fit. */
function sameRoleArrivals(state: GameState, mine: Player): Player[] {
  const me = state.me!
  const team = state.teams[state.myTeam]
  const ids = me.historyArrivals?.club === team?.id ? me.historyArrivals.ids : []
  return ids.map((id) => state.players[id])
    // his main position, as mine is: a sentinel whose agent pool also has a duelist in it is not at my position
    .filter((p): p is Player => !!p && p.teamId === team?.id && p.role === mine.role
      && p.injuredUntil <= state.day && !absentPlayer(state, p.id))
}

/**
 * This week the 替补 at my position starts instead of me, and why: I am worn out (ROTATE_FATIGUE) or off form
 * (ROTATE_FORM), or it is his turn (one week in ROTATE_EVERY, ROTATE_EVERY_TRUSTED for 认定首发). Never while a
 * contract's starting promise still holds, nor in the matches after a title won as a starter (graceMatches),
 * nor for a man on trial. Decided when the week's five is named (weeklyLineup, `fresh`) and kept for the week,
 * so every call in one week names the same five.
 */
export function rotationCall(state: GameState, fresh = false): { sub: Player; why: 'tired' | 'form' | 'turn' } | null {
  const me = state.me
  const mine = me ? state.players[me.id] : undefined
  const a = me?.historyArrivals
  if (!me || !mine || !a?.seat || a.club !== state.myTeam || me.trial || (me.graceMatches ?? 0) > 0 || promiseSeat(state) === 'start') return null
  if (!fresh && a.rot?.week === me.week) {
    const kept = a.rot.sub ? state.players[a.rot.sub] : undefined
    return kept && kept.teamId === state.myTeam && kept.injuredUntil <= state.day && !absentPlayer(state, kept.id) ? { sub: kept, why: a.rot.why } : null
  }
  const sub = sameRoleArrivals(state, mine).sort((x, y) => coachView(state, y) - coachView(state, x))[0]
  if (!sub) return null
  if (mine.fatigue >= ROTATE_FATIGUE) return { sub, why: 'tired' }
  if (mine.form <= ROTATE_FORM) return { sub, why: 'form' }
  const every = me.proven && me.coachTrust >= PROVEN_TRUST ? ROTATE_EVERY_TRUSTED : ROTATE_EVERY
  return (me.week - (a.since ?? me.week)) % every === every - 1 ? { sub, why: 'turn' } : null
}

/**
 * My place is held against history's signings at my position: I hold it (historyArrivals.seat — I was in the
 * five, and have not lost it on merit or for form since), not on trial, fit, not benched for form or a
 * 试新阵容 (benchLock), at a club history has signed somebody for since I came.
 */
export function heldSeat(state: GameState): boolean {
  const me = state.me
  const team = me?.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const p = me ? state.players[me.id] : undefined
  if (!me || !team || !p || me.trial) return false
  if (me.historyArrivals?.club !== team.id || !me.historyArrivals.ids.length || !me.historyArrivals.seat) return false
  if (me.benchLock && me.benchLock > state.day) return false
  return p.injuredUntil <= state.day && !absentPlayer(state, me.id)
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
    ? `你和 ${who} 能力差不多，教练用了跟队伍更合得来的你。协同、沟通、跟队友处得怎么样，都算数。`
    : `你和 ${who} 能力差不多，教练用了跟队伍更合得来的 ${who}。协同、沟通、跟队友处得怎么样，都算数。`
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

/**
 * Why this week's five has no place for me, in the coach's words. It said 「本周你回到替补席。」 and nothing else, so a
 * week after a win that put a man with a lower 综合 in my seat read as no reason at all (reported 2026-09-24:
 * 「比赛打完后获胜了，让能力低的替补我有点没法理解」). The coach does not read 综合 alone: an unproven man's number
 * is discounted while the sample behind it is thin (world.ts confidentRating), and form, fatigue and his trust
 * move it (coachView). This names whichever of those it was, or the four jobs a five has to cover.
 */
export function benchLine(state: GameState): string {
  const me = state.me!
  const mine = state.players[me.id]
  const team = state.teams[state.myTeam]
  const base = '本周你回到替补席'
  if (!mine || !team) return `${base}。`
  if (me.benchLock && me.benchLock > state.day) return `${base}：教练说过，这段时间先不考虑你。`
  if (promiseSeat(state) === 'bench') return `${base}：合同写的是替补，保底的 ${PROMISE_FLOOR} 场还没坐完。`
  const five = team.starters.map((id) => state.players[id]).filter((p): p is Player => !!p && p.id !== me.id)
  const cv = (p: Player) => coachView(state, p)
  const n = coverCount(five)
  // the men whose seat I could take without leaving a job open; the caller goes out with the team
  const swaps = five.filter((x) => !x.isIgl && coverCount(five.map((y) => (y === x ? mine : y))) >= n)
  if (!swaps.length) {
    const held = five.filter((z) => CORE.some((r) => jobs(z).includes(r) && !jobs(mine).includes(r)
      && five.filter((y) => jobs(y).includes(r)).length === 1))
    return `${base}：首发要把决斗者、先锋、控场、哨卫四个位置凑齐，${held.length ? `${held.map((z) => z.ign).join('、')} 打的是你打不了的位置，` : ''}剩下的位置教练这周更看好别人。多练一个副位置，能上的位置就多一个。`
  }
  const x = swaps.sort((a, b) => cv(a) - cv(b))[0]
  // coachView's own terms, mine against his: what put him ahead, the biggest first
  const tired = (p: Player) => -Math.max(0, p.fatigue - 60) * 0.05
  const terms: [number, string][] = [
    [x.overall - mine.overall, '他现在整体比你强'],
    // an unproven man's number is discounted while the sample behind it is thin; a proven one is read at his 综合
    [(mine.overall - (me.proven ? mine.overall : confidentRating(mine))) - (x.overall - confidentRating(x)),
      '你还没转正，职业比赛打得也比他少，教练更信比赛里打出来的人'],
    [-(me.coachTrust - 60) * 0.06, '教练对你还不够信任'],
    [(x.form - mine.form) * 0.05, '你最近的状态不如他'],
    [tired(x) - tired(mine), '你这周太累了'],
    [roomEdge(state, x) - roomEdge(state, mine), '他跟队伍更合得来'],
  ]
  const why = terms.filter(([d]) => d >= 0.5).sort((a, b) => b[0] - a[0]).slice(0, 2).map(([, w]) => w)
  if (!why.length) why.push('你们俩差得很少，这周他稍稍排在你前面')
  return `${base}：教练这周用 ${x.ign}。${x.overall < mine.overall ? '他的综合能力不如你，但' : ''}${why.join('；')}。训练赛、对位挑战赢下来，教练会重新考虑。`
}

/** Name this week's five and tell me if my place changed — and, when the room settled it, why. */
export function weeklyLineup(state: GameState): void {
  const me = state.me
  if (!me) return
  const team = state.teams[state.myTeam]
  const was = team.starters.includes(me.id)
  // this week's rotation at my position, decided once, before the five is named (rotationCall)
  if (me.historyArrivals?.club === state.myTeam) {
    const r = rotationCall(state, true)
    me.historyArrivals.rot = { week: me.week, sub: r?.sub.id ?? null, why: r?.why ?? 'turn' }
  }
  team.starters = coachStarters(state)
  const now = team.starters.includes(me.id)
  // the seat held against history's signing at my position (heldSeat): kept while I am in the five, through a
  // rotation week, an injury or a leave; lost when the coach leaves me out for anything else
  const a = me.historyArrivals
  const turn = !now && a?.seat ? rotationCall(state) : null
  const hurt = (state.players[me.id]?.injuredUntil ?? 0) > state.day || !!absentPlayer(state, me.id)
  if (a && a.club === state.myTeam) {
    if (now) { if (!a.seat) a.since = me.week; a.seat = true }
    else if (!turn && !hurt) a.seat = false
  }
  if (now && !was) pushLog(state, 'good', me.trial ? '教练兑现了承诺：本周你在首发名单里，这是试用。' : '教练把你排进了本周的首发名单。')
  if (!now && turn && turn.sub && team.starters.includes(turn.sub.id)) {
    const line = turn.why === 'tired' ? `本周轮换：你太累了，${turn.sub.ign} 替你首发。`
      : turn.why === 'form' ? `本周轮换：你状态不在，${turn.sub.ign} 替你首发。`
      : `本周轮换：${turn.sub.ign} 首发，你歇一周，首发位置还是你的。`
    pushLog(state, 'info', line)
    me.weekNotes.push(line)
  } else if (!now && was) pushLog(state, 'bad', roomCall(state) ? '本周你回到替补席。' : benchLine(state))
  // The first time the place moves on merit alone, the contract is named: it is the
  // sentence that makes the rule legible — 「合同上写着首发」 and yet here I am on the
  // bench — and it is said once a spell rather than every week it happens.
  const promised = state.players[me.id]?.contract?.promisedRole
  if (promised && !me.trial && !promiseHolds(state)) {
    const startPromise = promised === 'starter' || promised === 'star'
    if (!now && was && startPromise && !me.flags.promiseLost) {
      me.flags.promiseLost = 1
      pushLog(state, 'bad', `合同里保底的那 ${PROMISE_FLOOR} 场早就打完了：从这里开始，谁上谁不上，教练说了算。`)
    }
    if (now && !was && !startPromise && !me.flags.promiseWon) {
      me.flags.promiseWon = 1
      pushLog(state, 'good', `合同上写的是${SQUAD_ROLE_CN[promised]}，这个首发是你自己打进来的。`)
    }
  }
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
  if (!me || activeAbsence(state)) return null
  const mine = state.players[me.id]
  const him = duelTarget(state)
  if (!him) return null
  const dims = roleCoreDims(mine.role)
  const cn: Record<string, string> = {
    aim: '枪法', reaction: '反应', awareness: '意识', utility: '道具',
    clutch: '残局', teamwork: '协同', communication: '沟通', igl: '指挥',
  }
  const rounds: DuelRound[] = []
  let wins = 0
  // The button path pays the same exertion when the scrim opens, before its first odds.
  mine.fatigue = clamp(mine.fatigue + 7, 0, 100)
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
  me.duelsThisWeek++

  const team = state.teams[state.myTeam]
  const starter = team.starters.includes(me.id)
  const locked = !!me.benchLock && me.benchLock > state.day
  let trial = false
  // a substitute contract's floor is the coach's word too: he does not move the five for me
  // inside it, so no trial begins there. That guard is the whole of the rule — the duel itself
  // is still mine to play, and a win says why nothing moves yet (PROMISE_HELD)
  if (me.edge >= EDGE_NEED && !me.trial && !starter && !locked && promiseSeat(state) !== 'bench') {
    me.trial = { left: TRIAL_MATCHES, displaced: him.id, forgiven: false }
    me.edge = 0
    team.starters = coachStarters(state)
    trial = true
    pushLog(state, 'good', `训练赛里连着压过 ${him.ign}。教练：「下 ${TRIAL_MATCHES} 场你上。」打出来，位置就是你的。`)
  } else {
    const held = won && promiseSeat(state) === 'bench'
    pushLog(state, won ? 'team' : 'info',
      `对位挑战 vs ${him.ign}：${rounds.map((r) => `${r.dim}${r.ok ? '✓' : '✗'}`).join(' ')} —— ${won ? '赢了' : '输了'}，资本 ${me.edge.toFixed(1)}/${EDGE_NEED}。${held ? PROMISE_HELD : ''}`)
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
  // Approved leave is not a failed trial or a consumed promise opportunity.
  if (activeAbsence(state) && !rec.started) return
  const team = state.teams[state.myTeam]
  const opp = Object.values(state.teams).find((t) => t.tag === rec.oppTag)
  const calling = myCall(state)
  // New box scores count utility and other real contributions. Being fifth in a good five
  // is not itself a poor performance. Old records retain their original rank-only meaning.
  // 「Under」 is under his own role's par (engine/performance.ts ROLE_PAR), not one line for all:
  // since kills weigh more (2026-09-25) a 控场 averages 0.98 and a 决斗者 1.04, and a flat 0.95
  // docked the smoke player for the rating his role gets.
  const underperformed = rec.performanceVersion !== 1 || underPar(rec.rating, rec.role ?? state.players[me.id]?.role)

  // one more of the club's matches against the contract's floor — played, or watched from
  // the bench: both are matches the club played. A cup or an exhibition is not one of them
  // (me/matchplay.ts sends none here), and neither is a week in which nothing was played.
  if (!rec.friendly) {
    const spent = me.promiseMatches ?? PROMISE_FLOOR
    me.promiseMatches = spent + 1
    if (spent < PROMISE_FLOOR && spent + 1 >= PROMISE_FLOOR) {
      const role = state.players[me.id]?.contract?.promisedRole
      pushLog(state, 'info', role === 'starter' || role === 'star'
        ? `保底的 ${PROMISE_FLOOR} 场首发打完了。往后名单归教练排。`
        : `保底的 ${PROMISE_FLOOR} 场替补坐完了。往后按状态排人，训练赛、对位都算数了。`)
    }
  }

  if (rec.started) {
    let d = rec.won ? 1.5 : -0.5
    if (!calling) {
      if (rec.rank === 1) d += 1.5
      else if (rec.rank >= 5 && underperformed) d -= 2
    }
    if (d > 0) d *= traitMul(me, 'trust')
    me.coachTrust = clamp(me.coachTrust + d, 0, 100)
    const opp = Object.values(state.teams).find((t) => t.tag === rec.oppTag)
    if (rec.won && opp && opp.rating >= state.teams[state.myTeam].rating + 8) fireEvent(state, 'after_upset')
    const last3 = me.matches.filter((m) => !m.friendly && m.started).slice(-3)
    if (!rec.won && last3.length === 3 && last3.every((m) => !m.won)) fireEvent(state, 'after_skid')
  }

  if (me.trial && rec.started) {
    const good = rec.won || rec.rank <= 2 || (rec.performanceVersion === 1 && rec.rating >= 1.10)
    if (good) {
      me.trial.left--
      if (me.trial.left <= 0) {
        me.trial = undefined
        me.proven = true
        me.flags.trialPassed = 1
        if (me.flags.benchedOnce) me.flags.cameBack = 1
        me.coachTrust = clamp(me.coachTrust + 6, 0, 100)
        pushLog(state, 'good', '试用期打完。首发是你的了。')
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
    if (!rec.won && rec.rank >= 5 && underperformed && !grace) me.badStreak++
    else me.badStreak = Math.max(0, me.badStreak - 1)
    if (me.badStreak >= 3) {
      me.badStreak = 0
      me.benchLock = state.day + 14
      me.flags.benchedOnce = 1
      team.starters = coachStarters(state)
      pushLog(state, 'bad', '连着三场全队最差。你被换了下来，两周之内不会再考虑你。')
      fireEvent(state, 'after_bench')
      return
    }
    // losing with me in the bottom half, again: a coach who keeps losing
    // starts trying other fives to see who is dragging the team — but not with the
    // starter he has settled on and trusts, nor one who has just won him a title
    // (2026-09-14: 「拿了世界冠军fmvp但是一样被轮换」)
    if (!rec.won && rec.rank >= 4 && underperformed) me.rotateHeat = (me.rotateHeat ?? 0) + 1
    else if (rec.won || !underperformed) me.rotateHeat = 0
    if (grace || (me.proven && me.coachTrust >= PROVEN_TRUST)) me.rotateHeat = 0
    if ((me.rotateHeat ?? 0) >= 2 && !(me.benchLock && me.benchLock > state.day)) {
      const r = new Rng(hashStr(`rotate:${state.seed}:${state.year}:${state.day}`))
      if (r.chance(0.4)) {
        me.rotateHeat = 0
        me.benchLock = state.day + 7
        team.starters = coachStarters(state)
        pushLog(state, 'bad', '连着输了几场。教练要试新阵容，这一周先换人打。')
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
  pushLog(state, 'good', `首发打满 ${me.startsHere} 场。你成了教练认定的首发。`)
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
  if (me.trial) return `试用期，还剩 ${me.trial.left} 场。赢下比赛、贡献队内前二，或新版贡献评分达到 1.10，就算过。`
  // while the contract is still what decides, that is where I stand — and the sentence
  // says when it stops deciding, so the day it does is not a surprise
  const seat = promiseSeat(state)
  if (seat === 'start') {
    return `合同承诺的首发：俱乐部接下来 ${promiseFloorLeft(state)} 场比赛写死是你的。这 ${PROMISE_FLOOR} 场打完，名单就归教练自己排了。`
  }
  if (seat === 'bench') {
    return `合同说好先打 ${PROMISE_FLOOR} 场替补，还剩 ${promiseFloorLeft(state)} 场。坐满了才谈竞争——训练赛、对位，从那时候起都算数。`
  }
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
