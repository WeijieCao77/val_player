import type { GameState } from '../types'
import type { MeAction, MeState, WeekStart } from './types'

/**
 * 加一次、减一次: a card's + does the session now, its − takes that one back.
 *
 * The author, 2026-09-20: 「就直接是每个选项后面都可以加减，加了数值就会变化，
 * 减了就变回去」, and 「只要没点下一周就都能回退但是我又能知道点了的话我会收获
 * 什么」. So the click is real — the points, the body, the attribute, the ladder
 * and the money all move at once, which is the 预览 — and any one of the week's
 * sessions can be taken off again until 推进 closes the week.
 *
 * How a − stays honest. An action is not invertible by arithmetic: xp that
 * crossed a point takes the attribute with it, a ladder score that reached the
 * top pays the rest down against the board, side income past the platform's
 * weekly cap only pays a tenth of the rest, a bond clamps. So nothing is
 * subtracted. The week keeps what it started from (me.weekStart) and the list
 * of what has been done since (me.weekDone); a − drops that card's last entry
 * from the list and plays the week again from its start.
 *
 * Why replaying does not re-roll. A session's draw is seeded on how many times
 * *that card* has been used this week, not on where it sits among the others
 * (me/growth.ts runAction). Taking a 复盘 off therefore leaves every 打排位 of
 * the week on the draw it always had, and putting the 复盘 back gives it the
 * one it had before. What can change is what the later sessions meet — a
 * ranked night replayed without an hour of practice in front of it is played
 * on fresher legs — and that is the truth of the week as it now stands, not a
 * new roll. The board says so when a line changes.
 *
 * The snapshot rides in the save, because only 推进下一周 settles a week: a
 * reload keeps every − available. It is kept narrow for that reason — the
 * fields an action can actually move, plus the lengths of the lists it only
 * ever appends to (scripts/check_save_size.ts watches the cost).
 */

/** what the career keeps by value: the small fields an action can move */
const ME_FIELDS = [
  'ap', 'plan', 'trainWeek', 'mediaWeek', 'tilt', 'mental', 'body', 'heat', 'money',
  'coachTrust', 'scrimRounds', 'duoWith', 'pre', 'stream', 'quests', 'flags', 'ledger',
] as const
/** and the lists it only appends to, kept as a length and cut back to it */
const ME_LISTS = ['log', 'moments', 'weekNotes', 'weekLog', 'achievements'] as const
/** my player: the eight, their progress, and what a session wears */
const P_FIELDS = ['attrs', 'xp', 'overall', 'potential', 'value', 'fatigue', 'form', 'morale'] as const

const copy = <T>(x: T): T => (typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)) as T)

/** What the week started from, as small as the replay can be. */
export function weekStartSnap(state: GameState): WeekStart {
  const me = state.me!
  const p = state.players[me.id]
  const rec = me as unknown as Record<string, unknown>
  const prec = p as unknown as Record<string, unknown>
  const mine: Record<string, unknown> = {}
  for (const k of ME_FIELDS) if (rec[k] !== undefined) mine[k] = copy(rec[k])
  // a list the week has not written to yet is not there at all (noteAction's ??=). Leaving it out
  // of the record left the rewind with nothing to cut back to, so absence is written down as −1
  // and the rewind takes the key away again rather than leaving an empty array in the save.
  const cut: Record<string, number> = {}
  for (const k of ME_LISTS) { const v = rec[k]; cut[k] = Array.isArray(v) ? v.length : -1 }
  const player: Record<string, unknown> = {}
  for (const k of P_FIELDS) if (prec[k] !== undefined) player[k] = copy(prec[k])
  // only the pairs I am in can move (engine/bonds.ts duoBonded), and only my own programme
  const bonds: Record<string, number> = {}
  for (const [k, v] of Object.entries(state.bonds ?? {})) if (k.includes(me.id)) bonds[k] = v
  return { week: me.week, me: mine, cut, player, bonds, training: state.training?.[me.id], ...(state.bonds ? {} : { noBonds: true as const }) }
}

/** Put the week back to what it started from. */
export function restoreWeekStart(state: GameState, snap: WeekStart): void {
  const me = state.me!
  const p = state.players[me.id]
  const rec = me as unknown as Record<string, unknown>
  const prec = p as unknown as Record<string, unknown>
  for (const k of ME_FIELDS) {
    if (k in snap.me) rec[k] = copy(snap.me[k])
    else delete rec[k]
  }
  for (const k of ME_LISTS) {
    const v = rec[k]
    const n = snap.cut[k] ?? -1
    if (!Array.isArray(v)) continue
    if (n < 0) delete rec[k]
    else if (v.length > n) v.length = n
  }
  for (const k of P_FIELDS) if (k in snap.player) prec[k] = copy(snap.player[k])
  // never called into being by a rewind: a career that had no book of who it gets on with keeps none
  if (snap.noBonds) delete state.bonds
  else if (state.bonds) {
    const bonds = state.bonds
    for (const k of Object.keys(bonds)) if (k.includes(me.id)) delete bonds[k]
    for (const [k, v] of Object.entries(snap.bonds)) bonds[k] = v
  }
  if (state.training) {
    if (snap.training === undefined) delete state.training[me.id]
    else state.training[me.id] = snap.training as (typeof state.training)[string]
  }
}

/** The week's replayable sessions: everything done since the last thing that cannot be replayed. */
export const replayable = (me: MeState): MeAction[] => (me.weekDone ?? []).slice(me.undoFrom ?? 0)

/** How many of this week's sessions can still be taken off. */
export const undoDepth = (state: GameState): number => (state.me ? replayable(state.me).length : 0)

/** Can this card's last session be taken off? */
export const canUndo = (state: GameState, action: MeAction): boolean =>
  !!state.me?.weekStart && replayable(state.me).includes(action)

/**
 * The week is settled, or something happened in it that cannot be replayed (a
 * duel, which is three scenes the player sat through). From here the week's
 * 「−」 reaches back no further; what is already done stays done.
 */
export function sealWeek(state: GameState): void {
  const me = state.me
  if (!me) return
  me.weekStart = undefined
  // 0 and absent mean the same thing; only one of them costs the save a field
  me.undoFrom = (me.weekDone ?? []).length || undefined
}

/** A new week, or the first session of one: the week starts from here. */
export function markWeekStart(state: GameState): void {
  const me = state.me
  if (!me) return
  if (me.weekStart && me.weekStart.week === me.week) return
  me.weekStart = weekStartSnap(state)
  me.undoFrom = (me.weekDone ?? []).length || undefined
}

/** 「这周做过的都能减掉，推进一周才定下来」 — the boundary, said where the cards are. */
export const UNDO_EDGE_CN = '这周做过的都能用「−」退回去，推进一周才定下来。'
/** said once under the flow when taking one off moved the lines after it */
export const REPLAY_CN = '退掉之后，后面几项按没做过这一项重算了。'
