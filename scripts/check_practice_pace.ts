import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { addXp, gainBase, practicePace } from '../src/engine/me/growth'
import { Rng } from '../src/engine/rng'
import type { Player, Team } from '../src/engine/types'

const state = createCareer({ name: '成长验收', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', year: 2026, seed: 2701 })
const p = state.players[state.me!.id]
const original = structuredClone(p)
for (const [overall, expected] of [[60, 1.4], [80, 1.4], [85, 1.2], [90, 1], [99, 1]]) {
  assert.equal(practicePace({ overall, caps: p.caps }), expected)
  assert.equal(practicePace({ overall }), 1, 'No change to legacy no-caps path')
}
assert.deepEqual(p, original, 'Reading the multiplier cannot alter the player')
const team = { facilities: 55, coach: null } as unknown as Team
for (const age of [18, 24, 29]) for (const fatigue of [0, 46, 71]) {
  const a = structuredClone(p)
  a.age = age; a.fatigue = fatigue; a.overall = 75
  for (const k of Object.keys(a.attrs) as (keyof Player['attrs'])[]) a.caps![k] = 99
  const b = structuredClone(a); b.overall = 90
  const ratio = gainBase(a, team, new Rng(91)) / gainBase(b, team, new Rng(91))
  assert.ok(Math.abs(ratio - 1.4) < 1e-9, 'Age/fatigue penalties remain proportional')
}
for (const k of Object.keys(p.attrs) as (keyof Player['attrs'])[]) {
  p.attrs[k] = p.caps![k]
  p.xp[k] = 0
}
assert.equal(gainBase(p, team, new Rng(91)), 0, 'No training beyond personal ceilings')
addXp(p, 'aim', 1000)
assert.equal(p.attrs.aim, p.caps!.aim)
assert.equal(p.xp.aim, 0, 'No XP bank at the ceiling')
console.log('PASS: developing-player pace, taper, legacy isolation, condition and ceiling guards')
