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
 *    points and show no table. No line is drawn across it either (作者：「积分表上
 *    的线不画了」): a club already at Champions by another road sits above where
 *    the line went and takes none of the points places, so the marks are the
 *    whole of it — 「已晋级」 among them, checked both ways against the field the
 *    draw made, and against the field it makes a week later.
 *  - events: a played event's tables are its matches — a side's record, maps and
 *    rounds the sum of its matches in that phase, in whichever group's table it
 *    sits, and a knockout side's series, maps and rounds the same; a finished
 *    phase sends on the sides the next phase seated, and its lines sit exactly
 *    where the sides the next phases seated change — while it is still played,
 *    only between the bands the draw reads; a side out of a bracket lost a match
 *    there; an event over carries its own placings.
 *  - onward: an event's final order draws no line — every row is marked instead
 *    (作者：「积分表上的线不画了，只列出积分，但是如果有其他队伍在其他渠道进入冠军赛了，
 *    那就标一下」). A row marked as taking points is a place the prize table pays;
 *    a later event takes as many places as the route book gives it; once it is
 *    drawn, the rows marked as holding one of its seats are the sides it seated,
 *    the rows marked as being in it already are the rest of its field and are
 *    really in its entry list — and the seats it gave are the first finishers
 *    that were not in it already and that history had not let go by its draw
 *    day, the rule a line could never tell. A row marked 「已解散，名额顺延」 was
 *    let go by that day, as the world that morning and the roster book have it,
 *    and is in no seat there; every club let go whose place passed down is so
 *    marked, and no other is.
 *  - history: an event replayed as history shows, while it is on, exactly the real
 *    results whose day has passed, and none after.
 *  - render: the points panel as React renders it lists the table's rows, in its
 *    order, with its marks; an event's panel draws each phase line under its row,
 *    and no line at all under its final order.
 *  - a Masters' winner: on a 2021 EMEA table built by hand, before Masters Berlin
 *    is over history's winner (Gambit) is not through — it takes a points place,
 *    and the Last Chance Qualifier's places start right below the Champions
 *    places, with the week's reading of that qualifier (drawStanding) seating
 *    the same sides; once this world has played Berlin, its own winner is
 *    through and the places pass it by. Before Berlin the qualifier had counted
 *    Gambit through and the table had not, and the side third on points was
 *    marked by neither (reported 2026-09-17).
 *  - a club let go before the draw, built rather than waited for: the first
 *    event this world plays that sends places on, once it is over, on a copy of
 *    the career — a finisher holding one of those places, that the next event
 *    did not really have, let go the day before that event's draw. The draw
 *    passes its place to the next finisher and its row reads 「已解散，名额顺延」,
 *    held by the same `onward` reading as every other table (goneBuilt).
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
import { circuitAward, circuitPaid, drawStanding, eventOf, eventSoFar, eventsOf, onwardOf, pointsTables, progressCircuit, worldIdOf } from '../src/engine/circuit'
import type { CEvent, PointsTable } from '../src/engine/circuit'
import { circuitPointsFor } from '../src/engine/era'
import { foldsOf, isTimelineWorld } from '../src/engine/timeline'
import { eventTables, labelOf } from '../src/engine/eventTable'
import type { EventTable, GroupTable, Line, PlaceTable, TableRow } from '../src/engine/eventTable'
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
  lines: 0, linesAtSeats: 0, knockoutRows: 0, pointsMarks: 0, onward: 0, historyEvents: 0, historyRows: 0, panelRenders: 0,
  cascades: 0, elsewhere: 0, fields: 0, through: 0, throughRows: 0, goneMarks: 0, passedGone: 0,
}
/** a history event once it is over: looked at once */
const historyOver = new Set<string>()

/**
 * The world as each event's draw found it, read beside the draw and not through it. A club history has let go by
 * the day a later event is drawn is passed over for the place it finished in here, and the place goes on down to
 * the next finisher (engine/circuit.ts nextFinisher, 2026-09-17). Which clubs those were is read off what the draw
 * reads, never off the code that does the passing:
 *
 *  - quiet: the clubs already dormant that morning
 *  - folded: on a world that follows the roster book, the clubs it lets go on or before that day
 *    (engine/timeline.ts foldsOf: its fold day; the club it carries on as, where it has an heir)
 *  - club: the player's own club that day, which no draw passes over
 *
 * Taken each morning an event is due to be drawn — a setter on state.day, so the engine is untouched — before that
 * day's own work, a club let go that very day being in the book's list; kept from the morning the event is drawn.
 */
interface DrawDay { year: number; day: number; quiet: Set<string>; folded: Set<string>; club: string | null }
let drawDays = new Map<string, DrawDay>()

function watchDraws(state: GameState): void {
  drawDays = new Map()
  const take = (): DrawDay => {
    const heir = (id: string) => { const h = state.heirs?.[id]; return h && state.teams[h] ? h : id }
    return {
      year: state.year,
      day: state.day,
      quiet: new Set(Object.values(state.teams).filter((t) => t.dormant).map((t) => t.id)),
      // a book club's id is V21T and its vlr id (engine/timeline.ts clubId)
      folded: new Set(isTimelineWorld(state) ? foldsOf(state.year).filter((f) => f.day <= state.day).map((f) => heir(`V21T${f.vlr}`)) : []),
      club: state.me ? (state.me.phase === 'pro' ? state.myTeam : null) : state.myTeam,
    }
  }
  const morning = (first: boolean): void => {
    let today: DrawDay | undefined
    for (const c of Object.values(state.comps)) {
      const k = c.circuit
      if (!k) continue
      // an event drawn before the watch began, as the career was made: the world as the watch first finds it
      if (k.mode ? first : state.day >= k.start - 2) drawDays.set(c.key, (today ??= take()))
    }
  }
  morning(true)
  let d = state.day
  Object.defineProperty(state, 'day', {
    get: () => d,
    set: (v: number) => { d = v; morning(false) },
    configurable: true,
    enumerable: true,
  })
}

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
  // Once the Champions field exists, every mark answers to it: a club of this pool that is in that field is
  // marked — 「冠军赛」 off the points, 「已晋级」 off another road — and a club that is marked is in it. The
  // line that used to run under the last Champions place is gone (作者：「积分表上的线不画了」), because a club
  // already in by another road stood above it and took none of these places; nothing checked 「已晋级」 at all,
  // and an unchecked mark is how the line came to promise what the draw does not keep.
  const cev = targets(state.year).find((e) => e.stage === 'champions')
  const cc = cev ? state.comps[`ev:${cev.id}`]?.circuit : undefined
  const field = cc?.mode ? new Set(cc.seeds.filter((x): x is string => !!x)) : null
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
    if (!field) continue
    stats.through++
    for (const r of t.rows) {
      const marked = r.mark === 'direct' || r.mark === 'through'
      if (r.mark === 'through') stats.throughRows++
      if (marked !== field.has(r.team)) {
        fail(`${label}：${state.year} ${t.pool} 积分榜：${state.teams[r.team]?.name} ${marked
          ? `标着「${r.mark === 'direct' ? '冠军赛' : '已晋级'}」，冠军赛的名单里没有它`
          : '什么都没标，它却在冠军赛的名单里'}`)
      }
    }
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
    // 「已晋级」 is a promise about today, not a guess about later: a club the page marked as in by another
    // road the week before is a club this draw's field holds
    if (champs) {
      const field = new Set((state.comps[`ev:${ev.id}`]?.circuit?.seeds ?? []).filter((x): x is string => !!x))
      for (const t of before.tables) {
        const missing = t.rows.filter((r) => r.mark === 'through' && !field.has(r.team)).map((r) => r.team)
        if (missing.length) fail(`${label}：${state.year} ${ev.name} ${t.pool}：第 ${before.day} 天页面标「已晋级」给 ${names(state, missing)}，抽出来的名单里没有他们`)
      }
    }
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

/** The event's final order against the places it gives on: the points each place pays, the route book's count, the draw's seats — and no line. */
function onwardHolds(state: GameState, comp: Competition, ev: CEvent, t: PlaceTable, where: string): void {
  const over = !!comp.champion && comp.finished.length > 0
  const nameOf = (r: PlaceTable['rows'][number]) => state.teams[r.team]?.name ?? r.name ?? r.team
  const paid = (p: number) => (circuitAward(comp, p) ?? (state.year <= 2022 ? circuitPointsFor(comp.stage, p) : 0)) > 0
  t.onward.forEach((s, k) => {
    const hi = s.places[s.places.length - 1]
    if (s.kind === 'points') {
      stats.pointsMarks++
      const size = Math.max(comp.teams.length, ev.seeds.length, ev.places.length)
      let last = 0
      for (let p = 1; p <= size; p++) if (paid(p)) last = p
      if (hi !== last) fail(`${where}：积分标到第 ${hi} 名，奖励表最后一个给分的名次是第 ${last} 名`)
      // the line under the last paying place is gone: each row says for itself, and the prize table says who is right
      if (over) {
        for (const r of t.rows) {
          const p = r.place?.[0]
          if (p == null) continue
          if ((r.marks[k] === 'yes') !== paid(p)) {
            fail(`${where}：${nameOf(r)} 第 ${p} 名，表上标的是「${r.marks[k] === 'yes' ? '拿积分' : '没有积分'}」，奖励表给的是 ${paid(p) ? '有分' : '0 分'}`)
          }
        }
      }
      return
    }
    stats.onward++
    const target = s.event ? eventOf(s.event) : undefined
    if (target && !target.plan && !target.projected) {
      const want = Object.values(BOOK[target.id]?.routes ?? {}).filter((r) => (r.kind === 'top' || r.kind === 'winner') && r.event === ev.id).length
      if (want !== s.places.length) fail(`${where}：${s.name} 从这里拿 ${want} 个名额，表上写的是 ${s.places.length} 个`)
    }
    if (!s.seated) return
    const seated = s.seated
    const dest = s.event ? state.comps[`ev:${s.event}`] : undefined
    const field = dest?.circuit?.seeds ?? []
    const elsewhere = new Set(field.filter((x): x is string => !!x && !seated.includes(x)))
    stats.elsewhere += t.rows.filter((r) => elsewhere.has(r.team)).length
    // the world that draw found: which of these finishers history had let go by then
    const at = dest ? drawDays.get(dest.key) : undefined
    if (!at) fail(`${where}：${s.name} 抽签那天的世界没有记下来，查不了谁已经解散`)
    const letGo = (x: string): boolean => !!at && x !== at.club && (at.quiet.has(x) || at.folded.has(x))
    // every row, both ways: the seat this event gave it, and the seat it did not give because that side was in already
    for (const r of t.rows) {
      if ((r.marks[k] === 'yes') !== seated.includes(r.team)) fail(`${where}：${nameOf(r)} 的「${s.name}」名额标记和抽签不一致`)
      if ((r.marks[k] === 'other') !== elsewhere.has(r.team)) {
        fail(`${where}：${nameOf(r)} 的「${s.name}」标记是「${r.marks[k]}」，${elsewhere.has(r.team) ? '它已经从别的途径进去了' : '它并不在那边的名单上'}`)
      }
    }
    // 「已解散，名额顺延」 says two things of a row, and both are read off the world, not off the mark: history had let
    // that club go by the day this event was drawn, and it holds no place in that event
    for (const r of t.rows) {
      if (r.marks[k] !== 'gone') continue
      stats.goneMarks++
      if (!letGo(r.team)) fail(`${where}：${nameOf(r)} 标着「已解散，名额顺延」，${s.name}抽签那天它还没解散`)
      if (field.includes(r.team) || dest?.teams.includes(r.team)) fail(`${where}：${nameOf(r)} 标着「已解散，名额顺延」，${s.name} 的名单里却有它`)
    }
    // the mark is not a second reading of the same list: a side it marks is really in that event, as that
    // event holds its entrants — the page would otherwise promise a seat off a seed list nobody plays by
    if (dest?.teams.length) {
      stats.fields++
      for (const r of t.rows) {
        if ((r.marks[k] === 'yes' || r.marks[k] === 'other') && !dest.teams.includes(r.team)) {
          fail(`${where}：${nameOf(r)} 标着${r.marks[k] === 'yes' ? `拿到${s.name}名额` : `已经进了${s.name}`}，${s.name} 的参赛名单里没有它`)
        }
      }
    }
    // The N at the top are not always the N this event seats, which is why no line is drawn and each row is
    // marked instead. A club up there may already hold a place in that field by another road, and the draw
    // skips a club it has already seated (engine/circuit.ts seedsFor: nextFinisher(…, (t) => !used.has(t)
    // && inLeague(t))), so the seat cascades to the next finisher. 2021 EMEA 挑战者赛 1: Guild finished 3rd
    // and was already in 挑战者决赛 by another seed, so the seat it would have taken went to G2, the 5th.
    // Nor does a place go to a club history had let go by the draw (nextFinisher, 2026-09-17): 2022 EMEA 第二赛段
    // 挑战者赛, EXCEL finished 3rd and was gone before Masters Copenhagen was drawn, and its seat went on down
    // to the 4th. Which clubs were gone is the world that draw found (watchDraws), not the draw's own reading.
    //
    // Keyed on the outcome rather than on a second copy of the engine's route order (winner / points / top
    // before 2023, winner / top / rest / points after): whichever order the seats are filled in, a club taken
    // by an earlier road ends up holding one of that field's other seeds. Read off the drawn field, this
    // cannot drift the way a copy of the order table would. The line used to gate this, and gated it into a
    // tautology: a line was drawn only where the top rows already were the seated sides, and where that holds
    // the cascade can have skipped nobody. Ungated, it is the rule itself, on every event that is over.
    if (over && !s.league && s.places[0] === 1 && t.rows.slice(0, hi).every((r, i) => r.place?.[0] === i + 1)) {
      stats.cascades++
      const order = t.rows.map((r) => r.team).filter((x) => !elsewhere.has(x))
      const want = order.filter((x) => !letGo(x)).slice(0, hi)
      if (!same(new Set(want), new Set(seated))) {
        fail(`${where}：${s.name} 该坐的是 ${names(state, want)}（名次靠前、还没从别的路进去、抽签前也没解散的），抽签给了 ${names(state, seated)}`)
      }
      // and the other way round: every finisher these places passed over because it had been let go says so on
      // its row, and no other row does — the page never leaves 「无缘」 on a club whose place went to the next one
      const last = want.length === hi ? order.indexOf(want[hi - 1]) : -1
      const passed = new Set(order.slice(0, last + 1).filter(letGo))
      stats.passedGone += passed.size
      for (const r of t.rows) {
        if (passed.has(r.team) !== (r.marks[k] === 'gone')) {
          fail(`${where}：${nameOf(r)} 的「${s.name}」标记是「${r.marks[k]}」，${passed.has(r.team)
            ? '它抽签前已经解散，名额顺延给了下一名，该标「已解散，名额顺延」'
            : '它的名额并没有因为解散顺延下去'}`)
        }
      }
    }
  })
}

/**
 * An event's panel as rendered draws each phase table's lines under the row it belongs under — and draws none
 * under its final order, which has none to draw. A panel carrying either is rendered and read back.
 */
function panelHolds(state: GameState, comp: Competition, tables: EventTable[], label: string): void {
  const linesOf = (t: EventTable): Line[] => (t.kind === 'table' ? t.lines : [])
  if (!tables.some((t) => linesOf(t).length || (t.kind === 'bracket' && t.onward.length))) return
  stats.panelRenders++
  const html = renderToStaticMarkup(createElement(GameCtx.Provider, { value: renderCtx(state) }, createElement(CircuitPanel, { comp })))
  const got = [...html.matchAll(/<tr class="([^"]*)" data-team="([^"]*)"/g)].map((m) => `${m[2]}${/cut-solid/.test(m[1]) ? '=' : /cut-dash/.test(m[1]) ? '-' : ''}`)
  const want = tables.flatMap((t) => t.rows.map((r, i) => {
    const l = linesOf(t).find((x) => x.after === i + 1)
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

/**
 * 「已解散，名额顺延」, built rather than waited for (2026-09-18). The careers above met one by chance: EXCEL, third in
 * the European career's 2022 EMEA Stage 2 Challengers, let go before Masters Copenhagen was drawn — the only row
 * that ever carried the mark (eleven reads of it). Their world moves with the player's club, and once a club on
 * history's open-qualifier list plays the decider a club off it gets (engine/circuit.ts offerPlayIn), that career's
 * 2022 field was drawn without EXCEL and neither the mark nor a place passed down past a club let go was checked
 * anywhere. So: the first event this world plays that sends places on to one not drawn yet, once it is over, on a
 * copy of the career. A finisher holding one of those places — one the later event did not really have, whose draw
 * would put it back on the floor with its real people (engine/timeline.ts syncEvent) — is let go the day before
 * that draw; the draw is made, and the event's final order is read by onwardHolds against the world that morning,
 * as every other table is. Its row must read 「已解散，名额顺延」 and its place go on down.
 */
let goneBuiltDone = false
function goneBuilt(state: GameState, label: string): void {
  if (goneBuiltDone || !isTimelineWorld(state)) return
  for (const src of Object.values(state.comps)) {
    const sc = src.circuit
    if (!sc || sc.mode !== 'sim' || !src.champion || !src.finished.length) continue
    const sev = eventOf(sc.id)
    if (!sev) continue
    for (const o of onwardOf(state, src)) {
      const dest = state.comps[`ev:${o.event}`]
      const dev = eventOf(o.event)
      if (o.seated || o.league || !dest?.circuit || dest.circuit.mode || !dev || dev.plan || dev.projected) continue
      if (dest.circuit.start - 1 <= state.day || !o.places.every((p, n) => p === n + 1)) continue
      const real = new Set(dev.seeds.map((v) => worldIdOf(v)))
      for (const gone of src.finished.slice(0, o.places.length)) {
        if (real.has(gone) || gone === state.myTeam || state.teams[gone]?.dormant) continue
        const copy = structuredClone(state) as GameState
        copy.teams[gone].dormant = true
        copy.day = dest.circuit.start - 1
        const at: DrawDay = {
          year: copy.year,
          day: copy.day,
          quiet: new Set(Object.values(copy.teams).filter((t) => t.dormant).map((t) => t.id)),
          folded: new Set(foldsOf(copy.year).filter((f) => f.day <= copy.day).map((f) => { const h = copy.heirs?.[`V21T${f.vlr}`]; return h && copy.teams[h] ? h : `V21T${f.vlr}` })),
          club: copy.me?.phase === 'pro' ? copy.myTeam : null,
        }
        progressCircuit(copy, copy.comps[dest.key], [])
        if (!copy.comps[dest.key].circuit?.mode) continue
        const table = eventTables(copy, copy.comps[src.key]).find((t): t is PlaceTable => t.kind === 'bracket' && t.onward.some((s) => s.event === o.event))
        const k = table ? table.onward.findIndex((s) => s.event === o.event) : -1
        if (!table || !table.onward[k].gone?.includes(gone)) continue
        goneBuiltDone = true
        const where = `${label}（手搭：${state.teams[gone]?.name} 在 ${dest.name}抽签前一天解散）：${state.year} ${src.name}`
        const kept = drawDays
        drawDays = new Map([[dest.key, at]])
        const [marks, passed] = [stats.goneMarks, stats.passedGone]
        onwardHolds(copy, copy.comps[src.key], sev, table, where)
        drawDays = kept
        const row = table.rows.find((r) => r.team === gone)
        if (row?.marks[k] !== 'gone') fail(`${where}：${state.teams[gone]?.name} 抽签前解散了，那一行该标「已解散，名额顺延」，标的是「${row?.marks[k] ?? '（没有这一行）'}」`)
        if (stats.goneMarks === marks || stats.passedGone === passed) fail(`${where}：手搭的解散没有被「名额往下顺延」那一条对到`)
        const seated = table.onward[k].seated ?? []
        console.log(`\n== ${where}：名次 ${src.finished.slice(0, o.places.length + 1).map((t) => state.teams[t]?.name).join('、')}，${dest.name}的名额给了 ${names(copy, seated)}`)
        return
      }
    }
  }
}

function run(label: string, region: Region, start: StartPoint, year: 2021 | 2026, until: number): void {
  const t0 = Date.now()
  const state = createCareer({ name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year })
  watchDraws(state)
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
    goneBuilt(state, label)
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

console.log(`\n${stats.weeks} 周 · 积分榜 ${stats.tables} 次（${stats.rows} 行）· 抽签对照 ${stats.drawn} 次：抽签前「积分已定」${stats.settled} 次、「按目前积分」${stats.standing} 次（其中 ${stats.standingOff} 次抽签和当时标的不同）· 渲染 ${stats.renders} 次 · 冠军赛名单出来后对过标记 ${stats.through} 张表，其中 ${stats.throughRows} 行标着「已晋级」`)
console.log(`赛事表 ${stats.eventTables} 张（${stats.events} 场赛事）· 线 ${stats.lines} 条，${stats.linesAtSeats} 张打完的表对过下一阶段的座位 · 淘汰赛 ${stats.knockoutRows} 行 · 积分标记 ${stats.pointsMarks} 次 · 跨赛事名额 ${stats.onward} 次：对过参赛名单 ${stats.fields} 次、对过「名额往下顺延」${stats.cascades} 次，其中 ${stats.elsewhere} 行是已经从别的途径进去的、${stats.goneMarks} 行标着「已解散，名额顺延」（因为解散顺延下去的名额 ${stats.passedGone} 次）· 照真实历史 ${stats.historyEvents} 次（${stats.historyRows} 行）· 赛事面板渲染 ${stats.panelRenders} 次`)
if (!stats.settled) fail('没有一次抽签是在页面标「积分已定」之后发生的：检查没有覆盖到定下来的名额')
if (!stats.through) fail('冠军赛名单出来以后一张积分榜的标记都没对过：检查没有覆盖到「已晋级」')
if (!stats.throughRows) fail('没有一行标过「已晋级」：检查没有覆盖到从别的途径进了冠军赛的队')
if (!stats.linesAtSeats) fail('没有一张打完的表对过下一阶段的座位：检查没有覆盖到线')
if (!stats.pointsMarks) fail('没有一张淘汰赛表对过积分标记：检查没有覆盖到积分')
if (!stats.cascades) fail('没有一次对过「名额往下顺延」：检查没有覆盖到跨赛事名额是怎么给的')
if (!stats.goneMarks) fail('没有一行标过「已解散，名额顺延」：检查没有覆盖到抽签前解散的俱乐部')
if (!stats.passedGone) fail('没有一个名额因为俱乐部抽签前解散而顺延：检查没有覆盖到解散俱乐部的名额给了谁')
if (!stats.historyRows) fail('没有一场照真实历史的赛事对过真实比分：检查没有覆盖到进行中的历史赛事')
console.log(`资格判定：${qualifyStats.tables} 个小组赛、常规赛、瑞士轮的出线按各组战绩 · ${qualifyStats.entries} 次入口没有一队两占 · ${qualifyStats.lcqs} 个没进自己资格赛、积分却够的 LCQ 冠军去了冠军赛 · ${qualifyStats.ties} 场淘汰赛对阵等前一场打完才排、坐的是那场的胜者或负者`)
if (!qualifyStats.tables) fail('资格判定：一个打完的小组赛、常规赛、瑞士轮出线单元都没检查到')
if (!qualifyStats.ties) fail('资格判定：一场由前一场胜负送人进来的淘汰赛对阵都没检查到')
console.log(bad ? `\n✗ ${bad} 处不对` : '\n✓ 积分榜、赛事表、线和抽签一致')
process.exit(bad ? 1 : 0)
