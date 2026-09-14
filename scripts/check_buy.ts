/**
 * Money does not buy strength.
 *
 * The author's stance, and the shop's rule (me/shop.ts). Measured 2026-09-14
 * (scripts/probe_buy.ts, 托管's steady week, 8 seasons from a Challengers
 * start): a career that bought everything the moment it could ended +1.0 peak
 * 综合 above the same seed buying nothing — and 理疗 and short trips alone did
 * all of it, by taking fatigue off for free so the steady plan swapped rest for
 * practice (228 fewer hours of rest, 146 more of training). This holds the shop
 * to four things:
 *
 *  1. a week of the same plan trains exactly the same with the whole shop
 *     bought (flagship gear, every course, the flat) as with nothing;
 *  2. paid recovery takes fatigue down to RELIEF_FLOOR and no further;
 *  3. the steady plan, on a week that starts under that floor, plans the same
 *     hours with 理疗 and a trip bought as without;
 *  4. careers paired on their seed, nothing bought against everything, stay
 *     within `tol` of peak 综合, and the one buying everything still rests
 *     (REST_MIN) and does not practise more (TRAIN_MAX).
 *
 *   npx tsx scripts/check_buy.ts [seasons=3] [seeds=7] [tol=1]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan } from '../src/engine/me/auto'
import { settleTraining } from '../src/engine/me/growth'
import { COURSES, GEAR_SLOTS, RELAX, RELIEF_FLOOR, buyCourse, buyGear, buyRelax } from '../src/engine/me/shop'
import { Rng } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'
import { runCareer } from './probe_buy'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

const seasons = Number(process.argv[2] ?? 3)
const seeds = (process.argv[3] ?? '7').split(',').map(Number)
const tol = Number(process.argv[4] ?? 1)

const facts: [string, boolean][] = []
const base = (): GameState => {
  const s = createCareer({ name: 'Buy', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: seeds[0] })
  s.me!.money = 1_000_000
  return s
}

// 1. the same week's practice, with and without the shop
{
  const plain = base()
  const rich = structuredClone(plain)
  for (const g of GEAR_SLOTS) { buyGear(rich, g.key); buyGear(rich, g.key) }
  for (const c of COURSES) buyCourse(rich, c.key)
  buyRelax(rich, 'flat')
  const plan = { aim: 1, vod: 1, util: 1, ranked: 1 }
  const xp: string[] = []
  for (const s of [plain, rich]) {
    s.me!.plan = { ...plan }
    s.players[s.me!.id].fatigue = 20
    settleTraining(s, new Rng(12345), [])
    const p = s.players[s.me!.id]
    xp.push(JSON.stringify(ATTR_KEYS.map((k) => [p.attrs[k], Math.round((p.xp[k] ?? 0) * 1000)])))
  }
  const gear = GEAR_SLOTS.every((g) => rich.me!.gear[g.key] === 2)
  facts.push([`同一周同样的训练：五件旗舰外设、四门课、电竞公寓全买，和什么都不买练出来的一样${gear ? '' : '（外设没买齐）'}`, gear && rich.me!.courses.length === COURSES.length && xp[0] === xp[1]])
}

// 2. paid recovery stops at the floor
{
  const s = base()
  const p = s.players[s.me!.id]
  const price = (k: string) => RELAX.find((r) => r.key === k)!
  p.fatigue = RELIEF_FLOOR - 15
  buyRelax(s, 'physio')
  const rested = p.fatigue
  s.me!.relaxUsed = 0
  p.fatigue = 80
  buyRelax(s, 'physio')
  const tired = p.fatigue
  s.me!.relaxUsed = 0
  p.fatigue = 60
  buyRelax(s, 'trip')
  const trip = p.fatigue
  facts.push([`理疗和短途旅行只把疲劳降到 ${RELIEF_FLOOR}（体力 ${100 - RELIEF_FLOOR}）为止：疲劳 ${RELIEF_FLOOR - 15} 买理疗还是 ${rested}，80 买理疗到 ${tired}，60 出去走走到 ${trip}`,
    rested === RELIEF_FLOOR - 15 && tired === Math.max(RELIEF_FLOOR, 80 + price('physio').fatigue) && trip === RELIEF_FLOOR])
}

// 3. the steady plan does not turn paid recovery into practice on a rested week
{
  const plain = base()
  const p0 = plain.players[plain.me!.id]
  p0.fatigue = 30
  const bought = structuredClone(plain)
  buyRelax(bought, 'physio')
  buyRelax(bought, 'trip')
  buyRelax(bought, 'flat')
  autoPlan(plain)
  autoPlan(bought)
  facts.push([`一周从疲劳 30 开始：买了理疗、旅行、电竞公寓，托管排的训练和不买一样（${JSON.stringify(plain.me!.plan)}）`, JSON.stringify(plain.me!.plan) === JSON.stringify(bought.me!.plan)])
}

// 4. careers paired on their seed
// the leak's mark was the rest: at no floor the career buying everything rested 15% of what the one buying nothing did
// (248 hours fewer in 8 seasons) and trained 11% more; with the floor, 90–100% and ±3%. One seed over three seasons moves
// the training hours by about ±5% on its own, so the rest is held to 70% and the practice to +8%.
const REST_MIN = 0.7
const TRAIN_MAX = 0.08
// The peak is held one way: buying everything must not end stronger. Ending weaker is trophy luck, not a leak —
// on 2026-09-14, after the qualification fixes changed the world, seed 7 went 79 → 77 with 581 → 586 hours of
// practice, 146 → 145 of rest and no injuries either side; one seed's titles alone swing the peak −2…+4. The
// mark of money buying strength is the rest and the practice, and those stay held both ways above.
const gaps: string[] = []
let peakGap = 0
let trainOver = 0
let restShare = 1
for (const seed of seeds) {
  const none = runCareer(seed, 'none', 'EMEA', '决斗者', 'chal', seasons)
  const all = runCareer(seed, 'all', 'EMEA', '决斗者', 'chal', seasons)
  const train = (r: typeof none) => ['aim', 'vod', 'util', 'ranked', 'scrim'].reduce((s, k) => s + (r.hours[k] ?? 0), 0)
  peakGap += all.peak - none.peak
  trainOver = Math.max(trainOver, (train(all) - train(none)) / Math.max(1, train(none)))
  restShare = Math.min(restShare, (all.hours.rest ?? 0) / Math.max(1, none.hours.rest ?? 0))
  const tired = (r: typeof none) => Math.round(r.fatigueSum / Math.max(1, r.weeks))
  gaps.push(`seed ${seed}：峰值 ${none.peak} → ${all.peak}，训练 ${train(none)} → ${train(all)} 小时，休息 ${none.hours.rest ?? 0} → ${all.hours.rest ?? 0}，带伤 ${none.weeksHurt} → ${all.weeksHurt} 周，周末平均疲劳 ${tired(none)} → ${tired(all)}`)
}
peakGap /= seeds.length
facts.push([`同一个种子什么都不买 vs 全买，${seasons} 季：综合峰值平均差 ${peakGap >= 0 ? '+' : ''}${peakGap.toFixed(2)}（全买最多高 ${tol}）；全买的休息至少是不买的 ${Math.round(restShare * 100)}%（要 ${REST_MIN * 100}% 以上），训练最多多 ${(trainOver * 100).toFixed(1)}%（容许 ${TRAIN_MAX * 100}%）`,
  peakGap <= tol && restShare >= REST_MIN && trainOver <= TRAIN_MAX])

for (const g of gaps) console.log(`  ${g}`)
for (const [what, ok] of facts) console.log(`${ok ? '✓' : '✗'} ${what}`)
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 钱又能买到实力了：看上面哪一条没过。')
  process.exit(1)
}
console.log('\n✓ 钱买得到舒服、恢复和少受伤，买不到训练量和能力。')
