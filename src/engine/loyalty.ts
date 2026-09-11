/**
 * 归属感: how attached a player is to this CLUB.
 *
 * It sat still for the whole game — set once when the world was built and
 * never written again — which produced a dead end the group found before I
 * did: a renewal refused with 「对这支球队没有太深的归属感」, and the answer to
 * 「忠诚度怎么刷呀」 being that you cannot. A game that names a blocker and
 * offers no remedy is worse than one that says nothing.
 *
 * The obvious fix — move it on how well the manager treats him — would have
 * made it a second copy of trust. So the two are split along the line that
 * actually separates them:
 *
 *   忠诚 is about the CLUB. Years served, trophies lifted here, and whether
 *          the club has ever tried to sell him. Sack the manager and it
 *          survives, because none of it was about the manager.
 *   信任 is about YOU. Rotation, fatigue, commercial days, promises kept.
 *          Follow the manager out of the door and it means nothing.
 *
 * The world's part — years served, titles, a new club being a new start — is
 * engine/attachment.ts, which every club in every save runs. What is left here
 * is the manager game's: what listing a man, turning down money for him or
 * re-signing him does to it, and how the manager's screens word it.
 */
import { shiftLoyalty } from './attachment'
import type { GameState, Player } from './types'

export {
  LOYALTY_NEW, TITLE_LOYALTY, growLoyalty, loyaltyOf, loyaltyOnJoin, shiftLoyalty, titleLoyalty, yearlyGain,
} from './attachment'

/** Being put on the list is the club telling him what he is worth to it. */
export const LISTED_COST = 14
/** Turning down real money for him says the opposite, and he hears that too. */
export const KEPT_GAIN = 4
/** Choosing to stay is itself a commitment. */
export const RENEWAL_GAIN = 5

/** 「在这里待了三年」/「刚来」 — the reading, not the number. */
export function loyaltyLabel(v: number): string {
  if (v >= 80) return '把这里当家'
  if (v >= 62) return '有归属感'
  if (v >= 45) return '还行'
  if (v >= 28) return '谈不上归属感'
  return '随时会走'
}

/**
 * Being put up for sale, at most once a season.
 *
 * A listing lapses after a fortnight and a permanently surplus player gets
 * re-listed at every window, which charged him four or five times a year and
 * drained the league: measured at −7.7 average loyalty across five seasons,
 * with twenty-nine players on the floor. The second listing in the same year
 * tells him nothing the first one did not.
 */
export function loyaltyOnListed(state: GameState, p: Player): void {
  if (p.loyaltyHitYear === state.year) return
  p.loyaltyHitYear = state.year
  shiftLoyalty(p, -LISTED_COST)
}
