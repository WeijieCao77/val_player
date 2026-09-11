import { clamp } from './rng'
import type { GameState, Player } from './types'

/**
 * 归属感: how attached a player is to his club — the world's part of it.
 *
 * Years served and trophies lifted there. It is the world's own reason for a man
 * to stay where he is when another club wants him (the author's rule 3,
 * 2026-09-11), so it grows everywhere, every winter, and on every title. What a
 * manager does to it — listing a man, turning down money for him, re-signing
 * him — is the manager game's, and stays in engine/loyalty.ts.
 *
 * Everything moves slowly. A player is not talked into belonging.
 */

/** Where a player starts at a club he has just joined. */
export const LOYALTY_NEW = 38

/**
 * A season survived together.
 *
 * The curve flattens: the fourth year at a club is worth less than the first,
 * because by then he is already a club man and the number is near its ceiling.
 * Measured against the real spread — median loyalty in the data is 59 — this
 * takes a signing from 38 to roughly 60 over four seasons.
 */
export const yearlyGain = (loyalty: number): number =>
  clamp((78 - loyalty) * 0.16, 0.4, 7)

/** What lifting a trophy while he was here is worth. */
export const TITLE_LOYALTY = { regional: 2.5, international: 5 } as const

export const loyaltyOf = (p: Player): number => p.loyalty ?? 50

export function shiftLoyalty(p: Player, delta: number): number {
  p.loyalty = Math.round(clamp(loyaltyOf(p) + delta, 0, 99))
  return p.loyalty
}

/**
 * A new club is a new start.
 *
 * Attachment is to a place, so it cannot travel with him. Somebody coming home
 * is the exception worth honouring: a player returning to a club he has played
 * for before keeps a good part of what he had.
 */
export function loyaltyOnJoin(p: Player, toTeamId: string): void {
  const been = (p.clubHist ?? []).some((s) => s.team === toTeamId)
  p.loyalty = been
    ? Math.round(clamp(Math.max(LOYALTY_NEW + 14, loyaltyOf(p) * 0.7), 0, 99))
    : LOYALTY_NEW
}

/**
 * The winter pass: everyone in the world gets a year older at their club.
 *
 * League-wide on purpose. Applied to one club alone, it would slowly become
 * unpoachable while every other club's stayed as easy to raid as on day one.
 */
export function growLoyalty(state: GameState): void {
  for (const p of Object.values(state.players)) {
    if (!p.teamId) continue
    // a season that started somewhere else is not a season served here
    if (p.joinedYear === state.year) continue
    shiftLoyalty(p, yearlyGain(loyaltyOf(p)))
  }
}

/** Everyone who was at the club when it won something. */
export function titleLoyalty(state: GameState, teamId: string, international: boolean): void {
  const gain = international ? TITLE_LOYALTY.international : TITLE_LOYALTY.regional
  for (const id of state.teams[teamId]?.roster ?? []) {
    const p = state.players[id]
    if (p) shiftLoyalty(p, gain)
  }
}
