import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { talkToManager, managerTalkWait, managerTalkBlock } from '../src/engine/me/gmTrust'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { SEASON_DAYS } from '../src/engine/calendar'

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, fetch: () => Promise.reject(new Error('offline')) })

const base = createCareer({ name: 'GM信任验收', region: 'Europe', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 97, year: 2026 })
const fresh = () => structuredClone(base)

const gmTrustOf = (s: typeof base): number | undefined => s.me!.gmTrust
const gmTalkWeekOf = (s: typeof base): number | undefined => s.me!.managerTalkWeek

{
  const control = fresh()
  const history = fresh()
  const meC = control.me!, meH = history.me!
  assert.equal(managerTalkWait(control), 0)
  assert.equal(managerTalkWait(history), 0)
  assert.equal(gmTalkWeekOf(control), undefined)
  assert.equal(gmTalkWeekOf(history), undefined)
  const trustBefore = gmTrustOf(history) ?? 0
  assert.equal(talkToManager(history), null)
  assert.equal(gmTalkWeekOf(history), 0)
  assert.equal(meH.ap, meH.apMax - 2)
  assert.equal((gmTrustOf(history) ?? 0), trustBefore + 3)
  assert.equal(managerTalkWait(history), 4)

  for (let i = 1; i <= 52; i++) {
    const beforeC = meC.week
    const beforeH = meH.week
    const stopC = autoWeek(control)
    const stopH = autoWeek(history)
    assert.notEqual(stopC.kind, 'game-over')
    assert.notEqual(stopH.kind, 'game-over')
    assert.equal(meC.week, beforeC + 1)
    assert.equal(meH.week, beforeH + 1)
    assert.equal(meC.ap, meC.apMax)
    assert.equal(meH.ap, meH.apMax)
    assert.equal(gmTalkWeekOf(control), undefined)
    assert.equal(gmTalkWeekOf(history), 0)
    const wait = managerTalkWait(history)
    if (i <= 3) assert.equal(wait, 4 - i)
    else assert.equal(wait, 0)
  }
  console.log('PASS 52-week control/history: control week', meC.week, 'history week', meH.week, 'year', control.year, 'AP', meC.ap, '/', meH.ap, 'trust', gmTrustOf(control), '/', gmTrustOf(history))
}

{
  let state = fresh()
  assert.equal(managerTalkWait(state), 0)
  const trust0 = gmTrustOf(state) ?? 0
  assert.equal(talkToManager(state), null)
  assert.equal(gmTalkWeekOf(state), 0)
  assert.equal((gmTrustOf(state) ?? 0), trust0 + 3)
  assert.equal(managerTalkWait(state), 4)

  const blocked = talkToManager(state)
  assert.equal(typeof blocked, 'string')
  assert.notEqual(blocked, null)

  for (let week = 1; week <= 4; week++) {
    const me = state.me!
    const before = me.week
    const stop = autoWeek(state)
    assert.notEqual(stop.kind, 'game-over')
    assert.equal(state.me!.week, before + 1)
    assert.equal(state.me!.ap, state.me!.apMax)
    assert.equal(managerTalkWait(state), 4 - week)
    if (week === 2) {
      state = migratePlayerSave(unpackState(packState(state)))
    }
  }

  assert.equal(managerTalkWait(state), 0)
  assert.equal(state.me!.ap, state.me!.apMax)
  const blockReason = managerTalkBlock(state)
  if (blockReason) {
    console.log('PASS 4-week natural + pack/unpack/migrate: second talk blocked by pending guard:', blockReason, 'week', state.me!.week, 'year', state.year, 'AP', state.me!.ap, 'trust', gmTrustOf(state))
  } else {
    const trustBeforeSecond = gmTrustOf(state) ?? 0
    assert.ok(trustBeforeSecond < 80)
    assert.equal(talkToManager(state), null)
    assert.equal((gmTrustOf(state) ?? 0), trustBeforeSecond + 3)
    assert.equal(managerTalkWait(state), 4)
    assert.equal(gmTalkWeekOf(state), 4)
    console.log('PASS 4-week natural + pack/unpack/migrate: week', state.me!.week, 'year', state.year, 'AP', state.me!.ap, 'trust', gmTrustOf(state))
  }
}

{
  const state = fresh()
  const me = state.me!
  const startWeek = me.week
  assert.equal(managerTalkWait(state), 0)
  assert.equal(talkToManager(state), null)
  assert.equal(gmTalkWeekOf(state), 0)
  state.day = SEASON_DAYS - 2
  me.weekDay = 0
  me.pending = []
  me.moments = []
  const year = state.year
  let guard = 0
  while (state.year === year && guard < 5) {
    const stop = autoWeek(state)
    assert.notEqual(stop.kind, 'game-over')
    me.moments = []
    guard++
  }
  assert.equal(state.year, year + 1)
  assert.ok(state.me!.week > startWeek)
  assert.equal(gmTalkWeekOf(state), 0)
  console.log('PASS year boundary: week', state.me!.week, 'year', state.year, 'AP', state.me!.ap, 'trust', gmTrustOf(state))
}
