import { clamp } from '../rng'
import type { GameState, Player } from '../types'
import { bondBetween, ease, NEUTRAL, squadHarmony } from '../bonds'
import { squadOf } from '../roster'

/**
 * 化学反应 at my club: what 协同 and 沟通 do beyond a key round (decided
 * 2026-09-14, 「加大协同、沟通的影响」).
 *
 * They used to move a pair's opening bond by about a point and a carrier's
 * patience a little. The room itself — how fast a bond fades, how hard a loss
 * lands, when a loss turns into an argument — is engine/bonds.ts (ease, the
 * EASE_* terms), live at the career player's club. Here is what the room does
 * to the people in it:
 *
 *  - the coach's eye (roomEdge, me/coach.ts coachView): between two players of
 *    about the same level, the one who is easier to play with and gets on
 *    better with the squad. ROOM_EDGE_MAX either way, on a scale where a point
 *    is a point of 综合 — it settles a close call and cannot bench a clearly
 *    better player;
 *  - form (roomForm, roomWeek): a player more at ease in the room than the rest
 *    of it plays nearer his best. Nudged every week at the rate the engine pulls
 *    form back to 70 (engine/training.ts weeklyTick), so it settles about
 *    roomForm away from where it would have been, ROOM_FORM_MAX either way.
 *
 * Both measure a player against his own squad — his ease against the squad's
 * average ease, his average bond with the squad against the squad's average
 * bond — so the room sorts players inside a club and never moves the club as a
 * whole: the squad's average form, and so its strength against clubs this rule
 * does not reach, is what it was. A first cut measured from fixed points (ease
 * 0, bond 30) sat nearly every man at the career player's club under both and
 * cost that club three to four points of form (scripts/probe_igl.ts).
 */

/**
 * The coach's eye: per point of ease over the squad's, per point of bond over
 * the squad's, and the most it can move a player.
 *
 * These rates were doubled on 2026-09-16 to make the room settle close calls
 * for a place, measured, and put back the same night. Read this before trying
 * it again (scripts/probe_room.ts, 24 careers a side, 3,740 weeks at a club):
 *
 *  - the cap is not the knob and never was. At these rates the term runs
 *    p10 −0.51 · p50 0.00 · p90 +0.49 and reaches ±1.5 in 0.0% of readings.
 *    Doubling them moved it to p90 +0.97, exactly as the arithmetic says, and
 *    still nothing came near the cap;
 *  - it changed no outcome. The five the coach names moved in 3.7% of weeks at
 *    these rates and 3.4% doubled — if anything fewer, and well inside the
 *    spread between runs;
 *  - it cannot reach the career player's own place at all: 0 weeks of 3,743,
 *    either way. His place is the contract's or a trial's in 99.4% of weeks —
 *    me/coach.ts coachStarters seats him before coachView is ever read — and in
 *    the weeks left, the coach's own reading puts him a median 9.55 from the
 *    5/6 line, against an edge whose p90 is 0.97 and whose cap is 3.
 *
 * Making the room decide a place is not a tuning job. It is a question about
 * whether a starting place written into a contract can be lost.
 */
export const ROOM_EDGE_EASE = 0.05
export const ROOM_EDGE_BOND = 0.02
export const ROOM_EDGE_MAX = 1.5
/**
 * Form: the same two, the most it can move a player, and the weekly share of
 * it applied.
 *
 * This is the only road the room has into a match: roomEdge is read when the
 * coach names a five (me/coach.ts coachView) and nowhere else, so whatever the
 * room does to a result it does through form.
 *
 * These rates were raised by five thirds on 2026-09-16 to make the room decide
 * close matches, and put back the same night for a reason that is structural
 * rather than a matter of degree: **this term is mean-zero across the squad by
 * construction**. Every player is measured against his own squad's average ease
 * and average bond, so what it gives one man it takes from another and the
 * club's own strength is untouched — the note at the top of this file always
 * said so, and the measurement confirmed it. Over 24 careers a side
 * (scripts/probe_room.ts), taking the room out of the world changed 3.2% of
 * official matches at these rates and 2.3% at five thirds; the term's own
 * spread went p90 1.02 → 1.69 as the arithmetic says, and the cap was reached
 * 0.0% of the time in both. The cancellation is exact, not approximate,
 * precisely because the clamp never binds.
 *
 * So no value of these rates makes the room decide matches. A room meant to
 * move a result has to stop being zero-sum inside the squad — a design change,
 * not a constant.
 */
export const ROOM_FORM_EASE = 0.1
export const ROOM_FORM_BOND = 0.05
export const ROOM_FORM_MAX = 3
export const ROOM_FORM_PULL = 0.06

/** His average bond with the rest of his club's squad. */
export function roomBond(state: GameState, p: Player): number {
  const others = squadOf(state, p.teamId ?? '').filter((x) => x.id !== p.id)
  return others.length ? others.reduce((s, x) => s + bondBetween(state, p.id, x.id), 0) / others.length : NEUTRAL
}

/** What everyone in a squad is measured against: its average ease, and its average bond (every player's average bond, averaged). */
export function roomBase(state: GameState, teamId: string): { ease: number; bond: number } {
  const squad = squadOf(state, teamId)
  return {
    ease: squad.length ? squad.reduce((s, x) => s + ease(x), 0) / squad.length : 0,
    bond: squadHarmony(state, teamId),
  }
}

/** What the room adds to how the coach sees him. */
export function roomEdge(state: GameState, p: Player, base = roomBase(state, p.teamId ?? '')): number {
  return clamp((ease(p) - base.ease) * ROOM_EDGE_EASE + (roomBond(state, p) - base.bond) * ROOM_EDGE_BOND, -ROOM_EDGE_MAX, ROOM_EDGE_MAX)
}

/** Where the room sets his form, against where it would be. */
export function roomForm(state: GameState, p: Player, base = roomBase(state, p.teamId ?? '')): number {
  return clamp((ease(p) - base.ease) * ROOM_FORM_EASE + (roomBond(state, p) - base.bond) * ROOM_FORM_BOND, -ROOM_FORM_MAX, ROOM_FORM_MAX)
}

/** The week's nudge, for everyone at my club. */
export function roomWeek(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return
  const squad = squadOf(state, state.myTeam)
  const base = roomBase(state, state.myTeam)
  // read the whole room before touching anyone, so the order of the roster does not matter
  const nudge = squad.map((p) => roomForm(state, p, base) * ROOM_FORM_PULL)
  squad.forEach((p, i) => { p.form = clamp(p.form + nudge[i], 30, 99) })
}

export interface RoomView {
  /** my average bond with the squad, and the squad's with itself */
  mine: number
  squad: number
  /** my ease, and the squad's average ease without me */
  ease: number
  mates: number
  /** where it puts my form, and what it adds in the coach's eyes */
  form: number
  edge: number
}

/** The team screen's chemistry line, as numbers; the screen puts them in words. */
export function roomView(state: GameState): RoomView | null {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return null
  const p = state.players[me.id]
  const others = squadOf(state, state.myTeam).filter((x) => x.id !== me.id)
  const base = roomBase(state, state.myTeam)
  return {
    mine: roomBond(state, p),
    squad: base.bond,
    ease: ease(p),
    mates: others.length ? others.reduce((s, x) => s + ease(x), 0) / others.length : 0,
    form: roomForm(state, p, base),
    edge: roomEdge(state, p, base),
  }
}
