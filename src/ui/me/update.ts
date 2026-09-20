/**
 * What an open page should do about a build that went live under it.
 *
 * The rule on its own, away from React, so it can be read and checked
 * (scripts/check_update.ts). The page itself — the poll, the save, the reload
 * and the bar — is ui/me/UpdateNudge.tsx.
 *
 * Why it decides rather than always asking: a page left open goes on running
 * the build it loaded with, and its save is written by that build. The author,
 * 2026-09-20, took a week board that still had the old 「−」 on it hours after
 * the click-to-act build went live: 「我点了我还可以取消，这完全不合理。」 A tab
 * nobody has touched should come onto the new build by itself instead of
 * sitting there for hours, so 'reload' is the ordinary answer and the bar is
 * what is left when reloading would cost something.
 */

/** how often the page asks the server which build is newest */
export const EVERY = 70 * 1000
/** a tab flicked in and out of view does not fetch the page each time */
export const AT_LEAST = 20 * 1000
/** 稍后 quiets this build for half an hour — not for as long as the tab lives */
export const QUIET = 30 * 60 * 1000
/** hands off the mouse and the keyboard this long before the page reloads itself */
export const IDLE = 12 * 1000

export type UpdateAct =
  /** nothing to do: same build, or 稍后 is still quiet */
  | 'none'
  /** a new build, but the player's hands are on the page: ask again in a moment */
  | 'wait'
  /** say it and let the player choose: a reload right now would cost something */
  | 'bar'
  /** save and reload by itself */
  | 'reload'

export interface UpdateNow {
  /** the entry script this page is running; null under the dev server, where the name carries no hash */
  mine: string | null
  /** the entry script the server hands out now, as far as this page knows */
  newest: string | null
  /** something in memory a reload would lose — a match being played */
  busy: boolean
  /** the build 稍后 was pressed on, and the moment that quiet runs out */
  quiet: { build: string; until: number } | null
  /** an automatic reload already tried and the save did not go in */
  failed: boolean
  /** when the player last touched the page */
  acted: number
  now: number
}

export function updateAct(x: UpdateNow): UpdateAct {
  if (!x.mine || !x.newest || x.newest === x.mine) return 'none'
  // 稍后: quiet for a while, then ask again — and by hand, because the player already said no once.
  // A different build is a different question, so it goes down the ordinary road below.
  if (x.quiet && x.quiet.build === x.newest) return x.now < x.quiet.until ? 'none' : 'bar'
  // a match lives only in memory, and a save that is not going in would be lost with the stretch since it stopped going in
  if (x.busy || x.failed) return 'bar'
  if (x.now - x.acted < IDLE) return 'wait'
  return 'reload'
}
