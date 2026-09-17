import { SEASON_DAYS } from '../season'
import { isFinal, isIntlComp } from './compclass'
import type { MeMatchRecord, MeState, MeTally } from './types'

/**
 * 生涯明细只保留最近一年的。
 *
 * The per-match detail used to be capped at 120 records (me/matchplay.ts, until
 * 2026-09-17): a long career silently dropped its oldest matches, nothing on
 * screen said so, and everything that read the list back — the achievements
 * that count, the ceilings' gates — quietly read less of the career the longer
 * it ran. That is the worst thing a size limit can do, because the loss is
 * invisible. A count is also not a rule a player can hold in his head. A year
 * is: the detail covers the last year of the career's own calendar, and the
 * rest is let go.
 *
 * So: nothing that has to outlive a year may be counted off this list. What
 * does is added up as it happens — the career tally below, the season's record
 * (MeState.seasons, written each winter), the international campaigns
 * (me/intl.ts, written the day a campaign ends). Keep the rule here, in one
 * place: a count cap put back anywhere else brings the silent loss with it.
 */
export const DETAIL_DAYS = SEASON_DAYS

/** The career calendar as one number, so two dates in different years can be compared. */
export const dayIdx = (year: number, day: number): number => year * SEASON_DAYS + day

/** how many matches back keep the full all-ten table; older ones keep only the words */
const BOX_KEEP = 12

const ZERO: MeTally = { mvp: 0, carried: 0, finalLost: 0, intl: 0, skid: 0, skidBest: 0 }

/** The tally as a reader sees it: a save from before it, and a career that has played nothing, read as zeros. */
export const tallyOf = (me: MeState): Readonly<MeTally> => me.tally ?? ZERO

/** The tally to write into. */
const book = (me: MeState): MeTally => (me.tally ??= { ...ZERO })

/** Official starts over the whole career — the seasons' own record, which is never trimmed. */
export const careerStarts = (me: MeState): number =>
  me.seasons.reduce((n, s) => n + s.starts, 0) + me.seasonStart.starts

/**
 * One match into the running totals, the moment it is written down.
 *
 * Only what a consumer needs past the year: MVPs, matches carried in defeat,
 * finals lost, international matches started, and the longest run of defeats.
 * Everything else about a match is answered off the list while it is in it.
 * Cup and exhibition rounds are not official matches and never count here,
 * exactly as the achievements read them (me/achievements.ts starts()).
 */
export function noteMatch(me: MeState, rec: MeMatchRecord): void {
  if (rec.friendly || !rec.started) return
  const t = book(me)
  if (rec.mvp) t.mvp++
  if (rec.carried) t.carried++
  if (!rec.won && !rec.drawn && isFinal(rec.label)) t.finalLost++
  if (isIntlComp(rec.comp)) t.intl++
  if (!rec.won && !rec.drawn) {
    t.skid++
    if (t.skid > t.skidBest) t.skidBest = t.skid
  } else t.skid = 0
}

/** The detail older than a year, let go; and the full all-ten table kept only for the recent few. */
export function trimDetail(me: MeState, year: number, day: number): void {
  const from = dayIdx(year, day) - DETAIL_DAYS
  const keep = me.matches.filter((m) => dayIdx(m.year, m.day) >= from)
  if (keep.length !== me.matches.length) me.matches = keep
  for (let i = 0; i < me.matches.length - BOX_KEEP; i++) delete me.matches[i].box
}

/**
 * A save loaded from before the window: the totals are read off the detail it
 * still carries, then the detail settles to the year.
 *
 * Read off the list, which is what that save's own conditions could see anyway
 * — it held at most 120 records — so nothing it could already answer is lost,
 * and every achievement it had earned stays earned (they are kept by key,
 * me/achievements.ts). From here on the totals are added up as matches are
 * played, so they stop shrinking with the window.
 */
export function settleDetail(me: MeState, year: number, day: number): void {
  // the run of defeats it comes out with is only as long as the detail could show; it goes on from here
  if (!me.tally) for (const rec of [...me.matches]) noteMatch(me, rec)
  trimDetail(me, year, day)
}
