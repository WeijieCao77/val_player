/**
 * A card that stays up after the thing behind it is done.
 *
 * An event's result is the case (found 2026-09-14): the engine takes the event
 * off the list the moment it is answered (me/events.ts resolveEvent), so the
 * card showing it closed before it could say what the answer did. The card
 * hands its result here instead; PlayerGame draws it and holds the next card
 * the clock stopped on until it is closed. One at a time.
 */
import { useSyncExternalStore, type ReactNode } from 'react'

let held: ReactNode = null
const subs = new Set<() => void>()

/** Put a card up, or take it down with null. The caller commits, so the shell re-reads what waits behind it. */
export function holdCard(node: ReactNode): void {
  held = node
  subs.forEach((f) => f())
}

/** Whether a card is up now: read by the shell when it decides which card goes next. */
export const heldNow = (): boolean => held !== null

export function Held() {
  const node = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => held, () => held)
  return <>{node}</>
}
