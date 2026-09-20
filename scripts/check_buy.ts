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
 *     within `tol` of peak 综合 on average and `seedTol` on any one seed, and the
 *     one buying everything still rests (REST_MIN) and does not practise more
 *     (TRAIN_MAX).
 *
 * Why 4 is read over five seeds (2026-09-16). It used to be one, and one career
 * is one path: on seed 7 the career that bought everything peaked 2 over the one
 * that bought nothing while its training, rest and injury hours were all but
 * identical (581 → 586 practice, 146 → 145 rest, no injuries either side) — the
 * gap was a title and a move, not an hour of practice. Over seeds 7, 8, 9, 11 and
 * 12 the same comparison averages +0.40. So the peak is held two ways: the
 * average across the five within `tol`, and no single seed past `seedTol`, which
 * is the band one career's trophies can swing on their own. The hours are what
 * money could actually buy, and they stay held exactly as strictly as before.
 *
 *   npx tsx scripts/check_buy.ts [seasons=3] [seeds=7,8,9,11,12] [tol=1] [seedTol=2]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan } from '../src/engine/me/auto'
import { doAction } from '../src/engine/me/week'
import { COURSES, GEAR_SLOTS, RELAX, RELIEF_FLOOR, buyCourse, buyGear, buyRelax } from '../src/engine/me/shop'
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
const seeds = (process.argv[3] ?? '7,8,9,11,12').split(',').map(Number)
const tol = Number(process.argv[4] ?? 1)
const seedTol = Number(process.argv[5] ?? 2)

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
  // the same four clicks, in the same order, on the same body (me/week.ts doAction)
  const week = ['aim', 'vod', 'util', 'ranked'] as const
  const xp: string[] = []
  for (const s of [plain, rich]) {
    s.players[s.me!.id].fatigue = 20
    for (const k of week) doAction(s, k)
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
  facts.push([`一周从疲劳 30 开始：买了理疗、旅行、电竞公寓，按推荐做完的这一周和不买一样（${JSON.stringify(plain.me!.plan)}）`, JSON.stringify(plain.me!.plan) === JSON.stringify(bought.me!.plan)])
}

// 4. careers paired on their seed
// the leak's mark was the rest: at no floor the career buying everything rested 15% of what the one buying nothing did
// (248 hours fewer in 8 seasons) and trained 11% more; with the floor, 90–100% and ±3%. One seed over three seasons moves
// the training hours by about ±5% on its own, so the rest is held to 70% and the practice to +8%.
//
// 2026-09-20, lowered 0.70 → 0.65 by the author's own call (「不要管这个 check buy，68 我能接受」) after the
// instant-action week landed: a plan is now spent card by card instead of being laid out for the week, so a
// rested player's coach reaches for 休息 less often. Measured at the same three seasons: 79% at 36f7ab7,
// 68% here. The leak this check exists for did NOT move — the peak gap stayed inside its bounds (+0.20 mean,
// worst seed +1 of 2 allowed) and practice inside its own (+4.4% of 8%), which are the two that say money
// bought strength. Only this proxy moved. If it ever falls under 0.60, or if the peak or practice bound goes
// with it, that is the leak coming back: find the cause, do not lower this again.
const REST_MIN = 0.65
const TRAIN_MAX = 0.08
// The peak is held one way: buying everything must not end stronger. Ending weaker is trophy luck, not a leak —
// on 2026-09-14, after the qualification fixes changed the world, seed 7 went 79 → 77 with 581 → 586 hours of
// practice, 146 → 145 of rest and no injuries either side; one seed's titles alone swing the peak −2…+4. The
// mark of money buying strength is the rest and the practice, and those stay held both ways above.
const gaps: string[] = []
let peakGap = 0
let worstSeed = -Infinity
let trainOver = 0
let restShare = 1
for (const seed of seeds) {
  const none = runCareer(seed, 'none', 'EMEA', '决斗者', 'chal', seasons)
  const all = runCareer(seed, 'all', 'EMEA', '决斗者', 'chal', seasons)
  const train = (r: typeof none) => ['aim', 'vod', 'util', 'ranked', 'scrim'].reduce((s, k) => s + (r.hours[k] ?? 0), 0)
  peakGap += all.peak - none.peak
  worstSeed = Math.max(worstSeed, all.peak - none.peak)
  trainOver = Math.max(trainOver, (train(all) - train(none)) / Math.max(1, train(none)))
  restShare = Math.min(restShare, (all.hours.rest ?? 0) / Math.max(1, none.hours.rest ?? 0))
  const tired = (r: typeof none) => Math.round(r.fatigueSum / Math.max(1, r.weeks))
  gaps.push(`seed ${seed}：峰值 ${none.peak} → ${all.peak}，训练 ${train(none)} → ${train(all)} 小时，休息 ${none.hours.rest ?? 0} → ${all.hours.rest ?? 0}，带伤 ${none.weeksHurt} → ${all.weeksHurt} 周，周末平均疲劳 ${tired(none)} → ${tired(all)}`)
}
peakGap /= seeds.length
facts.push([`${seeds.length} 个种子各自什么都不买 vs 全买，${seasons} 季：综合峰值平均差 ${peakGap >= 0 ? '+' : ''}${peakGap.toFixed(2)}（全买平均最多高 ${tol}），单个种子最多差 ${worstSeed >= 0 ? '+' : ''}${worstSeed}（容许 ${seedTol}）；全买的休息至少是不买的 ${Math.round(restShare * 100)}%（要 ${REST_MIN * 100}% 以上），训练最多多 ${(trainOver * 100).toFixed(1)}%（容许 ${TRAIN_MAX * 100}%）`,
  peakGap <= tol && worstSeed <= seedTol && restShare >= REST_MIN && trainOver <= TRAIN_MAX])

for (const g of gaps) console.log(`  ${g}`)
for (const [what, ok] of facts) console.log(`${ok ? '✓' : '✗'} ${what}`)
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 钱又能买到实力了：看上面哪一条没过。')
  process.exit(1)
}
console.log('\n✓ 钱买得到舒服、恢复和少受伤，买不到训练量和能力。')
