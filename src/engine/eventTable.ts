import { circuitAward, eventOf, eventSoFar, isPlacementRound, onwardOf, phaseGroupsOf, rankPhase, tableOrderOf } from './circuit'
import type { CUnit, EventSoFar, Game, Slot } from './circuit'
import { circuitPointsFor } from './era'
import type { Competition, GameState } from './types'

/**
 * A real event's standings, read off its matches: this world's where it is played, history's — up to today —
 * where it is replayed.
 *
 * The standings page printed every fixture of an event, one row each, and a player looking for who was top of
 * the group found a match list instead (作者：「为什么积分榜里放的是所有队伍的比赛记录而不是积分」). What vlr.gg and
 * the broadcast show is what a player reads: a group, a Swiss stage or a regular season as a table — record,
 * maps, map difference, round difference — and a knockout bracket as placings, with each side's series and
 * maps: who is still in, who went out where, and the final order once it is over.
 *
 * Every table is there from the day the event is drawn: the sides known so far at 0-0, and each match counted
 * the day it is played — 作者：「虽然 kickoff 还没打完，但是已经打了的场次的输赢也应该在榜上体现」. And like 破晓's,
 * a phase's table shows its lines (「包括要达到哪个名次才能拿分或者进入季后赛也要有一根线标出来」): a line between
 * places that go to different phases, solid once nothing left to play can move it, dashed while it can, and drawn
 * only where the rows above it are exactly the sides that go.
 *
 * The event's own final order draws none (作者：「积分表上的线不画了，只列出积分，但是如果有其他队伍在其他渠道进入
 * 冠军赛了，那就标一下」). A line there promised what the draw does not keep: a later event seats the first finishers
 * that are not already in its field by another road (engine/circuit.ts seedsFor, `used`), so a club above the line
 * is skipped and the seat cascades past it — 2021 EMEA 挑战者赛 1 sent G2（第 5 名）to 挑战者决赛 because Guild
 * （第 3 名）was in it already. Every row is marked instead: the places it holds, the places it cannot have, and
 * where it is in that field already by another road.
 *
 * Nothing here decides anything. Who a table sends on is the draw's own reading of the slot that place fills
 * (engine/circuit.ts eventSoFar, PhaseSeats), and a table's order is the order the draw reads it in
 * (tableOrderOf), so the page cannot tell a different story from the draw.
 *
 * Pure: reads the state, writes nothing.
 */

export interface TableRow {
  team: string
  /** a side this world does not hold — an event replayed as history: its real name */
  name?: string
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

/** A rule under a table's row `after` (counted from 1): solid once nothing left to play can move it. */
export interface Line { after: number; solid: boolean }

/** A run of a group's places going to the same phase: 1st–3rd → 季后赛. */
export interface Band { from: number; to: number; dest: string }

export interface GroupTable {
  kind: 'table'
  unit: number
  /** 小组赛, 瑞士轮, 常规赛 */
  phase: string
  /** A组 — empty for a phase that is one table */
  group: string
  rows: TableRow[]
  /** every match of the phase is decided */
  done: boolean
  /** how many of the group's places go on — the event graph knows before a match is played */
  advance: number
  /** every phase its places go to, in the order of the first place that goes there */
  dests: string[]
  /** the group's places and where each run of them goes, as the draw reads the group */
  bands: Band[]
  /** the rows are places: a table's order as the draw reads it, or a bracket group's once its matches are over */
  ordered: boolean
  /** between places going to different phases, where the rows above are exactly the sides that go */
  lines: Line[]
  /** replayed as history */
  history: boolean
}

export interface PlaceRow {
  team: string
  name?: string
  /** in: still playing; out: knocked out; won: won the bracket */
  state: 'in' | 'out' | 'won'
  /** in: the round it plays next, '' where the draw has not said; out: the round it went out in */
  round: string
  /** its placing, joint places as a range — once it is out, or the event is over */
  place?: [number, number]
  /** its series won and lost in this bracket, and their maps and rounds */
  w: number
  l: number
  mapW: number
  mapL: number
  roundW: number
  roundL: number
  /**
   * against each of the table's `onward`: this side has those places, cannot have them, is in that field already
   * by another road — so it takes none of them — or it is still to play
   */
  marks: ('yes' | 'no' | 'open' | 'other')[]
}

/** Places an event gives beyond itself: a later event's seats, or its points. */
export interface OnwardSet {
  kind: 'event' | 'points'
  /** the later event's id */
  event?: string
  /** the event, or 积分 */
  name: string
  /** the places, from 1st */
  places: number[]
  /** the seats skip sides of other leagues: no line of places says who takes them */
  league?: string
  /** who the draw seated, once it is drawn */
  seated: string[] | null
  /**
   * the rest of that field: sides in it by another road. The draw skips a side it has already seated, so these
   * places pass them by. Null while the field is not drawn — until then no side is in it yet.
   */
  elsewhere: string[] | null
  /** points: what each place pays, from 1st */
  pays?: number[]
}

export interface PlaceTable {
  kind: 'bracket'
  unit: number
  phase: string
  group: string
  rows: PlaceRow[]
  done: boolean
  /** the losses that put a side out: 1 single, 2 double, 3 triple elimination */
  lives: number
  /** the places the event gives on, where this bracket is the event's final order */
  onward: OnwardSet[]
  history: boolean
}

export type EventTable = GroupTable | PlaceTable

/**
 * The phases the event graph names in English, in the words a Chinese broadcast uses. Every
 * English part the data carries is covered (listed off circuit.json 2026-09-14, after 「Weekly #4」
 * and 「前 8 名进Weekly #4」 showed on the standings page); a club's or circuit's own name
 * (ACE, ECLIPSE, Vikings, GameHome) stays as it is.
 */
const PHASE_CN: Record<string, string> = {
  'Swiss Stage': '瑞士轮', 'Swiss Phase': '瑞士轮', 'Upper Swiss Phase': '瑞士轮', 'Lower Swiss Phase': '下半区瑞士轮',
  'Group Stage': '小组赛', 'Groups Phase': '小组赛', 'Group Stage (Main)': '小组赛', 'Group Stage (Seeding)': '种子排位小组赛',
  'Play-In Stage': '附加赛', 'Play-Ins': '附加赛', 'Play-In': '附加赛',
  'Premier Play-Ins': '顶级组附加赛', 'Premier Play-ins': '顶级组附加赛', 'Promotion Play-ins': '晋级附加赛', 'Play-In Relegation': '附加赛降级战',
  Playoffs: '季后赛', 'Playoffs Phase': '季后赛', 'Zone Playoffs': '分区季后赛',
  'LATAM Playoffs': '拉美季后赛', 'LAS Playoffs': '拉美南区季后赛', 'LAN Playoffs': '拉美北区季后赛', 'LAN Finals': '拉美北区决赛',
  'Regular Season': '常规赛', 'Regular Phase': '常规赛', 'League Phase': '常规赛', 'League Stage': '常规赛', 'Regular League': '常规赛', 'League Play': '常规赛',
  'Promotion/Relegation': '升降级赛', 'Promotion/Relegation Series': '升降级赛', 'Promo/Rele': '升降级赛', 'Up and Down': '升降级赛',
  Relegation: '升降级赛', Relegations: '升降级赛', 'Promotion/Relegation - Last Chance': '升降级赛 · 最后机会',
  'Promotion Cup': '晋级杯', 'Promotion Match': '升级战', 'ECLIPSE (Pro/Rel)': 'ECLIPSE 升降级赛',
  'Round Robin': '循环赛', Knockout: '淘汰赛', Knockouts: '淘汰赛', Brackets: '淘汰赛', 'Bracket Stage': '淘汰赛', '(Elimination)': '（淘汰赛）',
  Final: '决赛', Finals: '决赛', 'Regional Finals': '赛区决赛', Regionals: '赛区赛',
  'Last Chance Qualifier': '最后机会资格赛', 'Last Chance': '最后机会资格赛', 'NORTH LCQ': '北区最后机会资格赛',
  Tiebreaker: '加赛', Decider: '加赛', Seeding: '种子排位赛', 'Preliminary Stage': '预选赛',
  'Second Chance': '复活赛', Repechage: '复活赛', Repescagem: '复活赛', 'Ranking Match': '排位赛', 'Last Battle': '最终决战',
  Online: '线上赛', Tournament: '正赛', Replacement: '补位赛', Preseason: '季前赛',
  Premier: '顶级组', 'Premier Qualification': '顶级组资格赛', 'First Division': '甲级联赛', 'Access Series': '晋级系列赛',
  'Mid-Season Face Off': '季中对决', 'Mid Season Cup': '季中杯', 'Advance Stage': '进阶赛',
  North: '北区', East: '东区', EAST: '东区', 'Levant and North Africa': '黎凡特与北非', 'GCC and Iraq': '海湾国家与伊拉克',
}

/** One part of a unit's label, in Chinese: a name from the table, else a numbered or compound phase read by its shape. */
function phaseCn(p: string): string {
  const s = p.trim()
  if (PHASE_CN[s]) return PHASE_CN[s]
  let m: RegExpMatchArray | null
  if ((m = s.match(/^Round of (\d+)$/))) return `${m[1]} 强赛`
  if ((m = s.match(/^Round (\d+)$/))) return `第 ${m[1]} 轮`
  if ((m = s.match(/^Playoffs Phase (\d+)$/))) return `季后赛第 ${m[1]} 阶段`
  if ((m = s.match(/^(?:Phase|Split) (\d+)$/))) return `第 ${m[1]} 阶段`
  if ((m = s.match(/^Stage (\d+) Tiebreaker$/))) return `第 ${m[1]} 赛段加赛`
  if ((m = s.match(/^Stage (\d+)$/))) return `第 ${m[1]} 赛段`
  if ((m = s.match(/^Weekly #(\d+)$/))) return `第 ${m[1]} 周周赛`
  if ((m = s.match(/^Week (\d+)$/))) return `第 ${m[1]} 周`
  if ((m = s.match(/^Top (\d+)$/))) return `${m[1]} 强`
  if ((m = s.match(/^Last Chance (\d+)$/))) return `最后机会资格赛 ${m[1]}`
  if ((m = s.match(/^Cup #(\d+) - (.+)$/))) return `第 ${m[1]} 杯 · ${phaseCn(m[2])}`
  if ((m = s.match(/^Série de Acesso - Fase (\d+)$/))) return `晋级系列赛第 ${m[1]} 阶段`
  if ((m = s.match(/^(.+?) Promotion\/Relegations?$/))) return `${phaseCn(m[1])} 升降级赛`
  if ((m = s.match(/^Advance Stage (?:- Group |\()([A-H])\)?$/))) return `进阶赛 · ${m[1]}组`
  return s
}

/** 「Group A」 and 「Group 2」 are groups, as 「A组」 already is. */
const groupCn = (p: string): string | null => {
  const s = p.trim()
  if (/组$/.test(s)) return s
  const m = s.match(/^Group ([A-H]|\d+)$/)
  return m ? `${m[1]}组` : null
}

/** A round the graph names in English: a Swiss round with its record, Kickoff's middle bracket, a bronze match. */
export function roundCn(round: string): string {
  return round
    .replace(/^Round (\d+) \((\d+-\d+)\)$/, '第 $1 轮（$2）')
    .replace(/^Middle Round (\d+)$/, '中段组第 $1 轮')
    .replace(/^Middle Final$/, '中段组决赛')
    .replace(/^(Bronze( Match| Final)?|Consolation)$/, '季军赛')
    .replace(/^Knockout Round$/, '首轮')
    .replace(/^Play-?[Ii]ns?$/, '附加赛')
    .replace(/^Tie ?[Bb]reaker$/, '加赛')
}

/** A unit's phase and group: 「小组赛 · A组」 is the A组 of 小组赛. */
export function labelOf(u: CUnit): { phase: string; group: string } {
  const parts = u.label.split(' · ')
  // a label that is only a group (「Group A」) is that group of the group stage
  if (parts.length === 1) {
    const lone = groupCn(parts[0])
    if (lone && !/组$/.test(parts[0])) return { phase: '小组赛', group: lone }
  }
  const group = parts.length > 1 ? groupCn(parts[parts.length - 1]) : null
  const phase = (group ? parts.slice(0, -1) : parts).map(phaseCn).join(' · ')
  return { phase, group: group ?? '' }
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
const emptyRow = (team: string, name?: string): TableRow =>
  ({ team, ...(name ? { name } : {}), w: 0, l: 0, d: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0 })

/** rank → the ties whose slots that place of a phase seats, in the phases after it */
type Fed = Map<number, { unit: number; at: number; side: 0 | 1 }[]>

/**
 * The tables of an event, the latest phase first; a phase whose groups the draw reads apart, one table a group.
 * An event not drawn yet has none.
 */
export function eventTables(state: GameState, comp: Competition): EventTable[] {
  const so = eventSoFar(state, comp)
  if (!so) return []
  const { ev, base } = so

  const seats = new Map<number, Fed>()
  ev.units.forEach((u, uj) => {
    ;(u.nodes ?? []).forEach((nd, i) => {
      ;[nd.a, nd.b].forEach((s, side) => {
        if (s[0] !== 'g' || s[2] == null || s[1] === uj) return
        const byRank: Fed = seats.get(s[1]) ?? new Map()
        byRank.set(s[2], [...(byRank.get(s[2]) ?? []), { unit: uj, at: base[uj] + i, side: side as 0 | 1 }])
        seats.set(s[1], byRank)
      })
    })
  })
  // later phases on top; a relegation series played after the final below everything
  const keyOf = (u: CUnit): number => (u.side ? -1 : ev.units.findIndex((x) => labelOf(x).phase === labelOf(u).phase))

  const tables: { t: EventTable; key: number }[] = []
  ev.units.forEach((u, ui) => {
    const nodes = u.nodes ?? []
    if (u.type === 'open' || !nodes.length) return
    // a phase is on the page once a side of it is known: at 0-0 before its first match
    if (!nodes.some((_, i) => so.sides(base[ui] + i).some((t) => !!t))) return
    const fed = seats.get(ui)
    const key = keyOf(u)
    // a knockout is matches that lead into one another; a round of pairings that lead nowhere
    // within the unit — one Swiss round of FGC 2023's qualifier — is read as a table
    const linked = nodes.some((nd) => [nd.a, nd.b].some((s) => s[0] === 'w' || s[0] === 'l'))
    if (u.type === 'rr' || fed?.size || (!linked && nodes.length > 1)) {
      for (const t of groupTables(so, ui, fed)) tables.push({ key, t })
    } else {
      tables.push({ key, t: placeTable(comp, so, ui) })
    }
  })

  // the places the event gives on belong to its final order: its last phase, where that is one bracket
  const last = Math.max(-1, ...tables.map((x) => x.key))
  const finals = tables.filter((x) => x.key === last)
  if (last >= 0 && finals.length === 1 && finals[0].t.kind === 'bracket') markOnward(state, comp, finals[0].t)

  return tables
    .sort((a, b) => b.key - a.key || a.t.group.localeCompare(b.t.group) || a.t.unit - b.t.unit)
    .map((x) => x.t)
}

/** A round robin, a Swiss stage, a league's groups, a bracket group that seats a later phase: a table a group. */
function groupTables(so: EventSoFar, ui: number, fed: Fed | undefined): GroupTable[] {
  const { ev, base } = so
  const u = ev.units[ui]
  const nodes = u.nodes ?? []
  const at = (i: number) => base[ui] + i
  const { phase, group } = labelOf(u)
  const done = nodes.every((_, i) => so.games.has(at(i)))
  const all = nodes.map((_, i) => i)
  const split = phaseGroupsOf(ev, ui)
  const parts: { name: string; nodes?: number[]; entries?: Slot[] }[] = split.length ? split : [{ name: group, nodes: all }]
  const ranks = [...(fed?.keys() ?? [])].sort((a, b) => a - b)
  const dest = (rank: number): string => labelOf(ev.units[fed!.get(rank)![0].unit]).phase
  // a table seats its own top places; a bracket group, the order its results leave (PhaseSeats)
  const reading: 'table' | 'bracket' = u.seats ? u.seats.kind : u.type === 'rr' ? 'table' : 'bracket'

  return parts.map((part, gi): GroupTable => {
    let idx = part.nodes ?? all
    let teams: string[]
    if (part.entries) {
      // two groups that play each other: a group is its sides, and every match they play
      teams = uniq(part.entries.map((s) => so.slot(ui, s)).filter((t): t is string => !!t))
      const mine = new Set(teams)
      idx = all.filter((i) => so.sides(at(i)).some((t) => !!t && mine.has(t)))
    } else {
      teams = uniq(idx.flatMap((i) => so.sides(at(i))).filter((t): t is string => !!t))
    }

    const rows = new Map(teams.map((t) => [t, emptyRow(t, so.names.get(t))]))
    const played: Game[] = []
    for (const i of idx) {
      const g = so.games.get(at(i))
      if (!g) continue
      played.push(g)
      if (!g.a || !g.b || so.walks.has(at(i))) continue
      const [ra, rb] = [rows.get(g.a), rows.get(g.b)]
      if (g.w === g.a) { if (ra) ra.w++; if (rb) rb.l++ } else if (g.w === g.b) { if (rb) rb.w++; if (ra) ra.l++ } else { if (ra) ra.d++; if (rb) rb.d++ }
      if (ra) { ra.mapW += g.mapsA; ra.mapL += g.mapsB; ra.roundW += g.roundsA; ra.roundL += g.roundsB }
      if (rb) { rb.mapW += g.mapsB; rb.mapL += g.mapsA; rb.roundW += g.roundsB; rb.roundL += g.roundsA }
    }
    const settled = idx.every((i) => so.games.has(at(i)))

    let order: string[]
    if (reading === 'table') {
      order = tableOrderOf(u, played, teams).filter((t) => rows.has(t))
    } else if (settled) {
      const ranked = rankPhase('bracket', played, u.upperFirst).ranked.filter((t) => rows.has(t))
      order = [...ranked, ...teams.filter((t) => !ranked.includes(t))]
    } else {
      // a bracket group still being played has no places yet: by its record
      order = [...rows.values()].sort((x, y) => y.w - x.w || x.l - y.l
        || (y.mapW - y.mapL) - (x.mapW - x.mapL) || (y.roundW - y.roundL) - (x.roundW - x.roundL)).map((r) => r.team)
    }

    // the rank numbers this group's places answer to: its own, where the draw reads groups apart
    const mine = ranks.filter((r) => !u.seats || u.seats.at[r]?.[0] === gi)
    // who the draw has seated off them so far; the phase complete, a side not seated went no further
    for (const r of mine) {
      const t = so.slot(fed!.get(r)![0].unit, ['g', ui, r])
      if (t && rows.has(t)) rows.get(t)!.next = dest(r)
    }
    if (done) for (const r of rows.values()) if (r.next === undefined) r.next = null

    const placeDest = new Map<number, string>()
    for (const r of mine) {
      const p = u.seats ? u.seats.at[r]?.[1] : r
      if (p != null && !placeDest.has(p)) placeDest.set(p, dest(r))
    }
    const bands: Band[] = []
    for (const p of [...placeDest.keys()].sort((a, b) => a - b)) {
      const b = bands[bands.length - 1]
      if (b && b.to === p - 1 && b.dest === placeDest.get(p)) b.to = p
      else bands.push({ from: p, to: p, dest: placeDest.get(p)! })
    }

    const ordered = reading === 'table' || settled
    const destAt = (p: number): string | null => placeDest.get(p) ?? null
    // the rows above a line are the sides the draw sends there, wherever the draw has already said
    const agrees = order.every((t, i) => { const n = rows.get(t)!.next; return n === undefined || n === destAt(i + 1) })
    const lines: Line[] = []
    if (ordered && placeDest.size && agrees) {
      for (let i = 1; i < order.length; i++) if (destAt(i) !== destAt(i + 1)) lines.push({ after: i, solid: settled })
    }

    return {
      kind: 'table', unit: ui, phase, group: part.name, done,
      rows: order.map((t) => rows.get(t)!),
      advance: placeDest.size, dests: uniq(bands.map((b) => b.dest)), bands, ordered, lines, history: so.history,
    }
  })
}

/** A side's final placing, joint places as a range: the event's own — history's, where it was replayed. */
function finalPlace(comp: Competition, so: EventSoFar, team: string): [number, number] | undefined {
  if (so.history) {
    const vlr = so.real.get(team)
    const hit = so.ev.places.find(([v]) => v === vlr)
    return hit ? [hit[1], hit[1] + so.ev.places.filter(([, p]) => p === hit[1]).length - 1] : undefined
  }
  const k = comp.finished.indexOf(team)
  if (k < 0) return undefined
  const p = comp.places?.[k] ?? k + 1
  return [p, p + (comp.places ? comp.places.filter((x) => x === p).length : 1) - 1]
}

/** Where a side stands in the event's final order, from 0; -1 where it has none. */
function finalIndex(comp: Competition, so: EventSoFar, team: string): number {
  return so.history ? so.ev.places.findIndex(([v]) => v === so.real.get(team)) : comp.finished.indexOf(team)
}

/** A knockout bracket: who is still in and what they play next, who went out where — and each side's series. */
function placeTable(comp: Competition, so: EventSoFar, ui: number): PlaceTable {
  const { ev, base } = so
  const u = ev.units[ui]
  const nodes = u.nodes ?? []
  const at = (i: number) => base[ui] + i
  const { phase, group } = labelOf(u)
  const done = nodes.every((_, i) => so.games.has(at(i)))
  const over = !!comp.champion && comp.finished.length > 0
  // follow each side along the graph's winner and loser slots
  const next = (kind: 'w' | 'l', i: number): number | undefined => {
    const j = nodes.findIndex((nd) => (nd.a[0] === kind && nd.a[1] === i) || (nd.b[0] === kind && nd.b[1] === i))
    return j < 0 ? undefined : j
  }
  const sides = uniq(nodes.flatMap((_, i) => so.sides(at(i))).filter((t): t is string => !!t))
  const rows: PlaceRow[] = []
  const exits = new Map<string, number>()
  for (const t of sides) {
    const row: PlaceRow = {
      team: t, ...(so.names.has(t) ? { name: so.names.get(t) } : {}), state: 'in', round: '',
      w: 0, l: 0, mapW: 0, mapL: 0, roundW: 0, roundL: 0, marks: [],
    }
    let end: { i: number; won: boolean } | undefined
    let upNext: number | undefined
    let playing: number | undefined
    let waiting: number | undefined
    nodes.forEach((_, i) => {
      const g = so.games.get(at(i))
      if (g && (g.a === t || g.b === t)) {
        const won = g.w === t
        if (g.a && g.b && !so.walks.has(at(i))) {
          const a = g.a === t
          if (won) row.w++
          else if (g.w) row.l++
          row.mapW += a ? g.mapsA : g.mapsB
          row.mapL += a ? g.mapsB : g.mapsA
          row.roundW += a ? g.roundsA : g.roundsB
          row.roundL += a ? g.roundsB : g.roundsA
        }
        const j = next(won ? 'w' : 'l', i)
        if (j == null) end = { i, won }
        else if (!so.games.has(at(j))) upNext = j
      } else if (so.pending.get(at(i))?.includes(t)) {
        playing = i
      } else if (!g && waiting == null && so.sides(at(i)).includes(t)) {
        waiting = i
      }
    })
    // a match still to play is the truth of it, whatever the graph says a side's last result led to
    if (playing != null) {
      row.round = nodes[playing].round
    } else if (end && end.won && !isPlacementRound(nodes[end.i].round)) {
      row.state = 'won'
      row.round = nodes[end.i].round
    } else if (end) {
      row.state = 'out'
      row.round = nodes[end.i].round
      exits.set(t, end.i * 2 + (end.won ? 1 : 0))
    } else {
      row.round = upNext != null ? nodes[upNext].round : waiting != null ? nodes[waiting].round : ''
    }
    rows.push(row)
  }

  if (over) {
    // the event is over: its own placings, joint places as ranges
    for (const r of rows) {
      const p = finalPlace(comp, so, r.team)
      if (p) r.place = p
    }
    const pos = (r: PlaceRow) => { const k = finalIndex(comp, so, r.team); return k < 0 ? Infinity : k }
    rows.sort((x, y) => pos(x) - pos(y))
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
    const rank = (r: PlaceRow) => (r.state === 'won' ? 0 : r.state === 'in' ? 1 : 2)
    rows.sort((x, y) => rank(x) - rank(y) || (x.state === 'in' ? x.l - y.l : (x.place?.[0] ?? 99) - (y.place?.[0] ?? 99)))
  }

  const lives = nodes.some((n) => /^Middle |中段组/.test(n.round)) ? 3 : nodes.some((n) => /败者组|^Lower /.test(n.round)) ? 2 : 1
  return { kind: 'bracket', unit: ui, phase, group, rows, done, lives, onward: [], history: so.history }
}

/**
 * The places an event gives beyond itself: each later event's seats off its order (engine/circuit.ts onwardOf),
 * and the places its points go to — its own prize table, Riot's 2021 chart for the open era — unless every side
 * is paid.
 */
export function onwardSets(state: GameState, comp: Competition): OnwardSet[] {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  const out: OnwardSet[] = onwardOf(state, comp)
    .map((o) => ({ kind: 'event', event: o.event, name: o.name, places: o.places, league: o.league, seated: o.seated, elsewhere: o.elsewhere }))
  const size = Math.max(comp.teams.length, ev?.seeds.length ?? 0, ev?.places.length ?? 0)
  const pays: number[] = []
  for (let p = 1; p <= size; p++) pays.push(circuitAward(comp, p) ?? (state.year <= 2022 ? circuitPointsFor(comp.stage, p) : 0))
  const places = pays.flatMap((v, i) => (v > 0 ? [i + 1] : []))
  if (places.length && !(places[0] === 1 && places.length >= size)) out.push({ kind: 'points', name: '积分', places, seated: null, elsewhere: null, pays })
  return out
}

/**
 * The event's final bracket, marked against the places it gives on. Each row: the places are its, cannot be,
 * are still to play for — while it is still in, it finishes no lower than the number of sides still in — or are
 * places it takes none of, because it is in that field already by another road.
 *
 * No line is drawn under any of it (作者：「积分表上的线不画了，只列出积分」). Where a run of places ends was never
 * the same thing as which sides go: the draw fills each seat with the next finisher it has not seated already,
 * so a side in the field by another road is skipped and the seat cascades past it. The mark is the rule itself,
 * row by row, and it says so only once it is true — the field drawn, the side really in it.
 */
function markOnward(state: GameState, comp: Competition, t: PlaceTable): void {
  const sets = onwardSets(state, comp)
  if (!sets.length) return
  t.onward = sets
  const over = !!comp.champion && comp.finished.length > 0
  const alive = t.rows.filter((r) => r.state !== 'out').length
  t.rows.forEach((r, i) => {
    r.marks = sets.map((s) => {
      if (s.elsewhere?.includes(r.team)) return 'other'
      if (s.seated) return s.seated.includes(r.team) ? 'yes' : 'no'
      if (s.league) return 'open'
      const [lo, hi] = [s.places[0], s.places[s.places.length - 1]]
      // the event over, a side's own placing — joint places and all, as the prize table reads it
      const range = over ? (r.place ?? [i + 1, i + 1]) : r.state === 'in' ? [1, alive] : r.place
      if (!range) return 'open'
      return range[0] >= lo && range[1] <= hi ? 'yes' : range[1] < lo || range[0] > hi ? 'no' : 'open'
    })
  })
}
