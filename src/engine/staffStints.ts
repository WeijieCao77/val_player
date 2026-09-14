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

export const STAFF_STINTS = (raw as unknown as { stints: StaffStint[] }).stints

/** The data as a stamp: a save brought up to it (WorldState.staffSync) is not brought up to it again. */
export const STAFF_STAMP = hashStr(STAFF_STINTS.map((s) => `${s.vlr}:${s.from ?? ''}:${s.to ?? ''}`).join('|')).toString(36)

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
