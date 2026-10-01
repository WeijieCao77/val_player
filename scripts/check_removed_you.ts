import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { migratePlayerSave } from '../src/engine/me/save'
import { cleanHall } from '../src/engine/me/hall'
import { packState, unpackState } from '../src/engine/save'
import { REMOVED_LABEL, removedPlayer, namesRemoved, scrubNames } from '../src/engine/removedPlayers'
import { offPoolOn } from '../src/engine/staffStints'
import { advanceDay } from '../src/engine/season'
import { syncYear } from '../src/engine/timeline'

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, fetch: () => Promise.reject(Error('offline')) })
assert(removedPlayer('V4710'))
assert(!removedPlayer('V21T4710'))
assert(offPoolOn('4710', '2021-01-01') && offPoolOn('4710', '2035-01-01'))
assert(namesRemoved('YOU 加盟'))
assert(!namesRemoved('thank you for your youth program'))
assert(!namesRemoved('YOUR YOUTH YOUNG YOU_123'))
assert(namesRemoved('kovaq 加盟'), 'existing longer-name case handling remains')
const text = { note: 'thank you for your youth program', ign: 'YOU', other: 'YOUR' }
scrubNames(text)
assert.equal(text.ign, REMOVED_LABEL)
assert.equal(text.note, 'thank you for your youth program')
assert.equal(text.other, 'YOUR')

for (const [year, teamId] of [[2021, 'V21T1211'], [2024, 'V21T12685'], [2025, 'V21T13581']] as const) {
  const s = createCareer({ name: 'Check', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 9, year: 2021 })
  for (let y = 2022; y <= year; y++) { s.year = y; syncYear(s, y) }
  assert(!s.players.V4710)
  const t = s.teams[teamId]
  advanceDay(s, { autoResolveDrawDecisions: true })
  assert(t.roster.length >= 5 && t.starters.length === 5, `${year} ${t.name} fills five`)
  assert(t.roster.some(id => s.players[id]?.isIgl), `${year} ${t.name} has a caller`)
}
// The actual day-advance path fills the club before its first simulated fixture.
const opening = createCareer({ name: 'Opening', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 9, year: 2021, teamId: 'V21T1211' })
assert.equal(opening.myTeam, 'V21T1211')
assert.equal(opening.teams[opening.myTeam].starters.length, 5, 'player joins the four remaining real players')
let played = opening.fixtures.find(f => f.played && (f.teamA === opening.myTeam || f.teamB === opening.myTeam))
for (let days = 0; days < 180 && !played; days++) {
  advanceDay(opening, { autoResolveDrawDecisions: true })
  played = opening.fixtures.find(f => f.played && (f.teamA === opening.myTeam || f.teamB === opening.myTeam))
}
assert(played?.result?.lineups, 'Totoro first official match was actually simulated')
const ten = [...played.result.lineups.a, ...played.result.lineups.b]
assert.equal(played.result.lineups.a.length, 5)
assert.equal(played.result.lineups.b.length, 5)
assert.equal(new Set(ten).size, 10)
assert(!ten.includes('V4710'))
for (const own of [false, true]) {
  const s = createCareer({ name: 'Check', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 9, year: 2026 })
  const t = own ? s.teams[s.myTeam] : Object.values(s.teams).find(t => t.id !== s.myTeam && !t.dormant && t.roster.length === 5)!
  const out = t.roster.find(id => id !== s.me!.id)!
  const p = structuredClone(s.players[out])
  s.players[out].teamId = null
  p.id = 'V4710'; p.ign = 'YOU'; p.teamId = t.id
  s.players[p.id] = p
  t.roster = t.roster.map(id => id === out ? p.id : id)
  t.starters = t.starters.map(id => id === out ? p.id : id)
  t.igl = p.id
  s.news.push({ year: s.year, day: s.day, kind: 'transfer', text: 'YOU 加盟。' })
  s.me!.log.push({ year: s.year, day: s.day, kind: 'team', text: 'thank you for your youth program' })
  delete s.removedSync
  const loaded = migratePlayerSave(unpackState(packState(s)))
  assert(!loaded.players.V4710)
  assert(!loaded.news.some(n => n.text === 'YOU 加盟。'))
  assert(loaded.me!.log.some(n => n.text === 'thank you for your youth program'))
  assert(loaded.teams[t.id].roster.length >= 5)
  assert(loaded.teams[t.id].starters.length === 5)
  const second = migratePlayerSave(unpackState(packState(loaded)))
  assert.deepEqual(second.teams[t.id].roster, loaded.teams[t.id].roster)
}

const mine = createCareer({ name: 'YOU', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 9, year: 2026 })
mine.me!.log.push({ year: mine.year, day: mine.day, kind: 'team', text: 'YOU 自己完成训练。' })
delete mine.removedSync
const loaded = migratePlayerSave(unpackState(packState(mine)))
assert.equal(loaded.players[loaded.me!.id].ign, 'YOU')
assert(loaded.me!.log.some(n => n.text === 'YOU 自己完成训练。'))
const hall = cleanHall({ v: 1, ach: {}, hx: {}, looks: {}, cards: [{ id: 'cabc', name: 'YOU', ending: { key: 'k', title: '冠军' }, clubs: [], rw: { n: 1, top: 'YOU 的生涯' } }] })
assert.equal(hall.cards[0].name, 'YOU')
assert.equal(hall.cards[0].rw?.top, 'YOU 的生涯')
console.log('OK removed professional, intact custom YOU career, English prose, old saves and roster/caller recovery')
