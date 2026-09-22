import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { doAction, undoAction } from '../src/engine/me/week'
import { beginAbsence } from '../src/engine/me/absence'
import { MANAGER_TALK_AP, MANAGER_TALK_GAIN, MANAGER_TALK_WEEKS, MANAGER_TALK_CAP, managerTalkBlock, managerTalkWait, talkToManager } from '../src/engine/me/gmTrust'
import { EVENTS, fireEvent } from '../src/engine/me/events'
import type { GameState } from '../src/engine/types'

const mem = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, String(v)),
    removeItem: (k: string) => mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() { return mem.size }
  },
  fetch: () => Promise.reject(new Error('offline')),
})

const reload = (s: GameState) => migratePlayerSave(unpackState(packState(s)))
const base = reload(createCareer({ name: '读档经理谈话', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 701, year: 2026 }))
const fresh = () => structuredClone(base)
const packNoWeekStart = (s: GameState) => {
  const c = structuredClone(s)
  if (c.me) delete c.me.weekStart
  return packState(c)
}

let bad = 0, cases = 0
function test(name: string, run: () => void): void {
  cases++
  try { run(); console.log(`PASS ${name}`) }
  catch (e) { bad++; console.error(`FAIL ${name}: ${e instanceof Error ? e.message : String(e)}`) }
}
function guard(name: string, mutate: (s: GameState) => void): void {
  test(name, () => {
    const s = fresh()
    mutate(s)
    const before = packState(s)
    assert.notEqual(managerTalkBlock(s), null)
    assert.notEqual(talkToManager(s), null)
    assert.equal(packState(s), before)
  })
}

test('fixed constants', () => {
  assert.equal(MANAGER_TALK_AP, 2)
  assert.equal(MANAGER_TALK_GAIN, 3)
  assert.equal(MANAGER_TALK_WEEKS, 4)
  assert.equal(MANAGER_TALK_CAP, 80)
})

for (const age of [18, 23, 24, 30, 38]) {
  test(`talk success age ${age} changes only trust/ap/marker`, () => {
    const s = fresh()
    s.players[s.me!.id].age = age
    s.me!.gmTrust = 55
    const beforeAp = s.me!.ap
    const beforeTrust = s.me!.gmTrust
    const playerBefore = JSON.stringify(s.players[s.me!.id])
    const coachTrust = s.me!.coachTrust
    const fans = s.me!.fans
    const money = s.me!.money
    const body = s.me!.body
    const mental = s.me!.mental
    const tilt = s.me!.tilt
    const heat = s.me!.heat
    assert.equal(managerTalkBlock(s), null)
    assert.equal(managerTalkWait(s), 0)
    assert.equal(talkToManager(s), null)
    assert.equal(s.me!.gmTrust, Math.min(80, beforeTrust + MANAGER_TALK_GAIN))
    assert.equal(s.me!.ap, beforeAp - MANAGER_TALK_AP)
    assert.equal(typeof s.me!.managerTalkWeek, 'number')
    assert.equal(s.me!.managerTalkWeek, s.me!.week)
    assert.equal(JSON.stringify(s.players[s.me!.id]), playerBefore)
    assert.equal(s.me!.coachTrust, coachTrust)
    assert.equal(s.me!.fans, fans)
    assert.equal(s.me!.money, money)
    assert.equal(s.me!.body, body)
    assert.equal(s.me!.mental, mental)
    assert.equal(s.me!.tilt, tilt)
    assert.equal(s.me!.heat, heat)
  })
}

test('old narrative exhaustion allows a new manager talk', () => {
  for (const age of [18, 23, 24, 30, 38]) {
    const s = fresh()
    s.players[s.me!.id].age = age
    for (const event of EVENTS) {
      const positive = event.a.some(o => (o.e.gmTrust ?? 0) > 0)
      if (!positive) continue
      s.me!.eventCounts[event.id] = event.max
      assert.equal(fireEvent(s, event.id), false)
    }
    assert.equal(managerTalkBlock(s), null)
    assert.equal(talkToManager(s), null)
  }
})

test('trust 79 caps at 80 and still consumes AP', () => {
  const s = fresh()
  s.me!.gmTrust = 79
  const ap = s.me!.ap
  assert.equal(managerTalkBlock(s), null)
  assert.equal(talkToManager(s), null)
  assert.equal(s.me!.gmTrust, 80)
  assert.equal(s.me!.ap, ap - MANAGER_TALK_AP)
})

test('trust 80 and 95 are blocked with no mutation', () => {
  for (const trust of [80, 95]) {
    const s = fresh()
    s.me!.gmTrust = trust
    const before = packState(s)
    assert.notEqual(managerTalkBlock(s), null)
    assert.notEqual(talkToManager(s), null)
    assert.equal(packState(s), before)
  }
})

test('cooldown: week0 allowed, weeks 1-3 blocked, week4 allowed', () => {
  const s = fresh()
  assert.equal(managerTalkWait(s), 0)
  assert.equal(managerTalkBlock(s), null)
  assert.equal(talkToManager(s), null)
  const last = s.me!.managerTalkWeek!
  for (const week of [1, 2, 3]) {
    s.me!.week = week
    const before = packState(s)
    assert.notEqual(managerTalkBlock(s), null)
    assert.equal(managerTalkWait(s), last + MANAGER_TALK_WEEKS - week)
    assert.notEqual(talkToManager(s), null)
    assert.equal(packState(s), before)
  }
  s.me!.week = 4
  const ap = s.me!.ap, trust = s.me!.gmTrust
  assert.equal(managerTalkWait(s), 0)
  assert.equal(managerTalkBlock(s), null)
  assert.equal(talkToManager(s), null)
  assert.equal(s.me!.ap, ap - MANAGER_TALK_AP)
  assert.equal(s.me!.gmTrust, Math.min(80, trust + MANAGER_TALK_GAIN))
})

test('invalid legacy managerTalkWeek values treated as unused', () => {
  for (const val of [undefined, NaN, Infinity, -1, -2.5, 1.5, 99]) {
    const s = fresh()
    if (val === undefined) delete s.me!.managerTalkWeek
    else (s.me as any).managerTalkWeek = val
    const before = packState(s)
    assert.equal(managerTalkWait(s), 0)
    assert.equal(managerTalkBlock(s), null)
    assert.equal(packState(s), before)
  }
})

test('invalid me.week pure fails', () => {
  for (const week of [NaN, Infinity, -1, 1.5]) {
    const s = fresh()
    ;(s.me as any).week = week
    const before = packState(s)
    assert.notEqual(managerTalkBlock(s), null)
    assert.notEqual(talkToManager(s), null)
    assert.equal(packState(s), before)
  }
})

test('invalid AP pure fails', () => {
  for (const ap of [1, NaN, Infinity, -1]) {
    const s = fresh()
    ;(s.me as any).ap = ap
    const before = packState(s)
    assert.notEqual(managerTalkBlock(s), null)
    assert.notEqual(talkToManager(s), null)
    assert.equal(packState(s), before)
  }
})

guard('invalid gmTrust NaN', s => { s.me!.gmTrust = NaN })
guard('invalid gmTrust Infinity', s => { s.me!.gmTrust = Infinity })
guard('invalid gmTrust -1', s => { s.me!.gmTrust = -1 })
guard('invalid gmTrust 101', s => { s.me!.gmTrust = 101 })

test('ordinary injury does not block manager talk', () => {
  const s = fresh()
  s.players[s.me!.id].injuredUntil = s.day + 14
  assert.equal(managerTalkBlock(s), null)
  assert.equal(talkToManager(s), null)
})

guard('blocked by me.phase pre', s => { s.me!.phase = 'pre' })
guard('blocked by me.phase retired', s => { s.me!.phase = 'retired' })
guard('blocked by teamId mismatch', s => { s.players[s.me!.id].teamId = 'other' })
guard('blocked by missing roster', s => { s.teams[s.myTeam].roster = [] })
guard('blocked by pendingFixture', s => { s.me!.pendingFixture = 'x' })
guard('blocked by dueFixture', s => { s.me!.dueFixture = 'x' })
guard('blocked by pendingEvent', s => { s.me!.pendingEvent = 'x' })
guard('blocked by duelLive', s => { s.me!.duelLive = { id: 'x' } as any })
guard('blocked by tryout', s => { s.me!.tryout = { inviteId: 'x' } as any })
for (const kind of ['event', 'cup', 'tryout', 'ending', 'hurt']) {
  guard(`blocked by pending ${kind}`, s => { s.me!.pending = [{ kind, id: 'x' }] as any })
}
guard('blocked by absence', s => { beginAbsence(s, 'family', 10, '测试缺席') })

test('main undo: vod committed by talk, aim undo preserves talk', () => {
  const s = fresh()
  assert.equal(doAction(s, 'vod'), null)
  assert.equal(talkToManager(s), null)
  assert.notEqual(undoAction(s, 'vod'), null)
  const afterTalkNoWeek = packNoWeekStart(s)
  const afterTalkAp = s.me!.ap
  const afterTalkTrust = s.me!.gmTrust
  const afterTalkMarker = s.me!.managerTalkWeek
  const afterTalkPlayer = JSON.stringify(s.players[s.me!.id])
  assert.equal(doAction(s, 'aim'), null)
  assert.equal(undoAction(s, 'aim'), null)
  assert.equal(s.me!.ap, afterTalkAp)
  assert.equal(s.me!.gmTrust, afterTalkTrust)
  assert.equal(s.me!.managerTalkWeek, afterTalkMarker)
  assert.equal(JSON.stringify(s.players[s.me!.id]), afterTalkPlayer)
  assert.ok(packNoWeekStart(s) === afterTalkNoWeek, 'undo changed sealed state beyond the allowed weekStart snapshot')
  const back = reload(s)
  assert.ok(packNoWeekStart(back) === afterTalkNoWeek, 'reload changed sealed state beyond the allowed weekStart snapshot')
  assert.equal(back.me!.managerTalkWeek, s.me!.managerTalkWeek)
  assert.equal(managerTalkWait(back), managerTalkWait(s))
})

test('legacy save missing marker can talk at week0 after roundtrip', () => {
  const s = fresh()
  s.me!.week = 0
  delete s.me!.managerTalkWeek
  const back = reload(s)
  assert.equal(managerTalkWait(back), 0)
  assert.equal(managerTalkBlock(back), null)
  assert.equal(talkToManager(back), null)
})

if (bad) process.exit(1)
console.log(`PASS ${cases - bad}/${cases} gmTrust checks`)
