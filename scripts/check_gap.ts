/**
 * Upset rate by strength gap: how often the weaker side takes a map and a
 * series, bucketed by the rating difference between the two clubs.
 *
 * This is the baseline behind "输赢随机性": before touching any clamp we
 * want to know what the round engine already produces at 13 rounds a map.
 *
 *   npx tsx scripts/check_gap.ts [matches=400] [seed=7] [bo=3]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { MatchSim } from '../src/engine/match'
import { Rng, hashStr } from '../src/engine/rng'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const n = Number(process.argv[2] ?? 400)
const seed = Number(process.argv[3] ?? 7)
const bo = Number(process.argv[4] ?? 3) as 1 | 3 | 5

const state = createCareer({ name: 'Probe', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed })
const ids = Object.keys(state.teams).filter((id) => !id.startsWith('CUP_') && state.teams[id].starters.length === 5)
const rng = new Rng(hashStr(`gap:${seed}`))

// bucket by |rating gap|; the stronger side is always "A" in the tally
const buckets = [
  { lo: 0, hi: 3, label: '0–3' }, { lo: 3, hi: 6, label: '3–6' }, { lo: 6, hi: 9, label: '6–9' },
  { lo: 9, hi: 12, label: '9–12' }, { lo: 12, hi: 16, label: '12–16' }, { lo: 16, hi: 99, label: '16+' },
]
const tally = buckets.map(() => ({ n: 0, seriesUpset: 0, maps: 0, mapUpset: 0, sweep: 0 }))

for (let i = 0; i < n; i++) {
  const a = ids[rng.int(0, ids.length - 1)]
  let b = ids[rng.int(0, ids.length - 1)]
  if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length]
  const gap = Math.abs(state.teams[a].rating - state.teams[b].rating)
  const strong = state.teams[a].rating >= state.teams[b].rating ? a : b
  const k = buckets.findIndex((x) => gap >= x.lo && gap < x.hi)
  if (k < 0) continue
  const sim = new MatchSim(state, a, b, bo, new Rng(hashStr(`gap:${seed}:${i}`)))
  const r = sim.runOut()
  const strongIsA = strong === a
  const strongMaps = strongIsA ? r.mapsWonA : r.mapsWonB
  const weakMaps = strongIsA ? r.mapsWonB : r.mapsWonA
  const t = tally[k]
  t.n++
  if (weakMaps > strongMaps) t.seriesUpset++
  t.maps += r.maps.length
  t.mapUpset += weakMaps
  if (weakMaps === 0) t.sweep++
}

console.log(`${n} × BO${bo}, seed ${seed}, ${ids.length} clubs\n`)
console.log('实力差     场次   弱队赢系列   弱队赢图   强队横扫')
for (let k = 0; k < buckets.length; k++) {
  const t = tally[k]
  if (!t.n) continue
  const pct = (x: number, d: number) => (d ? `${((x / d) * 100).toFixed(1).padStart(5)}%` : '   —  ')
  console.log(`${buckets[k].label.padEnd(9)} ${String(t.n).padStart(5)}   ${pct(t.seriesUpset, t.n)}      ${pct(t.mapUpset, t.maps)}     ${pct(t.sweep, t.n)}`)
}
