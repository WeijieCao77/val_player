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
