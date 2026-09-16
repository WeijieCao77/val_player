import raw from '../data/staff_stints.json'
import { hashStr } from './rng'

/**
 * The people vlr lists on a club's staff — coach, head coach, assistant coach,
 * analyst, manager — on days the roster book once had them as players.
 *
 * Reported 2026-09-14: Muggle, EDward Gaming's coach since 2022, played matches
 * in the game as one of EDG's five. To the builders anyone who took the server
 * at a Riot event was a player, and his two maps as a stand-in at the 2025
 * China Evolution Series made him one. src/data/staff_stints.json holds everyone
 * checked seat by seat against his vlr team history, with the stints vlr has
 * him on a staff; the builders read it (scripts/staff.py), so the book gives
 * nobody a seat, a rating or a year on record from inside one. This is the same
 * file for a save already under way (me/staffMigrate.ts).
 *
 * A month is whole — 「March 2022 – June 2024」 is 1 March 2022 to 30 June 2024 —
 * and an end vlr does not give is open.
 *
 * Beside the stints the file says what each man is (`people`), because a stint
 * alone is the wrong shape for a career. Two things a stint cannot say:
 *
 *  - Some of these men never played professionally at all — vlr's team history
 *    has them on a staff and nowhere else. Muggle is one, and so are eleven
 *    others. A man like that is not a player on any day, not only inside a
 *    stint (`played: false`).
 *  - A man who played and then went to a staff does not go back. Read stint by
 *    stint he did: oderus coached Apeks to October 2025 and the day after that
 *    stint closed he was a free agent again, twenty-six years old and available
 *    to sign. `coachFrom` is the month he went to a staff for good, and from its
 *    first day he is never in the pool again whether or not a stint covers it.
 *
 * It is one question — is this man a player today — so it is one predicate,
 * `offPoolOn`, and every path that could put somebody into the player pool asks
 * it: the roster book making a man the first time he is needed
 * (timeline.ts ensurePlayer), the world built at 2021, 2026's professionals
 * below the leagues (today.ts), the free agents an AI club signs from
 * (season.ts, transfer.ts), New Year's free agency and the player's own club
 * (me/market.ts, me/club.ts), and the men a short side calls up on a match day
 * (standin.ts). A save from before asks it once as it loads (me/staffMigrate.ts).
 *
 * `coachFrom` is null for a man still playing, and for one whose last playing
 * month cannot be pinned down — vlr and the roster book disagree about him, so
 * he is kept out only inside his stints, as before, and the row says why
 * (`note`).
 */

export interface StaffStint {
  vlr: string
  ign: string
  club: string
  clubVlr: string
  role: string
  /** YYYY-MM, or null where vlr gives no start */
  from: string | null
  /** YYYY-MM, or null where vlr gives no end */
  to: string | null
  source: string
  checked: string
}

/** What one of these men is, beside the clubs he has served. */
export interface StaffPerson {
  vlr: string
  ign: string
  /** was he ever a professional player at all — false is a man vlr only ever lists on a staff */
  played: boolean
  /** YYYY-MM he went to a staff and never went back on a roster; null where he still plays, or the month cannot be pinned down */
  coachFrom: string | null
  source: string
  checked: string
  /** why he has no `coachFrom` where the record is not clean */
  note?: string
}

const DATA = 'src/data/staff_stints.json'

/**
 * The file has to be whole before anything reads it.
 *
 * Both halves are written together by scripts/staff.py, but a file caught
 * half-written — or one from before a half existed — used to read as
 * `undefined` and fail at the first use of it, several modules away, as
 * 「Cannot read properties of undefined」 with nothing naming the file. A
 * missing half is a broken build: say so here, say which key and which file.
 */
function required<T>(rows: unknown, key: 'stints' | 'people'): T[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(
      `${DATA} 缺少 \`${key}\`：期望一个非空数组，实际读到 ${rows === undefined ? 'undefined' : JSON.stringify(rows)?.slice(0, 60)}。`
      + `这份教练组数据由 scripts/staff.py 写出，两部分（stints 任期、people 其人）必须齐全；`
      + `数据不全时宁可在这里停下，也不要让某个模块在很远的地方报一个看不出原因的错。`,
    )
  }
  return rows as T[]
}

export const STAFF_STINTS = required<StaffStint>((raw as { stints?: unknown }).stints, 'stints')
export const STAFF_PEOPLE = required<StaffPerson>((raw as { people?: unknown }).people, 'people')

/** The data as a stamp: a save brought up to it (WorldState.staffSync) is not brought up to it again. */
export const STAFF_STAMP = hashStr([
  ...STAFF_STINTS.map((s) => `${s.vlr}:${s.from ?? ''}:${s.to ?? ''}`),
  ...STAFF_PEOPLE.map((p) => `${p.vlr}:${p.played ? 1 : 0}:${p.coachFrom ?? ''}`),
].join('|')).toString(36)

/** The calendar day a season's day number falls on, as YYYY-MM-DD. */
export const dateOf = (year: number, day: number): string =>
  new Date(Date.UTC(year, 0, 1) + Math.round(day) * 86_400_000).toISOString().slice(0, 10)

const BY_VLR = new Map<string, StaffStint[]>()
for (const s of STAFF_STINTS) BY_VLR.set(s.vlr, [...(BY_VLR.get(s.vlr) ?? []), s])

/** Everyone the file names, by vlr id. */
export const staffPeople = (): string[] => [...BY_VLR.keys()]

/** The stint a person was on a staff in on a YYYY-MM-DD day, if any. */
export function staffStintOn(vlr: string, date: string): StaffStint | undefined {
  return (BY_VLR.get(vlr) ?? []).find((s) => (!s.from || `${s.from}-01` <= date) && (!s.to || date <= `${s.to}-31`))
}

const BY_PERSON = new Map(STAFF_PEOPLE.map((p) => [p.vlr, p]))

/** What the file says this man is, if it names him. */
export const staffPersonOf = (vlr: string): StaffPerson | undefined => BY_PERSON.get(vlr)

/**
 * Is this man off the player pool on this day — the one question every path asks.
 *
 * Three ways to be off it, in the order they settle the matter: he never played
 * professionally at all, so no day is his; he went to a staff for good and this
 * day is on or after that month; or a stint of his covers this day.
 */
export function offPoolOn(vlr: string, date: string): boolean {
  const who = BY_PERSON.get(vlr)
  if (who) {
    if (!who.played) return true
    if (who.coachFrom && `${who.coachFrom}-01` <= date) return true
  }
  return !!staffStintOn(vlr, date)
}

/** The book's people carry their vlr id in their player id; nobody else here is one of these men. */
const vlrOf = (playerId: string): string | null => (/^V\d+$/.test(playerId) ? playerId.slice(1) : null)

/** The same question about a man the game already holds, by player id. */
export function offPool(playerId: string, date: string): boolean {
  const v = vlrOf(playerId)
  return v !== null && offPoolOn(v, date)
}
