/**
 * VCT 2026 China Stage 1 — and the China Cup 1 each later season copies from it — plays its real format: two
 * round-robin groups of six (vlr.gg/event/2864: Group Alpha, Group Omega), the top four of each through, then four
 * seeding matches (each group's Nth against the other's Nth) whose winner is seed N and loser seed 4 + N; seed K meets seed 9 − K.
 *
 * Reported 2026-09-24: vlr's graph had the groups as winner/loser slots and the playoffs' seats as ranks of the
 * whole unit, so a world paired the groups by results and seated by elimination order — Wolves won its seeding
 * match and went out, Xi Lai Gaming reached the playoffs without playing one (engine/circuit.ts seedingIntoPlayoffs).
 *
 *  - the book: the real event reads that way, tie numbers unchanged
 *  - a career in China from 2026 through Stage 1: the eight in the seeding matches are each group's top four by
 *    its own table, the playoffs are exactly those eight, and each quarter-final is seed K against seed 9 − K
 *
 *   npx tsx scripts/check_group_seeding.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { eventOf, eventSoFar, tableOrderOf } from '../src/engine/circuit'
import type { Game } from '../src/engine/circuit'
import { qualifyHolds } from './qualify_holds'

const t0 = Date.now()
let checks = 0
const ok = (label: string) => { checks++; console.log(`OK ${label}`) }

// ---- the book
for (const id of ['2864', 'F2027:cup1:China', 'F2029:cup1:China']) {
  const ev = eventOf(id)!
  const [grp, po] = ev.units
  assert.equal(grp.nodes!.length, 30, `${id}: two groups of six, fifteen games each`)
  assert.equal(grp.seats?.shape, 'robin')
  assert.equal(grp.seats!.groups.length, 2)
  assert.ok(grp.follow, 'a fixed schedule: each seat plays its games whoever wins')
  assert.ok(grp.nodes!.every((n) => !/^Seeding/.test(n.round)))
  const seeding = po.nodes!.slice(0, 4)
  assert.ok(seeding.every((n) => n.round === 'Seeding'))
  const place = (s: (typeof seeding)[0]['a']) => grp.seats!.at[s[2]!]
  for (const n of seeding) {
    const [a, b] = [place(n.a), place(n.b)]
    assert.ok(a && b && a[0] !== b[0] && a[1] === b[1], `${id}: a seeding match is the two groups' Nth`)
  }
  const matchOf = (nth: number) => seeding.findIndex((n) => place(n.a)[1] === nth)
  const qf = po.nodes!.slice(4, 8).map((n) => [n.a, n.b].map((s) => `${s[0]}${s[1]}`).sort().join(' '))
  const want = [[1, 4], [2, 3], [3, 2], [4, 1]].map(([w, l]) => [`w${matchOf(w)}`, `l${matchOf(l)}`].sort().join(' '))
  assert.deepEqual([...qf].sort(), [...want].sort(), `${id}: seed K v seed 9 − K`)
  assert.ok(po.nodes!.slice(4).every((n) => [n.a, n.b].every((s) => s[0] !== 'g')), 'every playoff seat is a seeding match\'s')
}
const real = eventOf('2864')!
assert.deepEqual(real.units[1].nodes!.slice(0, 4).map((n) => n.teams.map((t) => real.names[t]).join('–')),
  ['JD Gaming–EDward Gaming', 'TYLOO–Dragon Ranger Gaming', 'All Gamers–Xi Lai Gaming', 'Titan Esports Club–Trace Esports'])
assert.equal(real.units.reduce((s, u) => s + (u.nodes?.length ?? 0), 0), 48, 'every tie keeps its number')
ok('2026 China Stage 1 and its later copies read as two groups, four seeding matches, seed K v 9 − K')

// ---- a career through it
const s = createCareer({ name: '种子排位赛回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
const fails: string[] = []
let g = 0
while (g++ < 40 && s.day < 135) {
  autoWeek(s)
  qualifyHolds(s, '2026 中国', (m) => fails.push(m))
}
assert.deepEqual(fails, [])
const comp = Object.values(s.comps).find((c) => c.circuit?.id === '2864')!
assert.ok(comp.circuit?.mode === 'sim' && comp.champion, 'the career played Stage 1 to the end')
const so = eventSoFar(s, { ...comp, circuit: { ...comp.circuit!, done: undefined } })!
const grp = so.ev.units[0]
const games = (js: number[]) => js.map((j) => so.games.get(so.base[0] + j)).filter((x): x is Game => !!x)
const tops = grp.seats!.groups.map((gr) => {
  const gs = games(gr.nodes!)
  assert.equal(gs.length, 15)
  const teams = [...new Set(gs.flatMap((x) => [x.a!, x.b!]))]
  assert.equal(teams.length, 6)
  for (const t of teams) assert.equal(gs.filter((x) => x.a === t || x.b === t).length, 5, 'each plays the other five once')
  return tableOrderOf(grp, gs, teams).slice(0, 4)
})
const seeding = [0, 1, 2, 3].map((j) => so.games.get(so.base[1] + j)!)
assert.deepEqual(new Set(seeding.flatMap((x) => [x.a, x.b])), new Set(tops.flat()), 'the seeding matches are each group\'s top four')
for (const x of seeding) {
  const nth = (t: string) => tops.findIndex((o) => o.includes(t)) >= 0 ? tops.find((o) => o.includes(t))!.indexOf(t) : -1
  assert.equal(nth(x.a!), nth(x.b!), 'Nth against Nth')
}
const qf = [4, 5, 6, 7].map((j) => so.games.get(so.base[1] + j)!)
assert.deepEqual(new Set(qf.flatMap((x) => [x.a, x.b])), new Set(tops.flat()), 'the playoffs are those eight')
const seedOf = (t: string) => {
  const m = seeding.find((x) => x.a === t || x.b === t)!
  const nth = tops.find((o) => o.includes(t))!.indexOf(t) + 1
  return m.w === t ? nth : 4 + nth
}
for (const x of qf) assert.equal(seedOf(x.a!) + seedOf(x.b!), 9, 'seed K v seed 9 − K')
ok(`a career: groups by their tables, seeding Nth v Nth, quarter-finals K v 9 − K (${s.teams[comp.champion!]?.name} won)`)

console.log(`PASS ${checks} group-seeding checks (${((Date.now() - t0) / 1000).toFixed(1)} s)`)
