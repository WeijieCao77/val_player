import type { GameState } from '../types'
import type { LogKind } from './types'

/** One line in my own diary; the week screen and the log tab read this. */
export function pushLog(state: GameState, kind: LogKind, text: string): void {
  const me = state.me
  if (!me) return
  me.log.push({ day: state.day, year: state.year, kind, text })
  if (me.log.length > 400) me.log.splice(0, me.log.length - 400)
}
