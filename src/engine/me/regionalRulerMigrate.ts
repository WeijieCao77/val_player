import type { GameState } from '../types'
import { REGIONAL_RULER, lastRegionalRulerShift, rulerOn, shiftPlayer } from '../ruler'
import { refreshValue } from '../player'
import { pushLog } from './log'

/**
 * Only the added regional delta, once; no full-ruler replay, no nationality check,
 * and no reset to a player's book attributes (simulated growth remains his).
 * New worlds stamp at creation because timeline reads already include this delta.
 * Old v1 worlds first complete their existing v2/player-rank migration, then this
 * NPC-only step. Later winters keep the ordinary global holdScale, without a
 * second fixed regional deduction every January.
 */
export function migrateRegionalRuler(state: GameState): number {
  const me = state.me
  if (!me || !rulerOn(state) || (state.regionalRuler ?? 0) >= REGIONAL_RULER) return 0
  state.regionalRuler = REGIONAL_RULER
  let moved = 0
  for (const p of Object.values(state.players)) {
    if (p.id === me.id || !/^V\d+$/.test(p.id)) continue
    const d = lastRegionalRulerShift(state.year, p.id.slice(1))
    if (!d) continue
    shiftPlayer(p, d)
    refreshValue(p)
    moved++
  }
  if (!moved) return 0
  for (const team of Object.values(state.teams)) {
    if (team.dormant) continue
    const top = team.roster.map(id => state.players[id]?.overall ?? 0).sort((a, b) => b - a).slice(0, 5)
    if (top.length) team.rating = Math.round(top.reduce((a, b) => a + b, 0) / top.length)
  }
  const text = `赛区样本标尺更新：${moved} 位 NPC 的历史赛区上尾数值按同年样本做了有限校准，并保留国际强队表现的保护；不是按国籍扣分。你的属性、潜力、天赋与历史荣誉没有因此改变，之后读档不会重复扣除。`
  me.weekNotes.push(text)
  pushLog(state, 'info', text)
  return moved
}
