/** Bounded synthetic map-era regression. No network, user saves, or season sim.
 * Run: npx tsx scripts/check_map_era.ts
 */
import assert from 'node:assert/strict'
import { MAPS, mapCn } from '../src/engine/content'
import { Rng } from '../src/engine/rng'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ARRIVALS } from '../src/engine/me/releases'
import { mapAvailableOn, mapsAvailableOn } from '../src/engine/me/mapEra'
import { activePool, MatchSim, poolFor, poolPhaseOf, runVeto, simulateMatch } from '../src/engine/match'
import type { PoolPhase } from '../src/engine/match'
import { MeMatch } from '../src/engine/me/matchplay'
import { cupFor, enterCup, mountCupMatch, TEMP_MINE, TEMP_OPP } from '../src/engine/me/cups'
import { makeFixture } from '../src/engine/league'
import { advanceDay, commitFixture } from '../src/engine/season'
import { migratePlayerSave } from '../src/engine/me/save'
import type { StageKey } from '../src/engine/types'

globalThis.fetch = () => Promise.reject(new Error('offline regression'))
const born = ['Ascent', 'Bind', 'Haven', 'Icebox', 'Split']
const releases = ARRIVALS.filter(a => a.kind === 'map')
const base = createCareer({ name: '地图年代回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2021, seed: 7 })
const aId = base.myTeam
const bId = Object.values(base.teams).find(t => t.id !== aId && t.roster.length >= 5)!.id
const clone = () => structuredClone(base)
const legal = (maps: readonly string[], year: number, day: number, count?: number) => {
  if (count !== undefined) assert.equal(maps.length, count, `${year}:${day} wrong map count: ${maps}`)
  assert.equal(new Set(maps).size, maps.length, `duplicate map: ${maps}`)
  for (const map of maps) assert.ok(mapAvailableOn(map, year, day), `${map} not released on ${year}:${day}`)
}
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }

// Independent copy of the pre-fix manager algorithm: default calls must stay bit-for-bit identical.
function oldManagerPool(seed: number, phase: PoolPhase): string[] {
  const rng = new Rng(seed ^ 0x5eed), order = rng.shuffle([...MAPS])
  const pool = order.slice(0, 7), bench = order.slice(7)
  for (let ph = 1; ph <= phase; ph++) {
    const swaps = 1 + rng.int(0, 1)
    for (let i = 0; i < swaps; i++) {
      const out = rng.int(0, pool.length - 1), inn = rng.int(0, bench.length - 1), dropped = pool[out]
      pool[out] = bench[inn]; bench[inn] = dropped
    }
  }
  return pool.sort()
}

check('every catalogue map has an explicit release or is one of the initial five', () => {
  assert.deepEqual(mapsAvailableOn(2021, 0).sort(), [...born].sort())
  for (const name of MAPS) assert.ok(born.includes(name) || releases.some(a => a.name === name), `${name} lacks a release`)
  assert.equal(mapAvailableOn('FutureUnannouncedMap', 2099, 300), false)
  assert.equal(mapAvailableOn('', 2099, 300), false)
  assert.equal(mapAvailableOn('Yoru', 2026, 300), false, 'agents are not maps')
  assert.ok(releases.some(a => a.name === 'Summit' && a.year === 2026 && a.day === 173))
})
check('ALL map arrivals: unavailable day before, available on release day and afterwards', () => {
  for (const a of releases) {
    assert.equal(mapAvailableOn(a.name, a.year - 1, 365), false, `${a.name}: prior year`)
    assert.equal(mapAvailableOn(a.name, a.year, a.day - 1), false, `${a.name}: early`)
    assert.equal(mapAvailableOn(a.name, a.year, a.day), true, `${a.name}: release day`)
    assert.equal(mapAvailableOn(a.name, a.year, a.day + 1), true, `${a.name}: day after`)
    assert.ok(!mapsAvailableOn(a.year, a.day - 1).includes(a.name))
    assert.ok(mapsAvailableOn(a.year, a.day).includes(a.name))
  }
})
check('2022 never includes 2023+ maps; Summit changes exactly on 2026 day 173', () => {
  for (const day of [0, 171, 172, 364]) {
    for (const a of releases.filter(a => a.year >= 2023)) assert.ok(!mapsAvailableOn(2022, day).includes(a.name))
  }
  assert.equal(mapsAvailableOn(2026, 172).includes('Summit'), false)
  assert.equal(mapsAvailableOn(2026, 173).includes('Summit'), true)
})
check('manager activePool and poolFor preserve the old seeded algorithm in every phase', () => {
  for (const seed of [0, 1, 7, 19, 73, 3750, 0x7fffffff]) for (const phase of [0, 1, 2] as const) {
    assert.deepEqual(activePool(seed, phase), oldManagerPool(seed, phase))
    const stage: StageKey = (['kickoff', 'stage1', 'stage2'] as const)[phase]
    const manager = { seed, year: 2021, day: 0, stage }
    assert.deepEqual(poolFor(manager), oldManagerPool(seed + manager.year, phase))
  }
  const manager = clone(); manager.me = undefined
  manager.vetoPlan = { maps: ['Summit'], log: ['manager original veto'] }
  const sim = new MatchSim(manager, aId, bId, 1, new Rng(7))
  assert.deepEqual(sim.maps, manager.vetoPlan.maps)
  assert.deepEqual(sim.vetoLog, manager.vetoPlan.log)
  const agreed = new MatchSim(manager, aId, bId, 1, new Rng(7), { map: 'Summit', format: 'full24' })
  assert.deepEqual(agreed.maps, ['Summit'], 'career release gating must not change manager agreements')
})
check('career pools: multiple seeds, phases and all release boundaries have enough distinct legal maps', () => {
  const dates = [[2021, 0], [2022, 364], [2026, 172], [2026, 173], [2027, 0], ...releases.flatMap(a => [[a.year, a.day - 1], [a.year, a.day]])]
  const stages: StageKey[] = ['kickoff', 'masters1', 'stage1', 'masters2', 'stage2', 'champions', 'offseason']
  for (const [year, day] of dates) for (const seed of [0, 1, 7, 19, 73, 3750]) for (const stage of stages) {
    const state = { seed, year, day, stage, me: base.me }
    const before = JSON.stringify(state), pool = poolFor(state)
    legal(pool, year, day, Math.min(7, mapsAvailableOn(year, day).length))
    assert.deepEqual(poolFor(state), pool)
    assert.equal(JSON.stringify(state), before, 'pool lookup mutated state')
  }
  for (const release of releases) {
    const seen = new Set<string>()
    for (let seed = 0; seed < 32; seed++) for (const map of poolFor({ seed, year: release.year, day: release.day, stage: 'kickoff', me: base.me })) seen.add(map)
    assert.ok(seen.has(release.name), `${release.name} must become eligible, not stay excluded forever`)
  }
})
check('5/6/7-map veto boards give BO1/2/3/5 enough distinct maps, deterministically', () => {
  for (const size of [5, 6, 7]) for (const bo of [1, 2, 3, 5] as const) for (const seed of [0, 1, 7, 19, 73]) {
    const pool = [...born, 'Breeze', 'Fracture'].slice(0, size)
    const veto = runVeto(base, aId, bId, bo, pool, new Rng(seed))
    assert.equal(veto.maps.length, bo, `pool ${size}, BO${bo}, seed ${seed}: ${veto.maps}`)
    assert.equal(new Set(veto.maps).size, bo)
    assert.ok(veto.maps.every(m => pool.includes(m)))
    assert.deepEqual(runVeto(base, aId, bId, bo, pool, new Rng(seed)), veto)
  }
})
check('old veto plans with future/unknown maps are ignored; valid selected maps remain intact', () => {
  const s = clone(); s.year = 2021; s.day = 0
  for (const bad of ['Summit', 'Lotus', 'FutureUnannouncedMap']) {
    s.vetoPlan = { maps: [bad, 'Ascent', 'Bind'], log: ['old bad plan'] }
    const sim = new MatchSim(s, aId, bId, 3, new Rng(7))
    legal(sim.maps, 2021, 0, 3)
    assert.ok(!sim.vetoLog.includes('old bad plan'))
  }
  s.vetoPlan = { maps: ['Ascent', 'Ascent', 'Bind'], log: ['duplicate stale plan'] }
  legal(new MatchSim(s, aId, bId, 3, new Rng(7)).maps, 2021, 0, 3)
  s.vetoPlan = { maps: ['Split', 'Haven', 'Ascent'], log: ['禁图：Summit / 天枢云阙', 'valid old plan'] }
  const oldPlan = JSON.stringify(s.vetoPlan)
  const selected = new MatchSim(s, aId, bId, 3, new Rng(7))
  assert.deepEqual(selected.maps, s.vetoPlan.maps)
  assert.ok(selected.vetoLog.every(line => !/Summit|天枢云阙/.test(line)))
  assert.equal(JSON.stringify(s.vetoPlan), oldPlan, 'old veto log is not overwritten')
})
check('agreed future scrim maps cannot bypass the release gate; valid agreements stay', () => {
  const s = clone(); s.year = 2021; s.day = 0; s.vetoPlan = undefined
  for (const bad of ['Summit', 'Pearl', 'FutureUnannouncedMap']) {
    const sim = new MatchSim(s, aId, bId, 1, new Rng(17), { map: bad, format: 'full24' })
    legal(sim.maps, 2021, 0, 1)
    assert.equal(sim.format, 'full24')
  }
  const agreed = new MatchSim(s, aId, bId, 1, new Rng(17), { map: 'Bind', format: 'full24' })
  assert.deepEqual(agreed.maps, ['Bind'])
})
check('legacy future-map scrim rewards only the actual legal map; booking and completed history stay untouched', () => {
  const s = clone(); s.year = 2021; s.day = 0; s.comps = {}; s.fixtures = []; s.vetoPlan = undefined
  const f = makeFixture(s, s.day, s.stage, 'scrim', aId, bId, 1, '旧训练赛')
  f.scrim = { map: 'Summit', format: 'full24' }
  const booking = JSON.stringify(f.scrim)
  for (const id of [aId, bId]) for (const map of MAPS) s.teams[id].mapPrefs[map] = 50
  const prefs = [aId, bId].map(id => ({ ...s.teams[id].mapPrefs }))
  s.fixtures.push(f)
  const result = simulateMatch(s, aId, bId, 1, new Rng(17), f.scrim)
  legal(result.maps.map(m => m.map), 2021, 0, 1)
  const actual = result.maps[0].map, notes: string[] = []
  commitFixture(s, f, result, notes)
  assert.ok(f.played)
  assert.equal(JSON.stringify(f.scrim), booking)
  for (const [i, id] of [aId, bId].entries()) {
    assert.ok(s.teams[id].mapPrefs[actual] > prefs[i][actual], 'actual scrim map earns practice')
    for (const map of MAPS) if (map !== actual) assert.equal(s.teams[id].mapPrefs[map], prefs[i][map], `${map}: phantom practice`)
  }
  assert.ok(notes.some(line => line.includes(mapCn(actual)) && line.includes('熟练度')))
  assert.ok(notes.every(line => !/Summit|天枢云阙/.test(line)))
})
check('early-2021 phase-change news never announces rotations of unavailable future maps', () => {
  const s = clone(); s.year = 2021; s.day = 2; s.stage = 'champions'; s.comps = {}; s.fixtures = []
  // Force a stage-boundary read on the next single day, without simulating a season.
  // All phases have the same five-map pool at this date, so there is no rotation.
  const before = s.news.length
  const report = advanceDay(s, { deferMine: true, holdMine: true, autoScrims: true, autoResolveDrawDecisions: true })
  assert.equal(report.stageChanged, true)
  assert.ok(!report.notes.some(line => line.includes('图池轮换')))
  assert.ok(!s.news.slice(before).some(n => n.text.includes('图池轮换')))
  legal(poolFor(s), s.year, s.day, 5)
})
check('BO5 on the launch five reaches a fifth distinct map at 2:2, then settles 3:2', () => {
  const s = clone(); s.year = 2021; s.day = 0; s.vetoPlan = undefined
  const sim = new MatchSim(s, aId, bId, 5, new Rng(17))
  legal(sim.maps, 2021, 0, 5)
  for (const winner of ['a', 'b', 'a', 'b', 'a'] as const) {
    assert.equal(sim.nextMap(), true, `ran out of maps at ${sim.wonA}:${sim.wonB}`)
    let guard = 0
    while (!sim.current!.over && guard++ < 30) sim.current!.playRound(winner)
    assert.ok(sim.current!.over)
    sim.closeMap()
  }
  assert.equal(sim.decided, true); assert.equal(sim.nextMap(), false)
  const result = sim.finish()
  assert.equal(result.mapsWonA, 3); assert.equal(result.mapsWonB, 2)
  legal(result.maps.map(m => m.map), 2021, 0, 5)
})
check('simulateMatch, professional MeMatch and real mounted cup MeMatch all use the legal pool', () => {
  const s = clone(); s.year = 2022; s.day = 0; s.comps = {}; s.fixtures = []; s.me!.pending = []
  s.vetoPlan = { maps: ['Summit'], log: ['future'] }
  const simulated = simulateMatch(s, aId, bId, 1, new Rng(37))
  legal(simulated.maps.map(m => m.map), s.year, s.day, 1)
  const fixture = makeFixture(s, s.day, s.stage, 'era-test', aId, bId, 1, '年代回归')
  s.fixtures.push(fixture)
  const professional = new MeMatch(s, fixture)
  legal(professional.sim.maps, s.year, s.day, 1)
  professional.runOut()
  assert.ok(fixture.played); legal(fixture.result!.maps.map(m => m.map), s.year, s.day, 1)
  const cupState = clone(); cupState.year = 2021; cupState.day = 0
  cupState.me!.phase = 'pre'; cupState.myTeam = ''; cupState.me!.pending = []
  cupState.me!.pre.cup = undefined; cupState.me!.money = 100000; cupState.me!.fans = 500
  assert.equal(enterCup(cupState, 'city', new Rng(17)), null)
  const cup = cupFor(cupState, 'city')!, mounted = mountCupMatch(cupState, cup, 0, new Rng(17))
  cupState.vetoPlan = { maps: ['Summit'], log: ['future cup veto'] }
  const friendly = new MeMatch(cupState, { aId: TEMP_MINE, bId: TEMP_OPP, bo: mounted.bo, comp: cup.name, label: mounted.label })
  legal(friendly.sim.maps, 2021, 0, mounted.bo)
  const rec = friendly.runOut()
  assert.ok(rec.friendly)
  legal(rec.mapLog!.map(m => m.map), 2021, 0, mounted.bo)
})
check('completed old reports are retained, not silently rewritten to a different map', () => {
  const s = clone(); s.year = 2026; s.day = 200; s.comps = {}; s.fixtures = []; s.me!.pending = []
  // Emulate a completed legacy report from when the old engine allowed a future map.
  s.vetoPlan = { maps: ['Summit'], log: ['legacy future map'] }
  const f = makeFixture(s, s.day, s.stage, 'old-report', aId, bId, 1, '旧赛报')
  s.fixtures.push(f)
  const rec = new MeMatch(s, f).runOut()
  assert.equal(rec.mapLog![0].map, 'Summit')
  s.year = 2021; s.day = f.day = rec.day = 1; rec.year = 2021
  const before = JSON.stringify({ result: f.result, mapLog: rec.mapLog })
  migratePlayerSave(s)
  poolFor(s)
  new MatchSim(s, aId, bId, 1, new Rng(17))
  assert.equal(JSON.stringify({ result: f.result, mapLog: rec.mapLog }), before)
  assert.equal(s.me!.matches.at(-1)!.mapLog![0].map, 'Summit')
})
console.log(`PASS ${checks} map-era checks; ${releases.length} dated map releases; phase mapping ${poolPhaseOf('kickoff')}/${poolPhaseOf('stage1')}/${poolPhaseOf('champions')}`)
