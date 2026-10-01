import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { drawnSeeds, eventOf, setupCircuitSeason, worldIdOf } from '../src/engine/circuit'
import { repairClubRegions, syncEvent, syncYear } from '../src/engine/timeline'
import { regionIn } from '../src/engine/era'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'

globalThis.fetch = () => Promise.reject(new Error('offline check'))
const state = createCareer({ name: '区域回归', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: 'V21T17' })
assert.equal(state.myTeam, 'V21T17')
const own = state.teams[state.myTeam]
assert.equal(own.region, 'North America')
for (const year of [2022, 2023, 2024]) {
  state.year = year
  syncYear(state, year)
  assert.equal(own.region, year === 2022 ? 'North America' : 'Korea')
  if (year >= 2023) {
    assert.equal(own.league, 'VCT Pacific')
    assert.equal(regionIn(own.region, year), 'Pacific')
  }
}
assert.equal(state.me!.region, 'North America', 'player origin is not a club location')
assert.ok(own.roster.includes(state.me!.id), 'relocation retains the player')

// An old save already in 2024: repair only the stale geography, preserving its results and roster.
own.region = 'North America'
state.teams.V21T14.region = 'North America'
const historical = Object.values(state.comps)[0]
historical.finished = historical.teams.slice(0, 3)
historical.champion = historical.finished[0]
state.teams['custom-region-check'] = { ...own, id: 'custom-region-check', region: 'Brazil' }
const before = JSON.stringify({ roster: own.roster, fixtures: state.fixtures, comps: state.comps, me: state.me })
repairClubRegions(state)
assert.equal(own.region, 'Korea')
assert.equal(state.teams.V21T14.region, 'Korea', 'T1 follows the same historical relocation')
assert.equal(state.teams['custom-region-check'].region, 'Brazil', 'custom clubs retain their location')
assert.equal(JSON.stringify({ roster: own.roster, fixtures: state.fixtures, comps: state.comps, me: state.me }), before)
own.region = 'North America'
const loaded = migratePlayerSave(unpackState(packState(state)))
assert.equal(loaded.teams[loaded.myTeam].region, 'Korea', 'packed old save is repaired immediately on load')
assert.equal(loaded.me!.id, state.me!.id)
assert.deepEqual(loaded.teams[loaded.myTeam].roster, own.roster)
assert.equal(JSON.stringify(loaded.comps), JSON.stringify(state.comps), 'historical results survive load')
assert.equal(JSON.stringify(loaded.fixtures), JSON.stringify(state.fixtures), 'fixtures survive load')
const once = JSON.stringify(loaded)
migratePlayerSave(loaded)
assert.equal(JSON.stringify(loaded), once, 'second load migration is idempotent')
delete state.teams['custom-region-check']
own.region = 'North America'
syncEvent(state, {})
assert.equal(own.region, 'Korea', 'event synchronization repairs an old save')
state.seat = { club: own.id, displaced: 'V21T7386', league: 'Americas', from: 2023 }
own.region = 'North America'
repairClubRegions(state)
assert.equal(own.region, 'North America', 'an alternate-world seat keeps its league')
state.seat = undefined
state.year = 2030
repairClubRegions(state)
assert.equal(own.region, 'Korea', 'old saves beyond the book retain the last known relocation')

state.year = 2023
syncYear(state, 2023)
state.comps = {}
setupCircuitSeason(state)
const evolution = eventOf('1747')!
const champions = eventOf('1657')!
const mibr = 'V21T7386'
const edg = 'V21T1120'
const feeder = state.comps['ev:1657']
feeder.circuit!.mode = 'sim'
feeder.finished = champions.places.map(([v]) => worldIdOf(v)!).filter((t) => !!state.teams[t])
const edgRank = feeder.finished.indexOf(edg)
assert.ok(edgRank >= 0)
feeder.finished.splice(edgRank, 0, mibr)
feeder.champion = feeder.finished[0]
state.day = evolution.start! - 1
const seeds = drawnSeeds(state, evolution)
assert.ok(!seeds.includes(mibr), 'MIBR cannot inherit a Chinese seed from international placings')
assert.ok(seeds.every((id) => !id || state.teams[id].region === 'China'), 'all China-only seats stay in region')
assert.ok(seeds.includes(edg), 'eligible regional finisher remains seated')

// Same changed result remains usable for a genuinely international event or a named invitee.
const international = { ...evolution, id: 'test:international', region: null, layer: null, scene: null }
assert.ok(drawnSeeds(state, international).includes(mibr), 'international draws still accept foreign finishers')
const invite = { ...evolution, id: 'test:invite', seeds: [...evolution.seeds, '7386'] }
assert.ok(drawnSeeds(state, invite).includes(mibr), 'real named foreign invitee is preserved')
const projected = { ...evolution, id: 'F2027:1747', projected: { year: 2027, base: '1747' } }
state.year = 2027
const projectedFeeder = { ...feeder, key: 'ev:F2027:1657', circuit: { ...feeder.circuit!, id: 'F2027:1657' } }
state.comps[projectedFeeder.key] = projectedFeeder
assert.ok(!drawnSeeds(state, projected).includes(mibr), 'projected regional draws also reject foreign replacements')
assert.ok(drawnSeeds(state, projected).includes(edg), 'projected draw skips the foreign finisher and takes the next eligible one')
console.log('OK Oct 1: Evolution regional seeds, international invitees, Gen.G/T1 relocation, old-save preservation and alternate seats')

// Read-only follow-up: only main bracket's literal seed references need clubs.
const projectedDraw = drawnSeeds(state, projected)
const mainRefs = new Set<number>()
for (const unit of projected.units) {
  if (unit.type === 'open') continue
  for (const node of unit.nodes ?? []) for (const ref of [node.a, node.b]) {
    if (ref[0] === 's') mainRefs.add(ref[1])
  }
}
assert.ok(mainRefs.size > 0)
for (const i of mainRefs) assert.ok(projectedDraw[i], 'projected main seed ' + i + ' is filled')
const nonempty = projectedDraw.filter((id): id is string => !!id)
assert.equal(new Set(nonempty).size, nonempty.length, 'projected draw has no duplicated clubs')

// Force the international replacement path to pass an unavailable first candidate.
state.year = 2023
const dead = Object.values(state.teams).find(t => t.id !== state.myTeam && t.id !== mibr && t.id !== edg && !feeder.finished.includes(t.id))!
const wasDormant = dead.dormant
dead.dormant = true
const oldFinished = [...feeder.finished]
feeder.finished = oldFinished.filter(id => id !== mibr && id !== dead.id)
feeder.finished.splice(edgRank, 0, dead.id, mibr)
assert.ok(!international.seeds.includes('7386'), 'foreign candidate was not an original named seed')
const foreignDraw = drawnSeeds(state, international)
assert.ok(foreignDraw.includes(mibr), 'foreign finisher replaces a gone candidate in an international')
assert.ok(!foreignDraw.includes(dead.id), 'gone candidate never takes the place')
dead.dormant = wasDormant
feeder.finished = oldFinished

// A seat in the multi-seat book survives real synchronization and load, not only the helper.
let multi = createCareer({ name: '席位回归', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: 'V21T17' })
multi.seats = [{ club: multi.myTeam, displaced: 'V21T7386', league: 'Americas', from: 2023 }]
for (const year of [2023, 2024, 2025, 2026]) {
  multi.year = year
  syncYear(multi, year)
  syncEvent(multi, {})
  multi = migratePlayerSave(unpackState(packState(multi)))
  assert.equal(multi.teams[multi.myTeam].region, 'North America', 'alternate seat region survives ' + year)
  assert.equal(multi.teams[multi.myTeam].league, 'VCT Americas', 'alternate seat league survives ' + year)
  assert.ok(multi.teams[multi.myTeam].roster.includes(multi.me!.id))
}
console.log('OK additional projected main seats, gone international candidate and multi-seat synchronization')
