/** A later written tie must not hide an earlier round not yet on the schedule. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { advanceTurn } from '../src/engine/me/week'
import { autoResolve } from '../src/engine/me/auto'
import { pop } from '../src/engine/me/pending'
import { MeMatch } from '../src/engine/me/matchplay'
import { nextUp } from '../src/engine/me/nextup'
import { roundAheadOf } from '../src/engine/circuit'
import type { GameState } from '../src/engine/types'

globalThis.fetch = async () => { throw new Error('offline regression: no network') }

const state = createCareer({ name: 'Next-round regression', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 11, year: 2026 })
const me = state.me!
let snapshot: GameState | undefined
let day = state.day
Object.defineProperty(state, 'day', {
  get: () => day,
  set: (n: number) => {
    if (state.year === 2027 && day === 78 && n === day + 1) snapshot = structuredClone(state)
    day = n
  }, enumerable: true, configurable: true,
})
let guard = 0
while (!snapshot && !state.gameOver && me.phase !== 'retired' && guard++ < 5000) {
  let pending = 0
  while (me.pending.length && pending++ < 30) {
    const it = me.pending[0]; autoResolve(state, it)
    if (me.pending[0] === it) pop(state, it.kind, it.id)
  }
  const stop = advanceTurn(state)
  if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
}
assert.ok(snapshot, 'reached 2027-03-20 seed 11 career')
const game = snapshot
const fixture = game.fixtures.filter(f => !f.played && !f.scrim && f.comp !== 'scrim' && (f.teamA === game.myTeam || f.teamB === game.myTeam)).sort((a, b) => a.day - b.day)[0]
assert.ok(fixture)
const comp = game.comps[fixture.comp]
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
