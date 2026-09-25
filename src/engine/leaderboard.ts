import { compClass, isQualifier } from './me/compclass'
import type { CompClass } from './me/compclass'
import { performanceRating } from './performance'
import type { GameState, Player } from './types'

/**
 * The season's 选手榜 (2026-09-25): the rating first, the year's honours on top.
 *
 * The mailbox's most-voted note that day (14): 「我主玩的决斗，一年四冠，acs240
 * 还只能排在末位。能否在原先考虑rating的基础上再增加荣誉系统，二者合并决定最后的
 * 排名」. The table sorted on the season's rating alone, so a trophy counted for
 * nothing there. Measured over one season on 托管 (scratchpad match-rating_probe):
 * of the 24 starters with two titles or more, a 5-title 控场 stood 123rd and a
 * 2-title 决斗者 103rd.
 *
 * Now each title this season adds BOARD_TITLE by what the event is — 冠军赛 the
 * most, then 大师赛 and LOCK//IN, the league stages, Challengers and 晋级赛; an
 * open qualifier is a door, not a title (compclass.ts isQualifier) — and each
 * series MVP adds BOARD_MVP, up to BOARD_MVP_MAX. The sizes keep the rating in
 * charge: a season's ratings run about 0.90–1.12 from P10 to P90, and a year of
 * four titles with a handful of MVPs is worth about +0.15 — the difference
 * between a good regular and the league's best, not a jump from the foot of the
 * table to its top. The same sum for every player; the career's own has no
 * other weight in it.
 */
export const BOARD_TITLE: Record<CompClass, number> = {
  champions: 0.06, masters: 0.04, lockin: 0.04, league: 0.02, chal: 0.01, qual: 0.01,
}
export const BOARD_MVP = 0.004
export const BOARD_MVP_MAX = 0.06

/** What the table says under its title, in words. */
export const BOARD_RULE = '评分为主，本季冠军和整场 MVP 加分——冠军赛加得最多，其次大师赛、联赛、挑战者联赛，资格赛不算'
/** The year-end awards read the same 排名分 (engine/me/nights.ts computeAwards); said on the night and on its card. */
export const AWARD_RULE = '按这一季的评分评，本季拿的冠军和整场 MVP 另外加分，和选手榜同一个排法'
/** The same rule with its sizes, for the tooltip. */
export const BOARD_RULE_DETAIL = `排名分 = 本季评分 + 本季冠军（冠军赛 +${BOARD_TITLE.champions}，大师赛 +${BOARD_TITLE.masters}，`
  + `联赛 +${BOARD_TITLE.league}，挑战者联赛与晋级赛 +${BOARD_TITLE.chal}；资格赛不算）`
  + ` + 每个整场 MVP +${BOARD_MVP}（最多 +${BOARD_MVP_MAX}）`

export interface BoardLine {
  rating: number
  /** titles lifted this season, qualifiers left out */
  titles: number
  titleBonus: number
  mvps: number
  mvpBonus: number
  score: number
}

export function boardLine(state: GameState, p: Player): BoardLine {
  const rating = performanceRating(p.season)
  let titles = 0
  let titleBonus = 0
  for (const t of p.titles ?? []) {
    if (t.year !== state.year || isQualifier(t.title)) continue
    titles++
    titleBonus += BOARD_TITLE[compClass(t.title)]
  }
  const mvps = Math.max(0, p.season.mvps || 0)
  const mvpBonus = Math.min(BOARD_MVP_MAX, mvps * BOARD_MVP)
  return { rating, titles, titleBonus, mvps, mvpBonus, score: rating + titleBonus + mvpBonus }
}

/** The number the table is sorted on. */
export const boardScore = (state: GameState, p: Player): number => boardLine(state, p).score
