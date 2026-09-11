import { titleCount } from '../dossier'
import type { Records } from '../dossier'
import { honoursOf } from '../dossier'
import type { GameState, Player, Role } from '../types'
import type { MeMatchRecord } from './types'

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

/** How much of a name this player is, before any honours are loaded. */
export function fame(p: Player): number {
  return p.overall + titleCount(p.id) * 6
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

export function cvLine(r: Records | null, id: string): string {
  const n = titleCount(id)
  if (!r) return n > 0 ? `${n} 个冠军` : '还没有冠军'
  const hon = honoursOf(r, id)
  const big = hon.filter((h) => REAL_TITLE.test(h.event)).slice(0, 2)
  const parts = big.map((h) => eventLabel(h.event, h.year))
  const rest = hon.length - big.length
  if (rest > 0) parts.push(`另有 ${rest} 个冠军`)
  if (!parts.length) return n > 0 ? `${n} 个冠军` : '还没有冠军'
  return parts.join(' · ')
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
  const mirror = sameRole.sort((a, b) => fame(b) - fame(a))[0]
    ?? five.filter((p) => (p.roles ?? []).includes(myRole)).sort((a, b) => fame(b) - fame(a))[0]
  const out: Spotlight[] = []
  for (const p of five) {
    const opposite = p.id === mirror?.id
    // a name is either decorated or simply very good
    if (!opposite && fame(p) < 88) continue
    out.push({
      id: p.id, ign: p.ign, role: p.role, overall: p.overall, opposite,
      cv: cvLine(r, p.id), titles: titleCount(p.id),
    })
  }
  return out.sort((a, b) => Number(b.opposite) - Number(a.opposite) || fame(state.players[b.id]) - fame(state.players[a.id])).slice(0, 4)
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
    .sort((x, y) => fame(y.p!) - fame(x.p!))[0]
  if (!theirs?.p) return null
  if (fame(theirs.p) < 88) return null
  return { ign: theirs.b.ign, theirRating: theirs.b.rating, myRating: me.rating, won: me.rating > theirs.b.rating }
}

/** The sentence for the log; one per opponent per stage is plenty. */
export function starBeatLine(beat: StarBeat, seriesWon: boolean): string {
  if (beat.won && seriesWon) return `对位 ${beat.ign}，你 ${beat.myRating.toFixed(2)} 对他 ${beat.theirRating.toFixed(2)}，还赢了比赛。`
  if (beat.won) return `对位 ${beat.ign} 你打赢了（${beat.myRating.toFixed(2)} 对 ${beat.theirRating.toFixed(2)}），可惜比赛输了。`
  if (seriesWon) return `${beat.ign} 个人数据压了你一头（${beat.theirRating.toFixed(2)} 对 ${beat.myRating.toFixed(2)}），好在比赛赢了。`
  return `${beat.ign} 给你上了一课：${beat.theirRating.toFixed(2)} 对 ${beat.myRating.toFixed(2)}。`
}
