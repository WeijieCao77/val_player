/**
 * Numbers or words: how an attribute is said on the career's screens.
 *
 * Ported from 破晓's 叙事 / 数值 switch (main.ts uiNum / DIM_WORDS). Its
 * players said 「数值扑面而来」; here it was the author, looking at a row of
 * 82 · 75 · 83 — a number alone does not say whether 82 is any good. So the
 * career speaks in tiers by default, 世界级 · 顶级 · 一流, and the corner switch
 * 「数值」 brings every number back. Nothing is hidden and nothing changes
 * underneath: the engine never reads this, and a headless run never sees it.
 *
 * The choice belongs to the device, the way the theme does (ui/theme.ts), so
 * it lives in localStorage and never rides along with a save. It takes over the
 * old 「数值 开/关」 strip switch: whoever had switched the strip off gets words,
 * which is what he was asking for; whoever switched it back on keeps numbers.
 */
import { useSyncExternalStore } from 'react'

const KEY = 'val_player.numbers'
/** the strip switch this replaced */
const OLD_KEY = 'val_player.pins'

function readNumbers(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    if (v === '1' || v === '0') return v === '1'
    return localStorage.getItem(OLD_KEY) === '1'
  } catch { return false }
}

const listeners = new Set<() => void>()
let current = readNumbers()

export function setNumbers(v: boolean): void {
  if (v === current) return
  current = v
  try { localStorage.setItem(KEY, v ? '1' : '0') } catch { /* private mode: lasts the session */ }
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
const read = () => current

/** [numbers shown, switch]; false means words. */
export function useNumbers(): [boolean, (v: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, read), setNumbers]
}

type Tiers = readonly (readonly [number, string])[]

/**
 * One ruler for the eight, 综合 and 上限, on this game's scale — anchored on
 * marks the game already has rather than invented. 世界级 is the achievement
 * of that name (综合 90). 一流 is where the new-career screen puts a VCT league
 * starter (「大多在 80 上下」) and where the rating badge turns good (78).
 * 职业级 is a Challengers starter (「六十几」, the badge's 68). Measured on the
 * 2026 world: VCT starters' attributes have a median of 86 (顶级), Challengers
 * starters' 68 (职业级), and a fresh seventeen-year-old reads 入门 to 扎实 —
 * a clear step under every club's bar, which is where he is.
 */
export const ATTR_TIERS: Tiers = [
  [90, '世界级'], [84, '顶级'], [78, '一流'], [68, '职业级'], [60, '扎实'], [52, '入门'], [-Infinity, '生疏'],
]
export const TIER_LADDER = ATTR_TIERS.map(([, w]) => w).reverse().join(' → ')

const tierOf = (table: Tiers, v: number) => table.findIndex(([at]) => v >= at)
export const attrWord = (v: number): string => ATTR_TIERS[tierOf(ATTR_TIERS, v)][1]
/** Higher is better; for "does the ceiling reach the next tier". */
export const attrRank = (v: number): number => ATTR_TIERS.length - tierOf(ATTR_TIERS, v)

// 心态 and 体质 run 0–100 from about 50 and fill up early: their own, plainer words
const MENTAL_TIERS: Tiers = [[90, '大心脏'], [75, '很稳'], [60, '稳'], [45, '一般'], [-Infinity, '容易慌']]
const BODY_TIERS: Tiers = [[90, '铁打的'], [75, '很好'], [60, '不错'], [45, '一般'], [-Infinity, '容易累']]
export const mentalWord = (v: number): string => MENTAL_TIERS[tierOf(MENTAL_TIERS, v)][1]
export const bodyWord = (v: number): string => BODY_TIERS[tierOf(BODY_TIERS, v)][1]
/** on the lines the 我的 page already names: training slows past 45, injuries climb past 70 */
export const fatigueWord = (v: number): string => (v >= 70 ? '透支' : v >= 45 ? '累' : v >= 25 ? '有点累' : '精神')
/** and play starts to drag past 55 */
export const tiltWord = (v: number): string => (v >= 75 ? '上头' : v >= 55 ? '烦躁' : v >= 30 ? '有点闷' : '平静')

/** A gap to a club's bar, on the transfer page's own lines: within 6 is worth a try, past 10 is a C or a D. */
export const gapWord = (gap: number): string => (gap <= 0 ? '够了' : gap <= 6 ? '差一点' : gap <= 10 ? '还差一截' : '差得远')

/**
 * How the coach reads me, in words. The career's own copy of the scale the
 * manager game used for its squad (engine/trust.ts), so no career screen
 * reads the manager's trust module.
 */
export function trustLabel(v: number): string {
  if (v >= 82) return '完全信任'
  if (v >= 66) return '信任'
  if (v >= 48) return '中立'
  if (v >= 30) return '有保留'
  return '已失去信任'
}

/** An in-round or duel readout judges on one of the eight or on 心态; say either in the current mode. */
export const sayDim = (nums: boolean, dim: string, v: number): string =>
  (nums ? String(Math.round(v)) : dim === 'mental' || dim === '心态' ? mentalWord(v) : attrWord(v))
