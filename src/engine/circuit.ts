import raw from '../data/circuit.json'
import routesRaw from '../data/routes.json'
import partneredRaw from '../data/routes_partnered.json'
import { aheadEventsOf, oqPoolOf } from './ahead'
import type { Plan, Seat } from './ahead'
import { regionIn, stageAtIn } from './era'
import { bookLeague, sceneFor, successorsOf, syncEvent } from './timeline'
import { makeFixture, newRow, newStandings } from './league'
import type { Competition, Fixture, GameState, Region, StageKey, Team, VctSeason } from './types'

/**
 * The open era's season: the events that really happened, in the formats they
 * really had, on the days they were really played.
 *
 * scripts/build_circuit.py read every 2021–2022 event back off its matches
 * into a graph. Each series is a node; each side of a node is a slot fed by an
 * outside seed (`s`), by the winner or loser of an earlier node (`w` / `l`),
 * or by a placing in an earlier phase of the same event (`g`). This file plays
 * that graph — Reykjavík's four-team play-in, Berlin's GSL groups, Korea's
 * round-robin preliminaries, LATAM's North and South brackets — without a
 * single format typed in by hand.
 *
 * It plays an event one of two ways, and the choice is the author's world-line
 * rule: 「世界线的改变会围绕玩家展开，在玩家够不着的地方原本是什么样就还是什么样」.
 *
 *  - **sim** — the event is within the player's reach: his club is in it, it
 *    is his own region's, or its field is no longer the field history had
 *    because something upstream already went differently. Every node is a
 *    match.
 *  - **history** — none of that. The event ends on its real last day with its
 *    real placings, and no match engine is asked.
 *
 * The choice is made the day before an event opens, not when the season is
 * drawn up: a result in March decides whether an event in May still matches.
 */

export type Slot = [string, number, number?]

export interface CNode {
  day: number
  round: string
  /** 2 is a Bo2 group game, which could end level */
  bo: 1 | 2 | 3 | 5
  a: Slot
  b: Slot
  winner: string | null
  teams: [string, string]
  score: [number | null, number | null]
}

export interface CUnit {
  label: string
  /** `open`: a qualifier, kept only as its result — see isOpen */
  type: 'rr' | 'bracket' | 'open'
  size: number
  nodes?: CNode[]
  first?: number
  last?: number
  ranked?: string[]
  /** the phase this unit ranks in: a stage's groups, or parallel conferences, share one */
  phase?: string
  /** played after the final — relegation, an access series: ranks below the phases that decided the winner */
  side?: boolean
  /** 2023 on: a bracket that ends with two sides unbeaten ranks the one from the upper side first */
  upperFirst?: boolean
  /**
   * 2023 on: a promotion/relegation stage, or a qualifier's last round — how many of its
   * sides really went up into the league's next split (`feeds`)
   */
  promotes?: number
  feeds?: string
}

export interface CEvent {
  id: string
  name: string
  cn: string
  /** a club region, a combining layer (EMEA, SEA…), or null for an international */
  region: string | null
  /** the club regions a combining layer draws on */
  layer: string[] | null
  /** 2023 on: the Challengers league a tier-two event belongs to */
  scene?: string | null
  stage: StageKey | null
  start: number | null
  end: number | null
  seeds: string[]
  units: CUnit[]
  /** the real placings, joint places repeated */
  places: [string, number][]
  /** display names of the sides a player can read about */
  names: Record<string, string>
  /** the vlr player ids each side brought */
  rosters?: Record<string, string[]>
  /** an event of a year nobody has played yet, drawn from `base` — see projectedOf */
  projected?: { year: number; base: string }
  /** 2027 on: an event of the new format, and how each of its places is filled (engine/ahead.ts) */
  plan?: Plan
}

const CIRCUIT = raw as unknown as Record<string, CEvent[]>

const BY_ID = new Map<string, CEvent>()
const YEAR_OF = new Map<string, number>()
for (const [y, evs] of Object.entries(CIRCUIT)) for (const e of evs) { BY_ID.set(e.id, e); YEAR_OF.set(e.id, Number(y)) }

/* ------------------------------------------------------------------ */
/*  the years nobody has played yet                                    */
/* ------------------------------------------------------------------ */

/**
 * Past the last real match the calendar does not stop. circuit.json runs to
 * 2026's Stage 2. 2026 itself still owes what closes its season — Champions in
 * Shanghai, in 2025's format (four GSL groups, then eight in double
 * elimination, as 2026 has it too) on the dates announced for it, and China's
 * Ascension — and from November the open qualifiers for 2027's Kickoff.
 *
 * From 2027 the leagues and internationals play the format Riot announced for
 * 2027, its unannounced parts 暂定 (engine/ahead.ts). The Challengers leagues
 * below them are 2026's again — the same events in the same formats on the
 * same days, each field drawn by the rule that really drew it (projectedSeeds).
 * Every match is played, because nobody has played them yet.
 *
 * A projected event is never written into a save. Its id — `F2027:2796`, the
 * 2027 edition of 2026's North America ACE qualifier, or `F2027:kickoff:Americas` —
 * is enough to draw it again.
 */
const REAL_YEARS = Object.keys(CIRCUIT).map(Number).sort((a, b) => a - b)
export const LAST_REAL_YEAR = REAL_YEARS[REAL_YEARS.length - 1]
// Americas, EMEA and Pacific have no Ascension in 2026 — Riot folded it into the leagues' Stage 2
// Play-Ins, which are on the books. China kept its own, after Evolution Series Act 3
const owes = (e: CEvent): boolean => e.stage === 'champions' || (e.stage === 'ascension' && e.region === 'China')
/** VALORANT Champions Shanghai 2026: 24 September to 18 October (Liquipedia). */
const OWED_DATES: Partial<Record<StageKey, [number, number]>> = { champions: [266, 290] }

const slotKey = (e: CEvent): string => `${e.stage}|${e.region ?? ''}|${e.scene ?? ''}`
const bareName = (e: CEvent): string =>
  e.name.replace(/\b20\d\d\b|VCT|Champions Tour|Challengers( League)?|Valorant/gi, '').replace(/[^a-z0-9]/gi, '').toLowerCase()

/** What the last real year closes with that its calendar has not reached. */
const OWED_EVENTS: CEvent[] = (() => {
  const have = new Set((CIRCUIT[String(LAST_REAL_YEAR)] ?? []).map(slotKey))
  return (CIRCUIT[String(LAST_REAL_YEAR - 1)] ?? []).filter((e) => owes(e) && !have.has(slotKey(e)))
})()

/**
 * Every Challengers season after the last real one is drawn from these. Not an
 * event that was only an open qualifier: its sides were five friends and a
 * Discord server, nobody this world holds, and a qualifier nobody can name is
 * not played here — the places it sent come through the next event's own open
 * phase instead. Not the leagues, their internationals, or a Last Chance
 * Qualifier into 2026's play-ins either: from 2027 those are the new format's.
 */
const LEAGUE_STAGES = new Set<StageKey>(['kickoff', 'stage1', 'stage2', 'masters1', 'masters2', 'champions', 'lcq'])
const TEMPLATE: CEvent[] = (CIRCUIT[String(LAST_REAL_YEAR)] ?? []).filter((e) => !!e.stage && e.stage !== 'offseason' && e.start != null
  && e.units.some((u) => u.type !== 'open') && !LEAGUE_STAGES.has(e.stage) && !/Last Chance/i.test(e.name))

function project(year: number, baseId: string): CEvent | undefined {
  const src = BY_ID.get(baseId)
  const from = YEAR_OF.get(baseId)
  if (!src || from == null || src.start == null || src.end == null || src.projected) return undefined
  const owed = from === LAST_REAL_YEAR - 1
  if (year < LAST_REAL_YEAR || (year === LAST_REAL_YEAR && !owed)) return undefined
  const [start, end] = (owed && src.stage && OWED_DATES[src.stage]) || [src.start, src.end]
  const s0 = src.start
  const span = src.end - s0
  const at = (d: number): number => (span ? Math.round(start + ((d - s0) * (end - start)) / span) : start)
  const n = src.stage === 'masters1' ? 1 : src.stage === 'masters2' ? 2 : 0
  return {
    ...src,
    id: `F${year}:${baseId}`,
    // no host city is named that nobody has announced
    name: n ? `Valorant Masters ${year} Stage ${n}` : src.name.replace(/\b20\d\d\b/g, String(year)),
    cn: src.stage === 'champions' ? `${year} 全球冠军赛` : n ? `${year} 第${n === 1 ? '一' : '二'}站大师赛` : src.cn,
    start,
    end,
    units: src.units.map((u) => ({
      ...u,
      first: u.first == null ? u.first : at(u.first),
      last: u.last == null ? u.last : at(u.last),
      ranked: undefined,
      nodes: u.nodes?.map((nd) => ({ ...nd, day: at(nd.day), winner: null, teams: ['', ''] as [string, string], score: [null, null] as [null, null] })),
    })),
    places: [],
    names: {},
    rosters: {},
    projected: { year, base: baseId },
  }
}

const PROJECTED = new Map<number, CEvent[]>()
function projectedOf(year: number): CEvent[] {
  if (year < LAST_REAL_YEAR) return []
  let hit = PROJECTED.get(year)
  if (!hit) {
    hit = [
      ...(year === LAST_REAL_YEAR ? OWED_EVENTS : TEMPLATE).map((e) => project(year, e.id)).filter((e): e is CEvent => !!e),
      ...aheadEventsOf(year),
    ].sort((a, b) => a.start! - b.start! || a.id.localeCompare(b.id))
    for (const e of hit) BY_ID.set(e.id, e)
    PROJECTED.set(year, hit)
  }
  return hit
}

export const eventsOf = (year: number): CEvent[] => [...(CIRCUIT[String(year)] ?? []), ...projectedOf(year)]

export const eventOf = (id: string): CEvent | undefined => {
  const hit = BY_ID.get(id)
  if (hit) return hit
  const m = /^F(\d{4}):(.+)$/.exec(id)
  if (!m) return undefined
  projectedOf(Number(m[1]))
  const drawn = BY_ID.get(id)
  if (drawn || !/^\d+$/.test(m[2])) return drawn
  // a save that reached 2027 before 2027 had its own format plays out that year on the 2026 copy it was drawn with
  const old = project(Number(m[1]), m[2])
  if (old) BY_ID.set(id, old)
  return old
}

/** A vlr team id as this world knows it. Sides from open qualifiers are not clubs. */
export const worldIdOf = (vlr: string): string | null => (vlr.startsWith('N:') ? null : `V21T${vlr}`)

const idIn = (state: GameState, vlr: string | null | undefined): string | null => {
  if (!vlr) return null
  const id = worldIdOf(vlr)
  // a club the player's club carried on as (engine/timeline.ts inherit) is the player's club
  const heir = id ? state.heirs?.[id] : undefined
  if (heir && state.teams[heir]) return heir
  return id && state.teams[id] ? id : null
}

/**
 * The club in this world that a real side at a real event was.
 *
 * Its own id first. Failing that, the people: a vlr team id is a name, and
 * names changed hands all year — Raise Your Edge's five played March as
 * Acend, and the roster book, written from where everyone started 2021, has
 * them at Raise Your Edge. If three of the five a side brought are on one
 * club here, that club is the side. A club that is in the same event under its
 * own name is never somebody else's alias.
 */
function teamOf(state: GameState, ev: CEvent, vlr: string | null | undefined): string | null {
  // a projected event's seeds are the places of the year it is drawn from, not anyone's
  if (!vlr || ev.projected) return null
  const direct = idIn(state, vlr)
  if (direct) return direct
  const roster = ev.rosters?.[vlr]
  if (!roster?.length) return null
  const count = new Map<string, number>()
  for (const pid of roster) {
    const t = state.players[`V${pid}`]?.teamId
    if (t) count.set(t, (count.get(t) ?? 0) + 1)
  }
  const best = [...count.entries()].sort((a, b) => b[1] - a[1])[0]
  if (!best || best[1] < 3) return null
  if (ev.seeds.some((s) => s !== vlr && idIn(state, s) === best[0])) return null
  return best[0]
}

const tagOf = (name: string): string => {
  const words = name.replace(/\b(esports?|gaming|team|club)\b/gi, '').trim().split(/\s+/).filter(Boolean)
  const tag = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? name).slice(0, 3)
  return tag.toUpperCase().slice(0, 4)
}

/**
 * A club here taking the name it really played under. Out of the player's
 * reach, history's rebrands happen when they happened; his own club keeps
 * the name he signed for.
 */
function adoptName(state: GameState, ev: CEvent, vlr: string, teamId: string): void {
  if (idIn(state, vlr) || teamId === state.myTeam) return
  const name = ev.names[vlr]
  const t = state.teams[teamId]
  if (!name || !t || t.name === name) return
  state.news.push({ day: state.day, kind: 'club', text: `${t.name} 的阵容以 ${name} 的名义出战${ev.cn}。` })
  t.name = name
  t.tag = tagOf(name)
}

/**
 * An open qualifier. Its sides are mostly five friends and a Discord server —
 * not clubs this world holds — so it is never simulated: it runs as it really
 * ran, and the player's club, if it enters, plays the one match that decides
 * the last place through (see offerPlayIn).
 */
const isOpen = (u: CUnit): boolean => u.type === 'open'

/** A stage's parallel groups are one phase; its own bracket is another. */
const phaseOf = (u: CUnit): string => u.label.replace(/ · [A-Z0-9]+组$/, ' · 组')

/** Events that paid circuit points and fed an international. */
const TOP: StageKey[] = ['s1masters', 's2finals', 's3finals', 'masters1', 'masters2', 'lcq', 'champions', 'kickoff', 'stage1', 'stage2']
const tierOf = (ev: CEvent): 1 | 2 => ((ev.stage && TOP.includes(ev.stage)) || /FGC/.test(ev.name) ? 1 : 2)

const scopeOf = (ev: CEvent): string[] | null => ev.layer ?? (ev.region ? [ev.region] : null)
const inScope = (ev: CEvent, region: string | undefined): boolean => {
  const s = scopeOf(ev)
  return !!region && !!s && s.includes(region)
}

/** The club the player answers for: his own once he has one, the managed club in the manager game. */
function playerClub(state: GameState): string | null {
  if (state.me) return state.me.phase === 'pro' ? state.myTeam : null
  return state.myTeam
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]

/* ------------------------------------------------------------------ */
/*  the graph                                                          */
/* ------------------------------------------------------------------ */

interface Flat extends CNode { unit: number; at: number }
const FLAT = new Map<string, { nodes: Flat[]; base: number[] }>()
function flat(ev: CEvent): { nodes: Flat[]; base: number[] } {
  let hit = FLAT.get(ev.id)
  if (hit) return hit
  const nodes: Flat[] = []
  const base: number[] = []
  ev.units.forEach((u, ui) => {
    base.push(nodes.length)
    for (const n of u.nodes ?? []) nodes.push({ ...n, unit: ui, at: nodes.length })
  })
  hit = { nodes, base }
  FLAT.set(ev.id, hit)
  return hit
}

/** One decided node, whoever decided it: a match or a walkover. */
interface Game { a: string | null; b: string | null; w: string | null; round: string; mapsA: number; mapsB: number; roundsA: number; roundsB: number }

/**
 * Order a phase's sides, and say which of them the format cannot tell apart.
 *
 * Mirrors scripts/build_circuit.py rank_unit, which wrote every `g` slot: a
 * round robin is its table (a win 3, a draw 1); a bracket is its sides still
 * alive by how few losses they carry, then sides knocked out by how late —
 * and two sides out in the same round share a place, so the semi-final losers
 * of a single bracket are joint third.
 */
function rankPhase(type: 'rr' | 'bracket', games: Game[], upperFirst = false): { ranked: string[]; tiers: string[][] } {
  const teams = uniq(games.flatMap((g) => [g.a, g.b]).filter((t): t is string => !!t))
  if (type === 'rr') {
    const s = new Map(teams.map((t) => [t, { pts: 0, md: 0, rd: 0 }]))
    for (const g of games) {
      if (!g.a || !g.b) continue
      const [ra, rb] = [s.get(g.a)!, s.get(g.b)!]
      if (g.w === g.a) ra.pts += 3
      else if (g.w === g.b) rb.pts += 3
      else { ra.pts += 1; rb.pts += 1 }
      ra.md += g.mapsA - g.mapsB
      rb.md += g.mapsB - g.mapsA
      ra.rd += g.roundsA - g.roundsB
      rb.rd += g.roundsB - g.roundsA
    }
    // points; then, among the sides level on points, the maps and rounds of
    // their games against each other (2021 SEA's written tiebreak); then the
    // overall map and round difference
    const level = new Map<number, Set<string>>()
    for (const t of teams) {
      const p = s.get(t)!.pts
      level.set(p, (level.get(p) ?? new Set<string>()).add(t))
    }
    const h2h = (t: string): [number, number] => {
      const tied = level.get(s.get(t)!.pts)!
      let md = 0
      let rdiff = 0
      for (const g of games) {
        if (!g.a || !g.b || !tied.has(g.a) || !tied.has(g.b)) continue
        if (g.a === t) { md += g.mapsA - g.mapsB; rdiff += g.roundsA - g.roundsB }
        if (g.b === t) { md += g.mapsB - g.mapsA; rdiff += g.roundsB - g.roundsA }
      }
      return [md, rdiff]
    }
    const key = (t: string) => { const r = s.get(t)!; return [r.pts, ...h2h(t), r.md, r.rd] }
    const ranked = teams.slice().sort((x, y) => {
      const [a, b] = [key(x), key(y)]
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return b[i] - a[i]
      return 0
    })
    const tiers: string[][] = []
    for (const t of ranked) {
      const prev = tiers[tiers.length - 1]
      if (prev && key(prev[0]).join() === key(t).join()) prev.push(t)
      else tiers.push([t])
    }
    return { ranked, tiers }
  }
  const last = new Map<string, number>()
  const losses = new Map<string, number>()
  games.forEach((g, i) => {
    for (const t of [g.a, g.b]) if (t) last.set(t, i)
    const l = g.w === g.a ? g.b : g.a
    if (g.w && l) losses.set(l, (losses.get(l) ?? 0) + 1)
  })
  const out = (t: string): boolean => {
    const g = games[last.get(t)!]
    // a third-place or runner-up match is played by two sides already out
    return !!g.w && (g.w !== t || g.round.endsWith('季军赛') || g.round.endsWith('亚军赛'))
  }
  // a bracket that ends with no grand final — 2025's Pacific Ascension — leaves
  // two sides unbeaten, and the one that came up the upper side is ahead
  const lower = new Set(upperFirst ? games.filter((g) => g.round.includes('败者组')).flatMap((g) => [g.a, g.b]) : [])
  const low = (t: string) => Number(lower.has(t))
  const alive = teams.filter((t) => !out(t))
    .sort((x, y) => (losses.get(x) ?? 0) - (losses.get(y) ?? 0) || low(x) - low(y) || last.get(y)! - last.get(x)!)
  const gone = teams.filter(out).sort((x, y) =>
    last.get(y)! - last.get(x)! || Number(games[last.get(y)!].w === y) - Number(games[last.get(x)!].w === x))
  const tiers: string[][] = []
  for (const t of alive) {
    const prev = tiers[tiers.length - 1]
    if (prev && (losses.get(prev[0]) ?? 0) === (losses.get(t) ?? 0) && low(prev[0]) === low(t)) prev.push(t)
    else tiers.push([t])
  }
  const byRound = new Map<string, string[]>()
  for (const t of gone) {
    const g = games[last.get(t)!]
    const k = `${g.round}|${g.w === t}`
    byRound.set(k, [...(byRound.get(k) ?? []), t])
  }
  tiers.push(...byRound.values())
  return { ranked: [...alive, ...gone], tiers }
}

/** The event's placings from each phase's tiers: later phases on top, parallel groups side by side. */
function placesFrom(units: CUnit[], tiers: string[][][]): [string, number][] {
  const phases = new Map<string, number[]>()
  const key = (u: CUnit) => u.phase ?? phaseOf(u)
  units.forEach((u, ui) => phases.set(key(u), [...(phases.get(key(u)) ?? []), ui]))
  // what is played after the final — a relegation series, an access
  // tournament — decides who plays where next year, not who won: it ranks
  // below every phase that did (scripts/build_circuit.py marks it `side`)
  const sideName = /relegation|promotion|降级|升级/i
  const isSide = (k: string) => sideName.test(k) || phases.get(k)!.some((ui) => !!units[ui].side)
  const keys = [...phases.keys()]
  const ordered = [...keys.filter((k) => !isSide(k)).reverse(), ...keys.filter(isSide).reverse()]
  const out: [string, number][] = []
  const seen = new Set<string>()
  for (const group of ordered.map((k) => phases.get(k)!)) {
    const fresh = group.map((ui) => tiers[ui].map((tier) => tier.filter((t) => !seen.has(t))).filter((tier) => tier.length))
    const depth = Math.max(0, ...fresh.map((f) => f.length))
    for (let k = 0; k < depth; k++) {
      const joint = uniq(fresh.flatMap((f) => f[k] ?? [])).filter((t) => !seen.has(t))
      const place = seen.size + 1
      for (const t of joint) { seen.add(t); out.push([t, place]) }
    }
  }
  return out
}

/* ------------------------------------------------------------------ */
/*  the season                                                         */
/* ------------------------------------------------------------------ */

/** Every event of the year on the books, nothing drawn yet: fields are settled the day before each opens. */
export function setupCircuitSeason(state: GameState): void {
  for (const ev of eventsOf(state.year)) bookEvent(state, ev)
}

function bookEvent(state: GameState, ev: CEvent): void {
  if (ev.start == null || ev.end == null || !ev.units.length) return
  const teams = ev.projected ? [] : uniq(ev.seeds.map((v) => idIn(state, v)).filter((x): x is string => !!x))
  const comp: Competition = {
    key: `ev:${ev.id}`,
    name: ev.cn,
    region: ev.region && !ev.layer ? (ev.region as Region) : undefined,
    tier: tierOf(ev),
    stage: ev.stage ?? stageAtIn(state.year, ev.start, true),
    teams,
    standings: newStandings(teams),
    finished: [],
    format: 'circuit',
    circuit: { id: ev.id, start: ev.start, end: ev.end, seeds: [] },
  }
  state.comps[comp.key] = comp
}

/**
 * A 2026 save already under way when November's open qualifiers were put on
 * the calendar: they go on its books now, before they open.
 */
export function bookAheadEvents(state: GameState): void {
  if (state.year !== LAST_REAL_YEAR) return
  for (const ev of eventsOf(state.year)) {
    if (ev.plan && ev.start != null && ev.start > state.day + 1 && !state.comps[`ev:${ev.id}`]) bookEvent(state, ev)
  }
}

/**
 * Move one event along. Returns true on the day it finishes, so the caller
 * can settle it like any other competition.
 */
export function progressCircuit(state: GameState, comp: Competition, notes: string[]): boolean {
  const c = comp.circuit
  const ev = c && eventOf(c.id)
  if (!c || !ev || comp.champion || c.done) return false
  if (state.day < c.start - 1) return false
  if (!c.mode) begin(state, comp, ev, notes)
  if (c.mode === 'history') {
    if (state.day < c.end) return false
    const seen = new Set<string>()
    const placed: [string, number][] = []
    for (const [v, p] of ev.places) {
      const t = teamOf(state, ev, v)
      if (t && !seen.has(t)) { seen.add(t); placed.push([t, p]) }
    }
    if (!placed.length) {
      // nobody who played it is in this world: a promotion event of clubs
      // founded after the roster book was written. It happened; there is no
      // one here to place.
      c.done = true
      return false
    }
    finish(comp, placed)
    return true
  }
  return playOn(state, comp, ev)
}

function finish(comp: Competition, placed: [string, number][]): void {
  comp.finished = placed.map(([t]) => t)
  comp.places = placed.map(([, p]) => p)
  comp.champion = comp.finished[0]
}

interface Swap { real: string; now: string | null; from: string }

/* ------------------------------------------------------------------ */
/*  how each seat was really won — scripts/build_routes.py            */
/* ------------------------------------------------------------------ */

/**
 * `rest`: 2023's Last Chance Qualifiers took a league's sides not already through to Champions.
 * `league`: EMEA's 2023 Champions places went to its three best-placed sides at Masters Tokyo.
 */
interface Route { kind: 'keep' | 'top' | 'points' | 'winner' | 'rest'; event?: string; k?: number; pool?: string; rank?: number | null; league?: string }
interface EventRules {
  routes?: Record<string, Route>
  award?: Record<string, number>
  /** 2024–2025: points a match win, which matches, a group topped, a playoff bye */
  wins?: number
  winsIn?: 'groups' | 'playoffs' | 'all'
  groupWin?: number
  bye?: number
}
interface RouteBook {
  events: Record<string, EventRules>
  pools: Record<string, Record<string, { regions: string[]; league?: string; standings: { team: string | null; rank: number | null }[] }>>
}
const OPEN_ROUTES = routesRaw as unknown as RouteBook
// 2023–2025, from scripts/build_routes_partnered.py
const PARTNERED_ROUTES = partneredRaw as unknown as RouteBook
const ROUTES: RouteBook = {
  events: { ...OPEN_ROUTES.events, ...PARTNERED_ROUTES.events },
  pools: { ...OPEN_ROUTES.pools, ...PARTNERED_ROUTES.pools },
}

/** An event's rules. A projected event plays by the rules of the event it is drawn from. */
function rulesOf(id: string): EventRules | undefined {
  const own = ROUTES.events[id]
  if (own) return own
  const base = eventOf(id)?.projected?.base
  return base ? ROUTES.events[base] : undefined
}

type Pool = RouteBook['pools'][string][string]
/** A points pool as a year had it. A year past the last real table plays by that table's rules, with no standings of its own. */
function poolOf(year: number, pool: string): (Pool & { real: boolean }) | undefined {
  for (let y = year; y >= 2021; y--) {
    const p = ROUTES.pools[String(y)]?.[pool]
    if (p) return { ...p, real: y === year }
  }
  return undefined
}

/** What a placing at this event really paid in circuit points — null where no prize table is on record. */
export function circuitAward(comp: Competition, place: number): number | null {
  const table = comp.circuit && rulesOf(comp.circuit.id)?.award
  if (!table) return null
  return table[String(place)] ?? 0
}

const poolRegions = (year: number, pool: string): string[] => poolOf(year, pool)?.regions ?? []

/**
 * Has anything this world played reached into a points pool? Until it has,
 * the pool's standings are history's, and so is every seat drawn from them.
 */
function poolTouched(state: GameState, pool: string): boolean {
  // a year with no real table has only this world's
  if (!poolOf(state.year, pool)?.real) return true
  const regions = new Set(poolRegions(state.year, pool))
  // only an event that pays points can move a points table: a Taiwanese club
  // playing the Huya cups changes nothing about SEA's standings
  return Object.values(state.comps).some((c) => c.circuit?.mode === 'sim' && !!c.champion
    && !!rulesOf(c.circuit.id)?.award
    && c.teams.some((t) => regions.has(state.teams[t]?.region ?? '')))
}

/** A pool's table in this world: points, then the order history had, then strength. */
function poolRanking(state: GameState, pool: string): string[] {
  const regions = new Set(poolRegions(state.year, pool))
  // from 2024 a pool is a league: the clubs that hold its seats, wherever they are from
  const def = poolOf(state.year, pool)
  const league = def?.league
  const realOrder = new Map<string, number>()
  ;((def?.real && def.standings) || []).forEach((r, i) => {
    const id = r.team ? worldIdOf(r.team) : null
    if (id && !realOrder.has(id)) realOrder.set(id, i)
  })
  return Object.values(state.teams)
    .filter((t) => t.roster.length >= 5 && (league
      ? t.tier === 1 && !t.dormant && regionIn(t.region, state.year) === league
      : regions.has(t.region)))
    .sort((a, b) => b.champPoints - a.champPoints
      || (realOrder.get(a.id) ?? 999) - (realOrder.get(b.id) ?? 999)
      || b.rating - a.rating)
    .map((t) => t.id)
}

/**
 * The year's direct Champions places as they stand now — its Masters winner
 * and the top of each pool. A Last Chance Qualifier takes the pool's next
 * teams, never these: Gambit won Berlin, Acend and Fnatic had EMEA's points
 * places, and EMEA's LCQ started at points #4.
 */
function championsDirect(state: GameState): Set<string> {
  const champs = eventsOf(state.year).find((e) => /Valorant Champions 20/i.test(e.name))
  const book = champs && rulesOf(champs.id)?.routes
  const out = new Set<string>()
  if (!champs || !book) return out
  const perPool = new Map<string, number>()
  // a placing in a league event, or EMEA's at Tokyo: taken off the feeder as it went in this world
  const perFeeder = new Map<string, { event: string; league?: string; n: number; real: string[] }>()
  for (const v of champs.seeds) {
    const r = book[v]
    const event = r?.event && counterpart(r.event, champs)
    if (r?.kind === 'top' && event && eventOf(event)?.stage !== 'lcq') {
      const key = `${event}|${r.league ?? ''}`
      const f = perFeeder.get(key) ?? { event, league: r.league, n: 0, real: [] }
      f.n++
      const t = teamOf(state, champs, v)
      if (t) f.real.push(t)
      perFeeder.set(key, f)
    }
    if (r?.kind === 'winner' && event) {
      const c = state.comps[`ev:${event}`]
      const w = c?.champion ?? teamOf(state, champs, v)
      if (w) out.add(w)
    }
    if (r?.kind === 'points' && r.pool) perPool.set(r.pool, (perPool.get(r.pool) ?? 0) + 1)
  }
  for (const f of perFeeder.values()) {
    const c = state.comps[`ev:${f.event}`]
    if (c?.champion && (c.circuit?.mode === 'sim' || champs.projected)) {
      const inLeague = (t: string) => !f.league || regionIn(state.teams[t]?.region ?? 'Europe', state.year) === f.league
      for (const t of c.finished.filter(inLeague).slice(0, f.n)) out.add(t)
    } else for (const t of f.real) out.add(t)
  }
  for (const [pool, n] of perPool) {
    if (!champs.projected && !poolTouched(state, pool)) {
      for (const v of champs.seeds) {
        if (book[v]?.kind === 'points' && book[v]?.pool === pool) {
          const t = teamOf(state, champs, v)
          if (t) out.add(t)
        }
      }
      continue
    }
    let taken = 0
    for (const t of poolRanking(state, pool)) {
      if (taken >= n) break
      if (!out.has(t)) { out.add(t); taken++ }
    }
  }
  return out
}

/**
 * Who takes each seat, by the route the seat really had.
 *
 *  - a placing in a feeder: whoever finished there in this world, if the
 *    feeder was played; its real side, if it was replayed
 *  - a points place: the pool's standings in this world, once anything played
 *    has touched the pool; history's until then
 *  - a winner: that event's champion here
 *  - anything else (open qualifiers, invitations): the side history had
 *
 * Seats with no route on record fall back to the old reading, kept within the
 * event's own scene so that no Chinese cup can reach a Taiwanese qualifier.
 */
function seedsFor(state: GameState, ev: CEvent): { seeds: (string | null)[]; swaps: Swap[] } {
  if (ev.plan) return planSeeds(state, ev)
  if (ev.projected) return projectedSeeds(state, ev)
  const book = rulesOf(ev.id)?.routes
  if (!book) return legacySeeds(state, ev)
  const real: (string | null)[] = []
  for (const v of ev.seeds) {
    const t = teamOf(state, ev, v)
    real.push(t && !real.includes(t) ? t : null)
  }
  const out = real.slice()
  const used = new Set<string>()
  const swaps: Swap[] = []
  // from 2023 a league's own placings are through before its points are counted
  const order: Record<Route['kind'], number> = state.year >= 2023
    ? { winner: 0, top: 1, rest: 2, points: 3, keep: 4 }
    : { winner: 0, points: 1, top: 2, keep: 3, rest: 4 }
  const items = ev.seeds.map((v, i) => ({ v, i, r: book[v] ?? ({ kind: 'keep' } as Route) }))
  for (const x of items) if (x.r.kind === 'keep' && out[x.i]) used.add(out[x.i]!)
  items.sort((a, b) => order[a.r.kind] - order[b.r.kind] || (a.r.rank ?? 99) - (b.r.rank ?? 99) || (a.r.k ?? 0) - (b.r.k ?? 0))
  const isLcq = /Last Chance/i.test(ev.name)
  let direct: Set<string> | null = null
  for (const x of items) {
    if (x.r.kind === 'keep') continue
    let now: string | null | undefined
    if (x.r.kind === 'winner' && x.r.event) {
      const c = state.comps[`ev:${x.r.event}`]
      now = c?.champion && c.circuit?.mode === 'sim' ? c.champion : real[x.i]
    } else if (x.r.kind === 'top' && x.r.event) {
      const c = state.comps[`ev:${x.r.event}`]
      const inLeague = (t: string) => !x.r.league || regionIn(state.teams[t]?.region ?? 'Europe', state.year) === x.r.league
      now = c?.champion && c.circuit?.mode === 'sim' ? c.finished.find((t) => !used.has(t) && inLeague(t)) : real[x.i]
    } else if (x.r.kind === 'rest' && x.r.event) {
      // the league's sides not already through to Champions. Each real entrant keeps
      // its place unless it has since gone through; only then does the league's next
      // side not in the field take it — a league's table below the playoffs is joint
      // places, and reading the whole field off it would change a field nothing changed
      const c = state.comps[`ev:${x.r.event}`]
      if (!direct) direct = championsDirect(state)
      const through = direct
      const keep = real[x.i]
      if (keep && !through.has(keep) && !used.has(keep)) now = keep
      else if (c?.champion) {
        const field = new Set(items.filter((y) => y.r.kind === 'rest').map((y) => real[y.i]).filter((t): t is string => !!t))
        now = c.finished.find((t) => !used.has(t) && !through.has(t) && !field.has(t))
      } else now = keep
    } else if (x.r.kind === 'points' && x.r.pool) {
      if (!poolTouched(state, x.r.pool)) now = real[x.i]
      else {
        if (isLcq && !direct) direct = championsDirect(state)
        now = poolRanking(state, x.r.pool).find((t) => !used.has(t) && !direct?.has(t))
      }
    }
    if (now == null || used.has(now)) now = real[x.i] && !used.has(real[x.i]!) ? real[x.i] : null
    if (now !== real[x.i]) swaps.push({ real: x.v, now, from: x.r.event ? `ev:${x.r.event}` : `pool:${x.r.pool}` })
    out[x.i] = now ?? null
    if (now) used.add(now)
  }
  return { seeds: out, swaps }
}

/** Two events share a scene when their scopes meet; an international meets everyone. */
function sameScene(a: CEvent, b: CEvent): boolean {
  const [sa, sb] = [scopeOf(a), scopeOf(b)]
  return !sa || !sb || sa.some((r) => sb.includes(r))
}

/**
 * Who a real seed's place goes to in this world.
 *
 * A seed came out of some earlier event — the top four of Challengers 1 skip
 * Challengers 2's qualifier, the top two of a Challengers Final go to
 * Reykjavík. If that earlier event was played rather than replayed, its
 * placings are not history's any more, and whoever finished where the real
 * side finished takes the real side's place. That is the whole of 「你顶掉了谁」:
 * no rule per event, only the place you earned, from the event that gave it.
 */
function legacySeeds(state: GameState, ev: CEvent): { seeds: (string | null)[]; swaps: Swap[] } {
  const out: (string | null)[] = []
  for (const v of ev.seeds) {
    const t = teamOf(state, ev, v)
    out.push(t && !out.includes(t) ? t : null)
  }
  const done = Object.values(state.comps).filter((x) => {
    if (x.format !== 'circuit' || !x.champion || !x.circuit || x.circuit.end >= (ev.start ?? 0)) return false
    const fe = eventOf(x.circuit.id)
    return !!fe && sameScene(ev, fe)
  })
  const groups = new Map<Competition, { i: number; k: number }[]>()
  ev.seeds.forEach((v, i) => {
    if (!out[i]) return
    let feeder: Competition | null = null
    let k = -1
    for (const x of done) {
      const fe = eventOf(x.circuit!.id)
      if (!fe) continue
      const real = fe.places.map(([t]) => t).filter((t) => teamOf(state, fe, t))
      const j = real.indexOf(v)
      if (j < 0) continue
      if (!feeder || x.circuit!.end > feeder.circuit!.end) { feeder = x; k = j }
    }
    if (feeder?.circuit?.mode === 'sim') groups.set(feeder, [...(groups.get(feeder) ?? []), { i, k }])
  })
  const swaps: Swap[] = []
  for (const [feeder, list] of groups) {
    list.sort((x, y) => x.k - y.k)
    // the sides that came out of this feeder trade places among themselves;
    // only a side that is in by some other road blocks a place
    const own = new Set(list.map((x) => x.i))
    const taken = new Set<string>()
    const blocked = (t: string | undefined) => !!t && (taken.has(t) || out.some((o, at) => !own.has(at) && o === t))
    const next = list.map(({ i, k }) => {
      let j = k
      while (j < feeder.finished.length && blocked(feeder.finished[j])) j++
      const now = feeder.finished[j]
      if (now) taken.add(now)
      return { i, now }
    })
    for (const { i, now } of next) {
      if (!now) continue
      if (now !== out[i]) swaps.push({ real: ev.seeds[i], now, from: feeder.key })
      out[i] = now
    }
  }
  return { seeds: out, swaps }
}

/* ------------------------------------------------------------------ */
/*  a projected event's field                                          */
/* ------------------------------------------------------------------ */

/** The event of `ev`'s own year that stands where `id` stood in its year — for a projected event's feeders and routes. */
function counterpart(id: string, ev: CEvent): string {
  const p = ev.projected
  const src = BY_ID.get(id)
  if (!p || !src) return id
  const like = (list: CEvent[]): CEvent | undefined => {
    const hits = list.filter((e) => slotKey(e) === slotKey(src))
    return hits.find((e) => bareName(e) === bareName(src)) ?? (hits.length === 1 ? hits[0] : undefined)
  }
  const real = like(CIRCUIT[String(p.year)] ?? [])
  if (real) return real.id
  if (YEAR_OF.get(id) !== LAST_REAL_YEAR && p.year > LAST_REAL_YEAR) {
    const last = like(CIRCUIT[String(LAST_REAL_YEAR)] ?? [])
    if (last) return `F${p.year}:${last.id}`
  }
  return `F${p.year}:${id}`
}

/** Where each of a real event's seeds came from: the latest earlier event of its scene it placed in, and where among the clubs. */
const FEEDERS = new Map<string, ({ from: string; k: number } | null)[]>()
function feedersOf(base: CEvent): ({ from: string; k: number } | null)[] {
  const hit = FEEDERS.get(base.id)
  if (hit) return hit
  const earlier = (CIRCUIT[String(YEAR_OF.get(base.id))] ?? [])
    .filter((e) => e.id !== base.id && e.end != null && base.start != null && e.end < base.start && e.places.length && sameScene(base, e))
  const out = base.seeds.map((v) => {
    if (v.startsWith('N:')) return null
    let best: { from: string; k: number; end: number } | null = null
    for (const e of earlier) {
      const k = e.places.filter(([t]) => !t.startsWith('N:')).findIndex(([t]) => t === v)
      if (k >= 0 && (!best || e.end! > best.end)) best = { from: e.id, k, end: e.end! }
    }
    return best ? { from: best.from, k: best.k } : null
  })
  FEEDERS.set(base.id, out)
  return out
}

/**
 * The field of an event nobody has played yet. No seat here is history's, so
 * each is drawn the way it was drawn in the year the event is copied from:
 *
 *  - a league's own event: the clubs that hold the league's seats this year
 *  - a seat with a route on record (a Masters, Champions): that route, off
 *    this world's results
 *  - any other seat: the placing it really came out of, in this year's edition
 *    of that event — or, where this year has none, in its scene's last event
 *  - whatever is left: the best clubs of the event's own scene not already in
 */
function projectedSeeds(state: GameState, ev: CEvent): { seeds: (string | null)[]; swaps: Swap[] } {
  const { year, base: baseId } = ev.projected!
  const base = BY_ID.get(baseId)
  const baseYear = YEAR_OF.get(baseId) ?? year
  const out: (string | null)[] = ev.seeds.map(() => null)
  const used = new Set<string>()
  const take = (i: number, t: string | null | undefined): boolean => {
    if (!t || out[i] || used.has(t) || !state.teams[t] || state.teams[t].dormant) return false
    out[i] = t
    used.add(t)
    return true
  }
  const league = isLeagueEvent(year, ev)

  if (league && ev.region) {
    const members = Object.values(state.teams)
      .filter((t) => !t.dormant && t.tier === 1 && t.league === `VCT ${ev.region}`)
      .sort((a, b) => b.rating - a.rating)
      .map((t) => t.id)
    const seats = ev.seeds.map((v, i) => ({ v, i })).filter(({ v }) => bookLeague(baseYear, v) === ev.region)
    seats.forEach(({ i }, n) => { take(i, members[n]) })
  }

  const book = rulesOf(ev.id)?.routes
  if (book) {
    const order: Record<Route['kind'], number> = { winner: 0, top: 1, rest: 2, points: 3, keep: 4 }
    const items = ev.seeds.map((v, i) => ({ i, r: book[v] }))
      .filter((x): x is { i: number; r: Route } => !!x.r && x.r.kind !== 'keep' && !out[x.i])
      .sort((a, b) => order[a.r.kind] - order[b.r.kind] || (a.r.rank ?? 99) - (b.r.rank ?? 99) || (a.r.k ?? 0) - (b.r.k ?? 0))
    let direct: Set<string> | null = null
    for (const { i, r } of items) {
      const c = r.event ? state.comps[`ev:${counterpart(r.event, ev)}`] : undefined
      if (r.kind === 'winner') take(i, c?.champion)
      else if (r.kind === 'top') {
        const inLeague = (t: string) => !r.league || regionIn(state.teams[t]?.region ?? 'Europe', year) === r.league
        take(i, c?.finished.find((t) => !used.has(t) && inLeague(t)))
      } else if (r.kind === 'rest') {
        direct ??= championsDirect(state)
        const through = direct
        take(i, c?.finished.find((t) => !used.has(t) && !through.has(t)))
      } else if (r.kind === 'points' && r.pool) {
        if (/Last Chance/i.test(ev.name)) direct ??= championsDirect(state)
        const through = direct
        take(i, poolRanking(state, r.pool).find((t) => !used.has(t) && !through?.has(t)))
      }
    }
  }

  if (base) {
    const feeders = feedersOf(base)
    const list = ev.seeds.map((_, i) => ({ i, f: feeders[i] }))
      .filter((x): x is { i: number; f: { from: string; k: number } } => !!x.f && !out[x.i])
      .sort((a, b) => a.f.from.localeCompare(b.f.from) || a.f.k - b.f.k)
    for (const { i, f } of list) {
      const src = BY_ID.get(f.from)
      let c: Competition | undefined = state.comps[`ev:${counterpart(f.from, ev)}`]
      if (!c?.champion && src?.scene) {
        c = Object.values(state.comps)
          .filter((x) => x.format === 'circuit' && !!x.champion && !!x.circuit && x.circuit.end < (ev.start ?? 0)
            && eventOf(x.circuit.id)?.scene === src.scene)
          .sort((x, y) => y.circuit!.end - x.circuit!.end)[0]
      }
      if (!c?.champion) continue
      for (let j = f.k; j < c.finished.length; j++) if (take(i, c.finished[j])) break
    }
  }

  const scope = scopeOf(ev)
  const want = league ? 2 : tierOf(ev)
  const pool = Object.values(state.teams)
    .filter((t) => !t.dormant && t.roster.length >= 5 && !used.has(t.id)
      && (ev.scene ? t.scene === ev.scene : !scope || scope.includes(t.region) || scope.includes(regionIn(t.region, year))))
    .sort((a, b) => Number(b.tier === want) - Number(a.tier === want) || b.rating - a.rating)
  const mainSeeds = new Set<number>()
  for (const u of ev.units) {
    if (isOpen(u)) continue
    for (const n of u.nodes ?? []) for (const s of [n.a, n.b]) if (s[0] === 's') mainSeeds.add(s[1])
  }
  for (const i of [...mainSeeds].sort((a, b) => a - b)) {
    while (!out[i] && pool.length) take(i, pool.shift()!.id)
  }
  return { seeds: out, swaps: [] }
}

/* ------------------------------------------------------------------ */
/*  2027 on: the new format's places (engine/ahead.ts)                 */
/* ------------------------------------------------------------------ */

/** A season's leagues as engine/leagues.ts has drawn them: the one being played, or the one announced for next. */
function vctSeason(state: GameState, year: number): VctSeason | undefined {
  const v = state.vct
  return v?.now?.year === year ? v.now : v?.next?.year === year ? v.next : undefined
}

/** In a season's leagues: a partner, or one of China's visitors. Before that season is drawn, a tier-one club. */
function leagueClub(state: GameState, year: number, t: Team): boolean {
  const s = vctSeason(state, year)
  if (!s) return t.tier === 1
  return Object.values(s.partners).some((ids) => ids.includes(t.id)) || s.visitors.includes(t.id)
}

/**
 * Who can take a place in an event of the new format: for an open place, who
 * may enter; for any other, who stands in when the place's own side is not
 * there — a region with too few clubs to hold its qualifier, a side since gone.
 */
function planEligible(state: GameState, ev: CEvent, t: Team, seat: Seat | null): boolean {
  if (t.dormant || t.roster.length < 5 || t.id.startsWith('CUP_')) return false
  const plan = ev.plan!
  const year = ev.projected!.year
  const league = regionIn(t.region, year)
  const played = (key: string) => !!state.comps[`ev:F${year}:${key}`]?.teams.includes(t.id)
  // an Open Playoffs, and a qualifier into one, is for the sides the event before did not already place
  const before = `${plan.cup === 1 ? 'kickoff' : 'cup1'}:${plan.league}`
  switch (plan.kind) {
    case 'oq':
      if (oqPoolOf(t.region, t.roster.map((id) => state.players[id]?.nat), t.scene) !== plan.pool) return false
      return plan.cup === 0 ? !leagueClub(state, year + 1, t) : !leagueClub(state, year, t) && !played(before)
    case 'open':
      return league === plan.league && !leagueClub(state, year, t) && !played(before)
    case 'kickoff':
      return league === plan.league && !leagueClub(state, year, t)
    case 'oqFinal':
      return league === 'Pacific' && !leagueClub(state, year + 1, t)
    case 'ascension': {
      const s = vctSeason(state, year)
      return league === 'China' && (s ? !(s.partners.China ?? []).includes(t.id) : t.tier !== 1)
    }
    case 'cup':
      return league === plan.league && !played(`open${plan.cup}:${plan.league}`)
    default:
      return seat?.from === 'place' && !!seat.league && league === seat.league && t.tier === 1
  }
}

/**
 * The field of an event of the new format: each place filled by its own rule
 * (engine/ahead.ts `Seat`) off this world's results, the open places by the
 * best of those who could enter, and a place nobody took by the next best who
 * could take it.
 */
function planSeeds(state: GameState, ev: CEvent): { seeds: (string | null)[]; swaps: Swap[] } {
  const plan = ev.plan!
  const s = vctSeason(state, ev.projected!.year)
  const L = plan.league ?? ''
  const out: (string | null)[] = plan.seats.map(() => null)
  const used = new Set<string>()
  const take = (i: number, t: string | null | undefined): boolean => {
    if (!t || out[i] || used.has(t) || !state.teams[t] || state.teams[t].dormant) return false
    out[i] = t
    used.add(t)
    return true
  }
  plan.seats.forEach((seat, i) => {
    if (seat.from === 'partner') take(i, s?.partners[L]?.[seat.k])
    else if (seat.from === 'visitor') take(i, s?.visitors[seat.k])
    else if (seat.from === 'qualified') take(i, s?.qualified?.[L]?.[seat.k])
    else if (seat.from === 'place') take(i, state.comps[`ev:${seat.event}`]?.finished[seat.k])
  })
  const who = (seat: Seat | null): Team[] => Object.values(state.teams)
    .filter((t) => !used.has(t.id) && planEligible(state, ev, t, seat))
    .sort((a, b) => a.tier - b.tier || b.rating - a.rating || a.id.localeCompare(b.id))
  const open = plan.seats.map((seat, i) => ({ seat, i })).filter((x) => x.seat.from === 'pool').sort((a, b) => a.seat.k - b.seat.k)
  if (open.length) {
    const entered = who(null)
    for (const { i } of open) while (!out[i] && entered.length) take(i, entered.shift()!.id)
  }
  plan.seats.forEach((seat, i) => {
    if (!out[i] && seat.from !== 'pool') take(i, who(seat)[0]?.id)
  })
  return { seeds: out, swaps: [] }
}

/** A partnered league's own events: closed to everyone without a seat, whatever region they are in. */
export function isLeagueEvent(year: number, ev: CEvent): boolean {
  return year >= 2023 && !ev.scene && !!ev.region && ['Americas', 'EMEA', 'Pacific', 'China'].includes(ev.region)
    && (ev.stage === 'kickoff' || ev.stage === 'stage1' || ev.stage === 'stage2' || ev.stage === 'lcq')
    // China had no league in 2023: its FGC acts and Champions qualifier were open to its clubs
    && !(year === 2023 && ev.region === 'China')
}

/**
 * The player's own scene. Until 2022 a region was one circuit. From 2023 it is
 * not: a French club plays France Revolution, not DACH Evolution; a Challengers
 * club does not play the league above it; and the world does not move for a
 * player with no club to move it.
 */
function isHome(state: GameState, ev: CEvent, team: Team | undefined, club: string | null): boolean {
  // a player with no club moves nothing, in any year: the world is his only once he is in it
  if (!team || !club) return false
  if (state.year < 2023) return inScope(ev, team.region)
  if (ev.scene) return sceneFor(state, team) === ev.scene
  if (isLeagueEvent(state.year, ev)) return false
  return inScope(ev, team.region)
}

/** 方案 C: the seat the player's club took stays taken, in every event that seat plays. */
function takeSeat(state: GameState, ev: CEvent, seeds: (string | null)[]): (string | null)[] {
  const s = state.seat
  // the new format has no seats to take: its leagues are drawn afresh (engine/leagues.ts)
  if (!s || state.year < s.from || ev.plan) return seeds
  const seatEvent = (isLeagueEvent(state.year, ev) && ev.region === s.league) || /LOCK\/\/IN/i.test(ev.name)
  // the seat's real holder at this event: the club it was taken from, or what history carried that club on as
  const holders = [s.displaced, ...successorsOf(s.displaced, state.year)]
  const i = seeds.findIndex((t) => !!t && holders.includes(t))
  if (!seatEvent || i < 0 || seeds.includes(s.club)) return seeds
  const out = seeds.slice()
  out[i] = s.club
  return out
}

function begin(state: GameState, comp: Competition, ev: CEvent, notes: string[]): void {
  const c = comp.circuit!
  // out of the player's reach, each side takes the field with the people it really brought
  const founded = syncEvent(state, ev.rosters ?? {})
  if (founded.length) {
    state.news.push({ day: state.day, kind: 'club', text: `🆕 ${founded.slice(0, 6).join('、')}${founded.length > 6 ? ` 等 ${founded.length} 家` : ''} 以新俱乐部的身份登场（${ev.cn}）。` })
  }
  const { seeds, swaps } = seedsFor(state, ev)
  c.seeds = takeSeat(state, ev, seeds)
  const club = playerClub(state)
  const mine = !!club && c.seeds.includes(club)
  c.why = mine ? 'mine' : isHome(state, ev, state.teams[state.myTeam], club) ? 'home' : swaps.length ? 'ripple' : ev.projected ? 'ahead' : undefined
  if (swaps.length) c.swaps = swaps.slice(0, 8)
  c.mode = c.why ? 'sim' : 'history'
  // a side that is here under its own real name takes it, rebrand and all
  const swapped = new Set(swaps.map((s) => s.real))
  ev.seeds.forEach((v, i) => { if (c.seeds[i] && !swapped.has(v)) adoptName(state, ev, v, c.seeds[i]!) })
  if (c.mode === 'sim' && ev.plan) {
    planPlayIn(state, comp, ev, club, notes)
    if (club && c.seeds.includes(club)) c.why = 'mine'
    if (c.seeds.filter(Boolean).length + (c.playin ? 1 : 0) < 2) {
      // a qualifier in a region this world holds too few clubs to hold one: its place passes on (planSeeds)
      const playin = c.playin
      if (playin) state.fixtures = state.fixtures.filter((f) => f.id !== playin.fixture)
      c.playin = undefined
      c.done = true
    }
  } else if (c.mode === 'sim') {
    fillGaps(state, comp, ev)
    offerPlayIn(state, comp, ev, club, notes)
  }
  const entrants = [...c.seeds, ...Object.values(c.fill ?? {})]
  comp.teams = uniq(entrants.filter((x): x is string => !!x))
  comp.standings = newStandings(comp.teams)
}

/** The places an open qualifier sends into the rest of its event. */
function openOutputs(ev: CEvent): { ui: number; rank: number }[] {
  const out: { ui: number; rank: number }[] = []
  for (const u of ev.units) {
    if (isOpen(u)) continue
    for (const n of u.nodes ?? []) {
      for (const s of [n.a, n.b]) {
        if (s[0] === 'g' && isOpen(ev.units[s[1]])) out.push({ ui: s[1], rank: s[2]! })
      }
    }
  }
  return out
}

/**
 * A place in the draw whose real side is not in this world — a club that
 * folded before the save's roster book was written, or never had five on it.
 * A simulated event cannot hand its opponent a walkover in every round, so
 * the best side in scope that is not already in stands in.
 */
function fillGaps(state: GameState, comp: Competition, ev: CEvent): void {
  const c = comp.circuit!
  const scope = scopeOf(ev)
  const taken = new Set(c.seeds.filter((x): x is string => !!x))
  const pool = Object.values(state.teams)
    .filter((t) => !taken.has(t.id) && t.roster.length >= 5 && !t.id.startsWith('CUP_') && (!scope || scope.includes(t.region)))
    .sort((x, y) => (ev.projected && ev.scene ? Number(y.scene === ev.scene) - Number(x.scene === ev.scene) : 0)
      || Number(y.tier === comp.tier) - Number(x.tier === comp.tier) || y.rating - x.rating)
  const next = (): string | null => {
    const t = pool.shift()
    if (t) taken.add(t.id)
    return t?.id ?? null
  }
  const mainSeeds = new Set<number>()
  for (const u of ev.units) {
    if (isOpen(u)) continue
    for (const n of u.nodes ?? []) for (const s of [n.a, n.b]) if (s[0] === 's') mainSeeds.add(s[1])
  }
  for (const i of [...mainSeeds].sort((a, b) => a - b)) {
    if (!c.seeds[i]) c.seeds[i] = next()
  }
  for (const { ui, rank } of openOutputs(ev)) {
    const key = `${ui}:${rank}`
    if (!teamOf(state, ev, ev.units[ui].ranked?.[rank - 1]) && !c.fill?.[key]) {
      const t = next()
      if (t) c.fill = { ...(c.fill ?? {}), [key]: t }
    }
  }
}

/**
 * 开放海选. 2021 had no franchise and no licence: five people could enter.
 * A club of the player's region that is not already in the draw plays for the
 * last place the qualifier sends through, against the side that really took
 * it, on the day the qualifier really ended. The rounds before that were
 * against teams this world does not hold, and are not pretended.
 */
function offerPlayIn(state: GameState, comp: Competition, ev: CEvent, club: string | null, notes: string[]): void {
  const c = comp.circuit!
  if (!club || c.seeds.includes(club) || Object.values(c.fill ?? {}).includes(club)) return
  if (!isHome(state, ev, state.teams[club], club)) return
  let best: { ui: number; rank: number } | undefined = openOutputs(ev).sort((x, y) => y.rank - x.rank)[0]
  if (!best && state.year >= 2023) {
    // a closed league: the way in is its promotion stage, for the last place it sends up
    const ui = ev.units.findIndex((u) => isOpen(u) && (u.promotes ?? 0) > 0)
    if (ui >= 0) best = { ui, rank: ev.units[ui].promotes! }
  }
  if (!best && state.year >= 2023) {
    // a promotion bracket played between a league's bottom sides and challengers from outside it —
    // East's 2023 Surge Promotion Cup, MENA's promotion/relegation series: the player's club plays the
    // weakest of those challengers for its seat, before the bracket starts
    const seat = outsideSeat(state, ev, c)
    const rival = seat == null ? null : c.seeds[seat]
    if (seat != null && rival && rival !== club) {
      const f = makeFixture(state.day, comp.stage, comp.key, club, rival, 3, 'KO:0:升降级 · 决胜局')
      f.node = -1
      state.fixtures.push(f)
      c.playin = { key: `s:${seat}`, fixture: f.id }
      notes.push(`📝 ${comp.name} 有给外来队伍的名额，${state.teams[club].name} 报名争取：打赢 ${state.teams[rival].name} 就进升降级赛。`)
    }
    return
  }
  if (!best) return
  const u = ev.units[best.ui]
  const key = `${best.ui}:${best.rank}`
  const rival = teamOf(state, ev, u.ranked?.[best.rank - 1]) ?? c.fill?.[key] ?? null
  if (!rival || rival === club) return
  const f = makeFixture(Math.max(u.last ?? 0, state.day), comp.stage, comp.key, club, rival, 3, 'KO:0:海选 · 决胜局')
  f.node = -1
  state.fixtures.push(f)
  c.playin = { key, fixture: f.id }
  notes.push(`📝 ${comp.name} 开放报名，${state.teams[club].name} 报了海选：打赢 ${state.teams[rival].name} 就进正赛。`)
}

/**
 * The new format's qualifiers are open: a club that can enter and is not in the
 * draw plays the weakest side that is, for its place — or, where a place went
 * untaken, simply takes it.
 */
function planPlayIn(state: GameState, comp: Competition, ev: CEvent, club: string | null, notes: string[]): void {
  const c = comp.circuit!
  const team = club ? state.teams[club] : undefined
  if (!club || !team || c.seeds.includes(club)) return
  const open = ev.plan!.seats.map((seat, i) => ({ seat, i })).filter((x) => x.seat.from === 'pool').sort((a, b) => b.seat.k - a.seat.k)
  if (!open.length || !planEligible(state, ev, team, null)) return
  const empty = open.find((x) => !c.seeds[x.i])
  if (empty) {
    c.seeds[empty.i] = club
    notes.push(`📝 ${team.name} 报名了${comp.name}。`)
    return
  }
  const rival = c.seeds[open[0].i]!
  const f = makeFixture(state.day, comp.stage, comp.key, club, rival, 3, 'KO:0:公开资格赛 · 决胜局')
  f.node = -1
  state.fixtures.push(f)
  c.playin = { key: `s:${open[0].i}`, fixture: f.id }
  notes.push(`📝 ${team.name} 报名了${comp.name}：打赢 ${state.teams[rival]?.name ?? rival} 就进最后阶段。`)
}

const PROMO_WORDS = /Promotion|Relegation|Up and Down|Pro\/Rel|Acesso|Repescagem/i

/**
 * The seat in a promotion bracket held by the weakest side that came from outside
 * the league: a seed no earlier event of its scene that year had placed.
 */
function outsideSeat(state: GameState, ev: CEvent, c: NonNullable<Competition['circuit']>): number | null {
  const feeders = feedersOf(ev)
  let pick: number | null = null
  let weakest = Infinity
  for (const u of ev.units) {
    if (isOpen(u) || !(u.side || PROMO_WORDS.test(`${ev.name} ${u.label} ${u.phase ?? ''}`))) continue
    for (const n of u.nodes ?? []) {
      for (const s of [n.a, n.b]) {
        if (s[0] !== 's' || feeders[s[1]]) continue
        const t = c.seeds[s[1]]
        const rating = t ? state.teams[t]?.rating ?? 0 : Infinity
        if (rating < weakest) { weakest = rating; pick = s[1] }
      }
    }
  }
  return pick
}

/**
 * The championship points a stage paid on top of its placings, 2024 and 2025:
 * a point a match win, a point for topping a group, a point for a playoff bye
 * (src/data/routes_partnered.json has each event's rules). Counted off this
 * world's results — the fixtures where the event was played, history's where
 * it was not — so a pool reads the same way whichever it was.
 */
export function circuitBonus(state: GameState, comp: Competition): Map<string, number> {
  const out = new Map<string, number>()
  const c = comp.circuit
  const rules = c ? rulesOf(c.id) : undefined
  const ev = c ? eventOf(c.id) : undefined
  if (!c || !rules || !ev || !(rules.wins || rules.groupWin || rules.bye)) return out
  const add = (t: string | null | undefined, v: number) => { if (t && v) out.set(t, (out.get(t) ?? 0) + v) }
  const { nodes, base } = flat(ev)
  const fx = new Map<number, Fixture>()
  for (const f of state.fixtures) if (f.comp === comp.key && f.node != null && f.node >= 0) fx.set(f.node, f)
  const resultOf = (n: Flat): { a: string | null; b: string | null; w: string | null; md: number } => {
    if (c.mode === 'sim') {
      const f = fx.get(n.at)
      const g = f ? gameOf(f) : null
      return g ? { a: g.a, b: g.b, w: g.w, md: g.mapsA - g.mapsB } : { a: null, b: null, w: null, md: 0 }
    }
    return {
      a: teamOf(state, ev, n.teams[0]), b: teamOf(state, ev, n.teams[1]),
      w: n.winner ? teamOf(state, ev, n.winner) : null, md: (n.score[0] ?? 0) - (n.score[1] ?? 0),
    }
  }
  const where = rules.winsIn ?? 'groups'
  // a titled event pays its winner for the title, and the final it won is that title, not a
  // match win on top (100 Thieves, FNATIC and Paper Rex took 9, 9 and 10 from 2024 Stage 1)
  const champion = rules.award?.['1'] ? comp.champion : undefined
  // the sides seeded past the knockout round, straight into the upper semi-finals
  const seeded = new Set<string>()
  ev.units.forEach((u, ui) => {
    const ns = (u.nodes ?? []).map((_, i) => nodes[base[ui] + i])
    if (!ns.length) return
    const games = ns.map(resultOf)
    const playoffs = /Playoff|季后赛|Main Event|正赛/.test((u.phase ?? '') + u.label)
    if (rules.wins && (playoffs ? where !== 'groups' : where !== 'playoffs')) {
      games.forEach((g, i) => {
        if (playoffs && champion && g.w === champion && ns[i].round.includes('总决赛')) return
        add(g.w, rules.wins!)
      })
    }
    if (!playoffs) return
    ns.forEach((n, i) => {
      const entry = (s: Slot) => s[0] === 'g' || s[0] === 's'
      const fed = (s: Slot) => s[0] === 'w' || s[0] === 'l'
      if (!n.round.includes('胜者组')) return
      if (entry(n.a) && fed(n.b) && games[i].a) seeded.add(games[i].a!)
      else if (entry(n.b) && fed(n.a) && games[i].b) seeded.add(games[i].b!)
    })
  })
  // 2024 Stage 1 was played across both groups and lists 「Group Victory」 and 「Bye Round」 both,
  // but it is one point, Riot's 「earned bye」: to the sides that skipped the knockout round
  const per = rules.bye || rules.groupWin
  if (per) for (const t of seeded) add(t, per)
  return out
}

function gameOf(f: Fixture): Game | null {
  if (!f.played || !f.result) return null
  const aWon = f.result.mapsWonA > f.result.mapsWonB
  const rounds = f.result.maps.reduce((s, m) => [s[0] + m.scoreA, s[1] + m.scoreB], [0, 0])
  return {
    a: f.teamA, b: f.teamB, w: f.result.mapsWonA === f.result.mapsWonB ? null : aWon ? f.teamA : f.teamB, round: f.label.replace(/^KO:-?\d+:/, ''),
    mapsA: f.result.mapsWonA, mapsB: f.result.mapsWonB, roundsA: rounds[0], roundsB: rounds[1],
  }
}

function playOn(state: GameState, comp: Competition, ev: CEvent): boolean {
  const c = comp.circuit!
  const { nodes, base } = flat(ev)
  const fx = new Map<number, Fixture>()
  for (const f of state.fixtures) if (f.comp === comp.key && f.node != null) fx.set(f.node, f)
  const games = new Map<number, Game>()
  for (const n of nodes) {
    const f = fx.get(n.at)
    const g = f && gameOf(f)
    if (g) games.set(n.at, g)
    else if (c.walk && n.at in c.walk) {
      const w = c.walk[n.at] || null
      games.set(n.at, { a: w, b: null, w, round: n.round, mapsA: 0, mapsB: 0, roundsA: 0, roundsB: 0 })
    }
  }

  const unitGames = (ui: number): Game[] | undefined => {
    const out: Game[] = []
    for (let i = 0; i < (ev.units[ui].nodes?.length ?? 0); i++) {
      const g = games.get(base[ui] + i)
      if (!g) return undefined
      out.push(g)
    }
    return out
  }
  const playIn = c.playin ? state.fixtures.find((f) => f.id === c.playin!.fixture) : undefined

  // scripts/build_circuit.py seeds a phase off the last earlier phase each side played in, and a
  // phase can begin before that one has ended: DACH Evolution 2026 Stage 1's Weekly #1 (11 January)
  // is read off a group stage that ran to its tiebreaker on 1 February. Waiting for that table put
  // all four Weekly cups, the play-in and the playoffs' first days into 1–13 February, one after
  // another. A phase that reseeds every side of such a table is seeded off it as it stood the day
  // before the phase began, once it holds them all. One that takes only some of its places still
  // waits for the final table: 2021 SEA's D组 takes A组's fourth, and read early that fourth could
  // go on to finish second and be seeded into the playoffs twice.
  const cuts = new Map<string, { day: number; need: number } | null>()
  const earlyCut = (ui: number, uj: number): { day: number; need: number } | null => {
    const key = `${ui}:${uj}`
    if (!cuts.has(key)) {
      const fed = (ev.units[ui].nodes ?? []).flatMap((n) => [n.a, n.b]
        .filter((s) => s[0] === 'g' && s[1] === uj).map((s) => ({ day: n.day, rank: s[2] ?? 0 })))
      const day = Math.min(...fed.map((x) => x.day))
      const ends = Math.max(...(ev.units[uj].nodes ?? []).map((n) => n.day))
      const need = ev.units[uj].size
      const whole = new Set(fed.map((x) => x.rank).filter((r) => r >= 1 && r <= need)).size === need
      cuts.set(key, fed.length && whole && ends > day ? { day, need } : null)
    }
    return cuts.get(key)!
  }

  const slot = (ui: number, s: Slot): string | null | undefined => {
    if (s[0] === 's') {
      // a seat the player's club is contesting: whoever wins the decider sits in it
      if (c.playin?.key === `s:${s[1]}`) {
        const g = playIn && gameOf(playIn)
        return g ? g.w : undefined
      }
      return c.seeds[s[1]] ?? null
    }
    if (s[0] === 'w' || s[0] === 'l') {
      const g = games.get(base[ui] + s[1])
      if (!g) return undefined
      return s[0] === 'w' ? g.w : (g.w === g.a ? g.b : g.a)
    }
    const [, uj, rank] = s
    const u = ev.units[uj]
    const key = `${uj}:${rank}`
    if (u.type === 'open') {
      if (state.day < (u.last ?? 0)) return undefined
      if (c.playin?.key === key) {
        const g = playIn && gameOf(playIn)
        return g ? g.w : undefined
      }
      return teamOf(state, ev, u.ranked?.[rank! - 1]) ?? c.fill?.[key] ?? null
    }
    const early = earlyCut(ui, uj)
    if (early) {
      const known: Game[] = []
      for (let i = 0; i < (u.nodes?.length ?? 0); i++) {
        if (u.nodes![i].day >= early.day) continue
        const g = games.get(base[uj] + i)
        if (!g) return undefined
        known.push(g)
      }
      const ranked = rankPhase(u.type, known, u.upperFirst).ranked
      if (ranked.length >= early.need) return ranked[rank! - 1] ?? null
    }
    const gs = unitGames(uj)
    if (!gs) return undefined
    return rankPhase(u.type, gs, u.upperFirst).ranked[rank! - 1] ?? null
  }

  let moved = true
  while (moved) {
    moved = false
    for (const n of nodes) {
      if (games.has(n.at) || fx.has(n.at)) continue
      const a = slot(n.unit, n.a)
      const b = slot(n.unit, n.b)
      if (a === undefined || b === undefined) continue
      if (!a || !b || a === b) {
        const w = a ?? b ?? ''
        c.walk = { ...(c.walk ?? {}), [n.at]: w }
        games.set(n.at, { a: w || null, b: null, w: w || null, round: n.round, mapsA: 0, mapsB: 0, roundsA: 0, roundsB: 0 })
        moved = true
        continue
      }
      const rr = ev.units[n.unit].type === 'rr'
      // Bo2 as it really was: two maps, and a level series is a point each
      const bo = n.bo
      // on its real day: a tie fed by one played this morning is played this
      // evening, the way Reykjavík opened (see advanceDay's second pass)
      const f = makeFixture(Math.max(n.day, state.day), comp.stage, comp.key, a, b, bo, rr ? n.round : `KO:${n.at + 1}:${n.round}`)
      f.node = n.at
      state.fixtures.push(f)
      fx.set(n.at, f)
      for (const t of [a, b]) {
        if (!comp.standings[t]) comp.standings[t] = newRow(t)
        if (!comp.teams.includes(t)) comp.teams.push(t)
      }
    }
  }

  if (nodes.some((n) => !games.has(n.at))) return false
  if (ev.units.some((u) => isOpen(u) && state.day < (u.last ?? 0))) return false
  if (playIn && !gameOf(playIn)) return false
  const playInWon = playIn ? gameOf(playIn)?.w : undefined
  const tiers = ev.units.map((u, ui) => (isOpen(u)
    // a promotion place won in the decider is the winner's, whoever held it in history
    ? uniq((u.ranked ?? []).map((v, r) => (c.playin?.key === `${ui}:${r + 1}` && playInWon ? playInWon : teamOf(state, ev, v)))
      .filter((t): t is string => !!t)).map((t) => [t])
    : rankPhase(u.type as 'rr' | 'bracket', unitGames(ui)!, u.upperFirst).tiers))
  finish(comp, placesFrom(ev.units, tiers))
  return true
}

/**
 * What really happened in the node a fixture plays, for 「真实历史里这场是 X 赢的」.
 * Once the bracket has moved, the same slot can hold two different sides, and
 * then it is 「这个位置」 that history is quoted for, not 「这场」.
 */
export function realResultOf(state: GameState, comp: Competition, f: Fixture): { winner: string; line: string } | null {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  if (!ev || ev.projected || f.node == null || f.node < 0) return null
  const n = flat(ev).nodes[f.node]
  if (!n) return null
  const nm = (t: string) => ev.names[t] ?? t.replace(/^N:/, '')
  const [sa, sb] = n.score
  const real = new Set([teamOf(state, ev, n.teams[0]), teamOf(state, ev, n.teams[1])])
  const same = real.has(f.teamA) && real.has(f.teamB)
  if (!n.winner) {
    return { winner: '', line: `真实历史里${same ? '这场' : '这个位置'}是 ${nm(n.teams[0])} ${sa ?? '?'}-${sb ?? '?'} ${nm(n.teams[1])}，打平` }
  }
  const loser = n.teams[0] === n.winner ? n.teams[1] : n.teams[0]
  const score = sa != null && sb != null ? ` ${Math.max(sa, sb)}-${Math.min(sa, sb)}` : ''
  return {
    winner: nm(n.winner),
    line: same
      ? `真实历史里这场是 ${nm(n.winner)}${score} 赢下 ${nm(loser)}`
      : `真实历史里这个位置是 ${nm(n.winner)}${score} ${nm(loser)}`,
  }
}

/** The real placings of an event, for the standings page. */
export function realPlacesOf(comp: Competition): { name: string; place: number }[] {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  if (!ev || ev.projected) return []
  return ev.places.slice(0, 8).map(([t, place]) => ({ name: ev.names[t] ?? t.replace(/^N:/, ''), place }))
}
