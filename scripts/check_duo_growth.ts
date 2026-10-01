/** #22e39114: light duo practice, through the real action and autopilot paths. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { duoMate, runAction } from '../src/engine/me/growth'
import { autoPlan } from '../src/engine/me/auto'
import { doAction, undoAction } from '../src/engine/me/week'
import { bondBetween } from '../src/engine/bonds'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(Error('offline duo check')) })
const base = createCareer({ name: 'DuoCheck', region: 'EMEA', role: '决斗者', talents: emptyTalents(),
  originKey: 'netcafe', start: 't1', year: 2026, seed: 2214 })
const fresh = () => {
  const s = structuredClone(base), me = s.me!, p = s.players[me.id]
  me.plan = {}; me.ap = me.apMax = 12; me.weekDone = []; me.pending = []; me.quests = []
  me.chain = undefined; me.fans = 1000; me.stream.deal = undefined; me.courses = []
  p.age = 24; p.fatigue = 0; p.injuredUntil = 0; me.injury = undefined
  for (const k of ATTR_KEYS) { p.attrs[k] = 55; p.caps![k] = 63; p.xp[k] = 0 }
  recomputeOverall(p)
  me.trainWeek = { week: me.week, g: 10 }
  s.fixtures = []
  s.teams[s.myTeam].starters = [me.id, ...s.teams[s.myTeam].starters.filter(id => id !== me.id)].slice(0, 5)
  return s
}
const near = (actual: number | undefined, expected: number) => assert.ok(Math.abs((actual ?? 0) - expected) < 1e-9, `${actual} != ${expected}`)
const combat = ['aim', 'reaction', 'clutch'] as const
const s = fresh(), me = s.me!, p = s.players[me.id], mate = duoMate(s)!
assert.ok(mate)
const bond = bondBetween(s, me.id, mate.id)
assert.equal(doAction(s, 'duo'), null)
for (const k of combat) near(p.xp[k], 0.5)
near(p.xp.communication, 3)
assert.ok(bondBetween(s, me.id, mate.id) > bond, 'relationship benefit preserved')
assert.equal(p.fatigue, 2); assert.equal(me.ap, 11); assert.equal(me.plan.duo, 1)
assert.equal(undoAction(s, 'duo'), null)
for (const k of [...combat, 'communication'] as const) near(s.players[me.id].xp[k], 0)
assert.equal(bondBetween(s, me.id, mate.id), bond)

for (const key of ['ranked', 'aim', 'vod'] as const) {
  const t = fresh(), player = t.players[t.me!.id]
  runAction(t, key)
  if (key === 'ranked') {
    const gains = Object.values(player.xp).filter(x => x! > 0)
    assert.equal(gains.length, 3); gains.forEach(x => near(x, 1.8))
  } else {
    const attrs = key === 'aim' ? ['aim', 'reaction'] as const : ['clutch'] as const
    for (const k of attrs) assert.ok(player.xp[k]! / 2 > 0.5, `${key}/${k}: specialist better per AP`)
  }
}
const capped = fresh(), cp = capped.players[capped.me!.id]
cp.attrs.aim = cp.caps!.aim; cp.xp.aim = 99
const capsBefore = structuredClone(cp.caps)
runAction(capped, 'duo')
assert.equal(cp.xp.aim, 0); assert.equal(cp.attrs.aim, cp.caps!.aim)
near(cp.xp.reaction, 0.5); near(cp.xp.clutch, 0.5)
assert.deepEqual(cp.caps, capsBefore, 'no ceiling movement or rerouting capped share')
const close = fresh(), closeP = close.players[close.me!.id]
closeP.attrs.aim = closeP.caps!.aim - 1; closeP.xp.aim = 99.99
runAction(close, 'duo'); assert.equal(closeP.attrs.aim, closeP.caps!.aim); assert.equal(closeP.xp.aim, 0)
for (const kind of ['old', 'hurt'] as const) {
  const t = fresh(), player = t.players[t.me!.id]
  if (kind === 'old') player.age = 30
  else { player.injuredUntil = t.day + 14; player.injuryNote = '手腕劳损'; t.me!.injury = { kind: 'wrist', from: t.day, played: 0 } }
  runAction(t, 'duo')
  for (const k of ['aim', 'reaction'] as const) assert.ok(player.xp[k]! > 0 && player.xp[k]! < 0.5, kind)
}
for (const target of ['missing', 'self'] as const) {
  const t = fresh(); t.me!.duoWith = target === 'self' ? t.me!.id : 'stale-id'
  runAction(t, 'duo')
  assert.notEqual(t.me!.duoWith, t.me!.id)
  for (const k of combat) near(t.players[t.me!.id].xp[k], 0.5)
}
const alone = fresh(); alone.teams[alone.myTeam].roster = [alone.me!.id]; alone.me!.duoWith = alone.me!.id
runAction(alone, 'duo')
for (const k of combat) near(alone.players[alone.me!.id].xp[k], 0)
near(alone.players[alone.me!.id].xp.communication, 3)

// Autopilot already schedules duo for communication talent. Compare its actual
// booked plan to manual execution: no separate reward and no weekly double-pay.
const auto = fresh(); auto.me!.talents = { ...emptyTalents(), communication: 10 }
const manual = structuredClone(auto)
autoPlan(auto)
assert.ok((auto.me!.plan.duo ?? 0) > 0, 'fixture must actually schedule duo')
for (const [key, count] of Object.entries(auto.me!.plan)) for (let i = 0; i < count!; i++) {
  manual.me!.duoWith = auto.me!.duoWith
  assert.equal(doAction(manual, key as MeAction), null)
}
for (const k of ATTR_KEYS) near(auto.players[auto.me!.id].xp[k], manual.players[manual.me!.id].xp[k] ?? 0)
assert.equal(auto.me!.ap, manual.me!.ap)
console.log('PASS duo growth: g=10 -> aim/reaction/clutch 0.5 each, communication 3; ranked 1.8 each; caps, injury, age, teammate fallback, undo, autopilot')
