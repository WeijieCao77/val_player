import { compClass } from './compclass'
import type { GameState } from '../types'
import type { CerKind } from './types'

/**
 * How many nights a professional season stops the clock for.
 *
 * The design is four to eight a season however the career goes. A career that
 * wins keeps walking out for finals, and nothing counted them: with the breaks
 * made worth their 综合 (me/bottleneck.ts) a Challengers starter who won his
 * league walked out for six or seven finals a season, and check_ceremony counted
 * fourteen nights in one year. So the season keeps a count, and a night that
 * would crowd it gives way — the smaller the stage, the sooner: Champions before
 * Masters before a league final before the rest. A final that gives way is still
 * played; the log says in one line that there was no walk-out for it.
 *
 * Its own module with nothing heavy imported: ceremony.ts and nights.ts both
 * count on it, and ceremony.ts already imports nights.ts.
 */

/** the most nights a season stops for (the design's four to eight) */
export const CER_SEASON_CAP = 8
/** media days a season always has room for: a club's stages are told through them */
export const MEDIA_FLOOR = 2
/** nights never crowded out: the year's patch, a lay-off, the last season, the last day, a tryout */
const EXEMPT = new Set<CerKind>(['patch', 'rehab', 'farewell', 'retire', 'tryout'])
/** places a night of each rank leaves free for the bigger ones (rank 1 the rest … rank 4 Champions) */
const RESERVE = [0, 2, 1, 0, -1]

/** How much a night matters when the season is full: a final by its stage, everything else as the rest. */
export function cerRank(kind: CerKind, about: string): number {
  if (kind !== 'final') return 1
  const c = compClass(about)
  return c === 'champions' ? 4 : c === 'masters' || c === 'lockin' ? 3 : c === 'league' ? 2 : 1
}

function bookOf(state: GameState): { year: number; n: number; media: number } {
  const me = state.me!
  if (me.cerYear?.year !== state.year) me.cerYear = { year: state.year, n: 0, media: 0 }
  return me.cerYear
}

/** Is there room this season for this night? The rest leave two places for the internationals, a league final one; a Champions final always walks out. */
export function cerRoom(state: GameState, kind: CerKind, about: string): boolean {
  if (EXEMPT.has(kind)) return true
  const book = bookOf(state)
  if (kind === 'media' && book.media < MEDIA_FLOOR) return true
  return book.n < CER_SEASON_CAP - RESERVE[cerRank(kind, about)]
}

/** A night opened: it takes its place in the season's count. */
export function cerCounted(state: GameState, kind: CerKind): void {
  const book = bookOf(state)
  book.n++
  if (kind === 'media') book.media++
}
