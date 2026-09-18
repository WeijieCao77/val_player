/**
 * One event another screen asked to be shown: the week page's 「下一场」 names
 * my club's next event, and its 「赛事详情 →」 opens 「积分榜」 on that event's
 * panel (ui/me/Standings.tsx) rather than at the top of the page. A value
 * handed across one screen change, read by the page it opens and then let go.
 */
let wanted: string | null = null

/** The anchor an event's panel carries on 「积分榜」. */
export const eventAnchor = (compKey: string): string => `ev-${compKey}`

/** Ask for this event on the next 「积分榜」. */
export function focusEvent(compKey: string): void {
  wanted = compKey
}

/** The event asked for, if any; it stays asked until letEventGo. */
export const wantedEvent = (): string | null => wanted

export function letEventGo(): void {
  wanted = null
}
