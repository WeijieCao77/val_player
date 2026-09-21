import assert from 'node:assert/strict'
import raw from '../src/data/timeline.json'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { migrateRegionalRuler } from '../src/engine/me/regionalRulerMigrate'
import { migratePlayerSave } from '../src/engine/me/save'
import { migrateRuler } from '../src/engine/me/rulerMigrate'
import { openWorldAt, syncYear } from '../src/engine/timeline'
import { REGIONAL_RULER, RULER, holdScale, lastRegionalRulerShift, regionalCalibration, regionalRulerShift, rulerClubRating, rulerShift, shiftPlayer } from '../src/engine/ruler'
import { packState, unpackState } from '../src/engine/save'
import type { GameState } from '../src/engine/types'

Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline')), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
const book = raw as unknown as { years: Record<string, { ratings: Record<string, { o: number }>; rosters: Record<string, string[]> }> }
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))
const fresh = (year = 2026) => {
  const s = createCareer({ name: '标尺守恒', region: 'EMEA', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 926011, year: 2021 })
  assert.equal(s.me!.region, 'Europe', '2021 EMEA entry resolves to the historical Europe server explicitly')
  if (year > 2021) openWorldAt(s, year)
  return s
}
const people = (s: GameState) => Object.fromEntries(Object.values(s.players).map(p => [p.id, { attrs: p.attrs, overall: p.overall, potential: p.potential, caps: p.caps }]))
let checks = 0
const ok = (value: unknown, text: string) => { assert.ok(value, text); checks++ }

for (const year of [2021, 2022, 2023, 2024, 2025, 2026]) {
  const calibration = regionalCalibration(year)
  for (const [id, d] of calibration.shifts) {
    ok(Number.isInteger(d) && d < 0 && d >= -4, `${year}/${id}: bounded integer delta`)
    ok(!calibration.protectedIds.has(id), 'international top-four protection')
    ok(d >= -calibration.maxDiscount, 'no more than measured annual excess')
  }
  if ([2021, 2022, 2024, 2025].includes(year)) assert.equal(calibration.shifts.size, 0, 'no evidence of same-year excess: no discount')
  for (const ids of Object.values(book.years[String(year)]?.rosters ?? {})) {
    const scores = ids.filter(id => book.years[String(year)].ratings[id]).map(id => book.years[String(year)].ratings[id].o + rulerShift(year, id)).sort((a, b) => b - a).slice(0, 5)
    if (scores.length) assert.equal(rulerClubRating(year, ids), Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), 'club previews apply total ruler exactly once')
  }
}
assert.equal(regionalRulerShift(2026, '55085'), -4)
assert.equal(regionalRulerShift(2026, '15559'), 0, 'same-year international team result protects CHICHOO')
assert.equal(regionalRulerShift(2026, '4742'), 0, 'same-year international team result protects Smoggy')
assert.equal(regionalRulerShift(2024, '55085'), 0, '2026 excess never leaks back into 2024')
assert.equal(regionalRulerShift(2026, '36685'), -4, 'CN source import is measured on the source, not nationality')
assert.equal(regionalRulerShift(2026, '440'), 0, 'unrelated overseas player unchanged')

for (const year of [2023, 2024, 2026, 2029]) {
  const s = fresh(Math.min(year, 2026)); s.year = year
  assert.equal(s.regionalRuler, REGIONAL_RULER)
  const newWorld = JSON.stringify(people(s))
  assert.equal(migrateRegionalRuler(s), 0)
  assert.equal(JSON.stringify(people(s)), newWorld, 'fresh world never receives a second regional deduction')
  // Reconstruct an un-stamped, current-RULER save; growth is then added independently.
  for (const p of Object.values(s.players)) if (/^V\d+$/.test(p.id)) shiftPlayer(p, -lastRegionalRulerShift(year, p.id.slice(1)))
  delete s.regionalRuler
  s.players[s.me!.id].nat = 'cn'
  const subject = s.players['V55085'] ?? Object.values(s.players).find(p => /^V\d+$/.test(p.id))!
  shiftPlayer(subject, 1)
  subject.nat = 'au' // changing nationality cannot change a source-season calibration
  const own = JSON.stringify({ player: s.players[s.me!.id], talents: s.me!.talents, achievements: s.me!.achievements, titles: s.me!.titles, seasonStart: s.me!.seasonStart })
  const before = clone(people(s))
  const expected = clone(s)
  for (const p of Object.values(expected.players)) if (p.id !== expected.me!.id && /^V\d+$/.test(p.id)) shiftPlayer(p, lastRegionalRulerShift(year, p.id.slice(1)))
  migrateRegionalRuler(s)
  assert.deepEqual(people(s), people(expected), 'migration adds only the new delta and retains simulated growth')
  assert.equal(JSON.stringify({ player: s.players[s.me!.id], talents: s.me!.talents, achievements: s.me!.achievements, titles: s.me!.titles, seasonStart: s.me!.seasonStart }), own, 'player nationality, attributes, ceilings and achievements untouched')
  assert.equal(s.ruler, RULER, 'full ruler version not bumped')
  const once = JSON.stringify(people(s))
  assert.equal(migrateRegionalRuler(s), 0)
  assert.equal(JSON.stringify(people(s)), once)
  const loaded = migratePlayerSave(unpackState(packState(s)))
  const loadOnce = JSON.stringify(people(loaded))
  migratePlayerSave(loaded)
  assert.equal(JSON.stringify(people(loaded)), loadOnce, 'real save roundtrip stamps and never repeats')
  for (const [id, value] of Object.entries(before)) if (!/^V\d+$/.test(id) || !lastRegionalRulerShift(year, id.slice(1))) assert.deepEqual(clone(people(s)[id]), value, 'unaffected source cohorts unchanged')
  if (year === 2026) {
    const expectedWorld = fresh(2026)
    syncYear(s, 2026)
    for (const id of Object.keys(book.years['2026'].ratings).map(id => `V${id}`)) if (s.players[id] && expectedWorld.players[id]) assert.deepEqual(s.players[id].attrs, expectedWorld.players[id].attrs, 'book reread replaces from raw once, not cumulatively')
  }
  if (year > 2026) {
    holdScale(s)
    const afterWinter = JSON.stringify(people(s))
    assert.equal(migrateRegionalRuler(s), 0)
    assert.equal(JSON.stringify(people(s)), afterWinter, 'global winter followed by reload does not add regional tax')
  }
}
// Legacy full-ruler migration runs on its published baseline; the new regional step alone never moves ME.
const ancient = fresh(2026)
delete ancient.ruler; delete ancient.regionalRuler; delete ancient.me!.flags.rulerMoved
migrateRuler(ancient)
const afterExistingMigration = JSON.stringify(ancient.players[ancient.me!.id])
migrateRegionalRuler(ancient)
assert.equal(JSON.stringify(ancient.players[ancient.me!.id]), afterExistingMigration)
assert.equal(ancient.regionalRuler, REGIONAL_RULER)
console.log(`PASS regional ruler: ${checks} bounded-delta checks, annual cohort/proof, nationality independence, player preserved, new/old/legacy saves, reload/winter/book idempotence`)
