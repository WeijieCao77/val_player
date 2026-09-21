import type { GameState } from '../types'

export interface ArcDate { year: number; day: number }
export type AbsenceReason = 'surgery' | 'illness' | 'family'
export interface CareerAbsence {
  id: string
  reason: AbsenceReason
  from: ArcDate
  until: ArcDate
  clubId: string
  wasStarter: boolean
  label: string
}
export interface CareerEventRecord extends ArcDate {
  id: string
  kind: 'medical' | 'family' | 'conflict' | 'return' | 'support'
  text: string
  clubId?: string
  mateId?: string
}
export interface CoreDispute extends ArcDate {
  mateId: string
  mateName: string
  clubId: string
  wasCore: true
  dismissed: boolean
}
export interface MissedFinal extends ArcDate {
  fixtureId: string
  eventId: string
  competition: string
  clubId: string
  reason: 'surgery' | 'illness' | 'injury'
}
export interface CareerEventState {
  version: 1
  absence?: CareerAbsence
  records: CareerEventRecord[]
  disputes: CoreDispute[]
  missedFinals: MissedFinal[]
  pendingMedicalFinal?: { fixtureId: string; year: number; day: number; clubId: string; reason: 'surgery' | 'illness' | 'injury' }
  pendingCore?: { mateId: string; mateName: string; clubId: string; sinceWeek: number; stage: 'warning' | 'ultimatum' }
  diagnosis?: ArcDate & { peakOverall: number; atPeak: boolean }
  medicalRetirement?: ArcDate & { peakOverall: number; atPeak: boolean }
  lastMajorWeek?: number
  returns: number
  familyReturns: number
  reconciliations: number
  supportChoices: number
}

/** Old saves have no invented history; readers never initialize this object. */
export const careerEventsOf = (s: GameState): CareerEventState | undefined => s.me?.careerEvents
export function ensureCareerEvents(s: GameState): CareerEventState {
  return s.me!.careerEvents ??= { version: 1, records: [], disputes: [], missedFinals: [], returns: 0, familyReturns: 0, reconciliations: 0, supportChoices: 0 }
}
export function recordCareerEvent(s: GameState, kind: CareerEventRecord['kind'], text: string, mateId?: string): void {
  const a = ensureCareerEvents(s)
  const previous = Number(a.records.at(-1)?.id.split(':').at(-1) ?? 0)
  const serial = Number.isSafeInteger(previous) ? previous + 1 : a.records.length + 1
  a.records.push({ id: `${s.year}:${s.day}:${s.me!.eventsSeen}:${serial}`, kind, text, year: s.year, day: s.day, clubId: s.myTeam || undefined, mateId })
  if (a.records.length > 96) a.records.splice(0, a.records.length - 96)
}
