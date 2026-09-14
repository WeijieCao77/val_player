import { clamp } from '../rng'
import { recomputeOverall, refreshValue } from '../player'
import { rereadWorld, rulerOn } from '../ruler'
import { ATTR_KEYS } from '../types'
import type { GameState, Player } from '../types'
import { ceilingPotential } from './bottleneck'
import { pushLog } from './log'

/**
 * A career saved before the rating ruler (engine/ruler.ts), brought onto it once
 * as it loads. The author's call, 2026-09-14 (方案 A1): the whole world is read
 * onto the ruler and the player moves with it by his rank, so where he stands
 * against the world is what it was; a note says so on the week screen and in 日志.
 *
 * His rank is among every player on a club that is still playing, himself left
 * out, before and after the world moves: the value at the same place in the new
 * order is where he goes. His eight move together, his eight ceilings with them,
 * so the room he had above each is the room he keeps; his 上限 is read off them
 * again. Nothing he has won or broken goes: titles, achievements and the breaks'
 * books are measured in what they added, not in where he stood. The season's
 * starting 综合 moves too, so the year's end says what the season did, not this.
 */

/** Everyone the scale is read over: players on a club still playing, the player himself left out. */
function field(state: GameState): number[] {
  const out: number[] = []
  for (const t of Object.values(state.teams)) {
    if (t.dormant) continue
    for (const id of t.roster) {
      const p = state.players[id]
      if (p && p.id !== state.me?.id) out.push(p.overall)
    }
  }
  return out.sort((a, b) => a - b)
}

/** Where `o` sits in an ascending list, 0 to 1, ties at their middle. */
const placeOf = (xs: number[], o: number): number =>
  xs.length ? (xs.filter((v) => v < o).length + xs.filter((v) => v === o).length / 2) / xs.length : 0.5

/** The value at place `q` of an ascending list. */
const atPlace = (xs: number[], q: number): number => xs[clamp(Math.round(q * xs.length - 0.5), 0, xs.length - 1)]

const median = (xs: number[]): number => (xs.length ? xs[Math.floor(xs.length / 2)] : 0)

/** His eight and his eight ceilings by `d` together; 上限 read off the ceilings again. */
function moveMe(p: Player, d: number): void {
  if (!d) return
  const before = p.overall
  for (const k of ATTR_KEYS) {
    const a = clamp(p.attrs[k] + d, 20, 99)
    if (p.caps) p.caps[k] = clamp(p.caps[k] + d, a, 99)
    p.attrs[k] = a
  }
  recomputeOverall(p)
  p.potential = p.caps ? ceilingPotential(p) : clamp(p.potential + (p.overall - before), p.overall, 99)
  refreshValue(p)
}

export interface RulerMove {
  year: number
  /** his 综合 before and after */
  from: number
  to: number
  /** his place among the field, before and after */
  placeFrom: number
  placeTo: number
  /** the field's median, before and after */
  worldFrom: number
  worldTo: number
}

/** The one-time read, or null for a save already on the ruler (or that has had it). */
export function migrateRuler(state: GameState): RulerMove | null {
  const me = state.me
  if (!me || rulerOn(state) || me.flags.rulerMoved) return null
  const p = state.players[me.id]
  if (!p) return null
  const before = field(state)
  if (before.length < 100) return null
  const from = p.overall
  const q = placeOf(before, from)
  rereadWorld(state)
  const after = field(state)
  moveMe(p, atPlace(after, q) - from)
  if (me.bottleneck && p.caps) me.bottleneck.pot = p.potential
  if (me.seasonStart.year === state.year) me.seasonStart.overall += p.overall - from
  me.flags.rulerMoved = state.year
  const d = p.overall - from
  // unread until the load notice is closed (PlayerGame.tsx): how far his 综合 moved, the notice says it
  me.flags.rulerNotice = d
  const text = `能力标尺更新：老存档里整个圈子一年比一年涨，国际赛几乎人人 90 以上。这次读档，所有人按新标尺一起重读了一遍，你也在内${d < 0 ? `，综合往下挪了 ${-d} 点` : d > 0 ? `，综合往上挪了 ${d} 点` : ''}；你在世界里的位置没变，拿到的荣誉和破开的瓶颈都在。以后每个冬天都按这把尺子读，世界不会再越涨越高。`
  me.weekNotes.push(text)
  pushLog(state, 'info', text)
  return { year: state.year, from, to: p.overall, placeFrom: +q.toFixed(3), placeTo: +placeOf(after, p.overall).toFixed(3), worldFrom: median(before), worldTo: median(after) }
}
