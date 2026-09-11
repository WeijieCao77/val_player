/**
 * When agents and maps actually arrived — for 版本发布会 (me/nights.ts).
 *
 * The repo holds no patch notes. What it does hold is stats_players.json, the
 * agents each professional played per year, and scripts/check_ceremony.ts
 * holds this table against it: an agent may not be dated after the first year
 * the professional data has anyone on it, nor more than a year before.
 *
 * Only arrivals from 2020 on are listed, each with the patch day it went live
 * (day 0 = 1 January). The launch roster needs no entry: it was there before
 * any year this game plays. Nothing past the last real arrival is listed, and
 * nothing may be — the years after that are told without names. An agent the
 * data knows but content.ts has no official Chinese name for is left out
 * rather than given one.
 */

export interface Arrival {
  /** the English key, exactly as content.ts spells it */
  name: string
  kind: 'agent' | 'map'
  year: number
  /** day of the year it went live */
  day: number
}

export const ARRIVALS: Arrival[] = [
  { name: 'Killjoy', kind: 'agent', year: 2020, day: 216 },   // 4 Aug 2020, patch 1.05
  { name: 'Skye', kind: 'agent', year: 2020, day: 300 },      // 27 Oct 2020, patch 1.11
  { name: 'Yoru', kind: 'agent', year: 2021, day: 11 },       // 12 Jan 2021, patch 2.0
  { name: 'Astra', kind: 'agent', year: 2021, day: 60 },      // 2 Mar 2021, patch 2.04
  { name: 'Breeze', kind: 'map', year: 2021, day: 116 },      // 27 Apr 2021, patch 2.08
  { name: 'KAY/O', kind: 'agent', year: 2021, day: 172 },     // 22 Jun 2021, patch 3.0
  { name: 'Fracture', kind: 'map', year: 2021, day: 250 },    // 8 Sep 2021, patch 3.05
  { name: 'Chamber', kind: 'agent', year: 2021, day: 319 },   // 16 Nov 2021, patch 3.10
  { name: 'Neon', kind: 'agent', year: 2022, day: 10 },       // 11 Jan 2022, patch 4.0
  { name: 'Fade', kind: 'agent', year: 2022, day: 116 },      // 27 Apr 2022, patch 4.08
  { name: 'Pearl', kind: 'map', year: 2022, day: 172 },       // 22 Jun 2022, patch 5.0
  { name: 'Harbor', kind: 'agent', year: 2022, day: 290 },    // 18 Oct 2022, patch 5.08
  { name: 'Lotus', kind: 'map', year: 2023, day: 9 },         // 10 Jan 2023, patch 6.0
  { name: 'Gekko', kind: 'agent', year: 2023, day: 65 },      // 7 Mar 2023, patch 6.04
  { name: 'Deadlock', kind: 'agent', year: 2023, day: 177 },  // 27 Jun 2023, patch 7.0
  { name: 'Sunset', kind: 'map', year: 2023, day: 240 },      // 29 Aug 2023, patch 7.04
  { name: 'Iso', kind: 'agent', year: 2023, day: 303 },       // 31 Oct 2023, patch 7.09
  { name: 'Clove', kind: 'agent', year: 2024, day: 85 },      // 26 Mar 2024, patch 8.05
  { name: 'Abyss', kind: 'map', year: 2024, day: 162 },       // 11 Jun 2024, patch 8.11
  { name: 'Vyse', kind: 'agent', year: 2024, day: 239 },      // 27 Aug 2024, patch 9.04
  { name: 'Tejo', kind: 'agent', year: 2025, day: 7 },        // 8 Jan 2025, patch 10.0
  { name: 'Waylay', kind: 'agent', year: 2025, day: 63 },     // 5 Mar 2025, patch 10.04
  { name: 'Corrode', kind: 'map', year: 2025, day: 174 },     // 24 Jun 2025, patch 11.0
]

/** The last year this table speaks for; after it, a patch night names nothing. */
export const ARRIVALS_UNTIL = 2025

const at = (year: number, day: number) => year * 400 + day

/** Out by this date? Anything not listed was out before 2020. */
export function arrivedBy(name: string, year: number, day: number): boolean {
  const a = ARRIVALS.find((x) => x.name === name)
  return !a || at(a.year, a.day) <= at(year, day)
}

/** What went live between two dates, oldest first: (from, to]. */
export function arrivalsBetween(fromYear: number, fromDay: number, toYear: number, toDay: number): Arrival[] {
  const lo = at(fromYear, fromDay)
  const hi = at(toYear, toDay)
  return ARRIVALS.filter((a) => at(a.year, a.day) > lo && at(a.year, a.day) <= hi)
}
