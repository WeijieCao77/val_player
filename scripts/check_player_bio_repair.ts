import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { repairPlayerBios } from '../src/engine/me/playerBioRepair'
import fixesData from '../src/data/player_bio_fixes.json'
import { REMOVED_PLAYERS } from '../src/engine/removedPlayers'
import type { GameState, Player } from '../src/engine/types'

type Fix = { playerIds: string[]; oldNames: (string | null)[]; oldBirths: (string | null)[]; name?: string | null; birth: string | null; estimated: boolean }
const fixes = fixesData.players as Record<string, Fix>
const books = Object.fromEntries(['bios', 'world', 'world_2021', 'timeline'].map(name => [name, JSON.parse(fs.readFileSync(`src/data/${name}.json`, 'utf8'))]))
for (const change of fixesData.changes) {
  if (change.field === 'quarantined-biography') {
    const bio = books.bios[change.id]
    assert.equal(bio.matchedBy, 'reviewed-vlr')
    assert.equal(bio.birth_date, null)
    assert.equal(bio.name, fixes[change.id].name)
    continue
  }
  const book = books[change.file]
  const row = change.file === 'bios' ? book[change.id]
    : change.file === 'timeline' ? (Object.values(book.years) as { debuts: Record<string, unknown> }[]).map(y => y.debuts[change.id]).find(Boolean)
      : book.players.find((p: Player) => fixes[change.id]?.playerIds.includes(p.id))
  assert.ok(row, `missing corrected data row ${change.file}/${change.id}`)
  assert.deepEqual((row as Record<string, unknown>)[change.field], change.after, `manifest/data disagreement ${change.file}/${change.id}/${change.field}`)
}
const player = (id: string, extra: Partial<Player> = {}) => ({ id, ign: 'unchanged nickname', age: 31,
  teamId: 'SIMULATED-TEAM', attrs: { aim: 83 }, salary: 14567, contractYears: 2, nat: 'cn',
  titles: [{ year: 2025, title: 'my title' }], ...extra } as Player)
const state = (players: Player[], year = 2026) => ({ year, day: 200, me: { id: 'ME' }, players: Object.fromEntries(players.map(p => [p.id, p])) } as GameState)
const protectedFields = (p: Player) => {
  const { realName: _name, birth: _birth, ageEstimated: _estimated, age: _age, ...rest } = p
  return rest
}

// All exact manifest IDs, including P/V/Y aliases; no made-up counterpart lookup.
let checked = 0
for (const f of Object.values(fixes)) for (const id of f.playerIds) {
  const p = player(id, { realName: f.oldNames[0], birth: f.oldBirths[0], ageEstimated: false })
  const saved = structuredClone(protectedFields(p)), s = state([p])
  repairPlayerBios(s)
  assert.equal(p.birth, f.birth)
  assert.equal(p.ageEstimated, f.estimated)
  if ('name' in f) assert.equal(p.realName, f.name)
  if (!f.birth) assert.equal(p.age, 31, 'unknown birthday preserves evolved save age')
  assert.deepEqual(protectedFields(p), saved)
  const once = JSON.stringify(s)
  assert.equal(repairPlayerBios(s), 0)
  assert.equal(JSON.stringify(s), once, 'read repair is idempotent')
  checked++
}
const f = fixes['8582']
const me = player('V8582', { realName: f.oldNames[0], birth: f.oldBirths[0] })
const mine = state([me]); mine.me!.id = me.id
assert.equal(repairPlayerBios(mine), 0, 'skip player-created identity even when id matches')
const fictional = player('V8582', { fictional: true, birth: f.oldBirths[0] })
assert.equal(repairPlayerBios(state([fictional])), 0)
const manager = state([player('V8582', { birth: f.oldBirths[0] })]); delete manager.me
assert.equal(repairPlayerBios(manager), 0)
const sameNickname = player('UNRELATED', { ign: 'Laz', realName: f.oldNames[0], birth: f.oldBirths[0] })
assert.equal(repairPlayerBios(state([sameNickname])), 0, 'never join by nickname')
const newer = player('V8582', { realName: 'Independent correction', birth: '2000-01-02', ageEstimated: false })
assert.equal(repairPlayerBios(state([newer])), 0, 'keep independent newer correction')
const juicy = player('V7426', { birth: '2006-10-19', age: 15, ageEstimated: false })
const j = state([juicy], 2021)
repairPlayerBios(j)
assert.equal(juicy.age, 14)
j.day = 364
assert.equal(repairPlayerBios(j), 0, 'calendar day cannot change season-age on reload')
j.year = 2022; juicy.age++
assert.equal(repairPlayerBios(j), 0, 'normal annual aging remains correct')

// Apply only the author-approved identity removals to the expected baseline.
// The actual data is never filtered here: extra roster/stat/club edits still fail.
const removedVlrIds = new Set(REMOVED_PLAYERS.map(p => p.vlr))
const removedIds = new Set(REMOVED_PLAYERS.map(p => `V${p.vlr}`))
// The data cleanup uses Python's round (ties to even), not JavaScript's ties up.
const roundBookRating = (n: number) => n % 1 === 0.5 ? Math.floor(n / 2) * 2 + (Math.floor(n) % 2 ? 2 : 0) : Math.round(n)
const applyApprovedRemovals = (file: string, v: Record<string, any>) => {
  if (file === 'timeline') {
    for (const year of Object.values(v.years) as Record<string, any>[]) {
      for (const [club, ids] of Object.entries(year.rosters) as [string, string[]][]) {
        if (!ids.some(id => removedVlrIds.has(id))) continue
        const left = ids.filter(id => !removedVlrIds.has(id))
        year.rosters[club] = left
        const top = left.filter(id => year.ratings[id]).map(id => year.ratings[id].o as number).sort((a, b) => b - a).slice(0, 5)
        year.clubs[club].o = top.length ? roundBookRating(top.reduce((sum, n) => sum + n, 0) / top.length) : 50
      }
      for (const id of removedVlrIds) { delete year.ratings[id]; delete year.debuts[id] }
    }
    for (const id of removedVlrIds) delete v.last[id]
  } else {
    v.players = v.players.filter((p: { id: string }) => !removedIds.has(p.id))
    for (const team of v.teams ?? []) {
      for (const key of ['roster', 'starters']) if (team[key]) team[key] = team[key].filter((id: string) => !removedIds.has(id))
      if (removedIds.has(team.igl)) team.igl = null
    }
  }
}

// Structural proof: biography changes and exact approved removals only.
for (const file of ['world', 'world_2021', 'timeline', 'prospects']) {
  const before = JSON.parse(execFileSync('git', ['show', `HEAD:src/data/${file}.json`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 }))
  const after = JSON.parse(fs.readFileSync(`src/data/${file}.json`, 'utf8'))
  applyApprovedRemovals(file, before)
  const clean = (v: typeof before): unknown => {
    const strip = (row: Record<string, unknown>, keys: string[]) => { for (const key of keys) delete row[key] }
    if (file === 'timeline') {
      for (const year of Object.values(v.years) as { debuts: Record<string, Record<string, unknown>>; clubs: Record<string, Record<string, unknown>> }[]) {
        for (const p of Object.values(year.debuts)) strip(p, ['name', 'birth', 'age', 'est', 'nat'])
        for (const t of Object.values(year.clubs)) strip(t, ['n', 't'])
      }
    } else {
      for (const p of v.players) strip(p, ['realName', 'real', 'birth', 'born', 'age', 'ageEstimated', 'nat'])
      for (const t of v.teams ?? []) strip(t, ['name', 'tag'])
    }
    return v
  }
  // nat and team-name keys belong to the simultaneous identity/roster patch,
  // excluded here only to allow the parent task to merge that bounded change.
  assert.deepEqual(clean(after), clean(before), `${file}: do not rewrite stats, clubs, rosters, budgets, or event results`)
}
console.log(`PASS biography repair: ${Object.keys(fixes).length} identities / ${checked} ID aliases; guards, idempotence, year-age and unchanged simulation fields`)
