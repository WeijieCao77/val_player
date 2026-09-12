import type { Records } from '../dossier'
import { honoursOf, recordsNow } from '../dossier'
import type { GameState, Player, Role } from '../types'
import type { MeMatchRecord } from './types'
import { compCn } from './compname'
import { isQualifier } from './compclass'

/**
 * Who you are actually up against tonight.
 *
 * Ported from 破晓's stars.ts, and its rule is the whole design:
 *
 *   **存在感是叙事，不是 buff。** Nothing here touches a win rate.
 *
 * The other half of that module's argument was 「聚光灯不要写段位，写他们的
 * 履历——明星之所以是明星是因为他们的履历」. We can do that literally: the
 * repo already ships every real player's tournament placements, and
 * dossier.ts already turns them into a trophy shelf. So the spotlight is not
 * "this man is rated 91", it is "two-time Masters winner, Champions 2024".
 *
 * Honours here are the scraped ones, frozen at the day the data was taken.
 * Trophies won inside a running save are not added yet: the engine keeps
 * honours per club rather than per player, so there is nothing to read. Worth
 * doing later — you rewrote history, their CV should say so.
 */

/** How much of a name this player is, by what this save knows he has won (see shelfOf). */
export function fame(state: GameState, p: Player): number {
  return p.overall + shelfOf(state, recordsNow(), p.id).length * 6
}

export interface Spotlight {
  id: string
  ign: string
  role: string
  overall: number
  /** same position as me — the direct matchup */
  opposite: boolean
  /** the CV line, once records have loaded */
  cv: string
  /** outright wins we know about */
  titles: number
}

/**
 * The line under the name: what he has actually won.
 *
 * Only silverware that means something goes in. dossier's MAJOR test lets a
 * Nerd Street open qualifier through, and printing that next to Champions is
 * how a CV stops being a CV — so the display filter is tighter than the data
 * filter, and anything that does not clear it is summarised as a count.
 */
const REAL_TITLE = /champions(?!hip)|masters|vct \d{4}|game changers|esports world cup|lock\/\/in/i

/** "Champions Tour 2024: Masters Shanghai" -> "2024 Masters Shanghai" */
function eventLabel(event: string, year: number | null): string {
  const name = event
    .replace(/^(valorant\s+)?champions tour\s*/i, '')
    .replace(/^valorant\s+/i, '')
    .replace(/^vct\s*/i, '')
    .replace(/^\d{4}[:\s]*/, '')
    .replace(/\s*\b(19|20)\d{2}\b\s*$/, '')
    .replace(/^[:\-\s]+/, '')
    .trim()
  return year ? `${year} ${name}` : name
}

/** The first year of this save: honours before it are history, from it on only what happened here counts. */
export function savedFrom(state: GameState): number {
  const me = state.me
  return me?.entryYear ?? me?.seasons[0]?.year ?? state.year
}

export interface ShelfItem { label: string; major: boolean; year: number }

/**
 * What a player has won, as far as this save knows: the real shelf up to the
 * year the save began, then the titles won inside it. The scraped records run
 * to the day the data was taken, and reading them whole wrote the future onto
 * a CV — 「2024 Shanghai Esports Masters」 in a 2023 save (found 2026-09-11), and
 * in a 2021 save trophies the simulation may well hand to someone else.
 */
export function shelfOf(state: GameState, r: Records | null, id: string): ShelfItem[] {
  const from = savedFrom(state)
  const real = r
    ? honoursOf(r, id)
      // a qualifier won is 出线, not a trophy on anyone's shelf (me/compclass.ts isQualifier)
      .filter((h) => h.year != null && h.year < from && !isQualifier(h.event))
      .map((h) => ({ label: eventLabel(h.event, h.year), major: REAL_TITLE.test(h.event), year: h.year as number }))
    : []
  const here = (state.players[id]?.titles ?? [])
    .filter((t) => t.year >= from && !isQualifier(t.title))
    .map((t) => {
      const cn = compCn(t.title)
      return { label: `${t.year} ${cn}`, major: REAL_TITLE.test(t.title) || /大师赛|冠军赛|联赛/.test(cn), year: t.year }
    })
  return [...real, ...here].sort((a, b) => Number(b.major) - Number(a.major) || b.year - a.year)
}

export function cvLine(state: GameState, r: Records | null, id: string): string {
  const shelf = shelfOf(state, r, id)
  // the real half is still loading: say nothing rather than a count that may be wrong
  if (!r && !shelf.length) return ''
  const big = shelf.filter((h) => h.major).slice(0, 2)
  const parts = big.map((h) => h.label)
  const rest = shelf.length - big.length
  if (rest > 0) parts.push(`另有 ${rest} 个冠军`)
  return parts.length ? parts.join(' · ') : '还没有冠军'
}

/**
 * The names worth pointing at on the other side: the man in my position
 * first, then whoever else on their five is a name.
 */
export function spotlights(state: GameState, oppTeamId: string, myRole: Role, r: Records | null): Spotlight[] {
  const team = state.teams[oppTeamId]
  if (!team) return []
  const five = (team.starters.length ? team.starters : team.roster)
    .map((id) => state.players[id])
    .filter((p): p is Player => !!p)
  // exactly one man is "the matchup": the best of those who actually play my
  // position. Counting every flex player made four of a five my opposite number.
  const sameRole = five.filter((p) => p.role === myRole)
  const mirror = sameRole.sort((a, b) => fame(state, b) - fame(state, a))[0]
    ?? five.filter((p) => (p.roles ?? []).includes(myRole)).sort((a, b) => fame(state, b) - fame(state, a))[0]
  const out: Spotlight[] = []
  for (const p of five) {
    const opposite = p.id === mirror?.id
    // a name is either decorated or simply very good
    if (!opposite && fame(state, p) < 88) continue
    out.push({
      id: p.id, ign: p.ign, role: p.role, overall: p.overall, opposite,
      cv: cvLine(state, r, p.id), titles: shelfOf(state, r, p.id).length,
    })
  }
  return out.sort((a, b) => Number(b.opposite) - Number(a.opposite) || fame(state, state.players[b.id]) - fame(state, state.players[a.id])).slice(0, 4)
}

/** Was there a name in my position tonight, and did I beat him on the night? */
export interface StarBeat {
  ign: string
  theirRating: number
  myRating: number
  won: boolean
}

/**
 * Read off the box score that is already on the record: my opposite number on
 * the other side, and whether I outplayed him. Narrative only — nothing here
 * feeds back into the result, which has already happened.
 */
export function starBeat(state: GameState, rec: MeMatchRecord, myRole: Role): StarBeat | null {
  if (!rec.box?.length || !rec.started) return null
  const me = rec.box.find((b) => b.me)
  if (!me) return null
  const theirs = rec.box
    .filter((b) => !b.mine)
    .map((b) => ({ b, p: state.players[b.id] }))
    .filter((x) => x.p && (x.p.roles ?? [x.p.role]).includes(myRole))
    .sort((x, y) => fame(state, y.p!) - fame(state, x.p!))[0]
  if (!theirs?.p) return null
  if (fame(state, theirs.p) < 88) return null
  return { ign: theirs.b.ign, theirRating: theirs.b.rating, myRating: me.rating, won: me.rating > theirs.b.rating }
}

/** The sentence for the log; one per opponent per stage is plenty. */
export function starBeatLine(beat: StarBeat, seriesWon: boolean): string {
  if (beat.won && seriesWon) return `对位 ${beat.ign}，你 ${beat.myRating.toFixed(2)} 对他 ${beat.theirRating.toFixed(2)}，还赢了比赛。`
  if (beat.won) return `对位 ${beat.ign} 你打赢了（${beat.myRating.toFixed(2)} 对 ${beat.theirRating.toFixed(2)}），可惜比赛输了。`
  if (seriesWon) return `${beat.ign} 个人数据压了你一头（${beat.theirRating.toFixed(2)} 对 ${beat.myRating.toFixed(2)}），好在比赛赢了。`
  return `${beat.ign} 给你上了一课：${beat.theirRating.toFixed(2)} 对 ${beat.myRating.toFixed(2)}。`
}
