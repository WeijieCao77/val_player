import { SEASON_DAYS } from '../calendar'
import type { GameState } from '../types'

/** A deliberate departure is not an automatic recruitment opportunity next week. */
export const CLUB_RETURN_DAYS = 56
const today = (s: GameState) => s.year * SEASON_DAYS + s.day

export function pruneClubDepartures(s: GameState): void {
  if (!s.me?.clubDepartures) return
  const now = today(s)
  const list = Array.isArray(s.me.clubDepartures) ? s.me.clubDepartures : []
  s.me.clubDepartures = list.filter(d => d && typeof d.teamId === 'string'
    && typeof d.playerId === 'string' && Number.isFinite(d.until)
    && d.until > now && d.until <= now + CLUB_RETURN_DAYS).slice(-64)
}

export function markClubDeparture(s: GameState, teamId: string, playerId: string): void {
  if (!s.me) return
  pruneClubDepartures(s)
  s.me.clubDepartures = [...(s.me.clubDepartures ?? []).filter(d => d.teamId !== teamId || d.playerId !== playerId),
    { teamId, playerId, until: today(s) + CLUB_RETURN_DAYS }].slice(-64)
}

export function isRecentClubDeparture(s: GameState, teamId: string, playerId: string): boolean {
  const list = s.me?.clubDepartures
  return Array.isArray(list) && list.some(d => d && d.teamId === teamId && d.playerId === playerId
    && Number.isFinite(d.until) && d.until > today(s) && d.until <= today(s) + CLUB_RETURN_DAYS)
}
