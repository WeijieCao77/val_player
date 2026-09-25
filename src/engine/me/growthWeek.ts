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

type GrowthChange = GrowthWeekResult['changes'][keyof GrowthWeekResult['changes']]

/** Attribute-equivalent net progress: crossing 100 XP must not count the same growth twice. */
export const growthNet = (c: GrowthChange): number =>
  Math.round((c.points + c.progress / 100) * 1000) / 1000

const signedInt = (n: number) => `${n > 0 ? '+' : ''}${n}`

/**
 * What one attribute's week says, points first. It led with the net —「净增 +0.42 点」,
 * in words「有所成长」— and the summary listed every attribute with any progress, so a
 * week of 42 progress on 枪法 read as growth while 枪法 stayed 69 (reported 2026-09-24:
 * 「训练之后周增长是看得出来变化，可实际数值不变」). Over two seasons of the steady plan
 * (seed 7) 103 of 104 weeks listed an attribute whose number had not moved. The number
 * moves only when a bar fills; the head says whether it did, the note says the bar.
 */
export function growthWords(c: GrowthChange, nums: boolean): { head: string; note: string } {
  const head = c.points > 0 ? (nums ? `属性 ${signedInt(c.points)}` : '升了一点')
    : c.points < 0 ? (nums ? `属性 ${signedInt(c.points)}` : '掉了一点')
    : '属性未变'
  if (c.capped) return { head, note: '已到当前瓶颈，进度不再累积' }
  // what the week put into the bar, a filled bar counted as 100 (the raw delta goes negative when it crosses);
  // a point lost to age or an injury leaves the bar where it was
  const bar = Math.round(c.progress + Math.max(0, c.points) * 100)
  if (nums) return { head, note: bar > 0 ? `本周进度 +${bar}（满 100 升一点）` : bar < 0 ? `本周进度 ${bar}` : '本周没有进度' }
  if (c.points > 0) return { head, note: '' }
  return { head, note: bar > 0 ? '进度在涨，还没满一点' : bar < 0 ? '进度退了一些' : c.points === 0 ? '本周没有进度' : '' }
}

/** The summary line: which numbers moved, and which only filled their bars. */
export function growthSummary(r: GrowthWeekResult, cn: Record<string, string>): string {
  const keys = Object.keys(r.changes) as (keyof GrowthWeekResult['changes'])[]
  const rose = keys.filter((k) => r.changes[k].points > 0).map((k) => cn[k])
  const fell = keys.filter((k) => r.changes[k].points < 0).map((k) => cn[k])
  const filling = keys.filter((k) => r.changes[k].points === 0 && growthNet(r.changes[k]) > 0).map((k) => cn[k])
  const parts = [
    rose.length ? `升了：${rose.join('、')}` : '',
    fell.length ? `掉了：${fell.join('、')}` : '',
    filling.length ? `${rose.length || fell.length ? '另有' : '属性都没变，'}${filling.length === keys.length ? '八项' : filling.join('、')}在攒进度` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '暂无变化'
}
