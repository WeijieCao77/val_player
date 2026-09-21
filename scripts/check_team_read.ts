import assert from 'node:assert/strict'
import { rosterOf, teamMatchesQuery } from '../src/ui/me/teamRead'
import type { GameState, Team, Player } from '../src/engine/types'

const team = { id: 't', name: 'EDward   Gaming 中国', tag: 'EDG',
  roster: ['a', 'b', 'a', 'c', 'missing', 'moved'], starters: ['a', 'c', 'a', 'orphan'] } as Team
const player = (id: string, overall: number, teamId = 't') => ({ id, overall, teamId }) as Player
const game: Pick<GameState, 'teams' | 'players'> = { teams: { t: team }, players: {
  a: player('a', 70), b: player('b', 99), c: player('c', 80), moved: player('moved', 95, 'elsewhere'), orphan: player('orphan', 90),
} }
for (const query of ['edg', ' EdG ', 'ＥＤＧ', 'ward', 'ward gaming', '中国', '', '  ']) assert.equal(teamMatchesQuery(team, query), true, query)
for (const query of ['g2', 'wrong', 'e d g']) assert.equal(teamMatchesQuery(team, query), false, query)
const before = JSON.stringify(game)
assert.deepEqual(rosterOf(game, 't'), ['c', 'a', 'b'], 'dedup, owned roster only, starters before higher-rated bench')
assert.deepEqual(rosterOf(game, 'unknown'), [])
assert.equal(JSON.stringify(game), before, 'reading never fixes/mutates world data')
game.players.c.teamId = 'elsewhere'
game.teams.t.starters = ['b']
assert.deepEqual(rosterOf(game, 't'), ['b', 'a'], 'current-world transfers/lineup changes reflected')
game.teams.t.roster = []
assert.deepEqual(rosterOf(game, 't'), [], 'stale starters cannot invent members')
console.log('PASS team read: normalized multilingual search, dedup/ownership, missing/stale roster, live world, no mutation')
