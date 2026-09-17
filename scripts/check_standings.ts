/**
 * Does the standings page tell the story the draw tells?
 *
 * The page printed an event as every fixture, one row each, and had no points
 * table at all (作者：「为什么积分榜里放的是所有队伍的比赛记录而不是积分，这个部分也学学
 * lol breaker」). Now it prints each event's tables and each year's points table,
 * with 破晓's lines (「积分榜里面也要有赛程小分」「包括要达到哪个名次才能拿分或者进入
 * 季后赛也要有一根线标出来」), and a table that disagrees with the draw is worse than
 * none. So:
 *
 *  - points: every year that gave places off a points table — 2021 and 2022's
 *    circuit points, 2024–2026's Championship Points — shows one, runs by points,
 *    and every side's points are what this year's events paid it. Whenever the
 *    page marks the places as settled, the Champions or Last Chance Qualifier
 *    draw that follows gives exactly those places to exactly those sides; once
 *    it is drawn, the page marks the draw. 2023 and 2027 on gave no place off
 *    points and show no table.
 *  - events: a played event's tables are its matches — a side's record, maps and
 *    rounds the sum of its matches in that phase, in whichever group's table it
 *    sits, and a knockout side's series, maps and rounds the same; a finished
 *    phase sends on the sides the next phase seated, and its lines sit exactly
 *    where the sides the next phases seated change — while it is still played,
 *    only between the bands the draw reads; a side out of a bracket lost a match
 *    there; an event over carries its own placings.
 *  - onward: a final bracket's points line is under the last place its prize
 *    table pays, a later event takes as many places as the route book gives it,
 *    and once that event is drawn a side marked as having one is a side it seated.
 *  - history: an event replayed as history shows, while it is on, exactly the real
 *    results whose day has passed, and none after.
 *  - render: the points panel as React renders it lists the table's rows, in its
 *    order, with its marks; an event's panel draws each line under its row.
 *  - a Masters' winner: on a 2021 EMEA table built by hand, before Masters Berlin
 *    is over history's winner (Gambit) is not through — it takes a points place,
 *    and the Last Chance Qualifier's places start right below the Champions
 *    places, with the week's reading of that qualifier (drawStanding) seating
 *    the same sides; once this world has played Berlin, its own winner is
 *    through and the places pass it by. Before Berlin the qualifier had counted
 *    Gambit through and the table had not, and the side third on points was
 *    marked by neither (reported 2026-09-17).
 *
 * Two careers: a Challengers starter in Europe from 2021 into 2027, and a VCT
 * club in EMEA from the 2026 entrance, whose league events are played.
 *
 *   npx tsx scripts/check_standings.ts [seed=11]
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import routesRaw from '../src/data/routes.json'
import partneredRaw from '../src/data/routes_partnered.json'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { circuitAward, circuitPaid, drawStanding, eventOf, eventSoFar, eventsOf, pointsTables, worldIdOf } from '../src/engine/circuit'
import type { CEvent, PointsTable } from '../src/engine/circuit'
import { circuitPointsFor } from '../src/engine/era'
import { eventTables, labelOf } from '../src/engine/eventTable'
import type { EventTable, GroupTable, PlaceTable, TableRow } from '../src/engine/eventTable'
import { qualifyHolds, qualifyStats } from './qualify_holds'
import { GameCtx } from '../src/ui/me/ctx'
import CircuitPanel from '../src/ui/me/CircuitPanel'
import { PointsPanel } from '../src/ui/me/Standings'
import type { Competition, Fixture, GameState, Region } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const seed = Number(process.argv[2] ?? 11)
let bad = 0
const said = new Set<string>()
// the same table is looked at every week: each fault once
const fail = (msg: string) => { if (said.has(msg)) return; said.add(msg); bad++; console.log(`✗ ${msg}`) }

/** The years that gave Champions or Last Chance Qualifier places off a points table. */
const POINTS_YEARS = new Set([2021, 2022, 2024, 2025, 2026])

type Route = { kind: string; pool?: string; event?: string }
type Rules = { routes?: Record<string, Route>; award?: unknown; wins?: unknown; groupWin?: unknown; bye?: unknown }
const BOOK = {
  ...(routesRaw as unknown as { events: Record<string, Rules> }).events,
  ...(partneredRaw as unknown as { events: Record<string, Rules> }).events,
}
/** An event's routes as the route book has them; a projected event plays by the event it is drawn from. */
const routesOf = (ev: CEvent): Record<string, Route> =>
  (ev.plan ? undefined : (BOOK[ev.id] ?? BOOK[ev.projected?.base ?? '']))?.routes ?? {}

/** The draws that read a points table: the year's Champions, and its Last Chance Qualifiers. */
const targets = (year: number): CEvent[] => eventsOf(year).filter((e) => !e.plan
  && (/Valorant Champions 20/i.test(e.name) || e.stage === 'lcq')
  && Object.values(routesOf(e)).some((r) => r.kind === 'points'))

/** Who the draw seated in each pool's points places. */
function seatsByPool(state: GameState, ev: CEvent): Map<string, string[]> {
  const c = state.comps[`ev:${ev.id}`]?.circuit
  const book = routesOf(ev)
  const out = new Map<string, string[]>()
  ev.seeds.forEach((v, i) => {
    const r = book[v]
    if (r?.kind !== 'points' || !r.pool) return
    const t = c?.seeds[i]
    out.set(r.pool, [...(out.get(r.pool) ?? []), ...(t ? [t] : [])])
  })
  return out
}

const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x))
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)]
const names = (state: GameState, ids: Iterable<string>) => [...ids].map((t) => state.teams[t]?.name ?? t).join('、') || '（无）'
const renderCtx = (state: GameState) => ({
  game: state, commit: () => {}, toast: () => {}, openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
})

interface Snap { year: number; day: number; tables: PointsTable[]; drawn: Set<string> }
const stats = {
  weeks: 0, tables: 0, rows: 0, settled: 0, standing: 0, standingOff: 0, drawn: 0, renders: 0, events: 0, eventTables: 0,
  lines: 0, linesAtSeats: 0, knockoutRows: 0, pointsLines: 0, onward: 0, historyEvents: 0, historyRows: 0, panelRenders: 0,
}
/** a history event once it is over: looked at once */
const historyOver = new Set<string>()

function snap(state: GameState): Snap {
  return {
    year: state.year,
    day: state.day,
    tables: pointsTables(state),
    drawn: new Set(targets(state.year).filter((e) => state.comps[`ev:${e.id}`]?.circuit?.mode).map((e) => e.id)),
  }
}

/** A year's points tables hold together: there when the year had places off points, in points order, no more marks than places. */
function tablesHold(state: GameState, s: Snap, label: string): void {
  const want = POINTS_YEARS.has(state.year)
  if (want && !s.tables.length) fail(`${label}：${state.year} 年第 ${state.day} 天应该有积分榜，页面上没有`)
  if (!want && s.tables.length) fail(`${label}：${state.year} 年没有靠积分给的名额，页面上却有 ${s.tables.length} 张积分榜`)
  for (const t of s.tables) {
    stats.tables++
    stats.rows += t.rows.length
    const drop = t.rows.findIndex((r, i) => i > 0 && r.points > t.rows[i - 1].points)
    if (drop > 0) fail(`${label}：${state.year} ${t.pool} 积分榜第 ${drop + 1} 名 ${state.teams[t.rows[drop].team]?.name}（${t.rows[drop].points}）排在 ${t.rows[drop - 1].points} 分的队后面`)
    const direct = t.rows.filter((r) => r.mark === 'direct').length
    const lcq = t.rows.filter((r) => r.mark === 'lcq').length
    if (direct > t.direct) fail(`${label}：${state.year} ${t.pool} 标了 ${direct} 个冠军赛名额，只有 ${t.direct} 个`)
    if (lcq > t.lcq) fail(`${label}：${state.year} ${t.pool} 标了 ${lcq} 个资格赛名额，只有 ${t.lcq} 个`)
  }
}

/** A draw made this week: the page's marks of the week before, and of today, against the seats it gave. */
function drawsSince(before: Snap, state: GameState, label: string): void {
  if (before.year !== state.year) return
  const now = pointsTables(state)
  for (const ev of targets(state.year)) {
    if (!state.comps[`ev:${ev.id}`]?.circuit?.mode || before.drawn.has(ev.id)) continue
    const champs = ev.stage === 'champions'
    const mark = champs ? 'direct' : 'lcq'
    for (const [pool, list] of seatsByPool(state, ev)) {
      const got = new Set(list)
      const was = before.tables.find((t) => t.pool === pool)
      const basis = was ? (champs ? was.basis : was.lcqBasis) : null
      const marked = new Set((was?.rows ?? []).filter((r) => r.mark === mark).map((r) => r.team))
      if (basis === 'settled') {
        stats.settled++
        if (!same(got, marked)) {
          fail(`${label}：${state.year} ${ev.name} ${pool}：第 ${before.day} 天页面标「积分已定」给 ${names(state, marked)}，抽签给了 ${names(state, got)}`)
        }
      } else if (basis === 'standing') {
        stats.standing++
        if (!same(got, marked)) {
          stats.standingOff++
          console.log(`  · ${state.year} ${ev.name} ${pool}：第 ${before.day} 天「按目前积分」标 ${names(state, marked)}，一周后抽签给了 ${names(state, got)}`)
        }
      }
      const t = now.find((x) => x.pool === pool)
      const nowBasis = t ? (champs ? t.basis : t.lcqBasis) : null
      stats.drawn++
      if (nowBasis !== 'drawn') { fail(`${label}：${state.year} ${ev.name} 已经抽签，${pool} 积分榜标的却是 ${nowBasis}`); continue }
      const missing = [...got].filter((x) => !t!.rows.some((r) => r.team === x))
      const nowMarked = new Set(t!.rows.filter((r) => r.mark === mark).map((r) => r.team))
      if (missing.length) fail(`${label}：${state.year} ${ev.name} 把 ${pool} 的积分名额给了 ${names(state, missing)}，积分榜上没有他们`)
      else if (!same(got, nowMarked)) fail(`${label}：${state.year} ${ev.name} ${pool}：抽签给了 ${names(state, got)}，页面标的是 ${names(state, nowMarked)}`)
    }
  }
}

/** Every side's points are what this year's events paid it. */
function pointsPaid(state: GameState, tables: PointsTable[], label: string): void {
  const paid = new Map<string, number>()
  for (const c of Object.values(state.comps)) {
    if (c.format !== 'circuit' || !c.awarded) continue
    for (const [t, v] of circuitPaid(state, c)) paid.set(t, (paid.get(t) ?? 0) + v)
  }
  const off: string[] = []
  for (const t of tables) for (const r of t.rows) {
    if ((paid.get(r.team) ?? 0) !== r.points) off.push(`${state.teams[r.team]?.name} 积分 ${r.points}，赛事付的 ${paid.get(r.team) ?? 0}`)
  }
  if (off.length) fail(`${label}：${state.year} 年第 ${state.day} 天有 ${off.length} 队的积分和赛事付的对不上：${off.slice(0, 3).join('；')}`)
}

/** The points panel as rendered: the table's rows in its order, with its marks; the club's own row may follow a gap. */
function renderHolds(state: GameState, tables: PointsTable[], label: string): void {
  for (const t of tables) {
    stats.renders++
    const html = renderToStaticMarkup(createElement(GameCtx.Provider, { value: renderCtx(state) }, createElement(PointsPanel, { table: t })))
    const got = [...html.matchAll(/data-team="([^"]*)" data-mark="([^"]*)"/g)].map((m) => ({ team: m[1], mark: m[2] }))
    if (!got.length && t.rows.length) { fail(`${label}：${state.year} ${t.pool} 积分榜渲染出来一行都没有`); continue }
    const lastIsMine = got.length > 1 && got[got.length - 1].team === state.myTeam && t.rows.findIndex((r) => r.team === state.myTeam) !== got.length - 1
    for (let i = 0; i < got.length; i++) {
      const k = lastIsMine && i === got.length - 1 ? t.rows.findIndex((r) => r.team === got[i].team) : i
      const r = t.rows[k]
      if (!r || r.team !== got[i].team || (r.mark ?? '') !== got[i].mark) {
        fail(`${label}：${state.year} ${t.pool} 积分榜渲染第 ${i + 1} 行是 ${state.teams[got[i].team]?.name}（${got[i].mark || '无标记'}），表里第 ${k + 1} 名是 ${r ? `${state.teams[r.team]?.name}（${r.mark ?? '无标记'}）` : '（没有）'}`)
        break
      }
    }
    if (t.rows.some((r) => r.mark) && !got.some((g) => g.mark)) fail(`${label}：${state.year} ${t.pool} 积分榜有名额标记，渲染出来没有`)
  }
}

/** Each side's series, level series, maps and rounds in these fixtures: [w, l, d, mapW, mapL, roundW, roundL]. */
function sumFixtures(fx: Fixture[]): Map<string, number[]> {
  const sum = new Map<string, number[]>()
  const add = (team: string, row: number[]) => sum.set(team, (sum.get(team) ?? [0, 0, 0, 0, 0, 0, 0]).map((x, i) => x + row[i]))
  for (const f of fx) {
    if (!f.played || !f.result) continue
    const { mapsWonA: a, mapsWonB: b, maps } = f.result
    const [ra, rb] = maps.reduce((s, m) => [s[0] + m.scoreA, s[1] + m.scoreB], [0, 0])
    add(f.teamA, [Number(a > b), Number(a < b), Number(a === b), a, b, ra, rb])
    add(f.teamB, [Number(b > a), Number(b < a), Number(a === b), b, a, rb, ra])
  }
  return sum
}

/** The event's final bracket against the places it gives on: the points line, the route book's count, the draw's seats. */
function onwardHolds(state: GameState, comp: Competition, ev: CEvent, t: PlaceTable, where: string): void {
  const over = !!comp.champion && comp.finished.length > 0
  t.onward.forEach((s, k) => {
    const hi = s.places[s.places.length - 1]
    if (s.kind === 'points') {
      stats.pointsLines++
      const size = Math.max(comp.teams.length, ev.seeds.length, ev.places.length)
      let last = 0
      for (let p = 1; p <= size; p++) if ((circuitAward(comp, p) ?? (state.year <= 2022 ? circuitPointsFor(comp.stage, p) : 0)) > 0) last = p
      if (hi !== last) fail(`${where}：积分标到第 ${hi} 名，奖励表最后一个给分的名次是第 ${last} 名`)
      if (over && hi < t.rows.length && !t.lines.some((l) => l.after === hi)) fail(`${where}：赛事结束，第 ${hi} 名下面没有积分线`)
      return
    }
    stats.onward++
    const target = s.event ? eventOf(s.event) : undefined
    if (target && !target.plan && !target.projected) {
      const want = Object.values(BOOK[target.id]?.routes ?? {}).filter((r) => (r.kind === 'top' || r.kind === 'winner') && r.event === ev.id).length
      if (want !== s.places.length) fail(`${where}：${s.name} 从这里拿 ${want} 个名额，表上写的是 ${s.places.length} 个`)
    }
    if (s.seated) {
      for (const r of t.rows) {
        if ((r.marks[k] === 'yes') !== s.seated.includes(r.team)) fail(`${where}：${state.teams[r.team]?.name ?? r.name} 的「${s.name}」名额标记和抽签不一致`)
      }
    }
    // The N above the line are not always the N this event seats. A club above it may already hold
    // a place in that field by another road, and the draw skips a club it has already seated
    // (engine/circuit.ts seedsFor: c.finished.find((t) => !used.has(t) && inLeague(t))), so the
    // seat cascades to the next finisher. 2021 EMEA 挑战者赛 1: Guild finished 3rd and was already
    // in 挑战者决赛 by another seed, so the seat it would have taken went to G2, the 5th. Compare
    // against that rule, not against a raw prefix of the table — a prefix only ever agreed because
    // no side above a line had yet qualified twice, which is fixture luck and not a rule.
    //
    // Keyed on the outcome rather than on a second copy of the engine's route order (winner /
    // points / top before 2023, winner / top / rest / points after): whichever order the seats are
    // filled in, a club taken by an earlier road ends up holding one of that field's other seeds.
    // Read off the drawn field, this cannot drift the way a copy of the order table would.
    if (over && s.seated && !s.league && t.lines.some((l) => l.after === hi)) {
      const seated = s.seated
      const field = (s.event ? state.comps[`ev:${s.event}`]?.circuit?.seeds : undefined) ?? []
      const elsewhere = new Set(field.filter((x): x is string => !!x && !seated.includes(x)))
      const want = new Set(t.rows.map((r) => r.team).filter((x) => !elsewhere.has(x)).slice(s.places[0] - 1, hi))
      if (!same(want, new Set(seated))) fail(`${where}：${s.name} 该坐的是 ${names(state, want)}（线以上、还没从别的路进去的），抽签给了 ${names(state, seated)}`)
    }
  })
}

/** An event's panel as rendered draws each of its tables' lines under the row it belongs under. */
function panelHolds(state: GameState, comp: Competition, tables: EventTable[], label: string): void {
  if (!tables.some((t) => t.lines.length)) return
  stats.panelRenders++
  const html = renderToStaticMarkup(createElement(GameCtx.Provider, { value: renderCtx(state) }, createElement(CircuitPanel, { comp })))
  const got = [...html.matchAll(/<tr class="([^"]*)" data-team="([^"]*)"/g)].map((m) => `${m[2]}${/cut-solid/.test(m[1]) ? '=' : /cut-dash/.test(m[1]) ? '-' : ''}`)
  const want = tables.flatMap((t) => t.rows.map((r, i) => {
    const l = t.lines.find((x) => x.after === i + 1)
    return `${r.team}${l ? (l.solid ? '=' : '-') : ''}`
  }))
  if (got.join('|') !== want.join('|')) fail(`${label}：${state.year} ${comp.name} 渲染出来的线和表里的线不一致`)
}

/** An event replayed as history: the real results whose day has passed, exactly, and none after. */
function historyHolds(state: GameState, comp: Competition, ev: CEvent, tables: EventTable[], label: string): void {
  const so = eventSoFar(state, comp)
  if (!so) return
  stats.historyEvents++
  const today = comp.champion ? Infinity : state.day
  const days = ev.units.flatMap((u) => (u.nodes ?? []).map((n) => n.day))
  const where = `${label}：${state.year} ${comp.name}（照真实历史）`
  const early = [...so.games.keys()].filter((at) => days[at] >= today)
  if (early.length) fail(`${where}：表里算进了 ${early.length} 场还没到日子的比赛`)
  for (const ui of uniq(tables.map((t) => t.unit))) {
    const u = ev.units[ui]
    // each real side's record so far: [w, l, d, mapW, mapL]
    const real = new Map<string, number[]>()
    const add = (v: string, row: number[]) => real.set(v, (real.get(v) ?? [0, 0, 0, 0, 0]).map((x, i) => x + row[i]))
    for (const n of u.nodes ?? []) {
      if (n.day >= today || !n.teams[0] || !n.teams[1]) continue
      const [sa, sb] = [n.score[0] ?? 0, n.score[1] ?? 0]
      const one = Math.max(sa, sb) >= 13
      const [ma, mb] = one ? [Number(n.winner === n.teams[0]), Number(n.winner === n.teams[1])] : [sa, sb]
      const [aw, bw] = [n.winner === n.teams[0], n.winner === n.teams[1]]
      add(n.teams[0], [Number(aw), Number(bw), Number(!n.winner), ma, mb])
      add(n.teams[1], [Number(bw), Number(aw), Number(!n.winner), mb, ma])
    }
    for (const t of tables.filter((x) => x.unit === ui)) {
      for (const r of t.rows as (TableRow | PlaceTable['rows'][number])[]) {
        stats.historyRows++
        const want = real.get(so.real.get(r.team) ?? '') ?? [0, 0, 0, 0, 0]
        const got = 'd' in r ? [r.w, r.l, r.d, r.mapW, r.mapL] : [r.w, r.l, want[2], r.mapW, r.mapL]
        if (got.join() !== want.join()) {
          fail(`${where} ${labelOf(u).phase}${t.group ? ` ${t.group}` : ''}：${state.teams[r.team]?.name ?? r.name} 表里是 ${got.join('/')}，真实比赛到今天是 ${want.join('/')}`)
        }
      }
    }
  }
}

/** A played event's tables are its matches, and its lines sit where the draw seats sides. */
function eventsHold(state: GameState, label: string): void {
  for (const comp of Object.values(state.comps)) {
    if (comp.format !== 'circuit' || !comp.circuit?.mode) continue
    const ev = eventOf(comp.circuit.id)
    if (!ev) continue
    if (comp.circuit.mode === 'history') {
      if (historyOver.has(comp.key)) continue
      if (comp.champion) historyOver.add(comp.key)
      const tables = eventTables(state, comp)
      if (tables.length) stats.events++
      stats.eventTables += tables.length
      historyHolds(state, comp, ev, tables, label)
      panelHolds(state, comp, tables, label)
      continue
    }
    const base: number[] = []
    let n = 0
    for (const u of ev.units) { base.push(n); n += u.nodes?.length ?? 0 }
    const fx = state.fixtures.filter((f) => f.comp === comp.key && f.node != null && f.node >= 0)
    const byNode = new Map(fx.map((f) => [f.node!, f]))
    const tables = eventTables(state, comp)
    if (tables.length) stats.events++
    stats.eventTables += tables.length
    for (const ui of uniq(tables.map((t) => t.unit))) {
      const u = ev.units[ui]
      const mine = tables.filter((t) => t.unit === ui)
      const lo = base[ui]
      const hi = lo + (u.nodes?.length ?? 0)
      const sums = sumFixtures(fx.filter((f) => f.node! >= lo && f.node! < hi))
      const where = `${label}：${state.year} ${comp.name} ${mine[0].phase}`
      if (mine[0].kind === 'table') {
        const groups = mine as GroupTable[]
        // record, maps and rounds: the sum of the phase's matches, in whichever group's table the side sits
        const rowOf = new Map<string, TableRow>()
        for (const t of groups) for (const r of t.rows) {
          if (rowOf.has(r.team)) fail(`${where}：${state.teams[r.team]?.name} 在两张表里`)
          rowOf.set(r.team, r)
        }
        for (const [team, s] of sums) {
          const r = rowOf.get(team)
          const have = r ? [r.w, r.l, r.d, r.mapW, r.mapL, r.roundW, r.roundL] : null
          if (!have) fail(`${where}：${state.teams[team]?.name} 打了这个阶段的比赛，表里没有`)
          else if (have.join() !== s.join()) fail(`${where}：${state.teams[team]?.name} 表里是 ${have.join('/')}，比赛加起来是 ${s.join('/')}`)
        }
        // the next phases' seats, as their ties have them: rank → the side, and where it went
        const seatOf = new Map<number, string | undefined>()
        const destOf = new Map<string, string>()
        ev.units.forEach((x, uj) => (x.nodes ?? []).forEach((nd, i) => [nd.a, nd.b].forEach((s, side) => {
          if (s[0] !== 'g' || s[1] !== ui || s[2] == null) return
          const f = byNode.get(base[uj] + i)
          const team = f ? (side === 0 ? f.teamA : f.teamB) : undefined
          if (!seatOf.get(s[2])) seatOf.set(s[2], team)
          if (team) destOf.set(team, labelOf(x).phase)
        })))
        const allSeated = [...seatOf.values()].every(Boolean)
        if (groups[0].done) {
          // who the phase sent on: exactly the sides the next phase seated
          const going = new Set(groups.flatMap((t) => t.rows.filter((r) => r.next).map((r) => r.team)))
          const seated = new Set(destOf.keys())
          const strays = [...seated].filter((x) => !going.has(x))
          if (strays.length) fail(`${where}：${names(state, strays)} 进了下一阶段，表上没标晋级`)
          if (allSeated && !same(seated, going)) fail(`${where}：表上标晋级的是 ${names(state, going)}，下一阶段坐进来的是 ${names(state, seated)}`)
        }
        for (const t of groups) {
          stats.lines += t.lines.length
          const bandDest = (p: number) => t.bands.find((b) => p >= b.from && p <= b.to)?.dest ?? null
          for (const l of t.lines) {
            if (bandDest(l.after) === bandDest(l.after + 1)) fail(`${where}${t.group ? ` ${t.group}` : ''}：第 ${l.after} 名下面有线，上下两名去的是同一个地方`)
          }
          if (t.done && t.lines.some((l) => !l.solid)) fail(`${where}${t.group ? ` ${t.group}` : ''}：打完了，线还是虚线`)
          if (t.done && allSeated && t.lines.length) {
            // a line exactly where the sides the next phases seated change
            stats.linesAtSeats++
            const want = t.rows.flatMap((r, i) => (i > 0 && (destOf.get(t.rows[i - 1].team) ?? null) !== (destOf.get(r.team) ?? null) ? [i] : []))
            const have = t.lines.map((l) => l.after)
            if (want.join() !== have.join()) fail(`${where}${t.group ? ` ${t.group}` : ''}：线在第 ${have.join('、')} 名下面，下一阶段实际在第 ${want.join('、') || '（无）'} 名下面分开`)
          }
        }
      } else {
        for (const t of mine as PlaceTable[]) {
          for (const r of t.rows) {
            stats.knockoutRows++
            // series won and lost, maps and rounds: the sum of the bracket's matches; a level Bo2 is neither side's
            const s = sums.get(r.team) ?? [0, 0, 0, 0, 0, 0, 0]
            const have = [r.w, r.l, r.mapW, r.mapL, r.roundW, r.roundL]
            const want = [s[0], s[1], s[3], s[4], s[5], s[6]]
            if (have.join() !== want.join()) fail(`${where}：${state.teams[r.team]?.name} 淘汰赛表里是 ${have.join('/')}，比赛加起来是 ${want.join('/')}`)
            const played = fx.filter((f) => f.node! >= lo && f.node! < hi && (f.teamA === r.team || f.teamB === r.team))
            // a level Bo2 in a knockout (FGC 2023's qualifiers had them) leads neither side on: out without a loss
            const lost = played.some((f) => f.played && f.result && (f.result.mapsWonA === f.result.mapsWonB
              || (f.result.mapsWonA > f.result.mapsWonB) !== (f.teamA === r.team)))
            if (r.state === 'out' && !lost) fail(`${where}：${state.teams[r.team]?.name} 标着淘汰，这个阶段一场没输也没打平`)
            if (r.state !== 'in' && played.some((f) => !f.played)) fail(`${where}：${state.teams[r.team]?.name} 标着${r.state === 'won' ? '胜出' : '淘汰'}，还有比赛没打`)
            if (comp.champion) {
              const k = comp.finished.indexOf(r.team)
              if (k >= 0 && r.place?.[0] !== (comp.places?.[k] ?? k + 1)) fail(`${where}：${state.teams[r.team]?.name} 名次写 ${r.place?.join('–')}，赛事记的是 ${comp.places?.[k] ?? k + 1}`)
            }
          }
          if (t.onward.length) onwardHolds(state, comp, ev, t, where)
        }
      }
    }
    const first = tables[0]
    if (comp.champion && first?.kind === 'bracket') {
      const won = first.rows.filter((r) => r.state === 'won')
      if (won.length === 1 && won[0].team !== comp.champion) {
        fail(`${label}：${state.year} ${comp.name}：最后一个阶段胜出的是 ${state.teams[won[0].team]?.name}，冠军是 ${state.teams[comp.champion]?.name}`)
      }
    }
    panelHolds(state, comp, tables, label)
  }
}

/**
 * A Masters' winner is at Champions once this world has played that Masters, and not before — the rule a Last
 * Chance Qualifier's winner already had. Built by hand rather than waited for: 2021's EMEA table, touched by
 * one event played here, with history's Berlin winner first on points and eleven sides below it.
 */
function mastersWaits(): void {
  const label = '大师赛冠军 · 2021 EMEA（手搭）'
  const was = bad
  const state = createCareer({ name: 'Probe', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2021 })
  const champs = targets(2021).find((e) => e.stage === 'champions')
  const lcq = targets(2021).find((e) => e.stage === 'lcq' && Object.values(routesOf(e)).some((r) => r.kind === 'points' && r.pool === 'EMEA'))
  const road = champs && Object.values(routesOf(champs)).find((r) => r.kind === 'winner' && !!r.event && eventOf(r.event)?.stage !== 'lcq')
  const masters = road?.event ? eventOf(road.event) : undefined
  const real = masters?.places[0] ? worldIdOf(masters.places[0][0]) : null
  const pool = (routesRaw as unknown as { pools: Record<string, Record<string, { regions: string[] }>> }).pools['2021']?.EMEA
  if (!champs || !lcq || !masters || !real || !state.teams[real] || !pool) {
    fail(`${label}：搭不起来——冠军赛、EMEA 最后机会资格赛、大师赛或它的真实冠军没找到`)
    return
  }
  // the pool touched: the first event before Berlin that pays EMEA points, played here
  const regions = new Set(pool.regions)
  const pays = (id: string) => { const r = BOOK[id]; return !!(r?.award || r?.wins || r?.groupWin || r?.bye) }
  const played = Object.values(state.comps)
    .filter((c) => !!c.circuit && c.circuit.end < (masters.start ?? 0) && pays(c.circuit.id) && c.teams.some((t) => regions.has(state.teams[t]?.region ?? '')))
    .sort((a, b) => a.circuit!.end - b.circuit!.end)[0]
  if (!played) { fail(`${label}：柏林之前没有给 EMEA 积分的赛事`); return }
  played.circuit!.mode = 'sim'
  played.finished = [...played.teams]
  played.champion = played.finished[0]
  // the points: history's Berlin winner first, then eleven sides that hold no other seat at Champions or the qualifier
  const other = new Set([champs, lcq].flatMap((e) => Object.entries(routesOf(e)).filter(([, r]) => r.kind !== 'points' && r.kind !== 'winner').map(([v]) => worldIdOf(v))))
  const rows = pointsTables(state).find((t) => t.pool === 'EMEA')?.rows.map((r) => r.team) ?? []
  for (const t of rows) state.teams[t].champPoints = 0
  const order = [real, ...rows.filter((t) => t !== real && !other.has(t) && t !== state.myTeam).slice(0, 11)]
  if (order.length < 12) { fail(`${label}：EMEA 积分榜上凑不够十二队`); return }
  order.forEach((t, i) => { state.teams[t].champPoints = i ? 400 - 10 * i : 500 })
  const comp = state.comps[`ev:${lcq.id}`]
  const expect = (when: string, want: (string | null)[], seated: string[], out: string[]): void => {
    const t = pointsTables(state).find((x) => x.pool === 'EMEA')
    if (!t) { fail(`${label} · ${when}：没有 EMEA 积分榜`); return }
    if (t.basis !== 'standing' || t.lcqBasis !== 'standing') fail(`${label} · ${when}：积分榜标的是 ${t.basis} / ${t.lcqBasis}，该是「按目前积分」`)
    const got = t.rows.slice(0, want.length).map((r) => `${state.teams[r.team]?.name}[${r.mark ?? ''}]`)
    const exp = order.slice(0, want.length).map((x, i) => `${state.teams[x]?.name}[${want[i] ?? ''}]`)
    if (got.join() !== exp.join()) fail(`${label} · ${when}：积分榜标的是 ${got.join(' ')}，该是 ${exp.join(' ')}`)
    // the week's reading of the qualifier's draw seats exactly the sides the table marks for it
    for (const x of seated) if (drawStanding(state, comp, x) !== 'seated') fail(`${label} · ${when}：${state.teams[x]?.name} 该有资格赛名额，抽签照目前看却没有它（${drawStanding(state, comp, x)}）`)
    for (const x of out) if (drawStanding(state, comp, x) === 'seated') fail(`${label} · ${when}：${state.teams[x]?.name} 不该有资格赛名额，抽签照目前看却有它`)
  }
  // Berlin not played: history's winner holds a points place like anyone else, and the qualifier starts at the third
  const lcqs = (n: number) => Array(n).fill('lcq') as string[]
  expect('柏林还没打', ['direct', 'direct', ...lcqs(7), null, null, null], [order[2], order[8]], [order[9]])
  // Berlin played here and won by the table's fifth: this world's winner is through, and history's keeps its points place
  const berlin = state.comps[`ev:${masters.id}`]
  const won = order[4]
  berlin.circuit!.mode = 'sim'
  berlin.finished = [won, ...berlin.teams.filter((x) => x !== won)]
  berlin.champion = won
  expect('柏林在这个世界打完', ['direct', 'direct', 'lcq', 'lcq', 'through', ...lcqs(5), null, null], [order[2], order[9]], [won, order[10]])
  if (bad === was) console.log(`\n== ${label}：柏林之前真实冠军 ${state.teams[real].name} 不算直通；柏林打完，这个世界的冠军 ${state.teams[won].name} 算`)
}

function run(label: string, region: Region, start: StartPoint, year: 2021 | 2026, until: number): void {
  const t0 = Date.now()
  const state = createCareer({ name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year })
  console.log(`\n== ${label}（${state.teams[state.myTeam]?.name ?? '无队'}，${state.year} 年第 ${state.day} 天开局）`)
  const years = new Map<number, number>()
  let guard = 0
  let before = snap(state)
  // into the first weeks of `until`, a year with no places off points
  while ((state.year < until || (state.year === until && state.day < 30)) && !state.gameOver && guard++ < 440) {
    tablesHold(state, before, label)
    if (state.day > 320 || guard % 4 === 0) eventsHold(state, label)
    if (state.day > 320 && before.tables.length) pointsPaid(state, before.tables, label)
    let stop
    try {
      stop = autoWeek(state)
    } catch (e) {
      fail(`${label}：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 4).join(' | ')}`)
      return
    }
    stats.weeks++
    qualifyHolds(state, label, fail)
    const drawnBefore = stats.drawn
    drawsSince(before, state, label)
    const after = snap(state)
    if (stats.drawn > drawnBefore) {
      renderHolds(state, after.tables, label)
      pointsPaid(state, after.tables, label)
    }
    years.set(state.year, (years.get(state.year) ?? 0) + 1)
    before = after
    if (stop.kind === 'game-over') break
  }
  if (state.year < until) fail(`${label}：只跑到 ${state.year} 年第 ${state.day} 天`)
  console.log(`  跑到 ${state.year} 年第 ${state.day} 天，${((Date.now() - t0) / 1000).toFixed(1)} 秒；经过 ${[...years.keys()].join('、')}`)
}

mastersWaits()
run('二线 · 欧洲 2021 起', 'Europe', 'chal', 2021, 2027)
run('VCT · EMEA 2026 起', 'Europe', 't1', 2026, 2027)

console.log(`\n${stats.weeks} 周 · 积分榜 ${stats.tables} 次（${stats.rows} 行）· 抽签对照 ${stats.drawn} 次：抽签前「积分已定」${stats.settled} 次、「按目前积分」${stats.standing} 次（其中 ${stats.standingOff} 次抽签和当时的线不同）· 渲染 ${stats.renders} 次`)
console.log(`赛事表 ${stats.eventTables} 张（${stats.events} 场赛事）· 线 ${stats.lines} 条，${stats.linesAtSeats} 张打完的表对过下一阶段的座位 · 淘汰赛 ${stats.knockoutRows} 行 · 积分线 ${stats.pointsLines} 次 · 跨赛事名额 ${stats.onward} 次 · 照真实历史 ${stats.historyEvents} 次（${stats.historyRows} 行）· 赛事面板渲染 ${stats.panelRenders} 次`)
if (!stats.settled) fail('没有一次抽签是在页面标「积分已定」之后发生的：检查没有覆盖到定下来的名额')
if (!stats.linesAtSeats) fail('没有一张打完的表对过下一阶段的座位：检查没有覆盖到线')
if (!stats.pointsLines) fail('没有一张淘汰赛表标过积分线：检查没有覆盖到积分线')
if (!stats.historyRows) fail('没有一场照真实历史的赛事对过真实比分：检查没有覆盖到进行中的历史赛事')
console.log(`资格判定：${qualifyStats.tables} 个小组赛、常规赛、瑞士轮的出线按各组战绩 · ${qualifyStats.entries} 次入口没有一队两占 · ${qualifyStats.lcqs} 个没进自己资格赛、积分却够的 LCQ 冠军去了冠军赛 · ${qualifyStats.ties} 场淘汰赛对阵等前一场打完才排、坐的是那场的胜者或负者`)
if (!qualifyStats.tables) fail('资格判定：一个打完的小组赛、常规赛、瑞士轮出线单元都没检查到')
if (!qualifyStats.ties) fail('资格判定：一场由前一场胜负送人进来的淘汰赛对阵都没检查到')
console.log(bad ? `\n✗ ${bad} 处不对` : '\n✓ 积分榜、赛事表、线和抽签一致')
process.exit(bad ? 1 : 0)
