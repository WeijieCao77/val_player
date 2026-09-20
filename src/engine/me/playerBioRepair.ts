import fixesData from '../../data/player_bio_fixes.json'
import type { GameState } from '../types'

interface BioFix {
  playerIds: string[]
  oldNames: (string | null)[]
  oldBirths: (string | null)[]
  name?: string | null
  birth: string | null
  estimated: boolean
}
const fixes = Object.values(fixesData.players) as BioFix[]
const byId = new Map(fixes.flatMap(f => f.playerIds.map(id => [id, f] as const)))

/** Only previously documented biography fields, never a nickname-based join.
 * Unknown-birth save ages are retained as estimates. With a verified birthday
 * age is the game's January-1 season age (NPCs age at the year turn, not daily).
 * No training attributes, clubs, contracts, results, or generated people move.
 */
export function repairPlayerBios(state: GameState): number {
  if (!state.me || !Number.isInteger(state.year)) return 0
  let changed = 0
  for (const p of Object.values(state.players)) {
    if (p.id === state.me.id || p.id === 'ME' || p.fictional) continue
    const f = byId.get(p.id)
    if (!f) continue
    const before = [p.realName, p.birth, p.ageEstimated, p.age]
    if ('name' in f && f.oldNames.includes(p.realName ?? null)) p.realName = f.name
    const priorBirth = p.birth ?? null
    // Do not overwrite a newer correction or user-supplied different birthday.
    if (f.oldBirths.includes(priorBirth) || priorBirth === f.birth) {
      p.birth = f.birth
      p.ageEstimated = f.estimated
      if (f.birth) {
        const y = Number(f.birth.slice(0, 4))
        p.age = state.year - y - (f.birth.slice(5) === '01-01' ? 0 : 1)
      }
    }
    if (before.some((value, index) => value !== [p.realName, p.birth, p.ageEstimated, p.age][index])) changed++
  }
  return changed
}
