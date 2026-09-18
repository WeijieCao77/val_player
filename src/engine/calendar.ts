import type { GameState } from './types'

/**
 * The year and a day of it, with nothing else attached. Kept apart from
 * engine/season.ts, which re-exports both: the season module reaches the whole
 * world — every roster book and the calendar of every circuit — and a page that
 * only writes a date or counts days (the home page's save card, me/detail.ts)
 * must not fetch the world to do it (reported 2026-09-18, an outside audit:
 * the home page downloaded about 8 MB before any career was opened).
 */

/**
 * The year, in days.
 *
 * The calendar ran 336 days with one stage hard against the next: Kickoff's
 * final on a Sunday, the Masters draw on Tuesday, Stage 1 opening the day
 * after the Masters final. A manager wrote that it was 「拥挤」 — no time to
 * do business between competitions — and the sport itself does not play
 * like that. So the year is the whole year now, and the stages are shaped
 * like the real ones: a league plays twice a week for five weeks, then a
 * fortnight of playoffs, then three to four weeks off before the Masters,
 * with the market open through the break that leads into it — and three
 * weeks off after the Masters before the next league starts (see
 * engine/season.ts LEAGUE_DAYS, and keepBreaks for the rule that holds it
 * whatever happens).
 */
export const SEASON_DAYS = 364

/** Display a day index as an in-fiction date. */
export function dateLabel(state: GameState): string {
  const d = new Date(Date.UTC(state.year, 0, 1))
  d.setUTCDate(d.getUTCDate() + state.day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}
