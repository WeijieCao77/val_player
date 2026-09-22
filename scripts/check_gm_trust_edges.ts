// DeepSeek edge-test drafts with reviewed fixes for actual imports, fixture state and snapshot timing.
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { doAction, undoAction, undoWeek } from '../src/engine/me/week'
import { canUndo } from '../src/engine/me/undo'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { makeDeal, joinClub } from '../src/engine/me/contract'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

const whole = (s: GameState) => {
  const c = structuredClone(s)
  c.me!.weekStart = undefined as never
  return packState(c)
}

const base = createCareer({ name: 'gm edges', region: 'Europe', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
base.me!.ap = 12
base.me!.gmTrust = 60
base.me!.week = 20
base.fixtures = []
base.comps = {}
base.me!.pending = []

// Case A: real talk success, marker survives transfer
const a = structuredClone(base)
assert.equal(a.me!.managerTalkWeek, undefined)
assert.equal(a.me!.gmTrust, 60)
import { talkToManager, managerTalkWait } from '../src/engine/me/gmTrust'
import { beginAbsence } from '../src/engine/me/absence'
assert.equal(talkToManager(a), null)
assert.equal(a.me!.managerTalkWeek, 20)
assert.equal(a.me!.gmTrust, 63)
assert.equal(a.me!.ap, 10)
const activeClubId = Object.keys(a.teams).find(id => id !== a.myTeam && !a.teams[id].dormant)!
joinClub(a, makeDeal(a, activeClubId, 'sign', 'B', new Rng(8)), { quiet: true })
assert.equal(a.me!.managerTalkWeek, 20)
assert.equal(managerTalkWait(a), 4)
a.me!.week = 23
assert.equal(managerTalkWait(a), 1)
a.me!.week = 24
assert.equal(managerTalkWait(a), 0)
a.me!.ap = 12
a.me!.weekStart = undefined as never
a.me!.weekDone = []
assert.equal(talkToManager(a), null)
assert.equal(a.me!.managerTalkWeek, 24)
console.log('✓ Case A: talk success and transfer persistence')

// Case B: undo interactions
const b = structuredClone(base)
assert.equal(doAction(b, 'aim'), null)
assert.equal(talkToManager(b), null)
assert.equal(canUndo(b, 'aim'), false)
assert.deepEqual(undoWeek(b), [])
const bLoaded = migratePlayerSave(unpackState(packState(b)))
assert.equal(bLoaded.me!.managerTalkWeek, 20)
const bAfter = whole(bLoaded)
assert.equal(doAction(bLoaded, 'vod'), null)
assert.equal(undoAction(bLoaded, 'vod'), null)
assert.equal(whole(bLoaded), bAfter)
console.log('✓ Case B: undo does not touch manager talk')

// Case C: old save without marker migrates cleanly
const c = structuredClone(base)
delete c.me!.managerTalkWeek
const cMigrated = migratePlayerSave(unpackState(packState(c)))
assert.equal(managerTalkWait(cMigrated), 0)
assert.equal(talkToManager(cMigrated), null)
console.log('✓ Case C: old save migration')

// Case D: trust cap and failed talk immutability
const d = structuredClone(base)
d.me!.gmTrust = 79
assert.equal(talkToManager(d), null)
assert.equal(d.me!.gmTrust, 80)
assert.equal(d.me!.ap, 10)
const blocked = structuredClone(base)
blocked.me!.gmTrust = 100
const blockedBefore = JSON.stringify(blocked)
const originalNext = Rng.prototype.next
const originalRandom = Math.random
Rng.prototype.next = () => { throw new Error('no RNG') }
Math.random = () => { throw new Error('no Math.random') }
try {
  assert.notEqual(talkToManager(blocked), null)
} finally {
  Rng.prototype.next = originalNext
  Math.random = originalRandom
}
assert.equal(JSON.stringify(blocked), blockedBefore)
assert.equal(blocked.me!.gmTrust, 100)
console.log('✓ Case D: 79->80, 100 blocked, failed talk unchanged')

// --- Extra imports needed by this block ---
import { cloutOf, canSign, signTargets, cloutStage } from '../src/engine/me/clout'
import { windowAt, windowBlock } from '../src/engine/me/window'
import { eventsOf } from '../src/engine/circuit'

{
  // Standalone block: talk to manager never bypasses sign protections
  const original = createCareer({ name: '经理门槛', region: 'Europe', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021 })
  const openState = structuredClone(original)
  const me = openState.me!
  me.titles = Array.from({ length: 8 }, (_, i) => ({ year: 2021 - i, title: 'Champions', started: true }))
  me.fans = 4000
  me.coachTrust = 100
  me.gmTrust = 77
  me.ap = 12
  me.pending = []
  me.week = 20
  me.cloutCd = { list: 0, sign: 0 }
  assert.ok(cloutOf(openState) >= 66, 'decorated positive control clears prestige gate')
  // Find BOTH open and closed days using windowAt for the player's own club
  let closedDay = -1, openDay = -1
  const playerTeamId = openState.players[me.id].teamId!
  // Same drawn-event fixture as check_window.ts: a real regional Masters locks its entrants.
  const ev = eventsOf(2021).find(e => e.stage === 's1masters' && e.region === 'Europe')
  assert.ok(ev && ev.start != null && ev.end != null, 'actual regional Masters exists')
  const main = [...new Set(ev.units.filter(u => u.type !== 'open').flatMap(u => (u.nodes ?? []).flatMap(n => [n.a, n.b])).filter(slot => slot[0] === 's').map(slot => slot[1]))].sort((a, b) => a - b)
  assert.ok(main.length > 0, 'actual main-event seed exists')
  const seeds: (string | null)[] = Array.from({ length: Math.max(ev.seeds.length, main[main.length - 1] + 1) }, () => null)
  seeds[main[0]] = playerTeamId
  const key = `ev:${ev.id}`
  openState.comps = { [key]: { key, name: ev.cn, stage: ev.stage ?? 'offseason', teams: [playerTeamId], standings: {}, finished: [], format: 'circuit', circuit: { id: ev.id, start: ev.start, end: ev.end, seeds, mode: 'history' } } }
  for (let day = 0; day <= 363; day++) {
    const probe = { ...openState, day }
    const win = windowAt(probe, undefined, false)
    if (win.open) {
      if (openDay === -1) openDay = day
    } else {
      if (closedDay === -1) closedDay = day
    }
  }
  assert.ok(openDay !== -1, 'found an open window day')
  assert.ok(closedDay !== -1, 'found a closed window day')

  // On a closed day, talkToManager is allowed (communication) and raises gmTrust to 80
  const closedState = structuredClone(openState)
  closedState.day = closedDay
  assert.equal(talkToManager(closedState), null)
  assert.equal(Math.round(closedState.me.gmTrust), 80, 'talk raises gmTrust even during closed window')
  // canSign should still be false on closed day due to window
  const gateOnClosed = canSign(closedState)
  assert.equal(gateOnClosed.ok, false, 'cannot sign during closed window')
  assert.ok(windowAt(closedState).lock, 'actual event lock, not another failed requirement')
  assert.equal(gateOnClosed.why, `${windowBlock(closedState)}。签不了人。`, 'sign failure reports the actual roster lock')

  // On an open day, canSign should be true (all other conditions met)
  const openStateOnOpenDay = structuredClone(closedState)
  openStateOnOpenDay.day = openDay
  const gateOnOpen = canSign(openStateOnOpenDay)
  assert.equal(gateOnOpen.ok, true, 'can sign on open day with sufficient clout and gm trust')

  // Cooldown test: set sign cooldown to 4, advance weeks, use cloutStage
  const cooldownState = structuredClone(openStateOnOpenDay)
  cooldownState.me.cloutCd = { list: 0, sign: 4 }
  cooldownState.me.week += 4
  assert.equal(managerTalkWait(cooldownState), 0, 'weekly talk wait expired independently')
  // After advancing weeks (managerTalkWait becomes 0), canSign still false because cooldown remains
  const gateAfterAdvance = canSign(cooldownState)
  assert.equal(gateAfterAdvance.ok, false, 'sign cooldown still blocks after week advance')
  // cloutStage three times => sign cooldown = 1, still false
  cloutStage(cooldownState)
  cloutStage(cooldownState)
  cloutStage(cooldownState)
  assert.equal(cooldownState.me.cloutCd?.sign, 1, 'after 3 stages cooldown is 1')
  const gateAfterThree = canSign(cooldownState)
  assert.equal(gateAfterThree.ok, false, 'still blocked with cooldown 1')
  // Fourth cloutStage => sign cooldown = 0, canSign true
  cloutStage(cooldownState)
  assert.equal(cooldownState.me.cloutCd?.sign, 0, 'after 4 stages cooldown is 0')
  const gateAfterFour = canSign(cooldownState)
  assert.equal(gateAfterFour.ok, true, 'can sign after cooldown expires')

  // Budget test: budget 0 => signTargets must be empty (no bypass)
  const zeroBudgetState = structuredClone(openStateOnOpenDay)
  zeroBudgetState.teams[playerTeamId].budget = 0
  const targetsZero = signTargets(zeroBudgetState)
  assert.equal(targetsZero.length, 0, 'no targets when budget is zero')

  // Positive funded control: set budget high, signTargets length > 0 on actual open day
  const fundedState = structuredClone(openStateOnOpenDay)
  fundedState.teams[playerTeamId].budget = 1e12
  const targetsFunded = signTargets(fundedState)
  // May need to choose a day where other clubs' windows also open; if empty, try other open days
  if (targetsFunded.length === 0) {
    let foundTargets = false
    for (let day = 0; day <= 363; day++) {
      const probe = { ...fundedState, day }
      if (windowAt(probe, undefined, false).open) {
        const targets = signTargets(probe)
        if (targets.length > 0) {
          foundTargets = true
          break
        }
      }
    }
    assert.ok(foundTargets, 'found at least one day with sign targets when budget is funded')
  } else {
    assert.ok(targetsFunded.length > 0, 'positive funded control: signTargets non-empty')
  }

  // Low clout fresh career: titles[], fans0, attrs all 50, mates all 80, gmTrust 77 => talk raises to 80, cloutOf < 66, canSign false with prestige
  const lowState = structuredClone(original)
  const lowMe = lowState.me!
  lowMe.titles = []
  lowMe.fans = 0
  lowMe.coachTrust = 100
  lowMe.gmTrust = 77
  lowMe.ap = 12
  lowMe.pending = []
  lowMe.week = 20
  // Set player attrs all 50, all teammates attrs 80
  const lowPlayer = lowState.players[lowMe.id]
  for (const key of ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl'] as const) {
    lowPlayer.attrs[key] = 50
  }
  const lowTeam = lowState.teams[lowState.myTeam]
  for (const id of lowTeam.roster) {
    if (id !== lowMe.id) {
      const mate = lowState.players[id]
      for (const key of ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl'] as const) {
        mate.attrs[key] = 80
      }
    }
  }
  // talkToManager on low state to raise gmTrust
  assert.equal(talkToManager(lowState), null)
  assert.equal(Math.round(lowMe.gmTrust), 80)
  const cloutLow = cloutOf(lowState)
  assert.ok(cloutLow < 66, `clout should be below 66, got ${cloutLow}`)
  const gateLow = canSign(lowState)
  assert.equal(gateLow.ok, false, 'cannot sign with low clout')
  assert.ok(gateLow.why?.includes('威望'), 'reason mentions prestige')
}

console.log('✓ Case E: talk does not bypass prestige, transfer window, four-stage signing cooldown or budget; funded/open controls succeed')

// Regression: talkToManager AP is not represented in me.plan; migration must not refund it.
for (const beforeTraining of [false, true] as const) {
  const s = structuredClone(base)
  s.me!.plan = {}
  s.me!.weekDone = []
  if (beforeTraining) {
    assert.equal(doAction(s, 'aim'), null)
  }
  assert.equal(talkToManager(s), null)
  const after = {
    ap: s.me!.ap,
    gmTrust: s.me!.gmTrust,
    managerTalkWeek: s.me!.managerTalkWeek,
    plan: structuredClone(s.me!.plan),
    weekDone: structuredClone(s.me!.weekDone),
  }
  if (!beforeTraining) {
    assert.deepEqual(after.plan, {})
    assert.deepEqual(after.weekDone, [])
  }
  if (beforeTraining) assert.equal(canUndo(s, 'aim'), false)
  const loaded = migratePlayerSave(unpackState(packState(s)))
  assert.deepEqual({
    ap: loaded.me!.ap,
    gmTrust: loaded.me!.gmTrust,
    managerTalkWeek: loaded.me!.managerTalkWeek,
    plan: loaded.me!.plan,
    weekDone: loaded.me!.weekDone,
  }, after)
  const loaded2 = migratePlayerSave(unpackState(packState(loaded)))
  assert.deepEqual({
    ap: loaded2.me!.ap,
    gmTrust: loaded2.me!.gmTrust,
    managerTalkWeek: loaded2.me!.managerTalkWeek,
    plan: loaded2.me!.plan,
    weekDone: loaded2.me!.weekDone,
  }, after)
}
console.log('✓ Case F: talk AP not refunded by stale-plan migration')

{
  // Negative guards from managerTalkBlock: each category blocks without touching state or RNG
  const assertBlockedNoRng = (label: string, mutate: (s: GameState) => void) => {
    const s = structuredClone(base)
    mutate(s)
    const before = JSON.stringify(s)
    const originalNext = Rng.prototype.next
    const originalRandom = Math.random
    Rng.prototype.next = () => { throw new Error('no RNG') }
    Math.random = () => { throw new Error('no Math.random') }
    try {
      assert.notEqual(talkToManager(s), null, `${label} should be blocked`)
    } finally {
      Rng.prototype.next = originalNext
      Math.random = originalRandom
    }
    assert.equal(JSON.stringify(s), before, `${label} state unchanged`)
  }

  assertBlockedNoRng('phase pre', s => { s.me!.phase = 'pre' as never })
  assertBlockedNoRng('phase free', s => { s.me!.phase = 'free' as never })
  assertBlockedNoRng('phase retired', s => { s.me!.phase = 'retired' as never })
  assertBlockedNoRng('missing me', s => { delete (s as any).me })
  assertBlockedNoRng('missing player', s => { delete (s as any).players[s.me!.id] })
  assertBlockedNoRng('missing team', s => { delete (s as any).teams[s.myTeam] })
  assertBlockedNoRng('roster mismatch', s => { s.teams[s.myTeam].roster = s.teams[s.myTeam].roster.filter(id => id !== s.me!.id) })
  assertBlockedNoRng('invalid week', s => { s.me!.week = -1 })
  assertBlockedNoRng('long absence', s => { beginAbsence(s, 'family', 28, '边界测试缺席') })
  assertBlockedNoRng('active duel', s => { s.me!.duelLive = true as any })
  assertBlockedNoRng('active match', s => { s.me!.pendingFixture = {} as any })
  assertBlockedNoRng('active tryout', s => { s.me!.tryout = true as any })
  assertBlockedNoRng('pending event', s => { s.me!.pendingEvent = true as any })
  assertBlockedNoRng('pending queue', s => { s.me!.pending = [{ kind: 'event' }] as any })
  assertBlockedNoRng('trust invalid', s => { s.me!.gmTrust = -1 })
  assertBlockedNoRng('trust cap', s => { s.me!.gmTrust = 80 })
  assertBlockedNoRng('AP insufficient', s => { s.me!.ap = 1 })
  assertBlockedNoRng('cooldown', s => { s.me!.managerTalkWeek = s.me!.week })
}
console.log('✓ Negative managerTalk guards: every block category returns without RNG or state mutation')
