import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import countries from '../src/data/player_country_fixes.json'
import bios from '../src/data/player_bio_fixes.json'
import { playerLocation } from '../src/engine/me/playerLocation'

// Synthetic local careers only: no online page, telemetry, or user storage.
for (const year of [2021, 2026] as const) {
  // Normalize existing unrelated save migrations (legacy trust removal and
  // potentialRevisions default) before isolating identity-repair effects.
  const state = migratePlayerSave(createCareer({ name: '身份回归', region: 'China', role: 'duelist',
    talents: emptyTalents(), originKey: 'net', start: 'pre', year, seed: 79 }))
  const meBefore = structuredClone(state.players[state.me!.id])
  const fixture = state.players.V3520
  assert.ok(fixture, 'ZmjjKK exists in both historical starts')
  assert.equal(playerLocation(fixture, fixture.teamId ? state.teams[fixture.teamId] : null, year).nationality, '国籍/地区：中国')

  const country = countries.fixes[0]
  const countryId = `V${country.pid}`
  state.players[countryId] = { ...structuredClone(fixture), id: countryId, nat: country.from }
  const b = bios.players['8582']
  state.players.V8582 = { ...structuredClone(fixture), id: 'V8582', ign: 'Laz',
    realName: b.oldNames[0], birth: b.oldBirths.find(x => !!x) ?? null,
    age: 29, ageEstimated: false }
  const contractBefore = { teamId: state.players.V8582.teamId, salary: state.players.V8582.salary,
    attrs: structuredClone(state.players.V8582.attrs), career: structuredClone(state.players.V8582.career) }
  const loaded = migratePlayerSave(unpackState(packState(state)))
  assert.equal(loaded.players[countryId].nat, country.to)
  assert.equal(loaded.players.V8582.realName, b.name)
  assert.equal(loaded.players.V8582.birth, null)
  assert.equal(loaded.players.V8582.ageEstimated, true)
  assert.equal(loaded.players.V8582.age, 29, 'do not rewrite evolved age without a verified birthday')
  assert.deepEqual({ teamId: loaded.players.V8582.teamId, salary: loaded.players.V8582.salary,
    attrs: loaded.players.V8582.attrs, career: loaded.players.V8582.career }, contractBefore)
  assert.deepEqual(loaded.players[loaded.me!.id], meBefore, 'main character stays unchanged')
  const once = packState(loaded)
  assert.equal(packState(migratePlayerSave(unpackState(once))), once, 'repeat load is byte-stable')
}
console.log('PASS identity integration: 2021/2026 new careers, serialized legacy repairs, unchanged career, repeat-load stability')
