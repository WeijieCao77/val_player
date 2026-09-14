import { clamp } from '../rng'
import type { GameState, Player } from '../types'
import { bondBetween, ease, squadHarmony } from '../bonds'
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
 *    about the same level, the one who is easy to play with and gets on with
 *    the squad. ROOM_EDGE_MAX either way, on a scale where a point is a point of
 *    综合 — it settles a close call and cannot bench a clearly better player;
 *  - form (roomForm, roomWeek): a player at ease in the room plays nearer his
 *    best. Nudged every week at the rate the engine pulls form back to 70
 *    (engine/training.ts weeklyTick), so it settles about roomForm away from
 *    where it would have been, ROOM_FORM_MAX either way.
 *
 * Both read the same two things: the player's own ease (协同 and 沟通 against
 * 70) and his average bond with the rest of the squad against ROOM_BOND_REF.
 */

/** the bond a squad settles around in a career's first seasons (scripts/probe_igl.ts, 2026: 20–30) */
export const ROOM_BOND_REF = 30
/** the coach's eye: per point of ease, per point of bond, and the most it moves a player */
export const ROOM_EDGE_EASE = 0.05
export const ROOM_EDGE_BOND = 0.02
export const ROOM_EDGE_MAX = 1.5
/** form: per point of ease, per point of bond, the most, and the weekly share of it applied */
export const ROOM_FORM_EASE = 0.15
export const ROOM_FORM_BOND = 0.08
export const ROOM_FORM_MAX = 4
export const ROOM_FORM_PULL = 0.06

/** His average bond with the rest of his club's squad. */
export function roomBond(state: GameState, p: Player): number {
  const others = squadOf(state, p.teamId ?? '').filter((x) => x.id !== p.id)
  return others.length ? others.reduce((s, x) => s + bondBetween(state, p.id, x.id), 0) / others.length : ROOM_BOND_REF
}

/** What the room adds to how the coach sees him. */
export function roomEdge(state: GameState, p: Player): number {
  return clamp(ease(p) * ROOM_EDGE_EASE + (roomBond(state, p) - ROOM_BOND_REF) * ROOM_EDGE_BOND, -ROOM_EDGE_MAX, ROOM_EDGE_MAX)
}

/** Where the room sets his form, against where it would be. */
export function roomForm(state: GameState, p: Player): number {
  return clamp(ease(p) * ROOM_FORM_EASE + (roomBond(state, p) - ROOM_BOND_REF) * ROOM_FORM_BOND, -ROOM_FORM_MAX, ROOM_FORM_MAX)
}

/** The week's nudge, for everyone at my club. */
export function roomWeek(state: GameState): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return
  const squad = squadOf(state, state.myTeam)
  // read the whole room before touching anyone, so the order of the roster does not matter
  const nudge = squad.map((p) => roomForm(state, p) * ROOM_FORM_PULL)
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
  return {
    mine: roomBond(state, p),
    squad: squadHarmony(state, state.myTeam),
    ease: ease(p),
    mates: others.length ? others.reduce((s, x) => s + ease(x), 0) / others.length : 0,
    form: roomForm(state, p),
    edge: roomEdge(state, p),
  }
}
