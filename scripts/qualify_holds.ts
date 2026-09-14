/**
 * The qualification rules an event this world plays must keep — for the checks that play careers
 * (scripts/check_standings.ts, scripts/check_circuit.ts). Call it every week: it reads the state as it
 * stands and says each fault through `fail`.
 *
 *  - one way in: no side holds two different entry slots — seeds, or places from an earlier phase — of one
 *    unit (2023's third China Evolution Series act had Dragon Ranger Gaming in its main bracket twice)
 *  - no level knockout: outside a table (engine/circuit.ts PhaseSeats, a round robin's fixed schedule) no
 *    tie ends level, which would send neither side on (a Bo2 semi-final of 2021's Indonesian Challengers 1
 *    did, and its final went to a walkover)
 *  - a knockout plays its own results: in a bracket — a unit whose ties name a semi-final, a final, a match for
 *    third, a group's opening match, winners' match or decider — a tie that takes an earlier tie's winner or loser
 *    is drawn only once that tie is decided, and seats exactly that side. 2024 France Revolution's playoffs drew
 *    their final and their match for third along with the semi-finals, off the seats history's finalists had come
 *    from: a side that won its semi-final played for third, and the side it beat played the final
 *  - a table's seats: once a table phase is over and the phases after it have seated its places, the sides
 *    sent to the best phase it feeds are no worse on record than any side of their group that went nowhere
 *    (2026 Americas Stage 1 sent Cloud9 on at 1-4 and LOUD out at 3-2)
 *  - Last Chance Qualifiers, 2021 and 2022: a real LCQ champion left out of its own qualifier either had no
 *    more points than every points seat the qualifier gave, or is at that year's Champions by another road
 *    (Cloud9 was left out of 2021 North America's for the Champions place it had not won yet)
 */
import routesRaw from '../src/data/routes.json'
import { eventOf, gameOf, worldIdOf } from '../src/engine/circuit'
import type { CEvent, CNode, CUnit } from '../src/engine/circuit'
import type { Competition, Fixture, GameState } from '../src/engine/types'

type Route = { kind: string; pool?: string }
const BOOK = (routesRaw as unknown as { events: Record<string, { routes?: Record<string, Route> }> }).events

/** `ties`: the fixtures themselves, not their ids — ids start again each season (engine/league.ts resetFixtureSeq) */
interface Watch { seen: Set<string>; ties: WeakSet<Fixture>; shutOut: Map<string, { year: number; lcq: string }> }
const WATCH = new WeakMap<GameState, Watch>()

/** How much each rule has looked at, for a check's summary line. */
export const qualifyStats = { tables: 0, entries: 0, lcqs: 0, ties: 0 }

const nameOf = (state: GameState, t: string | null | undefined): string => (t ? state.teams[t]?.name ?? t : '—')

/**
 * A tie a bracket names: not a table's round — a numbered round, a Swiss round and its record, a seeding match — nor
 * only a group's name (FGC 2022 Act 3's 「Stage组」), read after its group's own tag (「A组 决胜赛」).
 */
const bracketRound = (round: string): boolean =>
  !/^(第 \d+ 轮|Round \d+( \(\d+-\d+\))?( High| Low)?|Seeding( Match)?|\S*组)$/.test(round.replace(/^\S+组 /, ''))

export function qualifyHolds(state: GameState, label: string, fail: (msg: string) => void): void {
  let w = WATCH.get(state)
  if (!w) { w = { seen: new Set(), ties: new WeakSet(), shutOut: new Map() }; WATCH.set(state, w) }
  const byComp = new Map<string, Fixture[]>()
  for (const f of state.fixtures) if (f.node != null && f.node >= 0) byComp.set(f.comp, [...(byComp.get(f.comp) ?? []), f])
  for (const comp of Object.values(state.comps)) {
    const c = comp.circuit
    const ev = c && eventOf(c.id)
    if (!c || !ev) continue
    if (ev.stage === 'lcq' || ev.stage === 'champions') lastChance(state, label, fail, w, comp, ev)
    const fx = byComp.get(comp.key)
    if (c.mode === 'sim' && fx) units(state, label, fail, w, comp, ev, fx)
  }
}

function units(state: GameState, label: string, fail: (msg: string) => void, w: Watch, comp: Competition, ev: CEvent, fx: Fixture[]): void {
  const base: number[] = []
  let count = 0
  for (const u of ev.units) { base.push(count); count += u.nodes?.length ?? 0 }
  const at = new Map(fx.map((f) => [f.node!, f]))
  const where = `${label}：${state.year} ${comp.name}`
  ev.units.forEach((u, ui) => {
    const nodes = u.nodes ?? []
    if (!nodes.length) return
    const knockout = u.type !== 'rr' && nodes.some((n) => bracketRound(n.round))
    const ways = new Map<string, Set<string>>()
    nodes.forEach((nd, i) => {
      const f = at.get(base[ui] + i)
      if (!f) return
      ;[nd.a, nd.b].forEach((s, side) => {
        if (s[0] !== 's' && s[0] !== 'g') return
        const t = side === 0 ? f.teamA : f.teamB
        ways.set(t, (ways.get(t) ?? new Set<string>()).add(s.join(',')))
      })
      if (f.played && f.result && f.result.mapsWonA === f.result.mapsWonB && u.type !== 'rr' && !u.follow) {
        fail(`${where} · ${u.label} · ${nd.round}：${nameOf(state, f.teamA)} ${f.result.mapsWonA}-${f.result.mapsWonB} ${nameOf(state, f.teamB)}，淘汰赛打平，两边都没法往下走`)
      }
      if (knockout && !w.ties.has(f)) knockoutTie(state, fail, w, comp, `${where} · ${u.label} · ${nd.round}`, u, nd, base[ui], at, f)
    })
    qualifyStats.entries += ways.size
    for (const [t, s] of ways) if (s.size > 1) fail(`${where} · ${u.label}：${nameOf(state, t)} 同时占了 ${[...s].join(' / ')} 几个入口`)

    const seats = u.seats
    const key = `${comp.key}|${ui}`
    if (seats?.kind !== 'table' || w.seen.has(key)) return
    const games = nodes.map((_, i) => { const f = at.get(base[ui] + i); return f ? gameOf(f) : null })
    if (games.some((g) => !g)) return
    const seated: { team: string; to: number }[] = []
    let waiting = false
    ev.units.forEach((v, vj) => (v.nodes ?? []).forEach((nd, i) => [nd.a, nd.b].forEach((s, side) => {
      if (s[0] !== 'g' || s[1] !== ui) return
      const f = at.get(base[vj] + i)
      if (!f) { waiting = true; return }
      seated.push({ team: side === 0 ? f.teamA : f.teamB, to: vj })
    })))
    if (!seated.length || waiting) return
    w.seen.add(key)
    qualifyStats.tables++
    seats.groups.forEach((grp, gi) => {
      const teams = grp.entries
        ? grp.entries.map((s) => (s[0] === 's' ? comp.circuit!.seeds[s[1]] : null)).filter((t): t is string => !!t)
        : [...new Set((grp.nodes ?? []).flatMap((i) => [games[i]!.a, games[i]!.b]).filter((t): t is string => !!t))]
      const rec = new Map(teams.map((t) => [t, { w: 0, l: 0, d: 0 }]))
      for (const g of games) {
        if (!g?.a || !g.b) continue
        const [ra, rb] = [rec.get(g.a), rec.get(g.b)]
        if (g.w === g.a) { if (ra) ra.w++; if (rb) rb.l++ } else if (g.w === g.b) { if (rb) rb.w++; if (ra) ra.l++ } else { if (ra) ra.d++; if (rb) rb.d++ }
      }
      const pts = (t: string) => 3 * rec.get(t)!.w + rec.get(t)!.d
      // a round robin typed as one reads no losses (its level sides go by head-to-head)
      const better = (x: string, y: string) => pts(x) > pts(y) || (u.type !== 'rr' && pts(x) === pts(y) && rec.get(x)!.l < rec.get(y)!.l)
      const mine = seated.filter((s) => rec.has(s.team))
      if (!mine.length) return
      const best = mine.reduce((x, y) => (better(y.team, x.team) ? y : x)).to
      const sentOn = [...new Set(mine.filter((s) => s.to === best).map((s) => s.team))]
      const nowhere = teams.filter((t) => !mine.some((s) => s.team === t))
      const line = (t: string) => `${nameOf(state, t)} ${rec.get(t)!.w}-${rec.get(t)!.l}${rec.get(t)!.d ? `-${rec.get(t)!.d}` : ''}`
      for (const t of sentOn) {
        const above = nowhere.filter((o) => better(o, t))
        if (above.length) fail(`${where} · ${u.label}${seats.groups.length > 1 ? ` · ${String.fromCharCode(65 + gi)}组` : ''}：${line(t)} 晋级了，战绩更好的 ${above.map(line).join('、')} 没有`)
      }
    })
  })
}

/**
 * A bracket's tie that takes an earlier tie's winner or loser: drawn only once that tie is decided — played, or a
 * walkover — and seating exactly its winner or loser. Each tie is looked at once, as soon as the week finds it drawn.
 */
function knockoutTie(
  state: GameState, fail: (msg: string) => void, w: Watch, comp: Competition, where: string,
  u: CUnit, nd: CNode, base: number, at: Map<number, Fixture>, f: Fixture,
): void {
  const walk = comp.circuit!.walk ?? {}
  const fed = [nd.a, nd.b].map((s, side) => ({ s, side })).filter(({ s }) => s[0] === 'w' || s[0] === 'l')
  if (!fed.length) return
  w.ties.add(f)
  for (const { s } of fed) {
    const k = base + s[1]
    const from = at.get(k)
    if ((from && gameOf(from)) || k in walk) continue
    const src = u.nodes![s[1]]
    fail(`${where}：${nameOf(state, f.teamA)} 对 ${nameOf(state, f.teamB)} 已经排上了，${s[0] === 'w' ? '胜者' : '负者'}要从${src.round}`
      + `${from ? `（${nameOf(state, from.teamA)} 对 ${nameOf(state, from.teamB)}，第 ${from.day} 天）` : ''}来，那场还没打`)
    return
  }
  for (const { s, side } of fed) {
    const k = base + s[1]
    const from = at.get(k)
    const g = from ? gameOf(from) : null
    // a walkover sends its side on and nobody down; a level knockout tie of an old save, the side with more rounds (engine/circuit.ts graphOf)
    const won = g ? g.w ?? (g.roundsA >= g.roundsB ? g.a : g.b) : walk[k] || null
    const lost = g ? (won === g.a ? g.b : g.a) : null
    const want = s[0] === 'w' ? won : lost
    const got = side === 0 ? f.teamA : f.teamB
    if (got !== want) {
      fail(`${where}：${nameOf(state, got)} 坐的是${u.nodes![s[1]].round}${s[0] === 'w' ? '胜者' : '负者'}的位置，那场${s[0] === 'w' ? '赢' : '输'}的是 ${nameOf(state, want)}`)
      return
    }
  }
  qualifyStats.ties++
}

function lastChance(state: GameState, label: string, fail: (msg: string) => void, w: Watch, comp: Competition, ev: CEvent): void {
  const c = comp.circuit!
  if (!c.mode || ev.projected || state.year > 2022 || w.seen.has(comp.key)) return
  w.seen.add(comp.key)
  if (ev.stage === 'champions') {
    for (const [team, s] of w.shutOut) {
      if (s.year !== state.year) continue
      w.shutOut.delete(team)
      if (!c.seeds.includes(team)) fail(`${label}：${s.year} ${nameOf(state, team)} 是${s.lcq}的真实冠军，积分够却没进这场资格赛，也没有从别的路进冠军赛`)
    }
    return
  }
  const real = ev.places[0]?.[0]
  const team = real ? worldIdOf(real) : null
  if (!team || !state.teams[team] || state.teams[team].dormant || c.seeds.includes(team)) return
  const routes = BOOK[ev.id]?.routes ?? {}
  const seatPoints = ev.seeds.map((v, i) => (routes[v]?.kind === 'points' ? c.seeds[i] : null))
    .filter((t): t is string => !!t).map((t) => state.teams[t]?.champPoints ?? 0)
  if (!seatPoints.length || state.teams[team].champPoints <= Math.min(...seatPoints)) return
  qualifyStats.lcqs++
  w.shutOut.set(team, { year: state.year, lcq: comp.name })
}
