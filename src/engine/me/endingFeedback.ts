import type { GameState } from '../types'

/** Career-owned, saved with the ending: 1 = waiting, 2 = already shown.
 * Missing means an older finished career, not a reason to prompt on every load.
 */
export const ENDING_FEEDBACK_FLAG = 'endingFeedback'

export function queueEndingFeedback(state: GameState): void {
  const me = state.me
  if (me?.phase === 'retired' && me.ending && me.flags[ENDING_FEEDBACK_FLAG] === undefined) {
    me.flags[ENDING_FEEDBACK_FLAG] = 1
  }
}

export function endingFeedbackReady(state: GameState): boolean {
  const me = state.me
  return !!me && me.phase === 'retired' && !!me.ending
    && me.flags[ENDING_FEEDBACK_FLAG] === 1 && me.pending.length === 0
}

/** Called only after the unobstructed prompt has rendered, never while the ending card is up. */
export function noteEndingFeedbackShown(state: GameState): boolean {
  if (!endingFeedbackReady(state)) return false
  state.me!.flags[ENDING_FEEDBACK_FLAG] = 2
  return true
}
