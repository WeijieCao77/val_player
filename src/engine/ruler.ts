import timelineRaw from '../data/timeline.json'
import circuitRaw from '../data/circuit.json'
import world2021Raw from '../data/world_2021.json'
import { clamp } from './rng'
import { recomputeOverall, refreshValue } from './player'
import { ATTR_KEYS } from './types'
import type { GameState, Player, WorldState } from './types'

/**
 * The ruler a career's world measures its real players on.
 *
 * scripts/build_world_2021.py and scripts/build_timeline.py rate everyone who
 * played a Riot event that year by where he sits in that year's whole pool: a
 * percentile of every professional line, laid straight over 44–98. The pool is
 * mostly people below the leagues, so from 2023 — when the top flight became
 * four closed leagues and a sixth of the pool — every partner-league player sat
 * in the top sixth and was rated 84 to 98. The median VCT starter was 87; a
 * controller with a 0.94 rating over 31 maps was 85; and the whole top flight
 * moved eleven points between 2022 and 2023 because the pool changed shape, not
 * the players (reported 2026-09-12: 「很多不出名的选手如 yilai 的综合实力也有八九十」).
 *
 * The builders' numbers stay what they are — they are the evidence, and building
 * them again from today's raw statlines would move 2021's rosters too — and are
 * read again here, one year at a time:
 *
 *  - One curve a year, fitted where the scene has a shape that does not change
 *    from year to year: the world's best 240 lines (four leagues × twelve clubs ×
 *    five starters) laid over 79–97 by rank, and the Challengers lines' decile,
 *    median and upper decile put at 61, 69 and 77. Everyone is read through the
 *    same curve, so a line from below the leagues as good as a partner's is rated
 *    as a partner's.
 *  - Then the sample. A line counts by its rounds, n / (n + K), and the rest of
 *    the way is the mean of the level it was played at. A line played below the
 *    leagues needs more rounds to say as much: K / 0.831², the Challengers-to-VCT
 *    rating ratio the builders already translate by.
 *  - The eight move together, so a player's shape stays his own, and his
 *    headroom moves with them.
 *
 * Deterministic and read off the data alone. Only a world created on it uses it
 * (WorldState.ruler): a career already under way keeps the world line it has,
 * the author's rule that no turn of the year changes the whole world at once.
 */

export const RULER = 2

/** A world built on this ruler. Absent is the builders' own scale, which every save from before it keeps. */
export const rulerOn = (state: Pick<WorldState, 'ruler'>): boolean => (state.ruler ?? 1) >= RULER

/** the best lines of a year the curve is fitted on: four leagues × twelve clubs × five starters */
export const REF_SIZE = 240
/** rounds before a line is solid enough to shape the curve or a level's mean */
export const SOLID = 300
/** rank among the best 240 (0 the best, 1 the 240th) → rating */
export const TOP_KNOTS: [number, number][] = [[0, 98], [9 / 239, 95.5], [0.1, 92], [0.5, 84.5], [1, 79]]
/** quantile among the Challengers lines (0 the weakest) → rating */
export const SUB_KNOTS: [number, number][] = [[0.1, 61], [0.5, 69], [0.9, 79]]
/** rounds at which a top-flight line counts half */
export const K_TOP = 250
/** the Challengers-to-VCT rating ratio the builders translate lines by (Val_Manager calibrate_tier.py) */
export const SUB_RATIO = 0.831
/** and one from below the leagues needs more rounds to say as much */
export const K_SUB = K_TOP / SUB_RATIO ** 2

interface TRating { o: number; n: number }
interface TClub { k: 1 | 2; d: number }
interface TYear { clubs: Record<string, TClub>; rosters: Record<string, string[]>; ratings: Record<string, TRating> }
const BOOK = timelineRaw as unknown as { years: Record<string, TYear> }
const CIRCUIT = circuitRaw as unknown as Record<string, { rosters?: Record<string, string[]> }[]>
interface W21Player { id: string; teamId: string | null; overall: number; vlr?: { rounds: number } | null; rounds?: number }
const W21 = world2021Raw as unknown as { players: W21Player[]; teams: { id: string; tier: number }[] }

interface Line { id: string; o: number; n: number; tier: 1 | 2 }

const mean = (xs: number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length

/** The year's curve from the builders' scale onto this one. */
function curveOf(lines: Line[]): (o: number) => number {
  const solid = lines.filter((l) => l.n >= SOLID)
  const ref = solid.slice().sort((a, b) => b.o - a.o).slice(0, REF_SIZE)
  const sub = solid.filter((l) => l.tier === 2).map((l) => l.o).sort((a, b) => a - b)
  const raw: [number, number][] = []
  if (ref.length >= 24) for (const [q, t] of TOP_KNOTS) raw.push([ref[Math.round(q * (ref.length - 1))].o, t])
  if (sub.length >= 24) for (const [q, t] of SUB_KNOTS) raw.push([sub[Math.round(q * (sub.length - 1))], t])
  if (!raw.length) return (o) => o
  // one rating per value of the old scale, and never lower as the old scale rises
  const by = new Map<number, number[]>()
  for (const [o, t] of raw) by.set(o, [...(by.get(o) ?? []), t])
  const pts = [...by.entries()].map(([o, ts]) => [o, mean(ts)] as [number, number]).sort((a, b) => a[0] - b[0])
  for (let i = 1; i < pts.length; i++) pts[i][1] = Math.max(pts[i][1], pts[i - 1][1])
  return (o) => {
    const first = pts[0]
    const last = pts[pts.length - 1]
    if (o <= first[0]) return first[1] - (first[0] - o)
    if (o >= last[0]) return last[1] + (o - last[0]) * 0.5
    for (let i = 1; i < pts.length; i++) {
      const [o1, t1] = pts[i]
      if (o > o1) continue
      const [o0, t0] = pts[i - 1]
      return t0 + ((t1 - t0) * (o - o0)) / (o1 - o0)
    }
    return last[1]
  }
}

/** How far each line of a year moves: the curve, then the sample toward its level's mean. */
function shiftsOf(lines: Line[]): Map<string, number> {
  const curve = curveOf(lines)
  const levelMean = (tier: 1 | 2, fallback: number): number => {
    const xs = lines.filter((l) => l.tier === tier && l.n >= SOLID).map((l) => curve(l.o))
    return xs.length ? mean(xs) : fallback
  }
  const mu = { 1: levelMean(1, 84), 2: levelMean(2, 69) }
  // above the Challengers upper decile a line from below the leagues has nobody of its
  // own level left to be measured against: what it shows past there counts at the ratio squared
  const subTop = SUB_KNOTS[SUB_KNOTS.length - 1][1]
  const out = new Map<string, number>()
  for (const l of lines) {
    const v = curve(l.o)
    const level = l.tier === 1 ? v : Math.min(v, subTop) + Math.max(0, v - subTop) * SUB_RATIO ** 2
    const w = l.n / (l.n + (l.tier === 1 ? K_TOP : K_SUB))
    out.set(l.id, Math.round(mu[l.tier] + (level - mu[l.tier]) * w - l.o))
  }
  return out
}

/**
 * Everyone the book rates that year, and the level he mostly played it at: the
 * clubs he was on, an opening roster and each event's, top flight against below.
 * A Challengers regular who stood in for a partner once is a Challengers line.
 */
function bookLines(year: number): Line[] {
  const Y = BOOK.years[String(year)]
  if (!Y) return []
  const seen = new Map<string, { top: number; sub: number }>()
  const mark = (club: string, ids: string[]) => {
    const top = Y.clubs[club]?.k === 1
    for (const id of ids) {
      const s = seen.get(id) ?? { top: 0, sub: 0 }
      if (top) s.top++
      else s.sub++
      seen.set(id, s)
    }
  }
  for (const [club, ids] of Object.entries(Y.rosters)) mark(club, ids)
  for (const ev of CIRCUIT[String(year)] ?? []) for (const [club, ids] of Object.entries(ev.rosters ?? {})) mark(club, ids)
  return Object.entries(Y.ratings).map(([id, r]) => {
    const s = seen.get(id)
    return { id, o: r.o, n: r.n, tier: s && s.top > 0 && s.top >= s.sub ? 1 : 2 }
  })
}

/** January 2021's people (world_2021.json), rated in the same pool as the book's 2021 debutants. */
function worldLines(): Line[] {
  const tier = new Map(W21.teams.map((t) => [t.id, t.tier === 1 ? 1 : 2] as const))
  return W21.players.map((p) => ({
    id: p.id.replace(/^V/, ''), o: p.overall, n: p.vlr?.rounds ?? p.rounds ?? 0,
    tier: (p.teamId ? tier.get(p.teamId) : undefined) ?? 2,
  }))
}

const TABLES = new Map<number, Map<string, number>>()
function tableOf(year: number): Map<string, number> {
  let t = TABLES.get(year)
  if (!t) {
    t = shiftsOf(year === 2021 ? [...worldLines(), ...bookLines(2021)] : bookLines(year))
    TABLES.set(year, t)
  }
  return t
}

/** How far this ruler moves a person's rating of that year — `vlr` is his vlr id, without the V. */
export function rulerShift(year: number, vlr: string): number {
  return tableOf(year).get(vlr) ?? 0
}

/** Move all eight by `d`, the overall with them, and the headroom he had above it. */
export function shiftPlayer(p: Player, d: number): void {
  if (!d) return
  const before = p.overall
  for (const k of ATTR_KEYS) p.attrs[k] = clamp(p.attrs[k] + d, 20, 99)
  recomputeOverall(p)
  p.potential = clamp(p.potential + (p.overall - before), p.overall, 99)
}

const top5 = (xs: number[]): number | null => {
  const s = xs.slice().sort((a, b) => b - a).slice(0, 5)
  return s.length ? Math.round(mean(s)) : null
}

/** A club of the book that year, rated the way the world rates a club: its best five, on this ruler. */
export function rulerClubRating(year: number, ids: string[]): number | null {
  const Y = BOOK.years[String(year)]
  if (!Y) return null
  return top5(ids.filter((id) => Y.ratings[id]).map((id) => Y.ratings[id].o + rulerShift(year, id)))
}

/** A club of January 2021's world, on this ruler. */
export function rulerTeamRating2021(teamId: string): number | null {
  return top5(W21.players.filter((p) => p.teamId === teamId).map((p) => p.overall + rulerShift(2021, p.id.replace(/^V/, ''))))
}

/**
 * Past the roster book nothing re-rates the world each January, and it ages on
 * its own: the young grow into the headroom the builders gave them, the old
 * barely slip, and no season's numbers are read any more. Measured from 2026
 * with a career that reaches nothing, the VCT starters' median went 84 → 90 and
 * the Challengers' 69 → 77 by 2031, and the people rated 90 or more 31 → 137
 * (on the builders' own scale the same climb, 87 → 93).
 *
 * So each winter past the book the world is read on the curve the book years
 * were read on: the best 240 by rank laid over 79–98, the Challengers' decile,
 * median and upper decile at 61, 69 and 79, and everyone out of the player's
 * reach moved by what his rank says, his eight together. Who passes whom still
 * moves — a young man who keeps growing climbs past the ones who do not — and
 * the scale does not. A free agent moves as the Challengers players did. The
 * player's reach is left alone, as the book leaves it.
 */
export function holdScale(state: GameState, people: Set<string>): number {
  if (!rulerOn(state)) return 0
  const lines: Line[] = []
  const held: Player[] = []
  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    for (const id of t.roster) {
      const p = state.players[id]
      if (!p || people.has(p.id) || p.id === state.me?.id) continue
      lines.push({ id: p.id, o: p.overall, n: SOLID, tier: t.tier === 1 ? 1 : 2 })
      held.push(p)
    }
  }
  if (lines.length < 100) return 0
  const curve = curveOf(lines)
  const subShifts: number[] = []
  let moved = 0
  lines.forEach((l, i) => {
    const d = Math.round(curve(l.o) - l.o)
    if (l.tier === 2) subShifts.push(d)
    if (!d) return
    shiftPlayer(held[i], d)
    refreshValue(held[i])
    moved++
  })
  const sd = subShifts.length ? subShifts.slice().sort((a, b) => a - b)[Math.floor(subShifts.length / 2)] : 0
  if (sd) {
    for (const p of Object.values(state.players)) {
      if (p.teamId || people.has(p.id) || p.id === state.me?.id) continue
      shiftPlayer(p, sd)
      refreshValue(p)
    }
  }
  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    const r = top5(t.roster.map((id) => state.players[id]?.overall ?? 0))
    if (r != null) t.rating = r
  }
  return moved
}

export interface EntryBands {
  /** the median starter at a club in the top flight when the year opens */
  top: number
  /** the median starter at a club below it */
  sub: number
  /** the world's tenth-best starter: where the stars begin */
  star: number
}

/**
 * Where the starters of the year a career enters stand, on this ruler — for the
 * new-career screen to say what a ceiling means, instead of a figure typed in.
 */
export function entryBands(year: number): EntryBands {
  const starters: { tier: 1 | 2; o: number }[] = []
  if (year <= 2021) {
    const tier = new Map(W21.teams.map((t) => [t.id, t.tier === 1 ? 1 : 2] as const))
    const by = new Map<string, number[]>()
    for (const p of W21.players) {
      if (!p.teamId) continue
      by.set(p.teamId, [...(by.get(p.teamId) ?? []), p.overall + rulerShift(2021, p.id.replace(/^V/, ''))])
    }
    for (const [team, os] of by) for (const o of os.sort((a, b) => b - a).slice(0, 5)) starters.push({ tier: tier.get(team) ?? 2, o })
  } else {
    const Y = BOOK.years[String(year)] ?? BOOK.years['2026']
    const y = BOOK.years[String(year)] ? year : 2026
    for (const [club, ids] of Object.entries(Y.rosters)) {
      const c = Y.clubs[club]
      if (!c || c.d > 60 || ids.length < 5) continue
      const os = ids.filter((id) => Y.ratings[id]).map((id) => Y.ratings[id].o + rulerShift(y, id)).sort((a, b) => b - a).slice(0, 5)
      for (const o of os) starters.push({ tier: c.k === 1 ? 1 : 2, o })
    }
  }
  const med = (xs: number[]) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }
  const all = starters.map((s) => s.o).sort((a, b) => b - a)
  return {
    top: med(starters.filter((s) => s.tier === 1).map((s) => s.o)),
    sub: med(starters.filter((s) => s.tier === 2).map((s) => s.o)),
    star: all[Math.min(9, all.length - 1)] ?? 0,
  }
}
