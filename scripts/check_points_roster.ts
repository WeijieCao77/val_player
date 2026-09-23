/**
 * A Champions points place is held by points, not by the five on a roster on the draw's day.
 *
 * Reported 2026-09-24 (the carry-feel branch, a European career from 2021, seed 11): the points page marked Team
 * Vikings and Keyd Stars 「积分已定」 for Brazil's two Champions 2021 places from day 301; on the draw's day the event's
 * own roster sync (engine/circuit.ts begin → syncEvent) moved one of Keyd's five to the club history had him at, the
 * table the draw reads (poolRanking) dropped Keyd for being four, and Sharks Esports took the place while Keyd went
 * nowhere. Green before only because the random stream had not yet moved anyone out of a points club that week.
 *
 * Built by hand, no season played: two Brazilian clubs far ahead on points, the second of them one man short. The
 * points page and the draw (drawnSeeds, the reading begin makes) must put the same two clubs in Brazil's places —
 * and the short club must be one of them.
 *
 *   npx tsx scripts/check_points_roster.ts
 */
import assert from 'node:assert/strict'
import routesRaw from '../src/data/routes.json'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { drawnSeeds, eventsOf, pointsTables } from '../src/engine/circuit'
import type { Competition, GameState } from '../src/engine/types'

type Route = { kind: string; pool?: string }
const BOOK = (routesRaw as unknown as { events: Record<string, { routes?: Record<string, Route> }> }).events
const t0 = Date.now()

const base = createCareer({ name: '积分名额回归', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 11, year: 2021 })
const champs = eventsOf(2021).find((e) => /Valorant Champions 20/i.test(e.name))!
const book = BOOK[champs.id].routes!
const brSeats = champs.seeds.map((v, i) => ({ v, i })).filter(({ v }) => book[v]?.kind === 'points' && book[v]?.pool === 'BR').map(({ i }) => i)
assert.equal(brSeats.length, 2, 'Brazil had two points places at Champions 2021')

function world(short: boolean): { s: GameState; x: string; y: string } {
  const s = structuredClone(base)
  // a points table this world has moved: one Brazilian event that pays points, played here
  const pays = eventsOf(2021).filter((e) => e.region === 'Brazil')
  const brazil = Object.values(s.teams).filter((t) => t.region === 'Brazil' && !t.dormant && t.roster.length >= 5)
  const realIn = new Set(champs.seeds.map((v) => `V21T${v}`))
  const [x, y] = brazil.filter((t) => !realIn.has(t.id)).slice(0, 2)
  for (const t of brazil) t.champPoints = 0
  x.champPoints = 1000
  y.champPoints = 900
  if (short) {
    const out = s.players[y.roster[y.roster.length - 1]]
    y.roster = y.roster.filter((p) => p !== out.id)
    y.starters = y.starters.filter((p) => p !== out.id)
    out.teamId = null as never
  }
  const template = Object.values(base.comps).find((c) => c.circuit)!
  for (const e of pays) {
    const comp = { ...template, key: `ev:${e.id}`, champion: x.id, finished: [x.id, y.id], teams: [x.id, y.id] } as Competition
    comp.circuit = { ...template.circuit!, id: e.id, mode: 'sim', done: undefined }
    s.comps = { [comp.key]: comp }
    // one whose points count here: the draw now reads this world's table
    if (drawnSeeds(s, champs).includes(x.id)) break
  }
  assert.ok(drawnSeeds(s, champs).includes(x.id), 'a Brazilian event that pays points')
  s.day = (champs.start ?? 330) - 1
  return { s, x: x.id, y: y.id }
}

for (const short of [false, true]) {
  const { s, x, y } = world(short)
  const table = pointsTables(s).find((t) => t.pool === 'BR')!
  assert.notEqual(table.basis, 'history', 'this world has moved the Brazilian table')
  assert.deepEqual(table.rows.slice(0, 2).map((r) => r.team), [x, y], 'the table: points first')
  assert.equal(s.teams[y].roster.length, short ? 4 : 5)
  const marked = table.rows.filter((r) => r.mark === 'direct').map((r) => r.team).sort()
  const seeds = drawnSeeds(s, champs)
  const drawn = brSeats.map((i) => seeds[i]).filter((t): t is string => !!t).sort()
  assert.deepEqual(marked, [x, y].sort(), 'the page gives Brazil\'s places to the top two on points')
  assert.deepEqual(drawn, marked, `the draw seats who the page marks${short ? ' — the club one man short too' : ''}`)
}
console.log(`PASS points places: page and draw agree, a club one man short keeps its place (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
