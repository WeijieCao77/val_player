import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import {
  chooseSecondary, normalizePositionTraining, runScheduledSecondary,
  secondaryMastery, secondaryTrainingBlock, setSecondaryAuto, trainSecondary
} from '../src/engine/me/secondaryRole'
import { advanceUntil, autoPlan, autoWeek, runAutoPilot } from '../src/engine/me/auto'
import { doAction, undoAction } from '../src/engine/me/week'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { beginAbsence } from '../src/engine/me/absence'
import type { GameState, Role } from '../src/engine/types'

const mem = new Map<string, string>()
let deniedFetches = 0
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => mem.set(k, v),
    removeItem: (k: string) => mem.delete(k)
  },
  fetch: () => { deniedFetches++; return Promise.reject(new Error('offline')) }
})

const fresh = (seed = 9001, role: Role = '决斗者') => createCareer({
  name: 'auto', region: 'EMEA', role, year: 2026, start: 'pre',
  originKey: 'netcafe', talents: emptyTalents(), seed
})

function prep(s: GameState): GameState {
  const me = s.me!, p = s.players[me.id]
  me.week = 26; me.weekDay = 0; me.ap = me.apMax
  me.weekDone = []; me.plan = {}; me.trainWeek = undefined
  me.pending = []; me.duelLive = undefined; me.pendingFixture = undefined
  me.dueFixture = undefined; me.tryout = undefined; me.trial = undefined
  me.deals = []; me.moveAfter = undefined
  if (me.pitch) me.pitch.out = undefined
  if (me.pre.cup) me.pre.cup.alive = false
  delete s.gameOver
  p.injuredUntil = 0; p.fatigue = 0
  return s
}

// runScheduledSecondary false leaves full JSON untouched (snapshot after fixture edit)
const blocked = prep(fresh())
chooseSecondary(blocked, '先锋')
setSecondaryAuto(blocked, true)
blocked.me!.pendingFixture = 'now'
const blockedSnap = JSON.stringify(blocked)
assert.equal(runScheduledSecondary(blocked), false)
assert.equal(JSON.stringify(blocked), blockedSnap)

// opt-in changes only autoTrain flag
const opt = prep(fresh())
chooseSecondary(opt, '先锋')
const optBefore = JSON.parse(JSON.stringify(opt))
delete optBefore.me.positionTraining.autoTrain
assert.equal(setSecondaryAuto(opt, true), null)
const optAfter = JSON.parse(JSON.stringify(opt))
delete optAfter.me.positionTraining.autoTrain
assert.equal(JSON.stringify(optAfter), JSON.stringify(optBefore))
assert.equal(opt.me!.positionTraining!.autoTrain, true)

// default absent/false autoPlan does not auto-train secondary
const defaultPair = prep(fresh())
assert.equal(chooseSecondary(defaultPair, '先锋'), null)
const defaultAbsent = structuredClone(defaultPair), defaultFalse = structuredClone(defaultPair)
delete defaultAbsent.me!.positionTraining!.autoTrain
defaultFalse.me!.positionTraining!.autoTrain = false
assert.equal(autoPlan(defaultAbsent), autoPlan(defaultFalse))
delete defaultFalse.me!.positionTraining!.autoTrain
assert.deepEqual(defaultAbsent, defaultFalse, 'off and legacy absent preserve full state and RNG path')
for (const flag of [undefined, false]) {
  const s = prep(fresh())
  chooseSecondary(s, '先锋')
  if (flag === undefined) delete s.me!.positionTraining!.autoTrain
  else s.me!.positionTraining!.autoTrain = false
  const m0 = secondaryMastery(s)
  autoPlan(s)
  assert.equal(secondaryMastery(s), m0)
  assert.equal(s.me!.positionTraining!.trainedWeek, undefined)
  assert.equal(s.me!.positionTraining!.autoTrainedWeek, undefined)
}

// exact manual cost, no attrs/XP/caps, no role change, once per week, no auto marker
const t = prep(fresh())
chooseSecondary(t, '先锋')
const me = t.me!, p = t.players[me.id]
const ap = me.ap, fatigue = p.fatigue, mastery = secondaryMastery(t)
const stats = JSON.stringify({ attrs: p.attrs, caps: p.caps, xp: p.xp, overall: p.overall, potential: p.potential, role: p.role })
assert.equal(trainSecondary(t), null)
assert.equal(me.ap, ap - 2)
assert.equal(p.fatigue, fatigue + 4)
assert.equal(secondaryMastery(t), mastery + 2)
assert.equal(JSON.stringify({ attrs: p.attrs, caps: p.caps, xp: p.xp, overall: p.overall, potential: p.potential, role: p.role }), stats)
assert.equal(me.positionTraining!.trainedWeek, 26)
assert.equal(me.positionTraining!.autoTrainedWeek, undefined)
assert.equal(p.role, '决斗者')
assert.ok(trainSecondary(t), 'once per week')
assert.ok(secondaryTrainingBlock(t), 'blocked same week')

// injury, absence, pending, gameOver, insufficient AP all block runScheduledSecondary without mutation
const blockers: [string, (s: GameState) => void][] = [
  ['injury', s => { s.players[s.me!.id].injuredUntil = s.day + 3 }],
  ['absence', s => { beginAbsence(s, 'family', 30, '家中事务') }],
  ['pending', s => { s.me!.pending = [{ kind: 'event', id: 'x', day:s.day }] }],
  ['gameOver', s => { s.gameOver = 'fixture ended' }],
  ['insufficientAP', s => { s.me!.ap = 1 }],
  ['fatigue', s => { s.players[s.me!.id].fatigue = 97 }],
  ['nondelegated decision', s => { s.me!.pending = [{kind:'deal',id:'waiting',day:s.day}] }],
  ['malformed opt-in', s => { s.me!.positionTraining!.autoTrain = 'yes' as never }]
]
for (const [name, edit] of blockers) {
  const x = prep(fresh())
  chooseSecondary(x, '先锋')
  setSecondaryAuto(x, true)
  edit(x)
  const snap = JSON.stringify(x)
  assert.equal(runScheduledSecondary(x), false, name)
  assert.equal(JSON.stringify(x), snap, name)
}

// normalize strict boolean, correct legacy target, future markers cleared
const n = fresh()
const nme = n.me!, np = n.players[nme.id]
nme.week = 30
np.roles = ['决斗者', '先锋']
nme.positionTraining = { home: '决斗者', secondary: '自由人', trainedWeek: 99, switchedWeek: 99, autoTrain: true as never, autoTrainedWeek: 99 }
normalizePositionTraining(n)
assert.equal(nme.positionTraining!.secondary, '先锋')
assert.equal(nme.positionTraining!.trainedWeek, undefined)
assert.equal(nme.positionTraining!.switchedWeek, undefined)
assert.equal(nme.positionTraining!.autoTrainedWeek, undefined)
assert.notEqual(nme.positionTraining!.autoTrain, true)

// doAction/undo seals prior, later vod undo preserves mastery
const u = prep(fresh())
chooseSecondary(u, '先锋')
assert.equal(doAction(u, 'aim'), null)
assert.equal(trainSecondary(u), null)
assert.ok(undoAction(u, 'aim'), 'previous aim sealed by secondary')
assert.equal(doAction(u, 'vod'), null)
assert.equal(undoAction(u, 'vod'), null)
assert.equal(secondaryMastery(u), 2)

// pack/unpack/migrate no refund from 98 to 100, markers preserved
const m = prep(fresh())
chooseSecondary(m, '先锋')
setSecondaryAuto(m, true)
const mp = m.players[m.me!.id]
mp.rolePro = { ...mp.rolePro, '先锋': 98 }
const apM = m.me!.ap, fatigueM = mp.fatigue
const statsM = structuredClone({attrs:mp.attrs,xp:mp.xp,caps:mp.caps,role:mp.role})
assert.equal(runScheduledSecondary(m), true)
assert.equal(secondaryMastery(m), 100)
assert.deepEqual({attrs:mp.attrs,xp:mp.xp,caps:mp.caps,role:mp.role},statsM)
assert.equal(mp.rolePro['先锋'], 100)
assert.equal(m.me!.positionTraining!.autoTrain, false)
assert.equal(m.me!.positionTraining!.autoTrainedWeek, 26)
const reloaded = migratePlayerSave(unpackState(packState(m)))
assert.equal(secondaryMastery(reloaded), 100)
assert.equal(reloaded.me!.ap, apM - 2)
assert.equal(reloaded.players[reloaded.me!.id].fatigue, fatigueM + 4)
assert.deepEqual(reloaded.me!.positionTraining, m.me!.positionTraining)
assert.equal(reloaded.players[reloaded.me!.id].rolePro['先锋'], 100)
const fullSnapshot = JSON.stringify(reloaded)
assert.equal(runScheduledSecondary(reloaded), false)
assert.equal(JSON.stringify(reloaded), fullSnapshot, 'no repeat or refund after certification reload')
advanceUntil(reloaded, 'month')
assert.ok((reloaded.me!.weekDone?.length ?? 0)+(reloaded.me!.lastWeekDone?.length ?? 0)>0,
  'certified auto-off scheduled-only week still allocates ordinary actions after reload')

// autoPlan trains before ordinary actions and uses remaining AP
const order = prep(fresh())
chooseSecondary(order, '先锋')
setSecondaryAuto(order, true)
const ome = order.me!, op = order.players[ome.id]
ome.ap = 8
const apO = ome.ap, fatigueO = op.fatigue, masteryO = secondaryMastery(order)
const statsO = JSON.stringify({ attrs: op.attrs, caps: op.caps, xp: op.xp, overall: op.overall, potential: op.potential })
const orderLine = autoPlan(order)
assert.match(orderLine,/副位置训练/)
assert.equal(secondaryMastery(order), masteryO + 2)
assert.ok(ome.ap < apO - 2, 'ordinary actions used remaining AP after secondary')
assert.notEqual(JSON.stringify({ attrs: op.attrs, caps: op.caps, xp: op.xp, overall: op.overall, potential: op.potential }), statsO, 'ordinary training has real growth; isolated secondary no-freebie check is above')
assert.equal(ome.positionTraining!.trainedWeek, 26)
assert.equal(ome.positionTraining!.autoTrainedWeek, 26)
assert.equal(op.role, '决斗者')

// advanceUntil scheduledOnly actually trains and logs last after weekly reset
const adv = prep(fresh())
chooseSecondary(adv, '先锋')
setSecondaryAuto(adv, true)
const masteryAdv0 = secondaryMastery(adv)
runAutoPilot(adv)
assert.equal(adv.me!.ap,adv.me!.apMax-2)
const res = advanceUntil(adv, 'month')
assert.ok(res.weeks >= 0)
assert.ok((adv.me!.weekDone?.length ?? 0)+(adv.me!.lastWeekDone?.length ?? 0)>0,'scheduled-only week still performs ordinary actions')
assert.ok(secondaryMastery(adv) > masteryAdv0)
assert.ok((adv.me!.autoNotes ?? []).some(n => n.includes('副位置训练')))
assert.ok(adv.me!.log.some(l => l.text.includes('副位置训练：')))

// auto off + manual partial: advanceUntil must not auto-fill secondary
const partial = prep(fresh())
chooseSecondary(partial, '先锋')
partial.me!.positionTraining!.autoTrain = false
assert.equal(doAction(partial, 'aim'), null)
const partialMastery0 = secondaryMastery(partial)
advanceUntil(partial, 'month')
assert.equal(secondaryMastery(partial), partialMastery0)
assert.equal(partial.me!.positionTraining!.trainedWeek, undefined)
assert.equal(partial.me!.positionTraining!.autoTrainedWeek, undefined)
assert.ok(!(partial.me!.autoNotes ?? []).some(n => n.includes('副位置训练')))

// real 52-week natural pair, same seed, autoWeek only, no manual week/AP/health resets
function natural(enabled: boolean): { trainings: number; mastery: number; week: number } {
  const s = fresh(7133)
  let enabledOnce = false
  let trainings = 0
  const trainedWeeks = new Set<number>()
  for (let i = 0; i < 52; i++) {
    const me = s.me!, p = s.players[me.id]
    const week = me.week
    if (week >= 26 && !me.positionTraining?.secondary) {
      const why = chooseSecondary(s, '先锋')
      if (!why && enabled && !enabledOnce) {
        assert.equal(setSecondaryAuto(s, true), null)
        enabledOnce = true
      }
    } else if (enabled && me.positionTraining?.secondary && !enabledOnce && secondaryMastery(s) < 100) {
      assert.equal(setSecondaryAuto(s, true), null)
      enabledOnce = true
    }
    const masteryBefore = secondaryMastery(s)
    const stop = autoWeek(s)
    assert.equal(stop.kind, 'week-end')
    assert.equal(me.week, week + 1)
    const masteryAfter = secondaryMastery(s)
    if (masteryAfter > masteryBefore) {
      trainings++
      assert.ok(!trainedWeeks.has(week), 'duplicate week training')
      trainedWeeks.add(week)
      assert.equal(me.positionTraining!.trainedWeek, week)
      assert.equal(me.positionTraining!.autoTrainedWeek, week)
    }
    assert.ok(me.ap >= 0 && me.ap <= me.apMax)
    assert.ok(p.fatigue >= 0)
  }
  assert.equal(s.me!.week, 52)
  assert.ok(s.year > 2026, '52 real weeks cross the year boundary')
  if (enabled) assert.ok(trainings >= 10)
  else assert.equal(trainings, 0)
  console.log('NATURAL',JSON.stringify({enabled,year:s.year,week:s.me!.week,trainings,mastery:secondaryMastery(s)}))
  return { trainings, mastery: secondaryMastery(s), week: s.me!.week }
}

const off = natural(false)
const on = natural(true)
assert.equal(off.trainings, 0)
assert.equal(off.mastery, 0)
assert.ok(on.trainings >= 10)
assert.ok(on.mastery >= 20)
assert.ok(deniedFetches >= 0)
console.log('PASS check_secondary_auto')
