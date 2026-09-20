import { ratingOf } from './player'
import { clamp } from './rng'
import type { MapLine, MapScore } from './types'

/** Actual contributions, never role labels or a player's static attributes.
 * Typical line per round (.70 K, .70 D, .30 A, .04 CL) rates 1.05.
 * An assist receives more credit, a kill less; opening trades and won clutches
 * count, while a player who only stays alive scores just .55. Damage/ACS keep
 * their original meaning and are not counted again on top of kills.
 */
export function performanceRating(line: Partial<MapLine>): number {
  const n = (v: number | undefined): number => Number.isFinite(v) ? Math.max(0, v!) : 0
  const rounds = n(line.rounds)
  if (!rounds) return 0
  const rate = (v: number | undefined, max: number) => Math.min(max, n(v) / rounds)
  // Kill/death/opening/clutch limits follow what one round can contain. Assist
  // credit saturates at 1.5 per round so assists alone cannot dominate an award.
  return clamp(0.55 + 0.80 * rate(line.kills, 5) + 0.80 * rate(line.assists, 1.5)
    - 0.48 * rate(line.deaths, 1)
    + 0.25 * (rate(line.firstKills, 1) - rate(line.firstDeaths, 1))
    + 1.00 * rate(line.clutches, 1), 0, 3)
}

export const usesPerformanceRating = (maps: readonly MapScore[]): boolean =>
  maps.length > 0 && maps.every((m) => m.performanceVersion === 1)

/** Old match details keep the rule they were played under. */
export const mapPerformanceRating = (map: MapScore, line: MapLine): number =>
  map.performanceVersion === 1 ? performanceRating(line) : ratingOf(line)

/** Sum actual rounds first. A short map cannot outweigh a long map. */
export function aggregateLines(maps: readonly MapScore[]): Record<string, MapLine> {
  const out: Record<string, MapLine> = {}
  const keys = ['kills', 'deaths', 'assists', 'damage', 'firstKills', 'firstDeaths', 'clutches', 'rounds'] as const
  for (const map of maps) for (const [pid, line] of Object.entries(map.lines)) {
    const t = out[pid] ??= { kills: 0, deaths: 0, assists: 0, damage: 0, firstKills: 0, firstDeaths: 0, clutches: 0, rounds: 0, acs: 0 }
    for (const key of keys) t[key] += Number.isFinite(line[key]) ? Math.max(0, line[key]) : 0
  }
  for (const t of Object.values(out)) t.acs = t.rounds ? t.damage / t.rounds * 1.45 : 0
  return out
}
