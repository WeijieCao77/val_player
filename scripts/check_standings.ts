/**
 * Does the standings page tell the story the draw tells?
 *
 * The page printed an event as every fixture, one row each, and had no points
 * table at all (作者：「为什么积分榜里放的是所有队伍的比赛记录而不是积分，这个部分也学学
 * lol breaker」). Now it prints each event's tables and each year's points table,
 * and a table that disagrees with the draw is worse than none. So:
 *
 *  - points: every year that gave places off a points table — 2021 and 2022's
 *    circuit points, 2024–2026's Championship Points — shows one, runs by points,
 *    and every side's points are what this year's events paid it. Whenever the
 *    page marks the places as settled, the Champions or Last Chance Qualifier
 *    draw that follows gives exactly those places to exactly those sides; once
 *    it is drawn, the page marks the draw. 2023 and 2027 on gave no place off
 *    points and show no table.
 *  - events: a played event's tables are its matches — a side's record, maps and
 *    rounds the sum of its matches in that phase; a finished table sends on the
 *    sides the next phase seated; a side out of a bracket lost a match there; an
 *    event over carries its own placings.
 *  - render: the points panel as React renders it lists the table's rows, in its
 *    order, with its marks.
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
import { circuitPaid, eventOf, eventsOf, pointsTables } from '../src/engine/circuit'
import type { CEvent, PointsTable } from '../src/engine/circuit'
import { eventTables } from '../src/engine/eventTable'
import { GameCtx } from '../src/ui/me/ctx'
import { PointsPanel } from '../src/ui/me/Standings'
import type { GameState, Region } from '../src/engine/types'

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

type Route = { kind: string; pool?: string }
const BOOK = {
  ...(routesRaw as unknown as { events: Record<string, { routes?: Record<string, Route> }> }).events,
  ...(partneredRaw as unknown as { events: Record<string, { routes?: Record<string, Route> }> }).events,
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
const names = (state: GameState, ids: Iterable<string>) => [...ids].map((t) => state.teams[t]?.name ?? t).join('、') || '（无）'

interface Snap { year: number; day: number; tables: PointsTable[]; drawn: Set<string> }
const stats = { weeks: 0, tables: 0, rows: 0, settled: 0, standing: 0, standingOff: 0, drawn: 0, renders: 0, events: 0, eventTables: 0 }

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
  const ctx = {
    game: state, commit: () => {}, toast: () => {}, openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
  }
  for (const t of tables) {
    stats.renders++
    const html = renderToStaticMarkup(createElement(GameCtx.Provider, { value: ctx }, createElement(PointsPanel, { table: t })))
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

/** A played event's tables are its matches. */
function eventsHold(state: GameState, label: string): void {
  for (const comp of Object.values(state.comps)) {
    if (comp.format !== 'circuit' || comp.circuit?.mode !== 'sim') continue
    const ev = eventOf(comp.circuit.id)
    if (!ev) continue
    const base: number[] = []
    let n = 0
    for (const u of ev.units) { base.push(n); n += u.nodes?.length ?? 0 }
    const fx = state.fixtures.filter((f) => f.comp === comp.key && f.node != null && f.node >= 0)
    const byNode = new Map(fx.map((f) => [f.node!, f]))
    const tables = eventTables(state, comp)
    if (tables.length) stats.events++
    tables.forEach((t, ti) => {
      stats.eventTables++
      const u = ev.units[t.unit]
      const lo = base[t.unit]
      const hi = lo + (u.nodes?.length ?? 0)
      const inUnit = fx.filter((f) => f.node! >= lo && f.node! < hi)
      const where = `${label}：${state.year} ${comp.name} ${[t.phase, t.group].filter(Boolean).join(' · ')}`
      if (t.kind === 'table') {
        // record, maps and rounds: the sum of the phase's matches
        const sum = new Map<string, number[]>()
        const add = (team: string, row: number[]) => {
          const s = sum.get(team) ?? [0, 0, 0, 0, 0, 0, 0]
          sum.set(team, s.map((x, i) => x + row[i]))
        }
        for (const f of inUnit) {
          if (!f.played || !f.result) continue
          const { mapsWonA: a, mapsWonB: b, maps } = f.result
          const [ra, rb] = maps.reduce((s, m) => [s[0] + m.scoreA, s[1] + m.scoreB], [0, 0])
          add(f.teamA, [Number(a > b), Number(a < b), Number(a === b), a, b, ra, rb])
          add(f.teamB, [Number(b > a), Number(b < a), Number(a === b), b, a, rb, ra])
        }
        for (const [team, s] of sum) {
          const r = t.rows.find((x) => x.team === team)
          const have = r ? [r.w, r.l, r.d, r.mapW, r.mapL, r.roundW, r.roundL] : null
          if (!have) fail(`${where}：${state.teams[team]?.name} 打了这个阶段的比赛，表里没有`)
          else if (have.join() !== s.join()) fail(`${where}：${state.teams[team]?.name} 表里是 ${have.join('/')}，比赛加起来是 ${s.join('/')}`)
        }
        if (t.done) {
          // who the table sent on: exactly the sides the next phase seated
          const seated = new Set<string>()
          let seats = 0
          ev.units.forEach((x, uj) => (x.nodes ?? []).forEach((nd, i) => [nd.a, nd.b].forEach((s, side) => {
            if (s[0] !== 'g' || s[1] !== t.unit) return
            seats++
            const f = byNode.get(base[uj] + i)
            const team = f ? (side === 0 ? f.teamA : f.teamB) : undefined
            if (team) seated.add(team)
          })))
          const going = new Set(t.rows.filter((r) => r.next).map((r) => r.team))
          const strays = [...seated].filter((x) => !going.has(x))
          if (strays.length) fail(`${where}：${names(state, strays)} 进了下一阶段，表上没标晋级`)
          if (seated.size === seats && !same(seated, going)) fail(`${where}：表上标晋级的是 ${names(state, going)}，下一阶段坐进来的是 ${names(state, seated)}`)
        }
      } else {
        for (const r of t.rows) {
          const mine = inUnit.filter((f) => f.teamA === r.team || f.teamB === r.team)
          // a level Bo2 in a knockout (FGC 2023's qualifiers have them) leads neither side on: out without a loss
          const lost = mine.some((f) => f.played && f.result && (f.result.mapsWonA === f.result.mapsWonB
            || (f.result.mapsWonA > f.result.mapsWonB) !== (f.teamA === r.team)))
          if (r.state === 'out' && !lost) fail(`${where}：${state.teams[r.team]?.name} 标着止步，这个阶段一场没输也没打平`)
          if (r.state !== 'in' && mine.some((f) => !f.played)) fail(`${where}：${state.teams[r.team]?.name} 标着${r.state === 'won' ? '胜出' : '止步'}，还有比赛没打`)
          if (comp.champion) {
            const k = comp.finished.indexOf(r.team)
            if (k >= 0 && r.place?.[0] !== (comp.places?.[k] ?? k + 1)) fail(`${where}：${state.teams[r.team]?.name} 名次写 ${r.place?.join('–')}，赛事记的是 ${comp.places?.[k] ?? k + 1}`)
          }
        }
        const won = t.rows.filter((r) => r.state === 'won')
        if (comp.champion && ti === 0 && won.length === 1 && won[0].team !== comp.champion) {
          fail(`${where}：最后一个阶段胜出的是 ${state.teams[won[0].team]?.name}，冠军是 ${state.teams[comp.champion]?.name}`)
        }
      }
    })
  }
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

run('二线 · 欧洲 2021 起', 'Europe', 'chal', 2021, 2027)
run('VCT · EMEA 2026 起', 'Europe', 't1', 2026, 2027)

console.log(`\n${stats.weeks} 周 · 积分榜 ${stats.tables} 次（${stats.rows} 行）· 抽签对照 ${stats.drawn} 次：抽签前「积分已定」${stats.settled} 次、「按目前积分」${stats.standing} 次（其中 ${stats.standingOff} 次抽签和当时的线不同）· 渲染 ${stats.renders} 次 · 赛事表 ${stats.eventTables} 张（${stats.events} 场赛事）`)
if (!stats.settled) fail('没有一次抽签是在页面标「积分已定」之后发生的：检查没有覆盖到定下来的名额')
console.log(bad ? `\n✗ ${bad} 处不对` : '\n✓ 积分榜、赛事表和抽签一致')
process.exit(bad ? 1 : 0)
