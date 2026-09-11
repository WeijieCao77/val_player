import { ratingOf } from '../player'
import type { EdgeBreakdown, GameState, MapScore, Player } from '../types'
import type { BoxRow, MeMatchRecord } from './types'

/**
 * Why that result happened.
 *
 * Ported from 破晓's postmatch.ts, with one difference in our favour: it had
 * to synthesise the other nine players' numbers, and we do not — the engine
 * simulates all ten and writes a real line for each.
 *
 * The rule is the same and it is the whole point of the module: **nothing here
 * is invented.** Every row is a term the engine actually added up when it
 * decided the round win rate, taken from the EdgeBreakdown it already records
 * on every map and which nothing has been reading. Rows are sorted by how much
 * they moved the result, and when the numbers were on our side and we lost
 * anyway, the screen says exactly that instead of hunting for a reason.
 */

export interface EdgeRow {
  key: string
  label: string
  /** ours minus theirs, in the engine's own strength units */
  diff: number
  /** what a player can do about it */
  advice: string
}

const LABELS: Record<string, { label: string; advice: string }> = {
  base: { label: '五人能力', advice: '这是阵容本身的差距，靠成长和转会' },
  igl: { label: '指挥', advice: '队内最高指挥值是全队乘数' },
  chem: { label: '默契', advice: '合练、双排、少换人' },
  coach: { label: '教练组', advice: '俱乐部的事，你只能影响信任' },
  comp: { label: '阵容结构', advice: '缺哨卫或缺控场都会扣在这里' },
  shortHanded: { label: '人手不齐', advice: '有人受伤或停赛' },
  map: { label: '地图熟练', advice: '跑图和复盘' },
  utility: { label: '道具', advice: '练道具与配合' },
  tacticsAtk: { label: '进攻战术', advice: '教练的战术盘' },
  tacticsDef: { label: '防守战术', advice: '教练的战术盘' },
  style: { label: '阵容风格', advice: '五个人的位置搭配' },
  matchup: { label: '战术克制', advice: '针对对面的阵容' },
  familiarity: { label: '特工池熟悉度', advice: '这套特工这张图打得少' },
  atk: { label: '进攻端', advice: '' },
  def: { label: '防守端', advice: '' },
}

/** the terms worth showing: the ones a player can read as a cause */
const SHOWN = ['base', 'igl', 'chem', 'comp', 'shortHanded', 'map', 'utility', 'style', 'matchup', 'familiarity', 'coach']

/**
 * Ours minus theirs on every term the engine used, biggest mover first.
 * `mineIsA` says which side of the breakdown was mine.
 */
export function edgeRows(map: MapScore, mineIsA: boolean): EdgeRow[] {
  if (!map.edge) return []
  const mine: EdgeBreakdown = mineIsA ? map.edge.a : map.edge.b
  const theirs: EdgeBreakdown = mineIsA ? map.edge.b : map.edge.a
  const rows: EdgeRow[] = []
  for (const key of SHOWN) {
    const a = (mine as unknown as Record<string, number | undefined>)[key]
    const b = (theirs as unknown as Record<string, number | undefined>)[key]
    if (a == null && b == null) continue
    const diff = (a ?? 0) - (b ?? 0)
    if (Math.abs(diff) < 0.05) continue
    const meta = LABELS[key] ?? { label: key, advice: '' }
    rows.push({ key, label: meta.label, diff: Math.round(diff * 10) / 10, advice: meta.advice })
  }
  return rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
}

/** The same, added over every map of the series. */
export function seriesEdgeRows(maps: MapScore[], mineIsA: boolean): EdgeRow[] {
  const sum = new Map<string, EdgeRow>()
  for (const m of maps) {
    for (const r of edgeRows(m, mineIsA)) {
      const cur = sum.get(r.key)
      if (cur) cur.diff = Math.round((cur.diff + r.diff) * 10) / 10
      else sum.set(r.key, { ...r })
    }
  }
  return [...sum.values()]
    .map((r) => ({ ...r, diff: Math.round((r.diff / Math.max(1, maps.length)) * 10) / 10 }))
    .filter((r) => Math.abs(r.diff) >= 0.05)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))
}

/**
 * What my own calls were worth, net, in the same units as the rows above —
 * so a player can see their decisions next to the squad's shortcomings.
 */
export function nodeNet(rec: MeMatchRecord): { made: number; missed: number; net: number } {
  const made = rec.nodes.filter((n) => n.ok).length
  const missed = rec.nodes.length - made
  const net = rec.nodes.reduce((s, n) => s + (n.after - n.before), 0)
  return { made, missed, net }
}

/**
 * The honest verdict. Four cases, and the first two are the ones the module
 * exists for: the account said we should have won and we did not, and the
 * account said we should have lost and we did.
 */
export function verdict(rec: MeMatchRecord, rows: EdgeRow[]): string {
  const total = rows.reduce((s, r) => s + r.diff, 0)
  const n = nodeNet(rec)
  const ahead = total > 1
  const behind = total < -1
  // the biggest thing that was against us, for the "no wonder" case
  const worst = rows.filter((r) => r.diff < 0)[0]?.label ?? '五人能力'

  if (ahead && !rec.won) {
    return `账面上你们领先 ${total.toFixed(1)}，还是输了。数值只决定每回合的胜率，不保证结果——这一场就是没走出来，不用找别的理由。`
  }
  if (behind && rec.won) {
    return `账面上你们落后 ${Math.abs(total).toFixed(1)}，赢下来了。${n.made > n.missed ? '你的临场决定是原因之一。' : '这一场赢在运气和队友。'}`
  }
  if (ahead && rec.won) {
    return `账面领先 ${total.toFixed(1)}，赢下来了。${n.missed > n.made ? '你的几次决定没打成，但队伍兜住了。' : ''}`
  }
  if (behind && !rec.won) {
    return `账面落后 ${Math.abs(total).toFixed(1)}，输得不冤。差得最多的是${worst}。`
  }
  // within a point of each other — the match was decided on the night
  return rec.won
    ? `两边账面基本持平（差 ${total.toFixed(1)}），你们拿下了。${n.made > n.missed ? '关键回合是你选对的。' : '这种局赢在临场。'}`
    : `两边账面基本持平（差 ${total.toFixed(1)}），输在临场。${n.missed > n.made ? '你有几次决定没打成。' : '不是数值的问题。'}`
}

/**
 * Everyone who played, both sides, from the engine's own per-player lines.
 * Nothing is synthesised: these are the numbers the match was actually
 * played with.
 */
export function boxScore(state: GameState, maps: MapScore[], mineIds: string[], theirIds: string[]): BoxRow[] {
  const totals = new Map<string, { k: number; d: number; a: number; dmg: number; fk: number; cl: number; r: number }>()
  for (const m of maps) {
    for (const [pid, l] of Object.entries(m.lines)) {
      const t = totals.get(pid) ?? { k: 0, d: 0, a: 0, dmg: 0, fk: 0, cl: 0, r: 0 }
      t.k += l.kills; t.d += l.deaths; t.a += l.assists; t.dmg += l.damage
      t.fk += l.firstKills; t.cl += l.clutches; t.r += l.rounds
      totals.set(pid, t)
    }
  }
  const meId = state.me?.id
  const row = (pid: string, mine: boolean): BoxRow | null => {
    const t = totals.get(pid)
    const p: Player | undefined = state.players[pid]
    if (!t || !p || !t.r) return null
    const acs = (t.dmg / t.r) * 1.45
    return {
      id: pid, ign: p.ign, role: p.role, mine, me: pid === meId,
      k: t.k, d: t.d, a: t.a, acs: Math.round(acs),
      rating: Math.round(ratingOf({ kills: t.k, deaths: t.d, assists: t.a, rounds: t.r }) * 100) / 100,
      firstKills: t.fk, clutches: t.cl, rounds: t.r,
    }
  }
  const out: BoxRow[] = []
  for (const id of mineIds) { const r = row(id, true); if (r) out.push(r) }
  for (const id of theirIds) { const r = row(id, false); if (r) out.push(r) }
  return out.sort((x, y) => (x.mine === y.mine ? y.rating - x.rating : x.mine ? -1 : 1))
}

/**
 * Where the night actually went wrong, on my own side.
 *
 * 破晓 hands the surplus loss to the teammates by arithmetic because it has no
 * real numbers for them. We do have real numbers, so this only reads them:
 * who on my five was under the line, and whether I was one of them.
 */
export function blameLine(rows: BoxRow[], rec: MeMatchRecord): string | null {
  const mine = rows.filter((r) => r.mine)
  if (mine.length < 2) return null
  const me = mine.find((r) => r.me)
  const mates = mine.filter((r) => !r.me)
  if (!me || !mates.length) return null
  const mateAvg = mates.reduce((s, r) => s + r.rating, 0) / mates.length
  const sank = mates.filter((r) => r.rating < 0.85)
  const n = nodeNet(rec)
  if (!rec.won && me.rating >= 1.05 && sank.length >= 2) {
    return `你打出了 ${me.rating.toFixed(2)}，队内还有 ${sank.length} 个人在 0.85 以下（${sank.map((r) => r.ign).join('、')}）。这场不是你的问题。`
  }
  if (!rec.won && me.rating < 0.85 && mateAvg >= 1.0) {
    return `队友均分 ${mateAvg.toFixed(2)}，你 ${me.rating.toFixed(2)}。这场是你没打出来。`
  }
  if (rec.won && me.rating < 0.85) {
    return `你 ${me.rating.toFixed(2)}，是被队友抬赢的（均分 ${mateAvg.toFixed(2)}）。`
  }
  if (!rec.won && n.made > n.missed && me.rating >= mateAvg) {
    return `你的决定净赚 ${n.net > 0 ? '+' : ''}${n.net} 个百分点，个人数据也在队伍均线之上，还是输了。`
  }
  return null
}
