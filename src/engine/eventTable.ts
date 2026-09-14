import { eventOf, gameOf, isPlacementRound, phaseSeatsOf, rankPhase } from './circuit'
import type { CUnit, Game } from './circuit'
import type { Competition, GameState } from './types'

/**
 * A real event's standings, read off the matches this world played.
 *
 * The standings page printed every fixture of an event, one row each, and a
 * player looking for who was top of the group found a match list instead
 * (作者：「为什么积分榜里放的是所有队伍的比赛记录而不是积分」). What vlr.gg and
 * the broadcast show is what a player reads: a group, a Swiss stage or a
 * regular season as a table — record, maps, map difference, round difference —
 * and a knockout bracket as placings: who is still in and what they play next,
 * who went out where, and the final order once it is over.
 *
 * Nothing here decides anything. Who a table sends on is who took the seat in
 * the next phase's matches; before those matches exist, it is engine/circuit.ts's
 * own rankPhase over the event graph's `g` slots — the two things that seat the
 * next phase — so the page cannot tell a different story from the draw.
 *
 * Pure: reads the state, writes nothing.
 */

export interface TableRow {
  team: string
  w: number
  l: number
  /** level Bo2 series */
  d: number
  mapW: number
  mapL: number
  roundW: number
  roundL: number
  /** the phase this side's place sent it to, null where it went no further; absent while that is not known */
  next?: string | null
}

export interface GroupTable {
  kind: 'table'
  unit: number
  /** 小组赛, 瑞士轮, 常规赛 */
  phase: string
  /** A组 — empty for a phase that is one table */
  group: string
  rows: TableRow[]
  /** every match of the table is decided */
  done: boolean
  /** how many places the table sends on — the event graph knows before a match is played */
  advance: number
  /** where they go, when all of them go to the same phase */
  to: string | null
  /** every phase its places go to, in rank order of the first place that goes there */
  dests: string[]
  /** a line under this many rows: the sides going on are exactly the rows above it */
  cut: number | null
}

export interface PlaceRow {
  team: string
  /** in: still playing; out: knocked out; won: won the bracket */
  state: 'in' | 'out' | 'won'
  /** in: the round it plays next, '' where the draw has not said; out: the round it went out in */
  round: string
  /** its placing, joint places as a range — once it is out, or the event is over */
  place?: [number, number]
}

export interface PlaceTable {
  kind: 'bracket'
  unit: number
  phase: string
  group: string
  rows: PlaceRow[]
  done: boolean
}

export type EventTable = GroupTable | PlaceTable

/** The phases the event graph names in English, in the words a Chinese broadcast uses. */
const PHASE_CN: Record<string, string> = {
  'Swiss Stage': '瑞士轮', 'Swiss Phase': '瑞士轮', 'Upper Swiss Phase': '瑞士轮',
  'Group Stage': '小组赛', 'Groups Phase': '小组赛',
  'Play-In Stage': '附加赛', 'Play-Ins': '附加赛', 'Play-In': '附加赛',
  Playoffs: '季后赛', 'Playoffs Phase': '季后赛',
  'Regular Season': '常规赛', 'Regular Phase': '常规赛', 'League Phase': '常规赛', 'League Stage': '常规赛',
  'Promotion/Relegation': '升降级赛',
}

/** A round the graph names in English: a Swiss round with its record, Kickoff's middle bracket. */
export function roundCn(round: string): string {
  return round
    .replace(/^Round (\d+) \((\d+-\d+)\)$/, '第 $1 轮（$2）')
    .replace(/^Middle Round (\d+)$/, '中段组第 $1 轮')
    .replace(/^Middle Final$/, '中段组决赛')
    .replace(/^(Bronze( Match| Final)?|Consolation)$/, '季军赛')
}

/** A unit's phase and group: 「小组赛 · A组」 is the A组 of 小组赛. */
export function labelOf(u: CUnit): { phase: string; group: string } {
  const parts = u.label.split(' · ')
  const last = parts[parts.length - 1]
  const grouped = parts.length > 1 && /组$/.test(last)
  const phase = (grouped ? parts.slice(0, -1) : parts).map((p) => PHASE_CN[p] ?? p).join(' · ')
  return { phase, group: grouped ? last : '' }
}

const emptyRow = (team: string): TableRow => ({ team, w: 0, l: 0, d: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0 })

/**
 * The tables of an event this world plays, the latest phase first. An event
 * replayed as history has no matches here to read, and no tables.
 */
export function eventTables(state: GameState, comp: Competition): EventTable[] {
  const c = comp.circuit
  const ev = c && eventOf(c.id)
  if (!c || !ev || c.mode !== 'sim') return []

  // the graph's global node index of each unit's first node
  const base: number[] = []
  let count = 0
  for (const u of ev.units) { base.push(count); count += u.nodes?.length ?? 0 }
  const unitAt = (at: number): number => {
    let ui = 0
    while (ui + 1 < base.length && base[ui + 1] <= at) ui++
    return ui
  }

  const decided = new Map<number, Game>()
  const walks = new Set<number>()
  const pending = new Map<number, [string, string]>()
  for (const f of state.fixtures) {
    if (f.comp !== comp.key || f.node == null || f.node < 0) continue
    const g = gameOf(f)
    if (g) decided.set(f.node, g)
    else pending.set(f.node, [f.teamA, f.teamB])
  }
  for (const [k, w] of Object.entries(c.walk ?? {})) {
    const at = Number(k)
    if (decided.has(at)) continue
    const ui = unitAt(at)
    walks.add(at)
    decided.set(at, { a: w || null, b: null, w: w || null, round: ev.units[ui].nodes?.[at - base[ui]]?.round ?? '', mapsA: 0, mapsB: 0, roundsA: 0, roundsB: 0 })
  }

  // where each unit's places go: rank → the node slots it seats, in the units after it
  const seats = new Map<number, Map<number, { unit: number; at: number; side: 0 | 1 }[]>>()
  ev.units.forEach((u, uj) => {
    ;(u.nodes ?? []).forEach((nd, i) => {
      ;[nd.a, nd.b].forEach((s, side) => {
        if (s[0] !== 'g' || s[2] == null || s[1] === uj) return
        const byRank = seats.get(s[1]) ?? new Map<number, { unit: number; at: number; side: 0 | 1 }[]>()
        byRank.set(s[2], [...(byRank.get(s[2]) ?? []), { unit: uj, at: base[uj] + i, side: side as 0 | 1 }])
        seats.set(s[1], byRank)
      })
    })
  })
  /** who actually sits in a seat a table fed, once the match there is drawn */
  const seated = (x: { at: number; side: 0 | 1 }): string | null => {
    const p = pending.get(x.at)
    if (p) return p[x.side]
    if (walks.has(x.at)) return null
    const g = decided.get(x.at)
    return g ? (x.side === 0 ? g.a : g.b) : null
  }

  const tables: { t: EventTable; key: number }[] = []
  ev.units.forEach((u, ui) => {
    const nodes = u.nodes ?? []
    if (u.type === 'open' || !nodes.length) return
    const at = (i: number) => base[ui] + i
    if (!nodes.some((_, i) => decided.has(at(i)) || pending.has(at(i)))) return
    const games = nodes.map((_, i) => decided.get(at(i)))
    const done = games.every(Boolean)
    const { phase, group } = labelOf(u)
    const fed = seats.get(ui)
    // later phases on top; a relegation series played after the final below everything
    const phaseIndex = ev.units.findIndex((x) => labelOf(x).phase === phase)
    const key = u.side ? -1 : phaseIndex

    // a knockout is matches that lead into one another; a round of pairings that lead nowhere
    // within the unit — one Swiss round of FGC 2023's qualifier — is read as a table
    const linked = nodes.some((nd) => [nd.a, nd.b].some((s) => s[0] === 'w' || s[0] === 'l'))
    if (u.type === 'rr' || fed?.size || (!linked && nodes.length > 1)) {
      const rows = new Map<string, TableRow>()
      const row = (t: string): TableRow => {
        let r = rows.get(t)
        if (!r) { r = emptyRow(t); rows.set(t, r) }
        return r
      }
      nodes.forEach((_, i) => {
        const g = decided.get(at(i))
        if (g && g.a && g.b && !walks.has(at(i))) {
          const [ra, rb] = [row(g.a), row(g.b)]
          if (g.w === g.a) { ra.w++; rb.l++ } else if (g.w === g.b) { rb.w++; ra.l++ } else { ra.d++; rb.d++ }
          ra.mapW += g.mapsA; ra.mapL += g.mapsB; rb.mapW += g.mapsB; rb.mapL += g.mapsA
          ra.roundW += g.roundsA; ra.roundL += g.roundsB; rb.roundW += g.roundsB; rb.roundL += g.roundsA
        } else if (g) {
          for (const t of [g.a, g.b]) if (t) row(t)
        }
        for (const t of pending.get(at(i)) ?? []) row(t)
      })
      const played = games.filter((g): g is Game => !!g)
      // a round robin is its own table (points, head to head, maps, rounds); anything else by its record
      const order = u.type === 'rr'
        ? (() => { const ranked = rankPhase('rr', played, false, u.tiebreak === 'riot').ranked; return [...ranked, ...[...rows.keys()].filter((t) => !ranked.includes(t))] })()
        : [...rows.values()].sort((x, y) => y.w - x.w || x.l - y.l
          || (y.mapW - y.mapL) - (x.mapW - x.mapL) || (y.roundW - y.roundL) - (x.roundW - x.roundL)).map((r) => r.team)

      const ranks = [...(fed?.keys() ?? [])].sort((a, b) => a - b)
      const dest = (rank: number): string => labelOf(ev.units[fed!.get(rank)![0].unit]).phase
      // the sides the next phase has already seated, then — the table complete — its placings as the engine reads them
      for (const rank of ranks) {
        for (const x of fed!.get(rank)!) {
          const t = seated(x)
          if (t && rows.has(t)) rows.get(t)!.next = dest(rank)
        }
      }
      if (done) {
        // the places the draw reads off this table: each group's own top places (engine/circuit.ts PhaseSeats)
        const reads = phaseSeatsOf(state, comp, ui)
        for (const rank of ranks) {
          const t = reads?.get(rank)
          if (t && rows.has(t) && rows.get(t)!.next == null) rows.get(t)!.next = dest(rank)
        }
        for (const r of rows.values()) if (r.next === undefined) r.next = null
      }
      const tos = new Set(ranks.map(dest))
      let cut: number | null = null
      if (done) {
        const going = order.filter((t) => rows.get(t)!.next)
        if (going.length && going.length < order.length && going.every((t, i) => order[i] === t)) cut = going.length
      } else if (ranks.length && ranks.every((k, i) => k === i + 1) && ranks.length < rows.size) {
        cut = ranks.length
      }
      tables.push({
        key,
        t: {
          kind: 'table', unit: ui, phase, group, done, cut,
          rows: order.map((t) => rows.get(t)!),
          advance: ranks.length,
          to: tos.size === 1 ? [...tos][0] : null,
          dests: [...tos],
        },
      })
      return
    }

    // a knockout bracket: follow each side along the graph's winner and loser slots
    const next = (kind: 'w' | 'l', i: number): number | undefined => {
      const j = nodes.findIndex((nd) => (nd.a[0] === kind && nd.a[1] === i) || (nd.b[0] === kind && nd.b[1] === i))
      return j < 0 ? undefined : j
    }
    const sides: string[] = []
    nodes.forEach((_, i) => {
      const g = decided.get(at(i))
      for (const t of [g?.a, g?.b, ...(pending.get(at(i)) ?? [])]) if (t && !sides.includes(t)) sides.push(t)
    })
    const rows: PlaceRow[] = []
    const exits = new Map<string, number>()
    const losses = new Map<string, number>()
    for (const t of sides) {
      let end: { i: number; won: boolean } | undefined
      let upNext: number | undefined
      let playing: number | undefined
      nodes.forEach((_, i) => {
        const g = decided.get(at(i))
        if (g && (g.a === t || g.b === t)) {
          const won = g.w === t
          if (!won && g.w) losses.set(t, (losses.get(t) ?? 0) + 1)
          const j = next(won ? 'w' : 'l', i)
          if (j == null) end = { i, won }
          else if (!decided.has(at(j))) upNext = j
        } else if (pending.get(at(i))?.includes(t)) {
          playing = i
        }
      })
      // a match still to play is the truth of it, whatever the graph says a side's last result led to
      if (playing != null) {
        rows.push({ team: t, state: 'in', round: nodes[playing].round })
      } else if (end && end.won && !isPlacementRound(nodes[end.i].round)) {
        rows.push({ team: t, state: 'won', round: nodes[end.i].round })
      } else if (end) {
        rows.push({ team: t, state: 'out', round: nodes[end.i].round })
        exits.set(t, end.i * 2 + (end.won ? 1 : 0))
      } else {
        rows.push({ team: t, state: 'in', round: upNext != null ? nodes[upNext].round : '' })
      }
    }
    if (comp.champion && comp.finished.length) {
      // the event is over: its own placings, joint places as ranges
      for (const r of rows) {
        const k = comp.finished.indexOf(r.team)
        if (k < 0) continue
        const p = comp.places?.[k] ?? k + 1
        const joint = comp.places ? comp.places.filter((x) => x === p).length : 1
        r.place = [p, p + joint - 1]
      }
    } else {
      // two sides out in the same round share a place, counted up from the bottom of the bracket
      const size = Math.max(u.size, sides.length)
      const groups = new Map<string, string[]>()
      for (const r of rows) {
        if (r.state !== 'out') continue
        const k = `${r.round}|${exits.get(r.team)! % 2}`
        groups.set(k, [...(groups.get(k) ?? []), r.team])
      }
      const worstFirst = [...groups.values()].sort((a, b) =>
        Math.max(...a.map((t) => exits.get(t)!)) - Math.max(...b.map((t) => exits.get(t)!)))
      let below = 0
      for (const g of worstFirst) {
        const to = size - below
        for (const t of g) rows.find((r) => r.team === t)!.place = [to - g.length + 1, to]
        below += g.length
      }
      for (const r of rows) if (r.state === 'won') r.place = [1, 1]
    }
    const rank = (r: PlaceRow) => (r.state === 'won' ? 0 : r.state === 'in' ? 1 : 2)
    rows.sort((x, y) => rank(x) - rank(y)
      || (x.state === 'in' ? (losses.get(x.team) ?? 0) - (losses.get(y.team) ?? 0) : (x.place?.[0] ?? 99) - (y.place?.[0] ?? 99)))
    tables.push({ key, t: { kind: 'bracket', unit: ui, phase, group, rows, done } })
  })

  return tables
    .sort((a, b) => b.key - a.key || a.t.group.localeCompare(b.t.group))
    .map((x) => x.t)
}
