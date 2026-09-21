import type { GameState } from '../types'
import type { ArcDate, CareerEventState } from './eventState'
import { cleanCareerMarks } from './careerMarks'

const obj = (x: unknown): Record<string, unknown> | undefined => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : undefined
const str = (x: unknown, n = 120): string => typeof x === 'string' ? x.slice(0, n) : ''
const count = (x: unknown): number => typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(100000, Math.floor(x))) : 0
const rows = (x: unknown): Record<string, unknown>[] => Array.isArray(x) ? x.map(obj).filter((r): r is Record<string, unknown> => !!r) : []
const date = (x: unknown): ArcDate | undefined => {
  const d = obj(x)
  return d && Number.isInteger(d.year) && Number.isInteger(d.day) && Number(d.year) >= 2000 && Number(d.year) <= 2200 && Number(d.day) >= 0 && Number(d.day) <= 364
    ? { year: Number(d.year), day: Number(d.day) } : undefined
}
const medical = (x: unknown): x is 'surgery' | 'illness' | 'injury' => x === 'surgery' || x === 'illness' || x === 'injury'

/** No synthetic events for old saves. Reading twice must not award or replay anything. */
export function normalizeCareerEvents(s: GameState): void {
  const me = s.me
  if (!me) return
  if (me.ending?.marks !== undefined) {
    const marks = cleanCareerMarks(me.ending.marks)
    if (marks.length) me.ending.marks = marks
    else delete me.ending.marks
  }
  if (me.careerEvents === undefined) return
  const raw = obj(me.careerEvents)
  if (!raw) { delete me.careerEvents; return }
  const a: CareerEventState = {
    version: 1, records: [], disputes: [], missedFinals: [],
    returns: count(raw.returns), familyReturns: count(raw.familyReturns),
    reconciliations: count(raw.reconciliations), supportChoices: count(raw.supportChoices),
  }
  a.records = rows(raw.records).flatMap((r) => {
    const at = date(r), id = str(r.id), text = str(r.text, 1000)
    if (!at || !id || !text || !['medical', 'family', 'conflict', 'return', 'support'].includes(String(r.kind))) return []
    return [{ ...at, id, text, kind: r.kind as CareerEventState['records'][number]['kind'], ...(str(r.clubId) ? { clubId: str(r.clubId) } : {}), ...(str(r.mateId) ? { mateId: str(r.mateId) } : {}) }]
  }).slice(-96)
  a.disputes = rows(raw.disputes).flatMap((r) => {
    const at = date(r), mateId = str(r.mateId), clubId = str(r.clubId)
    return at && mateId && clubId && r.wasCore === true ? [{ ...at, mateId, clubId, mateName: str(r.mateName, 80), wasCore: true as const, dismissed: r.dismissed === true }] : []
  }).slice(-200)
  a.missedFinals = rows(raw.missedFinals).flatMap((r) => {
    const at = date(r), fixtureId = str(r.fixtureId), eventId = str(r.eventId), clubId = str(r.clubId)
    return at && fixtureId && eventId && clubId && medical(r.reason) ? [{ ...at, fixtureId, eventId, clubId, competition: str(r.competition, 120), reason: r.reason }] : []
  }).slice(-100)
  const absent = obj(raw.absence)
  if (absent) {
    const from = date(absent.from), until = date(absent.until)
    const id = str(absent.id), reason = absent.reason
    if (from && until && id && (reason === 'surgery' || reason === 'illness' || reason === 'family') && (until.year > from.year || (until.year === from.year && until.day > from.day)))
      a.absence = { id, reason, from, until, clubId: str(absent.clubId), wasStarter: absent.wasStarter === true, label: str(absent.label, 120) }
  }
  const core = obj(raw.pendingCore)
  if (core && str(core.mateId) && str(core.clubId) && (core.stage === 'warning' || core.stage === 'ultimatum'))
    a.pendingCore = { mateId: str(core.mateId), mateName: str(core.mateName, 80), clubId: str(core.clubId), sinceWeek: count(core.sinceWeek), stage: core.stage }
  for (const key of ['diagnosis', 'medicalRetirement'] as const) {
    const r = obj(raw[key]), at = date(r)
    if (r && at && typeof r.peakOverall === 'number' && Number.isFinite(r.peakOverall)) a[key] = { ...at, peakOverall: Math.max(0, Math.min(100, r.peakOverall)), atPeak: r.atPeak === true }
  }
  const final = obj(raw.pendingMedicalFinal), at = date(final)
  if (final && at && str(final.fixtureId) && str(final.clubId) && medical(final.reason)) a.pendingMedicalFinal = { ...at, fixtureId: str(final.fixtureId), clubId: str(final.clubId), reason: final.reason }
  if (typeof raw.lastMajorWeek === 'number' && Number.isFinite(raw.lastMajorWeek)) a.lastMajorWeek = count(raw.lastMajorWeek)
  me.careerEvents = a
}
