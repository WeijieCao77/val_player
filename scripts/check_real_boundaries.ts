import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { expectedSalary } from '../src/engine/player'
import { refreshMyRounds } from '../src/engine/me/coach'
import { familyLocked, setFamily, takeBreak, outletWeek, outletSeason, autoOutlets, outletRecap } from '../src/engine/me/outlets'
import { checkAchievements } from '../src/engine/me/achievements'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import type { MeState } from '../src/engine/me/types'
import type { GameState } from '../src/engine/types'

const opts = { name: 'probe', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'real', start: 't1', seed: 7 } as const
function noRemovedPlayer(s: GameState) {
  assert.equal(s.players.V4710, undefined)
  for (const t of Object.values(s.teams)) {
    assert.ok(!t.roster.includes('V4710') && !t.starters.includes('V4710') && t.igl !== 'V4710')
  }
}
function familyState(me: MeState) {
  me.money = 5_000_000
  me.out = { family: 1, familySent: 999999, meets: [], scholar: [], breaks: [], studio: 0 }
}
for (const [scenario, id, rounds] of [
  ['zmjjkk-2024', 'V3520', 770], ['demon1-2023', 'V26171', 0], ['boaster-2023', 'V438', 638],
] as const) {
  const s = createCareer({ ...opts, scenario })
  const me = s.me!, p = s.players[me.id]
  assert.equal(me.id, id)
  noRemovedPlayer(s)
  assert.equal(p.rounds, rounds)
  refreshMyRounds(s)
  assert.equal(p.rounds, rounds, 'refresh without matches must preserve opening evidence')
  assert.equal(p.salary, expectedSalary(p, 1))
  if (p.contract) assert.equal(p.contract.salary, p.salary)
  assert.equal(p.vlr, undefined)
  assert.equal(p.stageBonus, 0)
  if (scenario === 'demon1-2023') {
    checkAchievements(s)
    assert.ok(!me.achievements.includes('salary500k'), 'future salary must not grant an opening achievement')
    assert.equal(me.scenario!.profileRounds, null, 'unknown evidence stays unknown')
  }
  const loaded = migratePlayerSave(unpackState(packState(s)))
  const q = loaded.players[loaded.me!.id]
  assert.equal(q.rounds, rounds)
  assert.equal(q.salary, p.salary)
  assert.deepEqual(q.attrs, p.attrs)
  noRemovedPlayer(loaded)
  me.money = 5_000_000
  assert.notEqual(setFamily(s, 1), null)
  assert.notEqual(takeBreak(s, 'family'), null)
  familyState(me) // An older or malformed save cannot reactivate private narration.
  const cash = me.money, logCount = me.log.length
  outletWeek(s)
  assert.equal(me.money, cash)
  assert.equal(me.out!.familySent, 999999)
  outletSeason(s, s.year)
  assert.equal(me.log.length, logCount)
  assert.ok(!outletRecap(s)?.includes('往家里寄'))
  autoOutlets(s)
  assert.equal(me.out!.family, 1)
  assert.equal(me.out!.familySent, 999999)
  assert.ok(me.out!.breaks.every(b => b.key !== 'family'))
  console.log(`PASS ${scenario}: identity, evidence, salary, save/load and private-family boundaries`)
}
const ordinary = createCareer({ ...opts, originKey: 'radiant', year: 2026 })
const me = ordinary.me!
familyState(me)
assert.equal(familyLocked(ordinary, 2), null)
assert.equal(setFamily(ordinary, 2), null)
const cash = me.money, logCount = me.log.length
outletWeek(ordinary)
assert.ok(me.money < cash)
outletSeason(ordinary, ordinary.year)
assert.ok(me.log.length > logCount)
assert.ok(outletRecap(ordinary)?.includes('往家里寄'))
console.log('PASS ordinary career retains family payments and narration')
