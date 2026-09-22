import { fireEvent, resolveEvent } from '../src/engine/me/events'
import { activeAbsence } from '../src/engine/me/absence'
import { autoWeek } from '../src/engine/me/auto'
import { doAction, undoAction } from '../src/engine/me/week'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { GameState, Competition } from '../src/engine/types'
import { eventOf, floorOf, roundAheadOf, setupCircuitSeason, progressCircuit } from '../src/engine/circuit'
import { MeMatch } from '../src/engine/me/matchplay'
import { ATTR_KEYS } from '../src/engine/types'
import { recomputeOverall } from '../src/engine/player'
import { stagesOf } from '../src/engine/era'
import { familyVisitBlocked } from '../src/engine/me/familyVisit'

let bad = 0

;(globalThis as unknown as { localStorage?: { getItem: () => null; setItem: () => void; removeItem: () => void } }).localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
}
;(globalThis as unknown as { fetch?: () => Promise<never> }).fetch = () => Promise.reject(new Error('offline'))

function makeFixture(
  state: GameState,
  compKey: string,
  stage: Competition['stage'],
  teamA: string,
  teamB: string,
  day: number,
): void {
  state.fixtures.push({
    id: `${compKey}-${state.fixtures.length}`,
    comp: compKey,
    stage,
    teamA,
    teamB,
    day,
    bo: 3,
    label: '验收',
    played: false,
  })
}

function timeline(year: number, id: string, expectedBlocked = true): GameState {
  const state = createCareer({
    year: year === 2023 ? 2021 : year,
    region: 'Europe',
    role: '先锋',
    start: 't1',
    seed: 97,
    talents: emptyTalents(),
    originKey: 'netcafe',
    name: '探亲赛事验收',
  })

  // A calendar fixture, not natural multi-year progression: 2023 is not a timeline new-career entry.
  if (year === 2023) { state.year = year; state.comps = {}; setupCircuitSeason(state) }
  const comp = Object.values(state.comps).find((c) => c.circuit?.id === id)
  assert.ok(comp, `competition ${id} not found in ${year}`)
  const ev = eventOf(id)
  assert.ok(ev, `event ${id} not found`)
  comp.circuit!.mode = 'sim'

  const seeds = ev.seeds
    .map((v) => (state.teams['V21T' + v] ? 'V21T' + v : null))
  comp.circuit!.seeds = seeds
  comp.teams = Array.from(new Set(seeds.filter((t): t is string => t !== null)))

  const floor = floorOf(state, comp)
  const entry = Array.from(floor.entries()).find(([team, day]) => comp.teams.includes(team) && day >= comp.circuit!.start && day <= comp.circuit!.end)
  assert.ok(entry, `no floor entry for ${id}`)
  const [club, entryDay] = entry

  const me = state.players[state.me!.id]
  if (me.teamId && state.teams[me.teamId]) {
    state.teams[me.teamId].roster = state.teams[me.teamId].roster.filter((p) => p !== me.id)
  }
  me.teamId = club
  state.teams[club].roster.push(me.id)
  state.myTeam = club

  state.me!.phase = 'pro'
  state.me!.week = 60
  state.me!.pending = []
  state.me!.pendingEvent = undefined
  comp.champion = undefined
  comp.finished = []
  comp.circuit!.done = false

  state.comps = { [comp.key]: comp }
  state.fixtures = []
  state.day = Math.max(comp.circuit!.start, entryDay)

  assert.notEqual(roundAheadOf(state, comp, club), null, `roundAheadOf null for ${id}`)
  assert.strictEqual(familyVisitBlocked(state), expectedBlocked, `familyVisitBlocked should be ${expectedBlocked} for ${id}`)

  return state
}

function legacy(): GameState {
  const state = createCareer({
    year: 2026,
    region: 'Europe',
    role: '先锋',
    start: 't1',
    seed: 97,
    talents: emptyTalents(),
    originKey: 'netcafe',
    name: '探亲赛事验收',
  })

  state.comps = {}
  const legacyComp: Competition = {
    name: '旧档冠军赛',
    key: 'legacy',
    stage: 'champions',
    teams: [state.myTeam],
    standings: {},
    finished: [],
    format: 'champions',
  }
  state.comps = { legacy: legacyComp }
  state.fixtures = []
  const championsStage = stagesOf(2026, false).find((s) => s.key === 'champions')
  assert.ok(championsStage, 'champions stage not found')
  state.day = championsStage.start
  state.me!.phase = 'pro'
  state.me!.week = 60
  state.me!.pending = []
  state.me!.pendingEvent = undefined
  return state
}

function snapshot(state: GameState): string {
  return JSON.stringify(state)
}

for (const [year, id] of [
  [2021, '353'],
  [2023, '1188'],
  [2026, 'F2026:2283'],
] as const) {
  const state = timeline(year, id)
  const before = snapshot(state)
  assert.strictEqual(familyVisitBlocked(state), true, `should block during ${id}`)
  assert.ok(snapshot(state) === before, 'familyVisitBlocked must not mutate state')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  const opponent = comp.teams.find((t) => t !== state.myTeam)
  assert.ok(opponent, 'opponent not found')
  makeFixture(state, comp.key, comp.stage, state.myTeam, opponent, state.day + 2)
  assert.strictEqual(familyVisitBlocked(state), true, 'should block with own upcoming fixture')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  state.day = comp.circuit!.start - 1
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block before start')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  const floor = floorOf(state, comp)
  const entryDay = floor.get(state.myTeam)
  assert.ok(entryDay !== undefined, 'entry day missing')
  state.day = entryDay - 1
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block before floor entry')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.circuit!.mode = undefined
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block without mode')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.finished.push(state.myTeam)
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block when finished')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.champion = state.myTeam
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block when champion')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.circuit!.done = true
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block when done')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.teams = comp.teams.filter((t) => t !== state.myTeam)
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block for non-participant')
}

{
  const state = timeline(2021, '353')
  state.players[state.me!.id].teamId = null
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block when player has no team')
}

{
  const state = timeline(2021, '353')
  state.me!.phase = 'pre'
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block in pre phase')
}

{
  const state = timeline(2021, '353')
  const comp = state.comps[Object.keys(state.comps)[0]]
  comp.circuit!.mode = 'history'
  assert.strictEqual(familyVisitBlocked(state), true, 'should block in history mode')
}

{
  const state = legacy()
  assert.strictEqual(familyVisitBlocked(state), true, 'legacy should block during stage')
}

{
  const state = legacy()
  state.day = stagesOf(2026, false).find((s) => s.key === 'champions')!.start - 1
  assert.strictEqual(familyVisitBlocked(state), false, 'legacy should not block before stage')
}

{
  const state = legacy()
  state.day = stagesOf(2026, false).find((s) => s.key === 'champions')!.end + 1
  assert.strictEqual(familyVisitBlocked(state), false, 'legacy should not block after stage')
}

{
  const state = legacy()
  const comp = Object.values(state.comps)[0]
  comp.finished.push(state.myTeam)
  assert.strictEqual(familyVisitBlocked(state), false, 'legacy should not block when finished')
}

{
  const base = createCareer({
    year: 2021,
    region: 'Europe',
    role: '先锋',
    start: 't1',
    seed: 97,
    talents: emptyTalents(),
    originKey: 'netcafe',
    name: '探亲赛事验收',
  })
  const domComp = Object.values(base.comps).find((c) => {
    const ev = c.circuit ? eventOf(c.circuit.id) : undefined
    return ev?.region !== null && ev?.stage === 's1masters'
  })
  assert.ok(domComp, 'domestic s1masters not found')
  const domId = domComp.circuit!.id
  const state = timeline(2021, domId, false)
  assert.strictEqual(familyVisitBlocked(state), false, 'should not block for domestic competition')
}

test('legacy domestic comp overlapping active international still blocks', () => {
  const s = timeline(2021, '353')
  const legacyDomestic: Competition = {
    name: '国内联赛',
    key: 'domestic',
    stage: 'champions',
    teams: [s.myTeam],
    standings: {},
    finished: [],
    format: 'champions',
    region: 'Europe',
  }
  s.comps['domestic'] = legacyDomestic
  assert.strictEqual(familyVisitBlocked(s), true, 'international active should still block')
})

const queued = (s: GameState, id: string): void => {
  const me = s.me!
  me.pendingEvent = id
  me.pending.push({ kind: 'event', id, day: s.day })
  me.eventCounts[id] = (me.eventCounts[id] ?? 0) + 1
}

const RELOAD = (s: GameState): GameState => migratePlayerSave(unpackState(packState(s)))

function test(name: string, run: () => void): void {
  try { run(); console.log(`PASS ${name}`) }
  catch (e) { bad++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`) }
}

test('four family ids refuse to fire in active legacy tournament, full state unchanged', () => {
  const ids = ['family_call', 'career_family_leave', 'echo_home', 'cn_newyear']
  for (const id of ids) {
    const s = legacy()
    const before = packState(s)
    assert.equal(fireEvent(s, id), false)
    assert.equal(packState(s), before)
    assert.equal(s.me!.pendingEvent, undefined)
    assert.equal(s.me!.eventCounts[id], undefined)
  }
})

for (const id of ['family_call', 'career_family_leave', 'echo_home', 'cn_newyear']) {
  for (const choice of [0, 1]) {
    test(`queued ${id} choice ${choice} resolves neutral no side effects, undo unsealed`, () => {
      const s = legacy()
      assert.equal(doAction(s, 'vod'), null)
      queued(s, id)
      const before = structuredClone(s)
      const res = resolveEvent(s, id, choice)
      assert.equal(res.length, 1)
      assert.ok(res[0].includes('暂缓'))
      assert.equal(activeAbsence(s), undefined)
      assert.ok(s.me!.pendingEvent === undefined)
      assert.ok(!s.me!.pending.some(p => p.kind === 'event' && p.id === id))
      const after = structuredClone(before)
      after.me!.pendingEvent = undefined
      after.me!.pending = after.me!.pending.filter(p => p.kind !== 'event' || p.id !== id)
      if (s.me!.log && s.me!.log.length) after.me!.log = s.me!.log
      assert.equal(JSON.stringify(s), JSON.stringify(after))
      assert.equal(s.me!.eventCounts[id], 1)
      assert.equal(undoAction(s, 'vod'), null)
      const afterUndo = packState(s)
      assert.deepEqual(resolveEvent(s, id, choice), [])
      assert.equal(packState(s), afterUndo)
    })
  }
}

test('save reload real queued family card resolves without absence, counter intact', () => {
  const ids = ['family_call', 'career_family_leave', 'echo_home', 'cn_newyear']
  for (const id of ids) {
    const s = legacy()
    queued(s, id)
    const back = RELOAD(s)
    assert.equal(back.me!.pendingEvent, id)
    assert.equal(back.me!.eventCounts[id], 1)
    const res = resolveEvent(back, id, 0)
    assert.equal(res.length, 1)
    assert.ok(res[0].includes('暂缓'))
    assert.equal(activeAbsence(back), undefined)
    assert.equal(back.me!.eventCounts[id], 1)
  }
})

test('normal pro outside international: family_call and career_family_leave fire and resolve real', () => {
  let s = legacy();
  s.comps = {}
  assert.equal(fireEvent(s, 'family_call'), true)
  assert.equal(resolveEvent(s, 'family_call', 0).length > 0, true)
  assert.equal(activeAbsence(s), undefined)

  s = legacy();
  s.comps = {}
  assert.equal(fireEvent(s, 'career_family_leave'), true)
  const res = resolveEvent(s, 'career_family_leave', 0)
  assert.ok(res.length > 0)
  const a = activeAbsence(s)
  assert.ok(a)
  assert.equal(a.reason, 'family')
  assert.equal(a.until.year * 364 + a.until.day, s.year * 364 + s.day + 7)
})

test('cn_newyear outside China does not fire', () => {
  const s = legacy()
  s.comps = {}
  s.day = 20
  assert.equal(fireEvent(s, 'cn_newyear'), false)
})

test('career_surgery fire with injury resolves to surgery absence 84 days', () => {
  const s = timeline(2021, '353')
  assert.equal(familyVisitBlocked(s), true)
  s.me!.week = 60
  s.players[s.me!.id].injuredUntil = s.day + 14
  s.me!.injury = { kind: 'wrist', from: s.day, played: 0 }
  assert.equal(fireEvent(s, 'career_surgery'), true)
  const res = resolveEvent(s, 'career_surgery', 1)
  assert.ok(res.length > 0)
  const a = activeAbsence(s)
  assert.ok(a)
  assert.equal(a.reason, 'surgery')
  assert.equal(a.until.year * 364 + a.until.day, s.year * 364 + s.day + 84)
})

test('forged queue only or pendingEvent only are exact noops', () => {
  const s = legacy()
  s.me!.pendingEvent = 'family_call'
  const before = packState(s)
  assert.deepEqual(resolveEvent(s, 'family_call', 0), [])
  assert.equal(packState(s), before)

  const s2 = legacy()
  s2.me!.pending.push({ kind: 'event', id: 'career_family_leave', day: s2.day })
  const before2 = packState(s2)
  assert.deepEqual(resolveEvent(s2, 'career_family_leave', 0), [])
  assert.equal(packState(s2), before2)
})

test('autoflow with queued family leave settles naturally and advances week without game over', () => {
  const s = legacy()
  queued(s, 'career_family_leave')
  const beforeWeek = s.me!.week
  const stop = autoWeek(s)
  assert.equal(s.me!.week, beforeWeek + 1)
  assert.ok(!stop || stop.kind !== 'game-over')
  assert.equal(activeAbsence(s), undefined)
  assert.equal(s.me!.pendingEvent, undefined)
})

for (const [year, id, remainsIn] of [[2023, '1188', false], [2021, '353', true]] as const) {
  test(`actual ${id} first loss: ${remainsIn ? 'double-elimination still protected' : 'winner-only exit no longer protected'}`, () => {
    const s = timeline(year, id), comp = Object.values(s.comps)[0], club = s.myTeam
    progressCircuit(s, comp, [])
    const fixture = s.fixtures.find(f => !f.played && (f.teamA === club || f.teamB === club))
    assert.ok(fixture, 'real graph writes own match')
    s.day = fixture.day
    const opponent = fixture.teamA === club ? fixture.teamB : fixture.teamA
    for (const playerId of [...s.teams[club].roster, ...s.teams[opponent].roster]) {
      const p = s.players[playerId]
      for (const k of ATTR_KEYS) p.attrs[k] = p.teamId === club ? 5 : 95
      recomputeOverall(p)
    }
    const rec = new MeMatch(s, fixture).runOut()
    assert.equal(rec.won, false, 'fixture actually loses')
    progressCircuit(s, comp, [])
    assert.ok(floorOf(s, comp).has(club), 'drawn seat persists after the loss')
    assert.equal(comp.champion, undefined, 'event is not over')
    assert.equal(familyVisitBlocked(s), remainsIn)
    console.log(`  ${year} ${id}: ${rec.score}, preview=${JSON.stringify(roundAheadOf(s, comp, club))}`)
  })
}

if (bad) process.exit(1)
console.log('PASS family visit and hook event append guards')
