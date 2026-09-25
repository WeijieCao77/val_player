import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { computeAwards, leaguePool } from '../src/engine/me/nights'
import { vctRead } from '../src/engine/me/transfer'
import { careerOverview } from '../src/ui/me/careerOverviewRead'
import { performanceRating, mapPerformanceRating } from '../src/engine/performance'
import { simulateMatch, mapMvp } from '../src/engine/match'
import { ratingOf } from '../src/engine/player'
import { packState, unpackState } from '../src/engine/save'
import { emptyStats } from '../src/engine/types'
import { Rng } from '../src/engine/rng'
import { boxScore, rankInBox } from '../src/engine/me/postmatch'
import type { Fixture } from '../src/engine/types'

globalThis.fetch = () => Promise.reject(new Error('offline role consumer check'))
const s = createCareer({ name: 'RoleConsumer', role: '先锋', region: 'EMEA', year: 2026,
  start: 'chal', originKey: 'rich', talents: emptyTalents(), seed: 9417 })
const me = s.me!, p = s.players[me.id], club = s.teams[s.myTeam]
const pool = leaguePool(s, club)
const ids = new Set(pool.flatMap(t => t.roster))
ids.add(p.id)
assert.ok(ids.size >= 6)
for (const id of ids) s.players[id].season = { ...emptyStats(), maps: 25, rounds: 600,
  kills: 420, deaths: 440, assists: 140, damage: 82000, firstKills: 40, firstDeaths: 42, clutches: 8 }
Object.assign(p.season, { kills: 360, assists: 330, deaths: 390, damage: 74000, firstKills: 30, firstDeaths: 24, clutches: 15 })
const fragger = s.players[[...ids].find(id => id !== p.id)!]
// 2026-09-25 (match-rating): the author approved kills and damage weighing more than assists
// (「杀人的评分也太低了」). The fragger here was 480 kills and 105000 damage to the support's 360
// and 74000 — 0.2 kills and 50 damage a round more — and the old rating, an assist paying what a
// kill paid, still put the support first; that is the rule the mailbox asked to end (it now
// rates 1.02 to 1.09). The point kept: a strong support season still leads a table it does not
// top on kills or ACS, against a fragger 0.13 kills and 27 damage a round ahead of it.
Object.assign(fragger.season, { kills: 440, assists: 50, deaths: 420, damage: 90000, firstKills: 50, firstDeaths: 45, clutches: 8 })
assert.ok(p.season.kills < fragger.season.kills && p.season.damage < fragger.season.damage)
assert.ok(performanceRating(p.season) > performanceRating(fragger.season))
const before = JSON.stringify(s)
const awards = computeAwards(s)!
assert.ok(awards)
assert.equal(awards.cats.find(c => c.key === 'mvp')!.top[0].id, p.id,
  'Strong real support output can lead annual awards without ACS leadership')
assert.equal(awards.mine!.rating, performanceRating(p.season))
assert.equal(careerOverview(s, 'season').rating, performanceRating(p.season).toFixed(2))
assert.equal(JSON.stringify(s), before, 'Evaluating current stats cannot rewrite awards or history')
p.overall = 50; me.titles = []; me.seasonStart.starts = 8
assert.equal(vctRead(s)?.by, 'results', 'League-best contribution earns the existing scouting path')
p.season.maps = 1
assert.equal(vctRead(s)?.by, null, 'Tiny support sample does not bypass the season participation bar')
p.season.maps = 25

const clubs = Object.values(s.teams).filter(t => t.roster.length >= 5).slice(0, 2)
const result = simulateMatch(s, clubs[0].id, clubs[1].id, 3, new Rng(8201))
const oldResult = structuredClone(result)
for (const m of oldResult.maps) delete m.performanceVersion
s.fixtures.push({ id: 'new-role-test', teamA: clubs[0].id, teamB: clubs[1].id, result } as Fixture)
s.fixtures.push({ id: 'old-role-test', teamA: clubs[0].id, teamB: clubs[1].id, result: oldResult } as Fixture)
const originalHistory = JSON.stringify(s.me!.matches)
const loaded = unpackState(packState(s))
for (const [id, version] of [['new-role-test', 1], ['old-role-test', undefined]] as const) {
  const expected = s.fixtures.find(f => f.id === id)!.result!
  const actual = loaded.fixtures.find(f => f.id === id)!.result!
  // JSON saves normalize -0 to 0; compare the persistable representation, not IEEE sign bits.
  assert.deepEqual(actual, JSON.parse(JSON.stringify(expected)), 'Pack/unpack preserves every historic/new map and award')
  for (const m of actual.maps) {
    assert.equal(m.performanceVersion, version)
    for (const line of Object.values(m.lines)) assert.equal(mapPerformanceRating(m, line),
      version === 1 ? performanceRating(line) : ratingOf(line))
    assert.equal(mapMvp(m, actual.lineups), mapMvp(expected.maps.find(x => x.map === m.map)!, expected.lineups))
  }
}
assert.equal(JSON.stringify(loaded.me!.matches), originalHistory)
assert.equal(packState(unpackState(packState(loaded))), packState(loaded), 'Repeated save is idempotent')
const same = { kills: 14, deaths: 14, assists: 6, firstKills: 1, firstDeaths: 1, clutches: 1, rounds: 20 }
const tieMap = { map: 'Ascent', scoreA: 13, scoreB: 7, performanceVersion: 1 as const, lines: {
  [p.id]: { ...same, damage: 200.1 / 1.45 * 20, acs: 200.1 },
  [fragger.id]: { ...same, damage: 200.4 / 1.45 * 20, acs: 200.4 },
} }
const tieRows = boxScore(s, [tieMap], [p.id, fragger.id], [])
assert.equal(tieRows[0].rating, tieRows[1].rating)
assert.equal(tieRows[0].acs, tieRows[1].acs)
assert.equal(rankInBox(tieRows, p.id), 1, 'Displayed rounded tie is the exact coach rank')
assert.equal(rankInBox(tieRows, fragger.id), 2)
assert.equal(rankInBox(tieRows, 'absent'), 0)
console.log('PASS role consumers: support awards/scouting/overview agree, sample guard, read-only old history, mixed-version scoreboard save roundtrip')
