/** Role builds and practice budget: npx tsx scripts/check_role_growth.ts */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents, talentsOf } from '../src/engine/me/career'
import { ROLE_TALENT_PRESETS, TALENT_PRESETS, TALENT_MAX, TALENT_POINTS } from '../src/engine/me/talent'
import { hourValues, practiceSplit, primaryFocus, runAction } from '../src/engine/me/growth'
import { autoPlan, practiceWithRoom, rolePractice, ROLE_PRACTICE } from '../src/engine/me/auto'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import { MECH_VALUE_MAX } from '../src/engine/me/bottleneck'
import { doAction, undoAction } from '../src/engine/me/week'
import { recomputeOverall, weightsFor } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Role } from '../src/engine/types'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear() },
fetch: () => Promise.reject(Error('offline role growth check')) })
const roles = Object.keys(ROLE_TALENT_PRESETS) as Role[]
const base = createCareer({ name: 'RolePractice', region: 'EMEA', year: 2026, start: 'chal', originKey: 'netcafe',
  seed: 901, role: '先锋', talents: emptyTalents() })
function fresh(role: Role, pro = true, caps = true, hurt = false): GameState {
  const s = structuredClone(base), me = s.me!, p = s.players[me.id]
  p.role = role
  me.phase = pro ? 'pro' : 'pre'; me.plan = {}; me.ap = me.apMax; me.weekDone = []; me.pending = []
  me.quests = []; p.fatigue = 0; p.injuredUntil = 0
  for (const k of ATTR_KEYS) { p.attrs[k] = 55; p.xp[k] = 0 }
  p.caps = caps ? { aim: 80, reaction: 80, awareness: 80, utility: 80, clutch: 80, teamwork: 80, communication: 80, igl: 80 } : undefined
  p.potential = 99; recomputeOverall(p)
  me.trainWeek = { week: me.week, g: 10 }
  if (hurt) { p.injuredUntil = s.day + 14; p.injuryNote = '手腕劳损'; me.injury = { kind: 'wrist', from: s.day, played: 0 } }
  return s
}
let comparisons = 0
for (const x of [...TALENT_PRESETS, ...Object.values(ROLE_TALENT_PRESETS)]) {
  assert.equal(Object.values(x.t).reduce((a, b) => a + b, 0), TALENT_POINTS, x.key)
  assert.ok(ATTR_KEYS.every(k => Number.isInteger(x.t[k]) && x.t[k] >= 0 && x.t[k] <= TALENT_MAX), x.key)
}
assert.deepEqual(TALENT_PRESETS.map(x => x.key), ['gun', 'util', 'clutch', 'igl', 'even'])
assert.deepEqual(TALENT_PRESETS.find(x => x.key === 'even')!.t, emptyTalents())
for (const role of roles) {
  for (const key of ['aim', 'vod', 'util'] as const) {
    const split = practiceSplit({ role }, key)
    assert.ok(Math.abs(Object.values(split).reduce((a, b) => a + b, 0) - 1) < 1e-12)
    assert.ok(Object.values(split).every(x => x > 0 && x <= 0.65))
  }
  for (const pro of [false, true]) for (const caps of [false, true]) for (const hurt of [false, true]) {
    for (const key of ['aim', 'vod', 'util', 'ranked', 'scrim'] as const) {
      if (!pro && key === 'scrim') continue
      const s = fresh(role, pro, caps, hurt), p = s.players[s.me!.id], w = weightsFor(p)
      const snapshot = JSON.stringify(s)
      const expected = hourValues(s).find(h => h.key === key)!.perPoint
      assert.equal(JSON.stringify(s), snapshot, 'Preview must be pure, including legacy injury lookup')
      runAction(s, key)
      const actual = ATTR_KEYS.reduce((sum, k) => sum + (p.xp[k] ?? 0) * w[k], 0) / 10 / ACTION_BY_KEY[key].cost
      assert.ok(Math.abs(expected - actual) < 1e-10, `${role}/${key}/pro=${pro}/caps=${caps}/hurt=${hurt}: ${expected} != ${actual}`)
      assert.equal(p.fatigue, ACTION_BY_KEY[key].fatigue)
      comparisons++
    }
  }
  const s = fresh(role), p = s.players[s.me!.id]
  const caps = JSON.stringify(p.caps), talent = JSON.stringify(talentsOf(s))
  const before = JSON.stringify({ attrs: p.attrs, xp: p.xp, ap: s.me!.ap, fatigue: p.fatigue })
  assert.equal(doAction(s, 'util'), null)
  assert.equal(s.me!.ap, s.me!.apMax - ACTION_BY_KEY.util.cost)
  assert.equal(undoAction(s, 'util'), null)
  const restored = s.players[s.me!.id]
  assert.equal(JSON.stringify({ attrs: restored.attrs, xp: restored.xp, ap: s.me!.ap, fatigue: restored.fatigue }), before)
  assert.equal(JSON.stringify(restored.caps), caps)
  assert.equal(JSON.stringify(talentsOf(s)), talent)
  // Old saves infer talents from their existing caps; neither a recommendation
  // nor a role preset is allowed to replace them.
  delete s.me!.talents
  const legacy = JSON.stringify(talentsOf(s))
  hourValues(s)
  assert.equal(JSON.stringify(talentsOf(s)), legacy)
  assert.equal(JSON.stringify(restored.caps), caps)
  for (const k of ATTR_KEYS) { restored.attrs[k] = restored.caps![k]; restored.xp[k] = 0 }
  for (const k of ATTR_KEYS) s.me!.bottleneck!.mechV![k] = MECH_VALUE_MAX
  recomputeOverall(restored)
  for (const key of ['aim', 'vod', 'util'] as const) runAction(s, key)
  assert.ok(ATTR_KEYS.every(k => restored.xp[k] === 0 && restored.attrs[k] === restored.caps![k]), 'No banking at caps')
  assert.equal(practiceWithRoom(s, 'util'), null, 'All capped with no live breakthrough or quest must not train')
}
for (const role of roles) {
  const s = fresh(role), p = s.players[s.me!.id]
  const team = s.teams[s.myTeam]
  team.starters = [p.id, ...team.starters.filter(x => x !== p.id)].slice(0, 5)
  s.fixtures = []; s.me!.talents = emptyTalents(); s.me!.fans = 1000
  autoPlan(s, false)
  assert.ok(s.me!.ap >= 0 && s.me!.ap <= s.me!.apMax)
  if (role === '先锋' || role === '控场' || role === '哨卫') {
    assert.ok((s.me!.plan.util ?? 0) > 0, `${role} must receive utility practice`)
    assert.equal(s.me!.plan.aim ?? 0, 0, `${role} must not have unconditional aim tail`)
  }
  const first = primaryFocus({ ...s.me!, plan: { util: 1 } }, p)
  assert.equal(first, 'utility')
}
assert.deepEqual(ROLE_PRACTICE.决斗者, ['vod', 'aim'])
for (const role of roles) {
  const s = fresh(role), p = s.players[s.me!.id]
  p.attrs.awareness = p.attrs.utility = 80
  const baseTail = ROLE_PRACTICE[role]
  assert.deepEqual(rolePractice(p, 2), baseTail)
  if (role === '先锋' || role === '控场' || role === '哨卫') {
    assert.deepEqual(rolePractice(p, 3), [baseTail[0], 'aim'])
    assert.deepEqual(rolePractice(p, 3, true), baseTail, 'Keep a live breakthrough tail')
    p.attrs.aim = p.attrs.reaction = 68
    assert.deepEqual(rolePractice(p, 3), [baseTail[0], 'aim'], 'Exact 12-point gap qualifies')
    assert.deepEqual(rolePractice(p, 7), [baseTail[0], 'aim'], 'Four-week stable cadence')
    for (const week of [4, 5, 6]) assert.deepEqual(rolePractice(p, week), baseTail)
    p.attrs.aim = p.attrs.reaction = 68.01
    assert.deepEqual(rolePractice(p, 3), baseTail, 'Below 12-point gap does not qualify')
    p.attrs.aim = p.caps!.aim; p.attrs.reaction = p.caps!.reaction
    assert.deepEqual(rolePractice(p, 3), baseTail)
    p.attrs.aim = p.attrs.reaction = 70
    assert.deepEqual(rolePractice(p, 3), baseTail, 'A small gun gap is not an excuse to replace role practice')
  } else assert.deepEqual(rolePractice(p, 3), baseTail)
}
{
  const s = fresh('控场'), p = s.players[s.me!.id], me = s.me!
  const team = s.teams[s.myTeam]
  team.starters = [p.id, ...team.starters.filter(x => x !== p.id)].slice(0, 5)
  me.week = 3; me.trainWeek = { week: me.week, g: 10 }; me.talents = { ...ROLE_TALENT_PRESETS.控场.t }; me.fans = 1000; s.fixtures = []
  p.attrs.awareness = p.attrs.utility = 75
  autoPlan(s)
  assert.equal(me.plan.aim, 1, 'Role talent does not immediately overwrite its one scheduled gun catch-up')
  assert.ok((me.plan.util ?? 0) >= 1, 'Catch-up retains role practice in the other slots')
}
{
  const s = fresh('控场'), p = s.players[s.me!.id], me = s.me!
  const team = s.teams[s.myTeam]
  team.starters = [p.id, ...team.starters.filter(x => x !== p.id)].slice(0, 5)
  me.week = 3; me.trainWeek = { week: me.week, g: 10 }; me.talents = emptyTalents(); me.fans = 1000; s.fixtures = []
  p.attrs.awareness = p.caps!.awareness; p.attrs.utility = 75
  me.bottleneck!.mechV!.awareness = 0
  autoPlan(s, false)
  assert.ok((me.plan.vod ?? 0) > 0, 'Actual autoplan keeps awareness breakthrough session ahead of gun catch-up')
}
console.log(`PASS: 10 preset budgets, ${comparisons} XP/preview cases across 5 roles, role auto plans, legacy caps/talents, AP/fatigue, undo and capped no-banking`)
