import type { GameState, Team } from '../../engine/types'

const searchText = (value: string): string => value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')

/** Search the caller's already eligible/visible list; never broaden it. */
export function teamMatchesQuery(team: Pick<Team, 'name' | 'tag'>, query: string): boolean {
  const q = searchText(query)
  return !q || searchText(team.name).includes(q) || searchText(team.tag).includes(q)
}

/** Current world only. Reading a stale row never repairs or recruits a player. */
export function rosterOf(game: Pick<GameState, 'teams' | 'players'>, teamId: string): string[] {
  const team = game.teams[teamId]
  if (!team) return []
  const starters = new Set(team.starters)
  return [...new Set(team.roster)]
    .filter(id => game.players[id]?.teamId === teamId)
    .sort((a, b) => Number(starters.has(b)) - Number(starters.has(a))
      || game.players[b].overall - game.players[a].overall || a.localeCompare(b))
}
