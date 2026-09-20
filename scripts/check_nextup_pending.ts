/** A later written tie must not hide an earlier round not yet on the schedule. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { nextUp } from '../src/engine/me/nextup'
import { eventOf, roundAheadOf } from '../src/engine/circuit'
import { makeFixture } from '../src/engine/league'

globalThis.fetch = async () => { throw new Error('offline regression: no network') }

// A deterministic, partly materialized schedule from the real Spain Stage 1
// round-robin graph. No career wins, roster transfers or random draws need to
// land on a particular path to reach the condition this regression tests.
// At the draw (day 9), seed 0 has round 1 (node 0, day 10) in the graph while
// round 2 (node 6, day 11) is already a concrete fixture. Both opponents and
// dates come from the production event, not a stub of roundAheadOf/nextUp.
const game = createCareer({ name: 'Next-round regression', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', teamId: 'V21T8924', seed: 11, year: 2026 })
const ev = eventOf('2792')!
assert.ok(ev && ev.units[0]?.type === 'rr', 'fixture uses the real Spain Stage 1 round-robin graph')
const comp = game.comps['ev:2792']
assert.ok(comp?.circuit, 'real career contains Spain Stage 1')
const first = ev.units[0].nodes![0], second = ev.units[0].nodes![6]
assert.deepEqual([first.a, first.b, first.day], [['s', 0], ['s', 1], 10])
assert.deepEqual([second.a, second.b, second.day], [['s', 7], ['s', 0], 11])
const seeds = ev.seeds.map(id => `V21T${id}`)
assert.ok(seeds.every(id => !!game.teams[id]), 'every event seed is a real team in the world')
assert.equal(game.myTeam, seeds[0], 'the career really belongs to the tested seed')
game.day = first.day - 1
comp.circuit.mode = 'sim'
comp.circuit.seeds = seeds
const laterEvent = Object.values(game.comps).find(c => c.key !== comp.key && c.circuit && c.circuit.start > second.day)!
assert.ok(laterEvent, 'retain a real second event for cross-event boundary checks')
game.comps = { [comp.key]: comp, [laterEvent.key]: laterEvent }
const fixture = makeFixture(game, second.day, comp.stage, comp.key, seeds[second.a[1]], seeds[second.b[1]], second.bo, second.round)
fixture.node = 6
game.fixtures = [fixture]
assert.ok(!fixture.played && fixture.comp === comp.key && (fixture.teamA === game.myTeam || fixture.teamB === game.myTeam))
// Diagnosis-only comparison reads a shallow view without future own fixtures;
// the real assertion below always exercises the unmodified game and graph.
const earlier = roundAheadOf({ ...game, fixtures: game.fixtures.filter(f => f.comp !== fixture.comp || f.played || (f.teamA !== game.myTeam && f.teamB !== game.myTeam)) }, comp, game.myTeam)
console.log(JSON.stringify({ year: game.year, day: game.day, team: game.teams[game.myTeam].name, comp: comp.name,
  written: { day: fixture.day, label: fixture.label, node: fixture.node },
  earlier, actual: nextUp(game) }, (key, value) => key === 'comp' && typeof value === 'object' ? value.name : value, 2))
assert.ok(earlier && !earlier.waiting && earlier.day < fixture.day, 'first round is before the written second round')
const before = JSON.stringify(game)
const actual = nextUp(game)
assert.equal(actual.kind, 'round', 'a later written fixture cannot hide the earlier known round')
if (actual.kind === 'round') {
  assert.equal(actual.name, comp.name); assert.equal(actual.day, earlier.day); assert.equal(actual.round, earlier.round)
}
assert.equal(JSON.stringify(game), before, 'round preview remains read-only')
for (const day of [earlier.day - 1, earlier.day, earlier.day + 1]) {
  const shifted = { ...game, fixtures: game.fixtures.map(f => f.id === fixture.id ? { ...f, day } : f) }
  const up = nextUp(shifted)
  assert.equal(up.kind, day <= earlier.day ? 'fixture' : 'round', `written fixture on day ${day} vs pending round day ${earlier.day}`)
  assert.ok('day' in up)
  assert.equal(up.day, Math.min(day, earlier.day))
  if (up.kind === 'fixture') assert.equal(up.fixture.id, fixture.id, 'equal date preserves concrete fixture priority')
}
// A concrete fixture in another event still competes on date; it must not
// suppress this event's graph read just because it involves the same club.
const otherComp = Object.keys(game.comps).find(key => key !== comp.key)!
for (const day of [earlier.day - 1, earlier.day, earlier.day + 1]) {
  const shifted = { ...game, fixtures: game.fixtures.map(f => f.id === fixture.id ? { ...f, comp: otherComp, day } : f) }
  const pending = roundAheadOf(shifted, comp, game.myTeam)
  assert.equal(pending?.round, earlier.round, 'another event cannot hide this pending round')
  const up = nextUp(shifted)
  assert.equal(up.kind, day <= earlier.day ? 'fixture' : 'round', 'cross-event earliest match wins; equal date prefers written fixture')
  assert.ok('day' in up)
  assert.equal(up.day, Math.min(day, earlier.day))
}
assert.equal(JSON.stringify(game), before, 'boundary checks never mutate the original state')
console.log('PASS pending-round regression: earlier/same/later written ties, same/different events, read-only and concrete-fixture priority')
