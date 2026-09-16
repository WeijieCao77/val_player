/**
 * 争执有多少，按种子看分布 —— the evidence behind section 七's band in scripts/check_igl.ts.
 *
 * Six seasons of 托管 as a 均衡型 决斗者 from a 2026 Challengers start, counting the 💢 lines of
 * each professional week that name me, exactly as scripts/check_igl.ts section 七 counts them.
 * Each line is split by what the team screen called the other man at the START of that week
 * (engine/bonds.ts BOND_TIGHT): a pair it calls 很铁 must never be in one.
 *
 * Why this exists (measured 2026-09-16). Section 七 asserted a mean of 10–20 over three seeds,
 * a band written as 「about twice the 7.7 before the room was live」. The mean over three seeds
 * is not a property of the system: the count per career runs from 0 to 38 in the same
 * configuration, so one career decides the average. In the world that introduced the band
 * (28917bc) the three seeds 7/8/9 gave 4 / 38 / 2 — a mean of 14.67, inside the band only
 * because seed 8 threw 38 — while the same five seeds 7/8/9/11/12 gave a mean of 9.00, already
 * outside it. On the merge train the same five give 9.20. The rate never was at twice the
 * pre-room level; the band measured one outlier.
 *
 * So the band is set from what this prints, over enough seeds that no single career carries it.
 *
 *   npx tsx scripts/probe_argue.ts [seeds=7,…,22]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { squadOf } from '../src/engine/roster'
import { bondBetween } from '../src/engine/bonds'
import type { Region } from '../src/engine/types'

// engine/bonds.ts BOND_TIGHT, inlined so this probe also runs at commits from before that
// export existed (28917bc, for the world the old band was calibrated in)
const BOND_TIGHT = 45

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

/**
 * The region each seed starts in. scripts/probe_igl.ts maps 7→Americas, 8→Pacific, 9→EMEA,
 * 10→China, 11→Americas, 12→Pacific: a four-cycle from seed 7, continued here to any seed.
 *
 * With one substitution: 2026 opens with no Challengers club in China, so a 二线 start there
 * throws (engine/me/career.ts pickClub, 「2026 年开季时 China 没有二线俱乐部可以签」). A seed the
 * cycle lands on China starts in EMEA instead — the same move the batch probes already make
 * (7149703: 2026 年中国二队开局改到 EMEA). Seeds 7, 8, 9, 11 and 12 keep the regions the
 * five-seed figures quoted above were measured with, so those numbers stay reproducible.
 */
const REGIONS: Region[] = ['Americas', 'Pacific', 'EMEA', 'China']
const regionOf = (seed: number): Region => {
  const r = REGIONS[(((seed - 7) % 4) + 4) % 4]
  return r === 'China' ? 'EMEA' : r
}

const seeds = process.argv[2]
  ? process.argv[2].split(',').map(Number)
  : Array.from({ length: 16 }, (_, i) => 7 + i)

const mean = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
const median = (a: number[]): number => {
  const s = a.slice().sort((x, y) => x - y)
  const h = Math.floor(s.length / 2)
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2
}
/** the most any one seed moves a statistic, by dropping each in turn */
const swing = (a: number[], f: (v: number[]) => number): number => {
  const all = f(a)
  let worst = 0
  for (let i = 0; i < a.length; i++) {
    const without = f(a.filter((_, j) => j !== i))
    worst = Math.max(worst, Math.abs(without - all))
  }
  return worst
}

const totals: number[] = []
let gTight = 0, gArgue = 0, gFeud = 0

console.log('seed | region | total | 很铁 | 其他 | 赛后争执 | 还没缓和')
for (const seed of seeds) {
  const region = regionOf(seed)
  const s = createCareer({ name: `P${seed}`, region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2026 })
  const me = s.me!
  const p = s.players[me.id]
  let weeks = 0, all = 0, tight = 0, other = 0, argues = 0, feuds = 0

  while (s.year < 2032 && me.phase !== 'retired' && weeks < 360) {
    // what the team screen said about each man when the week began
    const seen: Record<string, number> = {}
    if (me.phase === 'pro' && s.myTeam) {
      for (const x of squadOf(s, s.myTeam)) if (x.id !== me.id) seen[x.ign] = bondBetween(s, me.id, x.id)
    }
    const stop = autoWeek(s)
    weeks++
    if (me.phase === 'pro' && s.myTeam) {
      const mine = me.weekNotes.filter((n) => n.includes('💢') && n.includes(p.ign))
      all += mine.length
      argues += mine.filter((n) => n.includes('赛后起了争执')).length
      feuds += mine.filter((n) => n.includes('关系还没缓和')).length
      for (const n of mine) {
        const m = n.match(/^💢 (.+?) [和与] (.+?) (在赛后起了争执|的关系还没缓和)/)
        const who = m ? (m[1] === p.ign ? m[2] : m[1]) : ''
        if (seen[who] != null && seen[who] >= BOND_TIGHT) tight++
        else other++
      }
    }
    if (stop.kind === 'game-over') break
  }

  console.log(`${seed} | ${region} | ${all} | ${tight} | ${other} | ${argues} | ${feuds}`)
  totals.push(all)
  gTight += tight; gArgue += argues; gFeud += feuds
}

const n = totals.length
const sorted = totals.slice().sort((x, y) => x - y)
console.log('---')
console.log(`seeds ${seeds.join(',')} (n=${n})`)
console.log(`总数每条生涯：min ${sorted[0]} · max ${sorted[n - 1]} · 中位 ${median(totals).toFixed(1)} · 平均 ${mean(totals).toFixed(2)}`)
console.log(`排序后：${sorted.join(' ')}`)
console.log(`一个种子最多能动：平均 ${swing(totals, mean).toFixed(2)} · 中位 ${swing(totals, median).toFixed(2)}`)
console.log(`很铁合计 ${gTight}（必须是 0）· 赛后争执平均 ${(gArgue / n).toFixed(2)} · 还没缓和平均 ${(gFeud / n).toFixed(2)}`)
