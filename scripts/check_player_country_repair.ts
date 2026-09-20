import assert from 'node:assert/strict'
import countryFixes from '../src/data/player_country_fixes.json'
import { repairPlayerCountries, repairPlayerTeamNames } from '../src/engine/me/playerDataRepair'
import { NAT_CN, natCountry, natName } from '../src/engine/nat'
import world from '../src/data/world.json'
import world2021 from '../src/data/world_2021.json'
import timeline from '../src/data/timeline.json'
import prospects from '../src/data/prospects.json'
import type { GameState, Player } from '../src/engine/types'

const fixes = countryFixes.fixes
assert.equal(fixes.length, 60)
assert.equal(new Set(fixes.map(f => f.pid)).size, 60)
const players = Object.fromEntries(fixes.map(f => [`V${f.pid}`, {
  id: `V${f.pid}`, ign: `Fixture-${f.pid}`, nat: f.from,
  region: 'Europe', teamId: 'unchanged-club', age: 27, overall: 81,
  attrs: { aim: 84 }, season: { matches: 9 }, clubHist: [{ team: 'past-club', from: 2022, to: 2024 }],
}])) as unknown as Record<string, Player>
const state = { players, me: { id: 'ME' } } as Pick<GameState, 'players' | 'me'>
const expected = structuredClone(state)
for (const f of fixes) expected.players[`V${f.pid}`].nat = f.to
assert.equal(repairPlayerCountries(state), 60)
assert.deepEqual(state, expected, 'only nat may change on the exact proven records')
assert.equal(repairPlayerCountries(state), 0, 'idempotent')

const fix = fixes[0]
const id = `V${fix.pid}`
for (const kind of ['own-id', 'fictional', 'ME', 'other-id', 'map-id-mismatch', 'manual-nat', 'correct-nat', 'missing-nat']) {
  const p = { ...structuredClone(players[id]), nat: fix.from }
  const fixture = { players: { [id]: p }, me: { id: kind === 'own-id' ? id : 'ME' } } as Pick<GameState, 'players' | 'me'>
  if (kind === 'fictional') p.fictional = true
  if (kind === 'ME') { p.id = 'ME'; fixture.players = { ME: p } }
  if (kind === 'other-id') { p.id = 'V999999999'; fixture.players = { [p.id]: p } }
  if (kind === 'map-id-mismatch') p.id = 'V999999999'
  if (kind === 'manual-nat') p.nat = 'cn'
  if (kind === 'correct-nat') p.nat = fix.to
  if (kind === 'missing-nat') delete p.nat
  const before = structuredClone(fixture)
  assert.equal(repairPlayerCountries(fixture), 0, kind)
  assert.deepEqual(fixture, before, `${kind} retained`)
}
assert.equal(natName('si'), '斯洛文尼亚')
assert.equal(natName('gb'), '英国')
for (const code of ['un', 'xx', 'eu']) {
  assert.equal(natName(code), '国籍未知')
  assert.equal(natName(code.toUpperCase()), '国籍未知')
  assert.equal(natCountry(code), code, 'display fixes must not change country comparison')
}
assert.equal(natName('mk'), '北马其顿')
assert.equal(natName('tn'), '突尼斯')
assert.equal(natName('wa'), '英国（威尔士）')
assert.equal(natName('en'), '英国（英格兰）')
assert.equal(natName('sx'), '英国（苏格兰）', 'VLR sx is not ISO Sint Maarten')
assert.equal(natName('bad-input'), '国籍未知', 'unknown values must not claim a nationality or leak raw codes')
for (const code of ['wa', 'en', 'sx']) assert.equal(natCountry(code), code)
const allRows = [...world.players, ...world2021.players, ...prospects.players,
  ...Object.values(timeline.years).flatMap(y => Object.values(y.debuts))]
const used = new Set(allRows.map(p => p.nat).filter((n): n is string => !!n))
for (const code of used) {
  assert.ok(NAT_CN[code], `missing explicit source-code label: ${code}`)
  assert.ok(!/^[A-Z]+$/.test(natName(code)), `raw code leaked: ${code}`)
}
const clubs = { teams: {
  T61: { id: 'T61', name: 'Eastern Pandas', players: ['transferred-player'], rating: 77 },
  T62: { id: 'T62', name: 'Sangal Esports', players: ['other-player'], rating: 82 },
} } as unknown as Pick<GameState, 'teams'>
const clubsExpected = structuredClone(clubs)
clubsExpected.teams.T61.name = 'Enterprise Esports'
clubsExpected.teams.T62.name = 'Eintracht Frankfurt'
assert.equal(repairPlayerTeamNames(clubs), 2)
assert.deepEqual(clubs, clubsExpected)
assert.equal(repairPlayerTeamNames(clubs), 0)
clubs.teams.T61.name = 'User-edited club'
assert.equal(repairPlayerTeamNames(clubs), 0, 'keep independently edited labels')
assert.equal(clubs.teams.T61.name, 'User-edited club')
console.log('PASS country repair: 60 exact NPC fixes, 8 protected cases, idempotence, display-only neutral flags, 2 guarded club labels')
console.log(`PASS nationality display: ${allRows.length} source rows / ${used.size} used nonempty codes`)
