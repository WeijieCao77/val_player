import frozen from '../data/npc_legacy_shifts.json'
import timelineRaw from '../data/timeline.json'
import type { Player } from './types'

/**
 * Published b2a2ea7-era numeric shifts, captured before database removals.
 * Recomputing percentiles after a removal would change OTHER players' old
 * baselines and prevent exact-match migration of otherwise untouched saves.
 * The snapshot contains no removed player's row. Only source fingerprints below
 * read live history; the remaining players' raw evidence is still unchanged.
 * check_oct01_legacy_snapshot verified all 11076 surviving old outputs before
 * replacing the algorithm, and pins their aggregate digest thereafter.
 */
const TABLES = frozen.years as Record<string, Record<string, number[]>>
export const legacyRulerShift = (year: number, id: string): number => TABLES[String(year)]?.[id]?.[0] ?? 0
export const legacyRegionalRulerShift = (year: number, id: string): number => TABLES[String(year)]?.[id]?.[1] ?? 0

interface SourceRating { n: number; v: [number | null, number | null] }
const BOOK = timelineRaw as unknown as { years: Record<string, { ratings: Record<string, SourceRating> }> }

/** Match the actual saved raw sample. Ambiguous, missing and future evidence
 * never guesses a source year or changes a player. Attribute shifts do not
 * alter these raw rating/ACS/rounds fingerprints.
 */
export function regionalRulerShiftForSample(year: number, id: string, sample: Player['vlr']): number {
  if (!sample || !Number.isFinite(sample.rounds) || sample.rounds < 0
    || !(sample.rating === null || Number.isFinite(sample.rating))
    || !(sample.acs === null || Number.isFinite(sample.acs))) return 0
  const matches: number[] = []
  for (const [key, book] of Object.entries(BOOK.years)) {
    const sourceYear = Number(key)
    if (sourceYear > year) continue
    const r = book.ratings[id]
    if (r && r.v[0] === sample.rating && r.v[1] === sample.acs && r.n === sample.rounds) {
      matches.push(legacyRegionalRulerShift(sourceYear, id))
    }
  }
  return matches.length && matches.every(d => d === matches[0]) ? matches[0] : 0
}
