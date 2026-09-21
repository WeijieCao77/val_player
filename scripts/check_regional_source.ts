import assert from 'node:assert/strict'
import raw from '../src/data/timeline.json'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { migrateRegionalRuler } from '../src/engine/me/regionalRulerMigrate'
import { migratePlayerSave } from '../src/engine/me/save'
import { regionalCalibration, regionalRulerShiftForSample, shiftPlayer } from '../src/engine/ruler'
import { openWorldAt, reachOf, syncYear } from '../src/engine/timeline'
import { packState, unpackState } from '../src/engine/save'

Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline')), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } })
const book = raw as any
const id = '55085'
const line = (year: number) => { const r = book.years[year].ratings[id]; return { rating: r.v[0], acs: r.v[1], rounds: r.n } }
const oldLine = line(2025), newLine = line(2026)
assert.equal(regionalRulerShiftForSample(2026, id, oldLine), 0, '2025 sample retained in 2026 does not borrow 2026 deduction')
assert.equal(regionalRulerShiftForSample(2026, id, newLine), -4)
assert.equal(regionalRulerShiftForSample(2025, id, newLine), 0, 'future samples forbidden')
assert.equal(regionalRulerShiftForSample(2026, id, undefined), 0)
assert.equal(regionalRulerShiftForSample(2026, id, { ...newLine, rounds: newLine.rounds + 1 }), 0, 'three fields must all match')
assert.equal(regionalRulerShiftForSample(2026, id, { ...newLine, rating: null }), 0)
assert.equal(regionalRulerShiftForSample(2026, id, { ...newLine, acs: 0 }), 0)
// In-memory malformed-history fixture only, after the real annual tables are cached.
regionalCalibration(2025); regionalCalibration(2026)
const previous = book.years[2025].ratings[id]
try {
  book.years[2025].ratings[id] = { ...previous, n: newLine.rounds, v: [newLine.rating, newLine.acs] }
  assert.equal(regionalRulerShiftForSample(2026, id, newLine), 0, 'same fingerprint with conflicting yearly deltas is ambiguous')
} finally { book.years[2025].ratings[id] = previous }
regionalCalibration(2024)
const previous24 = book.years[2024].ratings[id]
try {
  book.years[2024].ratings[id] = { ...previous }
  assert.equal(regionalRulerShiftForSample(2026, id, oldLine), 0, 'repeated fingerprint with unanimous deltas is safe')
} finally { if (previous24) book.years[2024].ratings[id] = previous24; else delete book.years[2024].ratings[id] }

const fresh = () => {
  const s = createCareer({ name: '历史样本', region: 'EMEA', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 926011, year: 2021 })
  assert.equal(s.me!.region, 'Europe')
  openWorldAt(s, 2026)
  assert.ok(s.players['V' + id])
  return s
}
const state = fresh(), subject = state.players['V' + id]
subject.vlr = oldLine // Synthetic old-save fixture with the exact real 2025 sample.
state.players[state.me!.id].nat = 'cn'
const own = JSON.stringify(state.players[state.me!.id])
const before = JSON.stringify(subject)
delete state.regionalRuler
migrateRegionalRuler(state)
assert.equal(JSON.stringify(subject), before, 'old sample survives migration, regardless of present club membership')
assert.equal(JSON.stringify(state.players[state.me!.id]), own, 'main character never altered')
const protectedState = fresh(), teammate = protectedState.players['V' + id]
const club = Object.values(protectedState.teams).find(t => !t.dormant && t.roster.includes(teammate.id))!
assert.ok(club, 'fixture uses the actual active club of the subject')
const main = protectedState.players[protectedState.me!.id]
for (const t of Object.values(protectedState.teams)) t.roster = t.roster.filter(p => p !== main.id)
club.roster.push(main.id)
main.teamId = club.id
teammate.teamId = club.id
protectedState.myTeam = club.id
protectedState.me!.phase = 'pro'
teammate.vlr = oldLine
assert.equal(reachOf(protectedState).club, club.id)
assert.ok(reachOf(protectedState).people.has(teammate.id))
syncYear(protectedState, 2026)
assert.deepEqual(teammate.vlr, oldLine, 'real reachOf protection retains 2025 sample through syncYear')
const protectedBefore = JSON.stringify(teammate)
delete protectedState.regionalRuler
migrateRegionalRuler(protectedState)
assert.equal(JSON.stringify(teammate), protectedBefore, 'protected teammate migration does not apply a future source deduction')
const released = fresh(), free = released.players['V' + id]
free.vlr = oldLine
for (const t of Object.values(released.teams)) t.roster = t.roster.filter(p => p !== free.id)
free.teamId = null
const freeBefore = JSON.stringify(free)
delete released.regionalRuler
migrateRegionalRuler(released)
assert.equal(JSON.stringify(free), freeBefore, 'released old sample is protected too')

const current = fresh(), npc = current.players['V' + id]
shiftPlayer(npc, 4) // Remove new-world regional delta: this emulates an un-migrated save.
shiftPlayer(npc, -2) // Simulated performance change must be preserved, not reset to the book.
const expected = JSON.parse(JSON.stringify(npc))
shiftPlayer(expected, -4)
delete current.regionalRuler
migrateRegionalRuler(current)
assert.deepEqual(npc.attrs, expected.attrs)
assert.equal(npc.overall, expected.overall)
const attributes = JSON.stringify(npc.attrs)
assert.equal(migrateRegionalRuler(current), 0)
assert.equal(JSON.stringify(npc.attrs), attributes)
const loaded = migratePlayerSave(unpackState(packState(current)))
assert.equal(JSON.stringify(loaded.players[npc.id].attrs), attributes, 'pack/load does not repeat deduction')
migratePlayerSave(loaded)
assert.equal(JSON.stringify(loaded.players[npc.id].attrs), attributes)

syncYear(state, 2026)
assert.deepEqual(state.players[subject.id].vlr, newLine, 'actual annual reread now has the 2026 fingerprint')
const reference = fresh().players[subject.id]
assert.deepEqual(state.players[subject.id].attrs, reference.attrs, 'annual overwrite includes the correct deduction once')
const synced = JSON.stringify(state.players[subject.id].attrs)
syncYear(state, 2026)
assert.equal(JSON.stringify(state.players[subject.id].attrs), synced)
assert.equal(migrateRegionalRuler(state), 0)
console.log('PASS regional source: old/current/grown/released samples, full fingerprint, ambiguity, missing/future guards, player preservation, pack/load and actual yearly overwrite idempotence')
