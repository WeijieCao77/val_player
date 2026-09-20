import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { emptyStats } from '../src/engine/types'
import { careerOverview } from '../src/ui/me/careerOverviewRead'
import { playerDisplayName } from '../src/ui/me/playerDisplayName'

// Pure read-only presentation: never advance a week or access user storage.
const game = createCareer({ name: '生涯总览回归', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2026 })
const me = game.me!, p = game.players[me.id]
p.career = emptyStats(); p.season = emptyStats()
for (const scope of ['career', 'season'] as const) {
  const v = careerOverview(game, scope)
  assert.equal(v.maps, 0); assert.equal(v.starts, 0)
  for (const key of ['rating', 'acs', 'kd', 'kda', 'winRate'] as const) assert.equal(v[key], '—')
}
me.seasons.push({ year: 2025, team: '旧队', tier: 1, matches: 12, starts: 10, wins: 6, acs: 200, overallFrom: 60, overallTo: 65, titles: [] })
Object.assign(me.seasonStart, { matches: 5, starts: 4, wins: 3 })
p.career = { ...emptyStats(), maps: 30, rounds: 600, kills: 450, deaths: 300, assists: 100, damage: 85000, firstKills: 70, firstDeaths: 45, mvps: 4 }
p.season = { ...emptyStats(), maps: 8, rounds: 160, kills: 120, deaths: 80, assists: 25, damage: 23000, firstKills: 20, firstDeaths: 11, mvps: 1 }
me.titles = [
  { year: 2026, title: 'Champions', started: true },
  { year: 2026, title: 'Masters Madrid', started: false },
  { year: 2026, title: 'Last Chance Qualifier', started: true },
  { year: 2025, title: 'Masters Bangkok', started: true },
]
const before = JSON.stringify(game)
const career = careerOverview(game, 'career'), season = careerOverview(game, 'season')
assert.equal(career.maps, 30); assert.equal(career.starts, 14); assert.equal(career.wins, 9)
assert.equal(career.winRate, '64%'); assert.equal(career.kd, '1.50'); assert.equal(career.mvps, 4)
assert.equal(season.maps, 8); assert.equal(season.starts, 4); assert.equal(season.wins, 3)
assert.equal(season.winRate, '75%'); assert.equal(season.mvps, 1)
assert.equal(career.playedTitles, 1); assert.equal(career.benchTitles, 1); assert.equal(career.currentTitles.length, 2)
assert.equal(JSON.stringify(game), before, 'presentation never mutates the save')
me.matches = []
assert.deepEqual(careerOverview(game, 'career'), career, 'trimmed detailed match history is not the career ledger')
p.season.deaths = 0
assert.equal(careerOverview(game, 'season').kd, '—')
assert.equal(careerOverview(game, 'season').zeroDeaths, true)
p.season.rounds = 0
assert.equal(careerOverview(game, 'season').acs, '—')
assert.equal(careerOverview(game, 'season').rating, '—')
// A new year clears current stats, not career totals or previous season rows.
game.year = 2027; p.season = emptyStats(); Object.assign(me.seasonStart, { year: 2027, starts: 0, wins: 0 })
assert.equal(careerOverview(game, 'season').winRate, '—')
assert.equal(careerOverview(game, 'season').currentTitles.length, 0)
assert.equal(careerOverview(game, 'career').maps, 30)
const contaminated = 'Sylvain Jean-Pierre Pattyn<!-- https://www.youtube.com/watch?v=oE5r7dTdLoY Fnatic Video -->'
assert.equal(playerDisplayName(contaminated), 'Sylvain Jean-Pierre Pattyn')
assert.ok(contaminated.includes('<!--'), 'display cleanup does not mutate the source')
assert.equal(playerDisplayName('康永康'), '康永康')
assert.equal(playerDisplayName("O'Connor <Jr>"), "O'Connor <Jr>")
assert.equal(playerDisplayName('  A<!--one--> B<!--two\nlines-->  '), 'A B')
assert.equal(playerDisplayName('A<!--unfinished'), 'A')
assert.equal(playerDisplayName('<!-- comment only -->'), null)
assert.equal(playerDisplayName(null), null)
console.log('PASS career overview: empty/zero-denominator, season/career, trimmed history, whole-match MVP, personal/bench/qualifier titles, read-only; display-only biography comments')
