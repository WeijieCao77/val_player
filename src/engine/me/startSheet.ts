import { ENTRY_YEARS } from '../era'
import type { EntryYear } from '../era'
import { entryBands } from '../ruler'
import type { EntryBands } from '../ruler'
import type { Region } from '../types'
import { careerRegions, isAcademy, startBlocked, startPool } from './career'
import type { StartPoint } from './talent'

/**
 * What the new-career screen reads off the world, worked out when the site is
 * built rather than in the player's browser.
 *
 * Reported 2026-09-18 (an outside audit of 6d128ed, finding 05): opening the
 * home page downloaded about 8 MB — every roster book, the calendar of every
 * circuit — before anyone had opened a career, 1.4 MB of it over the wire even
 * gzipped. Much of that was the new-career screen: which places a year opens in
 * (careerRegions), whether a door can open there (startBlocked), how many clubs
 * a club start is placed among and whether they are second teams (startPool,
 * isAcademy), and where that year's starters stand beside the talent panel's
 * ceiling (engine/ruler.ts entryBands) are all read off the whole world.
 *
 * They do not change while the page is open, only when the data or the rules
 * do. So vite.config.ts runs this once as the site is built — with the same
 * functions createCareer uses, on the same data — and hands the screen the
 * answers as a small table (virtual:start-sheet, ui/me/startSheet.ts). The world
 * itself is fetched when a career is opened. Nothing in the browser imports this
 * module; the checks run it the same way (scripts/check_starts.ts).
 */

export interface StartDoor {
  /** why this door does not open here that year, in the start button's words; '' when it does (startBlocked) */
  gate: string
  /** how many clubs a club start here is placed among (startPool); 0 for the ladder */
  pool: number
  /** and whether they are top clubs' second teams (isAcademy) */
  academies: boolean
}

export interface StartYear {
  /** the places the year opens in, in the screen's order (careerRegions) */
  regions: Region[]
  /** per place the screen can ask for — every listed one, and China, which it starts on — per door */
  doors: Partial<Record<Region, Record<StartPoint, StartDoor>>>
  /** where the year's starters stand, beside the talent panel's ceiling (entryBands) */
  bands: EntryBands
}

export type StartSheet = Record<EntryYear, StartYear>

const DOORS: StartPoint[] = ['pre', 'chal', 't1']

export function buildStartSheet(): StartSheet {
  const out = {} as StartSheet
  for (const year of ENTRY_YEARS) {
    const regions = careerRegions(year)
    const doors: StartYear['doors'] = {}
    for (const region of new Set<Region>([...regions, 'China'])) {
      const row = {} as Record<StartPoint, StartDoor>
      for (const start of DOORS) {
        const pool = startPool(region, start, year)
        row[start] = {
          gate: startBlocked(region, start, year) ?? '',
          pool: pool.length,
          academies: start === 'chal' && pool.some((c) => isAcademy(c, year)),
        }
      }
      doors[region] = row
    }
    out[year] = { regions, doors, bands: entryBands(year) }
  }
  return out
}
