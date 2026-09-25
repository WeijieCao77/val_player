import { ratingOf } from './player'
import { clamp } from './rng'
import type { MapLine, MapScore } from './types'

/**
 * The match rating, from what a man actually did — never his role label or his
 * attributes. Per round: kills, damage (ADR), assists, deaths, the opening duel
 * (first kills minus first deaths) and won clutches.
 *
 * Reported 2026-09-25, in many voices: 「我杀46第三 36的是第一」「250acs倒四」
 * 「杀人的评分也太低了」「决斗太难拿mvp了」. Measured over 600 NPC tier-1 BO3s
 * (scratchpad match-rating_probe): the old sum paid an assist exactly what it
 * paid a kill (0.80 each), so a 决斗者 on 0.76 kills a round and a 控场 on 0.61
 * rated the same 1.00; the ten best ACS lines of the sample sat as low as 62nd
 * on rating, and a side's top fragger was not its top-rated a third of the time.
 * Now a kill counts about twice and a half an assist and its damage counts too
 * (a kill is ~150 of it), the way a VLR rating reads a scoreboard: over 1000
 * such series the rating follows ACS at 0.94 (0.82), a side's top fragger is its
 * top-rated 85% of the time (66%), and the roles' averages sit about as real
 * VCT's do — 决斗者 1.05, 哨卫 1.04, 控场 0.98, 先锋 0.96 (1.00 / 1.02 / 1.01 /
 * 0.98) — with 11 决斗者 in the sample season's top 20 (5). Tried: kills 0.75
 * with a 0.25 assist and damage 0.25 — 13 of the top 20, the rating's spread up
 * from 0.17 to 0.22; 0.6 / 0.4 — top fragger first only 80%. A line of .66 K,
 * .66 D, .28 A, 140 ADR, .03 CL — the league's average — rates 1.01; a man who
 * only stays alive rates .49.
 */
export const RATING_BASE = 0.49
export const RATING_KILL = 0.7
/** per 100 ADR */
export const RATING_ADR = 0.2
export const RATING_ASSIST = 0.3
export const RATING_DEATH = 0.5
export const RATING_OPENING = 0.3
export const RATING_CLUTCH = 0.8
export function performanceRating(line: Partial<MapLine>): number {
  const n = (v: number | undefined): number => Number.isFinite(v) ? Math.max(0, v!) : 0
  const rounds = n(line.rounds)
  if (!rounds) return 0
  const rate = (v: number | undefined, max: number) => Math.min(max, n(v) / rounds)
  // Kill/death/opening/clutch limits follow what one round can contain; damage
  // saturates at 750 a round (five full kills) and assists at 1.5.
  return clamp(RATING_BASE + RATING_KILL * rate(line.kills, 5) + RATING_ADR * rate(line.damage, 750) / 100
    + RATING_ASSIST * rate(line.assists, 1.5)
    - RATING_DEATH * rate(line.deaths, 1)
    + RATING_OPENING * (rate(line.firstKills, 1) - rate(line.firstDeaths, 1))
    + RATING_CLUTCH * rate(line.clutches, 1), 0, 3)
}

/**
 * The winning side's nod in the MVP (engine/match.ts seriesMvp / mapMvp): the
 * MVP is the best rating plus this for the side that took the series (or the
 * map), so it is the winners' top-rated man unless someone on the losing side
 * out-rated him by more than this.
 *
 * 0.08 until 2026-09-25, when an MVP went to the losing side one series in
 * nine; a real match MVP is nearly always a winner's. With the rating above, at
 * 0.15, over 600 NPC tier-1 BO3s: 93% of MVPs are winners, and three in four are
 * the winning side's top ACS and its most kills (63% and 65% before) — 「MVP不都是按acs
 * 吗」 — while a losing side's 1.5 still takes it off a winning side's 1.2.
 */
export const PERFORMANCE_WIN_NOD = 0.15

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
