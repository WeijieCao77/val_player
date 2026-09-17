/**
 * 生涯明细只保留最近一年的 —— engine/me/detail.ts.
 *
 * The per-match detail used to be capped at 120 records, so a long career
 * silently dropped its oldest matches and everything that read the list back
 * read less of the career the longer it ran. The rule is a year now, over the
 * career's own calendar. A year is a rule a player can hold in his head; the
 * price is that nothing which has to outlive a year may be counted off the
 * list, and that is what this checks.
 *
 * A career is played several seasons with 托管, every match it ever played
 * written down beside it, and then:
 *
 *  - the detail held is exactly the matches of the last year: nothing older is
 *    still there, and nothing inside the year was let go
 *  - the window really bites — a career this long played more than it holds
 *  - the totals that outlive the year are the career's own: MVPs, matches
 *    carried, finals lost, international matches, the longest run of defeats,
 *    and official starts — each against the whole history, not the window
 *  - the achievements that ask for a career total (一百场, 常客, 一个人在扛,
 *    三次倒在决赛, 八连败) answer off those totals
 *  - the day a year back is in, the day before it is out
 *  - an old save carrying more than a year of detail settles to the rule: its
 *    totals are read off what it carries — all its own conditions could see —
 *    and the detail inside the year is untouched. A save already holding the
 *    totals is not counted twice when it is read back
 *
 *   npx tsx scripts/check_detail.ts [seasons=6] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { DETAIL_DAYS, careerStarts, dayIdx, tallyOf, trimDetail } from '../src/engine/me/detail'
import { isFinal, isIntlComp } from '../src/engine/me/compclass'
import { ACH_BY_KEY } from '../src/engine/me/achievements'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import type { GameState } from '../src/engine/types'
import type { MeMatchRecord, MeState } from '../src/engine/me/types'

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

const seasons = Number(process.argv[2] ?? 6)
const seed = Number(process.argv[3] ?? 7)

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}
const key = (m: MeMatchRecord) => `${m.year}:${m.day}:${m.fixtureId}`
const clone = (s: GameState): GameState => unpackState(packState(s))

/** the totals a consumer needs past the year, worked out the long way from a whole history */
function totals(all: MeMatchRecord[]) {
  const t = { starts: 0, mvp: 0, carried: 0, finalLost: 0, intl: 0, skid: 0, skidBest: 0 }
  for (const m of all) {
    if (m.friendly || !m.started) continue
    t.starts++
    if (m.mvp) t.mvp++
    if (m.carried) t.carried++
    if (!m.won && !m.drawn && isFinal(m.label)) t.finalLost++
    if (isIntlComp(m.comp)) t.intl++
    if (!m.won && !m.drawn) { t.skid++; t.skidBest = Math.max(t.skidBest, t.skid) } else t.skid = 0
  }
  return t
}

/* ---- a career, and every match it ever played ---- */

const t0 = Date.now()
const state = createCareer({
  name: '明细', region: 'China', role: '决斗者', talents: emptyTalents(),
  originKey: 'netcafe', start: 't1', seed,
} as CareerOpts)
const me = state.me!
const seen = new Map<string, MeMatchRecord>()
const order: string[] = []
const watch = () => {
  for (const m of me.matches) {
    const k = key(m)
    if (seen.has(k)) continue
    seen.set(k, JSON.parse(JSON.stringify(m)) as MeMatchRecord)
    order.push(k)
  }
}
watch()

const startYear = state.year
let weeks = 0
let held = 0
const perYear: string[] = []
let lastYear = state.year
while (state.year < startYear + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
  if (autoWeek(state).kind === 'game-over') break
  weeks++
  watch()
  held = Math.max(held, me.matches.length)
  if (state.year !== lastYear) {
    perYear.push(`${lastYear} 年底 ${me.matches.length} 条`)
    lastYear = state.year
  }
}
watch()

const history = order.map((k) => seen.get(k)!)
const all = totals(history)
const from = dayIdx(state.year, state.day) - DETAIL_DAYS
const inYear = history.filter((m) => dayIdx(m.year, m.day) >= from)
const dropped = history.filter((m) => dayIdx(m.year, m.day) < from)
const bytes = (xs: MeMatchRecord[]) => JSON.stringify(xs).length

console.log(`打到 ${state.year} 年第 ${state.day} 天（${weeks} 周，${((Date.now() - t0) / 1000).toFixed(0)}s）：一共打了 ${history.length} 场，明细留着 ${me.matches.length} 条（最多时 ${held} 条）`)
console.log(`  ${perYear.join(' · ')}`)
console.log(`  明细 ${(bytes(me.matches) / 1000).toFixed(0)}KB；换成以前的 120 条上限是 ${(bytes(history.slice(-120)) / 1000).toFixed(0)}KB，整份历史是 ${(bytes(history) / 1000).toFixed(0)}KB`)

console.log('\n一、窗口就是最近一年')
check(dropped.length > 0, `这条生涯打得比一年长：${dropped.length} 场落在一年以外`)
check(me.matches.every((m) => dayIdx(m.year, m.day) >= from), '留着的每一条都在最近一年里')
{
  const heldKeys = new Set(me.matches.map(key))
  const want = new Set(inYear.map(key))
  const lost = [...want].filter((k) => !heldKeys.has(k))
  const extra = [...heldKeys].filter((k) => !want.has(k))
  check(lost.length === 0 && extra.length === 0,
    `一年以内的 ${want.size} 场一场不少，一年以外的一场不留（少 ${lost.length}、多 ${extra.length}）`)
}

console.log('\n二、要活过一年的数，按整条生涯算')
{
  const t = tallyOf(me)
  check(t.mvp === all.mvp && t.carried === all.carried && t.finalLost === all.finalLost && t.intl === all.intl && t.skidBest === all.skidBest,
    `MVP ${t.mvp}/${all.mvp}、扛 ${t.carried}/${all.carried}、决赛负 ${t.finalLost}/${all.finalLost}、国际赛 ${t.intl}/${all.intl}、最长连败 ${t.skidBest}/${all.skidBest}`)
  check(careerStarts(me) === all.starts, `生涯首发 ${careerStarts(me)} 场，和整条历史的 ${all.starts} 场对得上`)
  const win = totals(inYear)
  check(all.starts > win.starts, `只看窗口里的话首发只剩 ${win.starts} 场——所以这些数不能从明细里数`)
}

console.log('\n三、要生涯总数的成就，答的是生涯总数')
for (const [k, want] of [['matches100', all.starts >= 100], ['mvp10', all.mvp >= 10], ['carry5', all.carried >= 5], ['final_lost3', all.finalLost >= 3], ['losing_skid', all.skidBest >= 8]] as [string, boolean][]) {
  const a = ACH_BY_KEY[k]
  check(!!a && a.cond(state) === want, `${a?.name ?? k}：${a?.cond(state) ? '已达成' : '未达成'}，整条生涯说的是${want ? '已达成' : '未达成'}`)
}

console.log('\n四、边界：一年前的那天还在，前一天不在——跨年也是这个算法')
{
  const y = state.year
  const d = 10
  const at = (year: number, day: number): MeMatchRecord => ({ ...history[0], fixtureId: `edge:${year}:${day}`, year, day })
  const fake = { matches: [at(y - 2, 300), at(y - 1, d - 1), at(y - 1, d), at(y, 0)] } as MeState
  trimDetail(fake, y, d)
  const left = fake.matches.map((m) => `${m.year} 年第 ${m.day} 天`)
  check(fake.matches.length === 2 && fake.matches[0].year === y - 1 && fake.matches[0].day === d,
    `站在 ${y} 年第 ${d} 天：整整一年前的 ${y - 1} 年第 ${d} 天还在，它前一天的和更早的都放开（还剩 ${left.join('、')}）`)
}

console.log('\n五、老存档')
{
  // a save from before the window: no totals, and all the detail it could hold
  const old = clone(state)
  const om = old.me!
  delete om.tally
  om.matches = history.slice(-120).map((m) => ({ ...m }))
  const before = totals(om.matches)
  migratePlayerSave(old)
  const t = tallyOf(om)
  check(t.mvp === before.mvp && t.carried === before.carried && t.finalLost === before.finalLost && t.intl === before.intl && t.skidBest === before.skidBest,
    `120 条的老存档：总数按它自己拿得出的那些场算（MVP ${t.mvp}、扛 ${t.carried}、决赛负 ${t.finalLost}、国际赛 ${t.intl}、最长连败 ${t.skidBest}），它以前能答的一个不少`)
  const keep = new Set(om.matches.map(key))
  const want = new Set(history.slice(-120).filter((m) => dayIdx(m.year, m.day) >= dayIdx(old.year, old.day) - DETAIL_DAYS).map(key))
  check(keep.size === want.size && [...want].every((k) => keep.has(k)),
    `读档之后明细收到最近一年：留 ${keep.size} 条，一年以内的一条没丢`)
  check(om.matches.every((m) => dayIdx(m.year, m.day) >= dayIdx(old.year, old.day) - DETAIL_DAYS), '老存档里一年以外的明细都放开了')

  // a save written by this build: it already holds the totals, and reading it back must not count them twice
  const now = clone(state)
  migratePlayerSave(now)
  const t2 = tallyOf(now.me!)
  const t1 = tallyOf(me)
  check(t2.mvp === t1.mvp && t2.carried === t1.carried && t2.finalLost === t1.finalLost && t2.intl === t1.intl && t2.skidBest === t1.skidBest,
    '新存档读回来：总数原样，不会再数一遍')
  check(now.me!.matches.length === me.matches.length, `新存档读回来明细还是 ${me.matches.length} 条`)
}

if (bad) {
  console.log(`\n✗ 生涯明细有 ${bad} 处不对。`)
  process.exit(1)
}
console.log(`\n✓ 生涯明细只留最近一年：一年以内一条不少，一年以外一条不留；要活过一年的数按整条生涯算，老存档读进来照这个规矩收。`)
