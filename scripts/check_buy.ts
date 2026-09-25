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
import { autoPlan, WEEK_END_FATIGUE } from '../src/engine/me/auto'
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

// 2b. and the floor sits above where the steady week ends (auto.ts WEEK_END_FATIGUE), read off what buying does rather
// than off the constant: an ordinary week then has nothing for money to take off (shop.ts RELIEF_FLOOR). Added
// 2026-09-24 when the career pairs below (4) lost the half leak — RELIEF_FLOOR 30 — among the careers' own noise:
// fact 2 reads the floor it tests from the same constant, so no fact here said where the floor must be.
{
  const s = base()
  const p = s.players[s.me!.id]
  p.fatigue = 95
  buyRelax(s, 'trip')
  buyRelax(s, 'physio')
  const after = p.fatigue
  s.me!.relaxUsed = 0
  buyRelax(s, 'trip')
  buyRelax(s, 'physio')
  facts.push([`花钱恢复不把身体补到稳健一周的周末以下：疲劳 95 连买两趟旅行和两次理疗，停在 ${Math.round(p.fatigue)}（第一轮后 ${Math.round(after)}），要高于 ${WEEK_END_FATIGUE}`, p.fatigue > WEEK_END_FATIGUE && after > WEEK_END_FATIGUE])
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
// 2026-09-24: the rest is read over the weeks the two careers spend alike — the same club, both in its five or
// both off it — and no longer over the whole three seasons. Over the whole career it read the path, not the
// shop: the career that buys everything also has 金牌经纪人, which brings more offers, and a different club
// means a different number of matches and a different body. At 686990b seed 7 went TLA → 200 → MDR buying
// everything and stayed at TLA buying nothing: start-of-week fatigue 23 against 29, rest 135 → 85 (63%), while
// the shop took 0.7 fatigue a week off it; at f91ec98 it was seed 12, off to Giants and on the bench there. Over
// ten seeds the whole-career ratio sat at 85–87% on both sides, and 192f963 itself had seeds at 68% and 70%.
// The leak this is for — paid recovery turned into practice (a077001) — shows in any week where it happens,
// so the paired weeks still catch it (red on a077001's leak put back, 2026-09-24). A seed needs PAIRED_MIN such
// weeks to be read, and at least SEEDS_READ seeds must be.
//
// And the same matches that week (2026-09-24, on the batch 74a35e0 with carry-feel and fb-circuit merged): at one
// club, both in its five, the club's own results still part the two careers — seed 11's club went on a run in
// 2027 without the shop and went out early with it. In the 27 weeks of 147 where the two played a different
// number of matches the one buying nothing played 147 maps to 38, started each week at fatigue 48 against 31 and
// rested 63 times to 19; in the other 120 weeks, 71 to 62 (87%). A week of matches is what makes a body need
// rest, and the shop has no hand in how far the club goes, so the pair also plays the same matches.
//
// And the practice is read over those same weeks (2026-09-24, batch d75aa8f with club-rotation): over the whole
// career it read the path too — seed 11's two careers took different turns through the 替补 rotation and the
// bench, and the one buying everything trained 514 → 557 hours (+8.4%) while resting 88% as much as the other
// in the weeks they spent alike. Money buying practice shows in the week it happens, so the weeks they spend
// alike are where to look for it: the leak put back (RELIEF_FLOOR 0) and half of it (RELIEF_FLOOR 30) both
// still go red on these weeks (see the commit).
const PAIRED_MIN = 52
const SEEDS_READ = 3
// 2026-09-25, batch 00c863a (age-curve + match-rating): the peak too is read over the weeks the two careers
// spend at the same club — from the start up to the first week they are not (both without a club counts as
// the same) — and no longer over the whole three seasons. Seed 7 ended 81 → 84 buying everything while it
// trained less (578 → 547 hours): the one with 金牌经纪人 moved to its VCT club a year earlier (78 weeks in
// the first tier against 26), and a year sooner among better men is growth at 20 on the new age curve. Up to
// week 79, where the clubs part, the two stood level. A seed needs PAIRED_MIN such weeks to be read; the same
// bounds (tol on the mean, seedTol on any one seed) hold over the seeds read, and the whole-career peak is
// still printed.
//
// The peak is held one way: buying everything must not end stronger. Ending weaker is trophy luck, not a leak —
// on 2026-09-14, after the qualification fixes changed the world, seed 7 went 79 → 77 with 581 → 586 hours of
// practice, 146 → 145 of rest and no injuries either side; one seed's titles alone swing the peak −2…+4. The
// mark of money buying strength is the rest and the practice, and those stay held both ways above.
const gaps: string[] = []
let peakGap = 0
let worstSeed = -Infinity
let peakRead = 0
let trainOver = 0
let restShare = 1
let seedsRead = 0
const pairedAt: string[] = []
for (const seed of seeds) {
  const none = runCareer(seed, 'none', 'EMEA', '决斗者', 'chal', seasons)
  const all = runCareer(seed, 'all', 'EMEA', '决斗者', 'chal', seasons)
  const train = (r: typeof none) => ['aim', 'vod', 'util', 'ranked', 'scrim'].reduce((s, k) => s + (r.hours[k] ?? 0), 0)
  // the common start: every week so far at the same club (or both without one)
  let common = 0
  while (common < Math.min(none.track.length, all.track.length) && none.track[common].club === all.track[common].club) common++
  const peakTo = (r: typeof none) => Math.max(...r.track.slice(0, Math.max(1, common)).map((w) => w.overall))
  const prefixGap = peakTo(all) - peakTo(none)
  if (common >= PAIRED_MIN) {
    peakRead++
    peakGap += prefixGap
    worstSeed = Math.max(worstSeed, prefixGap)
  }
  const wholeOver = (train(all) - train(none)) / Math.max(1, train(none))
  // the weeks both careers spend alike: same club (or both without one), both in its five or both not, and
  // the same matches played and started that week
  let paired = 0, restNone = 0, restAll = 0, trainNone = 0, trainAll = 0
  for (let i = 0; i < Math.min(none.track.length, all.track.length); i++) {
    const a = none.track[i], b = all.track[i]
    if (a.club !== b.club || a.starter !== b.starter || a.played !== b.played || a.started !== b.started) continue
    paired++; restNone += a.rest; restAll += b.rest; trainNone += a.train; trainAll += b.train
  }
  pairedAt.push(`${seed}:${paired}周 休息 ${restNone}→${restAll} 训练 ${trainNone}→${trainAll}（整个生涯 ${wholeOver >= 0 ? '+' : ''}${(wholeOver * 100).toFixed(1)}%）`)
  if (paired >= PAIRED_MIN) {
    seedsRead++
    restShare = Math.min(restShare, restAll / Math.max(1, restNone))
    trainOver = Math.max(trainOver, (trainAll - trainNone) / Math.max(1, trainNone))
  }
  const tired = (r: typeof none) => Math.round(r.fatigueSum / Math.max(1, r.weeks))
  gaps.push(`seed ${seed}：同队的前 ${common} 周峰值 ${peakTo(none)} → ${peakTo(all)}（整个生涯 ${none.peak} → ${all.peak}），训练 ${train(none)} → ${train(all)} 小时，休息 ${none.hours.rest ?? 0} → ${all.hours.rest ?? 0}，带伤 ${none.weeksHurt} → ${all.weeksHurt} 周，周末平均疲劳 ${tired(none)} → ${tired(all)}`)
}
peakGap /= Math.max(1, peakRead)
if (!peakRead) worstSeed = 0
facts.push([`${seeds.length} 个种子各自什么都不买 vs 全买，${seasons} 季：同一支队的那段里综合峰值平均差 ${peakGap >= 0 ? '+' : ''}${peakGap.toFixed(2)}（全买平均最多高 ${tol}），单个种子最多差 ${worstSeed >= 0 ? '+' : ''}${worstSeed}（容许 ${seedTol}；${peakRead} 个种子够 ${PAIRED_MIN} 周，要 ${SEEDS_READ} 个以上）；同一支队、同样首发或替补、同样场数的周里，全买的休息至少是不买的 ${Math.round(restShare * 100)}%（要 ${REST_MIN * 100}% 以上；${seedsRead} 个种子够 ${PAIRED_MIN} 周，要 ${SEEDS_READ} 个以上），训练最多多 ${(trainOver * 100).toFixed(1)}%（容许 ${TRAIN_MAX * 100}%）`,
  peakGap <= tol && worstSeed <= seedTol && peakRead >= SEEDS_READ && restShare >= REST_MIN && seedsRead >= SEEDS_READ && trainOver <= TRAIN_MAX])
console.log(`  成对的周（种子:周数 休息 不买→全买）：${pairedAt.join('，')}`)

for (const g of gaps) console.log(`  ${g}`)
for (const [what, ok] of facts) console.log(`${ok ? '✓' : '✗'} ${what}`)
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 钱又能买到实力了：看上面哪一条没过。')
  process.exit(1)
}
console.log('\n✓ 钱买得到舒服、恢复和少受伤，买不到训练量和能力。')
