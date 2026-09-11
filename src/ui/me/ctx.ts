import { createContext, useContext } from 'react'
import type { Fixture, GameState } from '../../engine/types'

/**
 * What every career screen can reach: the running game and the shell's hands.
 *
 * The career's own context. The manager game's (ui/ctx.ts) also loads a save
 * into the running game, hands a fixture to its live view and opens a draw
 * ceremony; a career does none of those.
 */
export interface GameCtxValue {
  game: GameState
  /** re-render after the engine mutated state in place, and autosave */
  commit: () => void
  toast: (msg: string) => void
  /** open a player's card */
  openPlayer: (id: string) => void
  /** open a played match's sheet */
  openMatch: (f: Fixture) => void
  go: (screen: string) => void
  /** the week screen's tour for where the career is now (ui/me/guide.ts) */
  startTutorial: () => void
}

export const GameCtx = createContext<GameCtxValue | null>(null)

export function useGame(): GameCtxValue {
  const v = useContext(GameCtx)
  if (!v) throw new Error('useGame must be used inside GameCtx')
  return v
}
