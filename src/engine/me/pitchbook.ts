import type { GameState } from '../types'
import type { PitchBook } from './types'
import { pushLog } from './log'
import { periodKey } from './window'

/**
 * The book 自荐 and 主动接触 keep (me/selfpitch.ts), on its own so the contract code can call a
 * pitch off when I sign somewhere without reaching the pitch's odds and answers. Nothing here
 * imports more than the log and the window's calendar.
 */

const blank = (period: number): PitchBook => ({ period, sent: [], contacted: [], rejected: [], replies: [] })

export const tallyOf = (b: PitchBook): NonNullable<PitchBook['tally']> =>
  (b.tally ??= { sent: 0, replied: 0, ok: 0, cancelled: 0, odds: 0 })

/**
 * The book as it reads today, without writing to the save: a career from before 自荐 has none and
 * reads as a blank one, and the counts of a transfer period gone by read as empty.
 */
export function pitchBook(state: GameState): PitchBook {
  const key = periodKey(state.year, state.day)
  const b = state.me?.pitch
  if (!b) return blank(key)
  return b.period === key ? b : { ...b, period: key, sent: [], contacted: [] }
}

/** The save's own book, made if it is missing and rolled on to today's transfer period. */
export function pitchBookMut(state: GameState): PitchBook {
  const me = state.me!
  const key = periodKey(state.year, state.day)
  const b = (me.pitch ??= blank(key))
  if (b.period !== key) {
    b.period = key
    b.sent = []
    b.contacted = []
  }
  // a no from a season gone has lapsed
  b.rejected = b.rejected.filter((r) => r.year === state.year)
  return b
}

/**
 * Signed, or agreed, with a club while a 自荐 or a contact is still waiting on its answer: it is
 * called off, and the log says so unless it was that club I signed for.
 */
export function dropPitch(state: GameState, teamId: string, verb = '签了约'): void {
  const me = state.me
  const out = me?.pitch?.out
  if (!me?.pitch || !out) return
  me.pitch.out = undefined
  tallyOf(me.pitch).cancelled++
  if (out.teamId === teamId) return
  const name = (id: string) => state.teams[id]?.name ?? '那家俱乐部'
  pushLog(state, 'deal', `你和 ${name(teamId)} ${verb}，给 ${name(out.teamId)} 的${out.kind === 'contact' ? '接触' : '自荐'}作废了。`)
}

/** A save's book, whatever wrote it: missing lists are empty lists, an answer for a club that is gone is dropped with its card. */
export function normalizePitch(state: GameState): void {
  const me = state.me
  const b = me?.pitch
  if (!me || !b) return
  if (typeof b.period !== 'number') b.period = periodKey(state.year, state.day)
  b.sent = Array.isArray(b.sent) ? b.sent.filter((x) => typeof x === 'string') : []
  b.contacted = Array.isArray(b.contacted) ? b.contacted.filter((x) => typeof x === 'string') : []
  b.rejected = Array.isArray(b.rejected) ? b.rejected.filter((r) => typeof r === 'object' && r !== null && typeof r.year === 'number') : []
  b.replies = Array.isArray(b.replies) ? b.replies.filter((r) => typeof r === 'object' && r !== null && !!state.teams[r.teamId]) : []
  if (b.out && (typeof b.out.due !== 'number' || typeof b.out.odds !== 'number' || !state.teams[b.out.teamId])) b.out = undefined
  me.pending = me.pending.filter((x) => x.kind !== 'pitch' || b.replies.some((r) => r.id === x.id))
}
