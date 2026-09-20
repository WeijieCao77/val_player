import { ratingOf, statLine } from '../../engine/player'
import { isQualifier } from '../../engine/me/compclass'
import type { GameState, Stats } from '../../engine/types'

/** A read-only view over the existing career ledger, never the trimmed match list. */
export function careerOverview(state: GameState, scope: 'season' | 'career') {
  const me = state.me!, p = state.players[me.id]
  const stats: Stats = scope === 'season' ? p.season : p.career
  const seasons = scope === 'career' ? me.seasons : []
  const starts = seasons.reduce((n, s) => n + s.starts, 0) + me.seasonStart.starts
  const wins = seasons.reduce((n, s) => n + s.wins, 0) + me.seasonStart.wins
  const line = statLine(stats), hasMaps = stats.maps > 0, hasRounds = hasMaps && stats.rounds > 0
  // A title comes only from the player's own ledger, not every championship
  // their current club won. Qualifier wins are qualification, not trophies.
  const currentTitles = me.titles.filter(t => t.year === state.year && !isQualifier(t.title))
  return {
    maps: stats.maps, starts, wins,
    rating: hasRounds ? ratingOf(stats).toFixed(2) : '—',
    acs: hasRounds ? line.acs.toFixed(0) : '—',
    kd: hasMaps && stats.deaths > 0 ? line.kd.toFixed(2) : '—',
    kda: hasMaps ? `${stats.kills}/${stats.deaths}/${stats.assists}` : '—',
    winRate: starts > 0 ? `${Math.round(wins / starts * 100)}%` : '—',
    // applyMatchStats increments this ONCE for result.mvp, outside the map loop.
    mvps: stats.mvps,
    firstKillDiff: hasMaps ? String(line.fkDiff) : '—',
    hasMaps, zeroDeaths: hasMaps && stats.deaths === 0,
    currentTitles, playedTitles: currentTitles.filter(t => t.started).length,
    benchTitles: currentTitles.filter(t => !t.started).length,
  }
}
