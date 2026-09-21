import { SEASON_DAYS } from '../calendar'
import type { GameState } from '../types'
import type { MeAction } from './types'
import type { AbsenceReason, CareerAbsence } from './eventState'
import { ensureCareerEvents, recordCareerEvent } from './eventState'
import { pushLog } from './log'
import { sealWeek } from './undo'

/** The game's calendar has 364 days per season, not the display calendar's leap years. */
const stamp = (x: { year: number; day: number }) => x.year * SEASON_DAYS + x.day

/** Pure reader: old saves and completed leave do not create event history. */
export function activeAbsence(state: GameState): CareerAbsence | undefined {
  const a = state.me?.careerEvents?.absence
  return a && stamp(state) < stamp(a.until) ? a : undefined
}

export const absentPlayer = (state: GameState, id: string): boolean =>
  id === state.me?.id && !!activeAbsence(state)

export function absenceBlock(state: GameState): string | null {
  const a = activeAbsence(state)
  return a ? `${a.label}期间不能参赛或参加集训，预计 ${a.until.year} 赛季第 ${a.until.day + 1} 天归队。` : null
}

/** One light review per week; rest remains possible. No ranked, scrim, duel or commercial grind. */
export function absenceActionBlock(state: GameState, action: MeAction, booked = false): string | null {
  const a = activeAbsence(state)
  if (!a || action === 'rest') return null
  if (action === 'vod' && (state.me!.plan.vod ?? 0) < (booked ? 2 : 1)) return null
  return action === 'vod' ? `${a.label}期间每周最多安排一次轻量复盘。` : `${a.label}期间只能休息和每周一次轻量复盘。`
}

/** Starts a leave once. Ordinary injury care never changes this separate clock. */
export function beginAbsence(state: GameState, reason: AbsenceReason, durationDays: number | 'season', label: string): CareerAbsence {
  const existing = activeAbsence(state)
  if (existing) return existing
  absenceTick(state)
  const me = state.me!
  const book = ensureCareerEvents(state)
  const days = durationDays === 'season' ? SEASON_DAYS - state.day : Math.max(1, Math.min(730, Math.floor(Number.isFinite(durationDays) ? durationDays : 1)))
  const end = stamp(state) + days
  const a: CareerAbsence = {
    id: `${state.year}:${state.day}:${reason}:${book.records.length}`,
    reason, from: { year: state.year, day: state.day },
    until: { year: Math.floor(end / SEASON_DAYS), day: end % SEASON_DAYS },
    clubId: state.myTeam, wasStarter: !!state.teams[state.myTeam]?.starters.includes(me.id), label,
  }
  book.absence = a
  // These short event promises require play/training/streaming, all unavailable on approved leave.
  // Cancel rather than roll a day-only deadline across the year or award unearned completion.
  if (me.quests.length) {
    const titles = me.quests.map(q => q.title).join('、')
    me.quests = []
    pushLog(state, 'event', `获准长期缺席，当前限时待办撤销（${titles}）：不发完成奖励，也不追加失败惩罚。`)
  }
  // No half-completed training or trial can carry a player through a medical/leave gate.
  me.duelLive = undefined
  if (me.tryout) {
    const id = me.tryout.inviteId
    me.pending = me.pending.filter(x => !(x.kind === 'tryout' && x.id === id))
    me.tryout = undefined
  }
  me.pending = me.pending.filter(x => x.kind !== 'hurt')
  if (me.injury) me.injury.play = undefined
  const club = state.teams[state.myTeam]
  if (club) club.starters = club.starters.filter(id => id !== me.id)
  state.training[me.id] = 'rest'
  const line = `${label}：暂停比赛与集训，休息和每周一次轻量复盘仍可安排。`
  recordCareerEvent(state, reason === 'family' ? 'family' : 'medical', line)
  pushLog(state, 'event', line)
  sealWeek(state)
  return a
}

/** Called at a clock boundary, not while rendering. Each completed leave is counted once. */
export function absenceTick(state: GameState): void {
  const book = state.me?.careerEvents
  const a = book?.absence
  if (!book || !a || activeAbsence(state)) return
  delete book.absence
  if (a.reason === 'family') book.familyReturns++
  else book.returns++
  const line = `${a.label}结束，可以重新参与训练和选拔；首发位置仍由当前名单决定。`
  recordCareerEvent(state, 'return', line)
  pushLog(state, 'good', line)
}
