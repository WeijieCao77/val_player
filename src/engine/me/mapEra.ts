import { MAPS } from '../content'
import { ARRIVALS } from './releases'

/** All five existed before the earliest playable career (2021-01-01).
 * A new catalogue entry must supply an arrival, never silently become a
 * launch map. Availability is not a claim to reproduce every VCT rotation.
 */
export const CAREER_LAUNCH_MAPS = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Split'] as const
const initial = new Set<string>(CAREER_LAUNCH_MAPS)

export function mapAvailableOn(name: string, year: number, day: number): boolean {
  if (initial.has(name)) return true
  const release = ARRIVALS.find(a => a.kind === 'map' && a.name === name)
  return !!release && (year > release.year || year === release.year && day >= release.day)
}

export const mapsAvailableOn = (year: number, day: number): string[] =>
  MAPS.filter(name => mapAvailableOn(name, year, day))

/**
 * The day each map after the launch five was first played in a professional match of the events this game plays
 * (src/data/circuit.json), off vlr.gg's match pages — before then no pro pool had it, whatever day its patch came.
 * Reported 2026-09-21 (「有些地图过早出现在比赛图池」): Breeze was in a pro match here the day after its patch; really
 * it waited for Stage 3's Challengers, and Pearl, out on 22 June 2022, sat out Masters Copenhagen and the Last Chance
 * Qualifiers and opened at Champions. Found by reading each event's maps (vlr.gg/event/agents/…) from the release
 * on, then each match of the events that played it, in order; days as the game counts them, 1 January = 0, UTC.
 * A map not listed here (none yet announced) enters with its patch.
 */
export const FIRST_PRO: Readonly<Record<string, { year: number; day: number; match: string }>> = {
  Breeze: { year: 2021, day: 178, match: 'vlr.gg/23680' },   // 28 Jun 2021, Europe Stage 3 Challengers 1 qualifier
  Fracture: { year: 2021, day: 334, match: 'vlr.gg/51283' }, // 1 Dec 2021, Champions Berlin opening day
  Pearl: { year: 2022, day: 242, match: 'vlr.gg/130617' },   // 31 Aug 2022, Champions Istanbul opening day
  Lotus: { year: 2023, day: 39, match: 'vlr.gg/164472' },    // 9 Feb 2023, Challengers East Surge Split 1
  Sunset: { year: 2023, day: 250, match: 'vlr.gg/271941' },  // 8 Sep 2023, China Evolution Series Act 1 qualifier
  Abyss: { year: 2024, day: 191, match: 'vlr.gg/369421' },   // 10 Jul 2024, WDG Challengers Korea Split 2
  Corrode: { year: 2025, day: 183, match: 'vlr.gg/506930' }, // 3 Jul 2025, VCT China Stage 2 opening day
  Summit: { year: 2026, day: 190, match: 'vlr.gg/701027' },  // 10 Jul 2026, VCT China Stage 2
}

/** In a professional map pool on this day: released, and — where the date is known — played by the pros by then. */
export function mapInProPoolOn(name: string, year: number, day: number): boolean {
  if (!mapAvailableOn(name, year, day)) return false
  const first = FIRST_PRO[name]
  return !first || year > first.year || (year === first.year && day >= first.day)
}

export const proMapsAvailableOn = (year: number, day: number): string[] =>
  MAPS.filter(name => mapInProPoolOn(name, year, day))
