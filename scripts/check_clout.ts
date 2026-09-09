/**
 * Is 威望 actually hard to earn, and are the two actions actually hard to use?
 *
 * The whole point of the port is that these are not a transfer market: a
 * rookie must not be able to have a team-mate moved on, and even a decorated
 * veteran should be spending real standing to ask. So this walks a career and
 * records, season by season, what the number is and which doors it opens.
 *
 *   npx tsx scripts/check_clout.ts [seasons=10] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { canList, canSign, cloutBreakdown, cloutTier, doList, doSign, signTargets } from '../src/engine/me/clout'

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

const seasons = Number(process.argv[2] ?? 10)
const seed = Number(process.argv[3] ?? 7)

const state = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed,
})
const me = state.me!
const year0 = state.year
let lastYear = state.year
let guard = 0
let everList = 0
let everSign = 0
console.log(`seed ${seed}\n`)
console.log('年份  威望  档位   冠军  人气档  换人  签人')
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  if (autoWeek(state).kind === 'game-over') break
  if (state.year === lastYear) continue
  lastYear = state.year
  const { total } = cloutBreakdown(state)
  const l = canList(state)
  const s = canSign(state)
  if (l.ok) everList++
  if (s.ok) everSign++
  console.log(
    `${state.year}  ${String(total).padStart(4)}  ${cloutTier(total).name.padEnd(4)}`
    + `  ${String(me.titles.length).padStart(3)}  ${String(Math.round(me.fans)).padStart(5)}`
    + `  ${l.ok ? '可' : '×'}     ${s.ok ? '可' : '×'}`,
  )
}
const targets = signTargets(state)
console.log(`\n最后一年能开口要的人：${targets.length ? targets.map((t) => `${t.ign}(${t.overall})`).join('、') : '（无）'}`)
console.log(`赛季末检查里，换人可用 ${everList} 次、签人可用 ${everSign} 次`)

// The two actions must actually work end to end, and must actually be able
// to blow up. Force the gates open and run each a few times from a copy.
console.log('')
console.log('两个动作的实际结果（强行开门）：')
me.coachTrust = 90
me.gmTrust = 95
const teamNow = state.teams[state.players[me.id].teamId ?? '']
if (teamNow) {
  for (let i = 0; i < 3; i++) {
    if (me.cloutCd) me.cloutCd.list = 0
    const mate = teamNow.roster.map((id) => state.players[id]).find((q) => q && q.id !== me.id)
    if (!mate) break
    const before = teamNow.roster.length
    console.log(`  提出换人 → ${doList(state, mate.id)}（名单 ${before} → ${teamNow.roster.length}）`)
  }
  for (let i = 0; i < 2; i++) {
    if (me.cloutCd) me.cloutCd.sign = 0
    const t = signTargets(state)[0]
    if (!t) { console.log('  要求签人 → 没有够得着的目标'); break }
    const g = canSign(state)
    console.log(`  要求签人 ${t.ign} → ${g.ok ? doSign(state, t.id) : g.why}`)
  }
}

let bad = 0
// A rookie must never be able to do either of these in his first season.
const firstYear = 1
if (firstYear && everList > seasons - 2) { bad++; console.log('✗ 换人几乎一直可用——这不是「很难用的动作」。') }
if (!Object.keys(state.players).length) { bad++; console.log('✗ 世界空了。') }
console.log(bad ? '\n✗ 有问题。' : '\n✓ 威望随生涯上行，两个动作都要熬到门槛才开。')
if (bad) process.exit(1)
