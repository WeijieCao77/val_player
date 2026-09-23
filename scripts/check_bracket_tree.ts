import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { eventOf, eventsOf, eventSoFar } from '../src/engine/circuit'
import { CARD_H, CARD_W, circuitTrees, layoutTree, legacyTrees } from '../src/ui/me/bracketModel'
import type { Competition, Fixture } from '../src/engine/types'

const game = createCareer({ name: '本地签表回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
const sample = Object.values(game.comps).find(c => c.circuit)!
assert.ok(sample)
let events = 0, matches = 0, edges = 0
for (const year of [2021, 2022, 2023, 2024, 2025, 2026, 2027]) for (const ev of eventsOf(year)) {
  const c: Competition = { ...sample, key: 'test', champion: undefined,
    circuit: { ...sample.circuit!, id: ev.id, mode: undefined, done: undefined } }
  const sections = circuitTrees(game, c)
  events++
  for (const section of sections) {
    const layout = layoutTree(section)
    for (const m of section.matches) {
      matches++
      assert.equal(m.scores, undefined, 'future historical score leaked')
      assert.ok(m.sides.every(s => s.id === undefined), 'future historical participant leaked')
      const p = layout.positions.get(m.id)!
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y))
      assert.ok(p.x >= 0 && p.y >= 0 && p.x + CARD_W <= layout.width && p.y + CARD_H <= layout.height)
      for (const s of m.sides) if (s.from) {
        edges++
        const src = layout.positions.get(s.from)
        assert.ok(src, `missing source: ${ev.id} ${section.id} ${s.from}`)
        assert.ok(src.x < p.x, `backwards edge: ${ev.id} ${m.id}`)
      }
    }
    const sorted = [...layout.positions.values()].sort((a, b) => a.x - b.x || a.y - b.y)
    sorted.slice(1).forEach((p, i) => { const last = sorted[i]; if (p.x === last.x) assert.ok(p.y >= last.y + CARD_H) })
    if (!section.tree) assert.ok(section.matches.every(m => m.sides.every(s => !s.from)))
  }
}
// Completed and partial historical views must agree with the engine's date-gated reading.
for (const id of ['2682', '2760']) {
  const ev = eventOf(id)!
  const c: Competition = { ...sample, key: 'test', champion: undefined, circuit: { ...sample.circuit!, id, mode: 'history', done: undefined } }
  for (const day of [(ev.start ?? 0), (ev.start ?? 0) + 8, (ev.end ?? 0) + 1]) {
    game.day = day
    const before = JSON.stringify(game)
    const view = eventSoFar(game, c)!
    const rows = circuitTrees(game, c).flatMap(s => s.matches)
    assert.equal(rows.filter(m => m.scores || m.walk).length, view.games.size)
    for (const m of rows) {
      const [ui, local] = m.id.split(':').map(Number), at = view.base[ui] + local
      assert.deepEqual(m.sides.map(s => s.id), view.sides(at))
      if (m.scores) assert.deepEqual(m.scores, [view.games.get(at)!.mapsA, view.games.get(at)!.mapsB])
    }
    assert.equal(JSON.stringify(game), before, 'render projection mutated career')
  }
}
const mkFixture = (id: string, wave: number, a: string, b: string, score?: [number, number]): Fixture => ({
  id, comp: 'legacy-test', label: `KO:${wave}:测试轮次`, teamA: a, teamB: b, day: 10, bo: 3,
  played: !!score, result: score ? { mapsWonA: score[0], mapsWonB: score[1], maps: [] } : undefined,
} as Fixture)
// Simulated scores/pending participants come from this career, not the historical schedule.
const sim: Competition = { ...sample, key: 'legacy-test', champion: undefined,
  circuit: { ...sample.circuit!, id: '2682', mode: 'sim', done: undefined, walk: { '2': 'Z' } } }
game.fixtures = [{ ...mkFixture('sim-played', 1, 'A', 'B', [0, 2]), node: 0 },
  { ...mkFixture('sim-pending', 1, 'C', 'D'), node: 1 }]
const simBefore = JSON.stringify(game)
const simulated = circuitTrees(game, sim)[0].matches
assert.deepEqual(simulated[0].scores, [0, 2]); assert.equal(simulated[0].winner, 'B')
assert.deepEqual(simulated[1].sides.map(s => s.id), ['C', 'D']); assert.equal(simulated[1].scores, undefined)
assert.equal(simulated[2].walk, true); assert.equal(simulated[2].scores, undefined)
assert.equal(JSON.stringify(game), simBefore)
const legacy: Competition = { ...sample, key: 'legacy-test', circuit: undefined, format: 'double', seeds: ['A', 'B', 'C', 'D'], champion: undefined }
game.fixtures = []
assert.equal(legacyTrees(game, legacy)[0].matches.length, 6)
assert.ok(legacyTrees(game, legacy)[0].matches.some(m => m.sides.some(s => s.outcome === 'l')))
legacy.format = 'triple'
assert.equal(legacyTrees(game, legacy)[0].matches.length, 30)
legacy.format = 'champions'
legacy.groups = Array.from({ length: 4 }, (_, i) => ['A', 'B', 'C', 'D'].map(x => `${i}${x}`))
assert.equal(legacyTrees(game, legacy).length, 5)
legacy.format = 'single'; legacy.groups = undefined
game.fixtures = [mkFixture('a', 1, 'A', 'B', [2, 0]), mkFixture('b', 1, 'C', 'D')]
const single = legacyTrees(game, legacy)[0]
assert.equal(single.matches.length, 3)
assert.equal(single.matches[2].bo, 5)
assert.equal(single.matches[2].sides[0].id, 'A')
assert.equal(single.matches[2].sides[1].id, undefined)
assert.equal(single.matches[2].scores, undefined)
legacy.byes = ['E', 'F']
assert.equal(legacyTrees(game, legacy)[0].matches.length, 5, 'non-power-of-two bye path')
game.fixtures = [{ ...mkFixture('sw', 1, 'A', 'B', [1, 1]), label: 'SW:1:瑞士轮' }]
const swiss = legacyTrees(game, legacy)[0]
assert.equal(swiss.tree, false)
assert.equal(swiss.matches[0].winner, undefined, 'draw cannot mark side B as winner')
// A walkover is stored winner-first; its card still seats each side on the edge it came in by (reported
// 2026-09-24: 2027 Thailand's A组 败者赛 drew Team NKT as 「#1 败者」 when #1 was a walkover and NKT had lost #2).
// GSL group: #1 s0 v s1, #2 s2 v s3, #3 胜者赛 w1 v w2, #4 败者赛 l1 v l2, #5 决胜赛 l3 v w4.
{
  const gsl = eventOf('F2026:oq0:th')!
  const n = gsl.units[0].nodes!
  assert.deepEqual([n[3].a, n[3].b], [['l', 0], ['l', 1]], 'GSL fixture shape changed: pick another event')
  const walkComp: Competition = { ...sample, key: 'walk-test', champion: undefined,
    circuit: { ...sample.circuit!, id: gsl.id, mode: 'sim', done: undefined, seeds: ['A', null, 'C', 'D'], walk: { '0': 'A', '3': 'C' } } }
  game.fixtures = [{ ...mkFixture('w1', 1, 'C', 'D', [0, 2]), comp: 'walk-test', node: 1 }]
  const before = JSON.stringify(game)
  const cards = circuitTrees(game, walkComp)[0].matches
  assert.deepEqual(cards[0].sides.map(s => s.id), ['A', null], 'walkover #1: A on its own seed, nobody opposite')
  assert.deepEqual(cards[3].sides.map(s => s.id), [null, 'C'], 'walkover #4: C came in as #2 败者, the #1 败者 side is empty')
  assert.equal(cards[3].walk, true)
  assert.equal(cards[3].winner, 'C')
  assert.deepEqual(cards[4].sides.map(s => s.id), [undefined, 'C'], '#5 waits on #3; C in on #4 胜者')
  assert.equal(JSON.stringify(game), before)
}
console.log(`PASS bracket projection: ${events} events / ${matches} nodes / ${edges} real edges; no future leaks, no state mutation, layout bounds, double/triple/GSL/single/bye/Swiss.`)
