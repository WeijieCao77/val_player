import { weightsFor } from '../player'
import { ATTR_KEYS } from '../types'
import type { Attrs, Player } from '../types'

/**
 * The career's copy of the world's training judgement (engine/training.ts),
 * so a career reads nothing from the manager's training module. A pure
 * function over a player: copied, not shared (作者 2026-09-11).
 */

/** Past this much fatigue a player is rested rather than trained — the same line the world's plans use. */
export const REST_AT = 45

/**
 * The most useful individual focus for this player's actual role.
 *
 * Overall is role-weighted, so "train the lowest raw number" is not neutral:
 * it sent duelists to communication (5% of their rating) instead of aim
 * (28%). This is the heaviest attribute that still has somewhere to go, and
 * among equals the one he is worse at. Only the caller is ever pointed at
 * 指挥, and anyone tired or already at his ceiling is rested instead.
 */
export function recommendedTrainingFocus(p: Player): keyof Attrs | 'rest' {
  if (p.potential <= p.overall || p.fatigue >= REST_AT) return 'rest'
  const weights = weightsFor(p)
  const room = ATTR_KEYS.filter((k) => (k !== 'igl' || p.isIgl) && p.attrs[k] < 97)
  if (!room.length) return 'rest'
  return room.reduce((a, b) => {
    const d = weights[b] - weights[a]
    if (Math.abs(d) > 0.001) return d > 0 ? b : a
    return p.attrs[b] < p.attrs[a] ? b : a
  })
}
