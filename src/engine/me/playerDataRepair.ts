import countryFixes from '../../data/player_country_fixes.json'
import type { GameState } from '../types'

const COUNTRY_FIXES = new Map(countryFixes.fixes.map(f => [`V${f.pid}`, f]))

/** Repair only proven bad nationality values on an already-created real NPC.
 *
 * The roster book uses V<vlr id>. Never join by IGN, overwrite a user's own
 * character, change a fictional newcomer, or refresh a save from today's team
 * roster. The old value is a precondition: manual edits and already-correct
 * values are retained. `year` in the manifest is evidence, not a save gate —
 * the same erroneous initial value can survive many seasons in an old save.
 * Idempotent; changes no ages, ratings, clubs, regions, RNG or match records.
 */
export function repairPlayerCountries(state: Pick<GameState, 'players' | 'me'>): number {
  let repaired = 0
  for (const [id, p] of Object.entries(state.players)) {
    if (p.id !== id || p.id === 'ME' || p.id === state.me?.id || p.fictional) continue
    const fix = COUNTRY_FIXES.get(id)
    if (!fix || p.nat !== fix.from) continue
    p.nat = fix.to
    repaired++
  }
  return repaired
}

/** Correct two proven legacy labels, not a simulated club's roster or identity. */
export function repairPlayerTeamNames(state: Pick<GameState, 'teams'>): number {
  let repaired = 0
  for (const [id, from, to] of [
    ['T61', 'Eastern Pandas', 'Enterprise Esports'],
    ['T62', 'Sangal Esports', 'Eintracht Frankfurt'],
  ]) {
    const team = state.teams[id]
    if (!team || team.id !== id || team.name !== from) continue
    team.name = to
    repaired++
  }
  return repaired
}
