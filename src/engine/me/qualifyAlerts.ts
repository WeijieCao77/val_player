import type { GameState } from '../types'
import type { MomentItem } from './types'
import { compClass } from './compclass'

export type QualifyAlertMode = 'all' | 'yearly' | 'first'
type QualClass = 'masters' | 'champions' | 'lockin'
export interface QualifyAlertPrefs {
  mode?: QualifyAlertMode
  firstKeys?: Partial<Record<QualClass, string>>
  yearFirstKeys?: Partial<Record<QualClass, { year: number; key: string }>>
}
type Book = Required<QualifyAlertPrefs>
const classes: QualClass[] = ['masters', 'champions', 'lockin']
const validKey = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 1024
const validYear = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 10000
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
const modeOf = (v: unknown): QualifyAlertMode => v === 'yearly' || v === 'first' ? v : 'all'

/** Reads are pure, including imports from before this setting existed. */
export function normalizeQualifyAlertPrefs(raw: unknown): Book {
  const data = object(raw), first = object(data.firstKeys), years = object(data.yearFirstKeys)
  const book: Book = { mode: modeOf(data.mode), firstKeys: {}, yearFirstKeys: {} }
  for (const cls of classes) {
    if (validKey(first[cls])) book.firstKeys[cls] = first[cls]
    const rec = object(years[cls])
    if (validKey(rec.key) && validYear(rec.year)) book.yearFirstKeys[cls] = { key: rec.key, year: rec.year }
  }
  return book
}
export const qualificationMode = (state: GameState): QualifyAlertMode => normalizeQualifyAlertPrefs(state.me?.qualifyAlerts).mode
const category = (m: Pick<MomentItem, 'kind' | 'comp'>): QualClass | undefined => {
  if (m.kind !== 'qualify') return
  const cls = compClass(typeof m.comp === 'string' ? m.comp : '')
  return cls === 'masters' || cls === 'champions' || cls === 'lockin' ? cls : undefined
}
function remember(book: Book, cls: QualClass, key: string, year: number): void {
  book.firstKeys[cls] ??= key
  if (!book.yearFirstKeys[cls] || year > book.yearFirstKeys[cls]!.year) book.yearFirstKeys[cls] = { year, key }
}
/** Legacy queued cards are evidence; unknown, already-consumed history is not.
 * Keep known consumed first keys: changing a setting never resets the book. */
function seedQueue(book: Book, queue: MomentItem[]): void {
  for (const m of queue) {
    const cls = category(m)
    if (cls && validKey(m.key) && validYear(m.year)) remember(book, cls, m.key, m.year)
  }
}

/** Called only at the engine's enqueue boundary. A suppressed qualification
 * never changes momentMark and therefore never interrupts advanceUntil. */
export function queueQualification(state: GameState, m: Omit<MomentItem, 'year' | 'day'>): boolean {
  const cls = category(m), me = state.me
  if (!cls || !me) return true
  const book = normalizeQualifyAlertPrefs(me.qualifyAlerts)
  seedQueue(book, me.moments ?? [])
  remember(book, cls, m.key, state.year)
  me.qualifyAlerts = book
  return book.mode === 'all' || book.firstKeys[cls] === m.key
    || (book.mode === 'yearly' && book.yearFirstKeys[cls]?.year === state.year && book.yearFirstKeys[cls]?.key === m.key)
}

/** Applies immediately to queued repeats without hiding a blocking queue head.
 * All other moment types and unrecognised legacy qualification names survive. */
export function setQualificationMode(state: GameState, mode: QualifyAlertMode): void {
  const me = state.me
  if (!me) return
  const book = normalizeQualifyAlertPrefs(me.qualifyAlerts), queue = me.moments ?? []
  // For old multi-year queues preserve each observed year's first card. A
  // persisted key wins over the queue because that card may already be taken.
  const yearKeys = new Map<string, string>()
  for (const cls of classes) {
    const rec = book.yearFirstKeys[cls]
    if (rec) yearKeys.set(`${cls}:${rec.year}`, rec.key)
  }
  for (const m of queue) {
    const cls = category(m)
    if (cls && validYear(m.year) && !yearKeys.has(`${cls}:${m.year}`)) yearKeys.set(`${cls}:${m.year}`, m.key)
  }
  seedQueue(book, queue)
  book.mode = modeOf(mode)
  me.qualifyAlerts = book
  if (book.mode !== 'all') me.moments = queue.filter((m) => {
    const cls = category(m)
    return !cls || book.firstKeys[cls] === m.key
      || (book.mode === 'yearly' && yearKeys.get(`${cls}:${m.year}`) === m.key)
  })
}
