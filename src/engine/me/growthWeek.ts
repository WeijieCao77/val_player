import { ATTR_KEYS } from '../types'
import type { GameState } from '../types'
import type { GrowthWeekResult } from './types'

export function validGrowthReport(report: unknown): report is GrowthWeekResult {
  if (!report || typeof report !== 'object') return false
  const r = report as GrowthWeekResult
  return Number.isFinite(r.week) && Number.isFinite(r.year) && typeof r.complete === 'boolean' &&
    ATTR_KEYS.every(k => !!r.changes?.[k] && Number.isFinite(r.changes[k].points) && Number.isFinite(r.changes[k].progress) && typeof r.changes[k].capped === 'boolean')
}

/** Independent from the replay snapshot: purchases/duels seal undo, not this week's growth. */
export function ensureGrowthWeek(state: GameState, complete = false): void {
  const me = state.me
  const p = me && state.players[me.id]
  if (!me || !p) return
  if (me.lastGrowthWeek && !validGrowthReport(me.lastGrowthWeek)) delete me.lastGrowthWeek
  const old = me.growthWeek
  // A week can cross New Year. The lifetime week counter, not calendar year, identifies it.
  if (old?.week === me.week && Number.isFinite(old.year) && Number.isFinite(old.day) && typeof old.complete === 'boolean' && ATTR_KEYS.every(k => Number.isFinite(old.attrs?.[k]) && Number.isFinite(old.xp?.[k] ?? 0))) return
  me.growthWeek = { week: me.week, year: state.year, day: state.day, complete, attrs: { ...p.attrs }, xp: { ...p.xp } }
}

/** Read-only net change, including events/ageing. This is not a training-earned XP ledger. */
export function readGrowthWeek(state: GameState): GrowthWeekResult | undefined {
  const me = state.me, base = me?.growthWeek
  const p = me && state.players[me.id]
  if (!me || !base || base.week !== me.week || !p) return
  if (!ATTR_KEYS.every(k => Number.isFinite(base.attrs?.[k]) && Number.isFinite(base.xp?.[k] ?? 0))) return
  const changes = {} as GrowthWeekResult['changes']
  for (const k of ATTR_KEYS) {
    const points = p.attrs[k] - base.attrs[k]
    const capped = !!p.caps && p.attrs[k] >= p.caps[k]
    let progress = (p.xp[k] ?? 0) - (base.xp[k] ?? 0)
    // Clearing banked XP at a cap is not lost ability. Preserve real negative attribute changes.
    if (capped && points >= 0) progress = Math.max(progress, -100 * points)
    changes[k] = { points, progress, capped }
  }
  return { week: base.week, year: base.year, complete: base.complete, changes }
}

export function finishGrowthWeek(state: GameState): void {
  if (!state.me) return
  ensureGrowthWeek(state)
  state.me.lastGrowthWeek = readGrowthWeek(state)
}

/** Attribute-equivalent net progress: crossing 100 XP must not count the same growth twice. */
export const growthNet = (c: GrowthWeekResult['changes'][keyof GrowthWeekResult['changes']]): number =>
  Math.round((c.points + c.progress / 100) * 1000) / 1000
