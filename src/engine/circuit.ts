import raw from '../data/circuit.json'
import { stageAtIn } from './era'
import { makeFixture, newRow, newStandings } from './league'
import type { Competition, Fixture, GameState, Region, StageKey } from './types'

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

type Slot = [string, number, number?]

interface CNode {
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

interface CUnit {
  label: string
  /** `open`: a qualifier, kept only as its result — see isOpen */
  type: 'rr' | 'bracket' | 'open'
  size: number
  nodes?: CNode[]
  first?: number
  last?: number
  ranked?: string[]
}

export interface CEvent {
  id: string
  name: string
  cn: string
  /** a club region, a combining layer (EMEA, SEA…), or null for an international */
  region: string | null
  /** the club regions a combining layer draws on */
  layer: string[] | null
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
}

const CIRCUIT = raw as unknown as Record<string, CEvent[]>

export const eventsOf = (year: number): CEvent[] => CIRCUIT[String(year)] ?? []

const BY_ID = new Map<string, CEvent>()
for (const evs of Object.values(CIRCUIT)) for (const e of evs) BY_ID.set(e.id, e)
export const eventOf = (id: string): CEvent | undefined => BY_ID.get(id)

/** A vlr team id as this world knows it. Sides from open qualifiers are not clubs. */
export const worldIdOf = (vlr: string): string | null => (vlr.startsWith('N:') ? null : `V21T${vlr}`)

const idIn = (state: GameState, vlr: string | null | undefined): string | null => {
  if (!vlr) return null
  const id = worldIdOf(vlr)
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
  if (!vlr) return null
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
const TOP: StageKey[] = ['s1masters', 's2finals', 's3finals', 'masters1', 'masters2', 'lcq', 'champions']
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
function rankPhase(type: 'rr' | 'bracket', games: Game[]): { ranked: string[]; tiers: string[][] } {
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
    const key = (t: string) => { const r = s.get(t)!; return [r.pts, r.md, r.rd] }
    const ranked = teams.slice().sort((x, y) => {
      const [a, b] = [key(x), key(y)]
      return b[0] - a[0] || b[1] - a[1] || b[2] - a[2]
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
  const alive = teams.filter((t) => !out(t))
    .sort((x, y) => (losses.get(x) ?? 0) - (losses.get(y) ?? 0) || last.get(y)! - last.get(x)!)
  const gone = teams.filter(out).sort((x, y) =>
    last.get(y)! - last.get(x)! || Number(games[last.get(y)!].w === y) - Number(games[last.get(x)!].w === x))
  const tiers: string[][] = []
  for (const t of alive) {
    const prev = tiers[tiers.length - 1]
    if (prev && (losses.get(prev[0]) ?? 0) === (losses.get(t) ?? 0)) prev.push(t)
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
  units.forEach((u, ui) => phases.set(phaseOf(u), [...(phases.get(phaseOf(u)) ?? []), ui]))
  const out: [string, number][] = []
  const seen = new Set<string>()
  for (const group of [...phases.values()].reverse()) {
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
  for (const ev of eventsOf(state.year)) {
    if (ev.start == null || ev.end == null || !ev.units.length) continue
    const teams = uniq(ev.seeds.map((v) => idIn(state, v)).filter((x): x is string => !!x))
    const comp: Competition = {
      key: `ev:${ev.id}`,
      name: ev.cn,
      region: ev.region && !ev.layer ? (ev.region as Region) : undefined,
      tier: tierOf(ev),
      stage: ev.stage ?? stageAtIn(state.year, ev.start),
      teams,
      standings: newStandings(teams),
      finished: [],
      format: 'circuit',
      circuit: { id: ev.id, start: ev.start, end: ev.end, seeds: [] },
    }
    state.comps[comp.key] = comp
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
function seedsFor(state: GameState, ev: CEvent): { seeds: (string | null)[]; swaps: Swap[] } {
  const out: (string | null)[] = []
  for (const v of ev.seeds) {
    const t = teamOf(state, ev, v)
    out.push(t && !out.includes(t) ? t : null)
  }
  const done = Object.values(state.comps).filter((x) =>
    x.format === 'circuit' && x.champion && x.circuit && x.circuit.end < (ev.start ?? 0))
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

function begin(state: GameState, comp: Competition, ev: CEvent, notes: string[]): void {
  const c = comp.circuit!
  const { seeds, swaps } = seedsFor(state, ev)
  c.seeds = seeds
  const club = playerClub(state)
  const home = state.teams[state.myTeam]?.region
  const mine = !!club && c.seeds.includes(club)
  c.why = mine ? 'mine' : inScope(ev, home) ? 'home' : swaps.length ? 'ripple' : undefined
  if (swaps.length) c.swaps = swaps.slice(0, 8)
  c.mode = c.why ? 'sim' : 'history'
  // a side that is here under its own real name takes it, rebrand and all
  const swapped = new Set(swaps.map((s) => s.real))
  ev.seeds.forEach((v, i) => { if (c.seeds[i] && !swapped.has(v)) adoptName(state, ev, v, c.seeds[i]!) })
  if (c.mode === 'sim') {
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
    .sort((x, y) => Number(y.tier === comp.tier) - Number(x.tier === comp.tier) || y.rating - x.rating)
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
  if (!inScope(ev, state.teams[club]?.region)) return
  const best = openOutputs(ev).sort((x, y) => y.rank - x.rank)[0]
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

function gameOf(f: Fixture): Game | null {
  if (!f.played || !f.result) return null
  const aWon = f.result.mapsWonA > f.result.mapsWonB
  const rounds = f.result.maps.reduce((s, m) => [s[0] + m.scoreA, s[1] + m.scoreB], [0, 0])
  return {
    a: f.teamA, b: f.teamB, w: aWon ? f.teamA : f.teamB, round: f.label.replace(/^KO:-?\d+:/, ''),
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

  const slot = (ui: number, s: Slot): string | null | undefined => {
    if (s[0] === 's') return c.seeds[s[1]] ?? null
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
    const gs = unitGames(uj)
    if (!gs) return undefined
    return rankPhase(u.type, gs).ranked[rank! - 1] ?? null
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
      // Korea's and Japan's Bo2 groups are played as Bo3: the match engine has
      // no drawn series. Their real draws stay draws in the history the
      // schedule quotes.
      const bo = n.bo === 2 ? 3 : n.bo
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
  const tiers = ev.units.map((u, ui) => (isOpen(u)
    ? uniq((u.ranked ?? []).map((v) => teamOf(state, ev, v)).filter((t): t is string => !!t)).map((t) => [t])
    : rankPhase(u.type as 'rr' | 'bracket', unitGames(ui)!).tiers))
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
  if (!ev || f.node == null || f.node < 0) return null
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
  if (!ev) return []
  return ev.places.slice(0, 8).map(([t, place]) => ({ name: ev.names[t] ?? t.replace(/^N:/, ''), place }))
}
