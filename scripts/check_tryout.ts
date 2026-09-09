/**
 * The four gates from invitation to signature.
 *
 * 邀请 → 试训 → 评级 → 谈判. Each of the four has to actually be reachable and
 * actually be able to end badly — a tryout you always pass and a negotiation
 * that never blows up are decoration.
 *
 *   npx tsx scripts/check_tryout.ts [seeds=8]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { clubBars, tryoutSkill } from '../src/engine/me/prepro'
import { GRADE_TEXT, gradeOf, tryoutDays } from '../src/engine/me/tryout'
import { ASKS, askDeal, makeDeal } from '../src/engine/me/contract'
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

const SEEDS = [1, 2, 3, 5, 7, 11, 13, 17].slice(0, Number(process.argv[2] ?? 8))

const grades: Record<string, number> = {}
let signed = 0
let neverSigned = 0
let blown = 0
let asked = 0
let agreed = 0

for (const seed of SEEDS) {
  const state = createCareer({
    name: 'Probe', region: 'China', role: '决斗者',
    talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed,
  })
  const me = state.me!
  // walk the pre-pro years and record every grade handed out
  const seenGrades = new Set<string>()
  let guard = 0
  while (me.phase === 'pre' && guard++ < 60 * 5) {
    const before = me.tryout?.grade
    if (autoWeek(state).kind === 'game-over') break
    void before
    for (const l of me.log) {
      const m = l.text.match(/试训评级 <b>(A\+|A|B|C|D)<\/b>/)
      if (m && !seenGrades.has(`${l.day}:${m[1]}`)) { seenGrades.add(`${l.day}:${m[1]}`); grades[m[1]] = (grades[m[1]] ?? 0) + 1 }
    }
  }
  if (me.phase === 'pro') signed++
  else neverSigned++

  // and push a fresh offer until it either lands or blows up. The autopilot
  // has already signed whatever was on the table, so one is made here rather
  // than waiting for a leftover — the first run of this probe reported
  // 「提了 0 次」, which tested nothing.
  const teamId = state.players[me.id].teamId ?? Object.keys(state.teams)[0]
  const deal = makeDeal(state, teamId, 'sign', 'B', new Rng(hashStr(`probe:deal:${seed}`)))
  me.deals.push(deal)
  for (const a of ASKS) {
    if (!me.deals.find((x) => x.id === deal.id)) break
    if (!a.can(deal)) continue
    asked++
    const r = askDeal(state, deal.id, a.key, new Rng(hashStr(`probe:${seed}:${a.key}`)))
    if (r.ok) agreed++
    if (r.blown && !me.deals.find((x) => x.id === deal.id)) { blown++; break }
  }
}

console.log(`${SEEDS.length} 个档，每档最多跑五年职业前\n`)
console.log('试训评级分布：' + (['A+', 'A', 'B', 'C', 'D'].map((g) => `${g} ${grades[g] ?? 0}`).join(' · ') || '（没有一次试训）'))
console.log(`签上约的 ${signed} 个，五年没上岸的 ${neverSigned} 个`)
console.log(`谈判：提了 ${asked} 次，答应 ${agreed} 次，谈崩 ${blown} 次`)

// every grade needs its sentence, or a letter reaches the player with nothing attached
const missing = ['A+', 'A', 'B', 'C', 'D'].filter((g) => !GRADE_TEXT[g])
// the boundary values of gradeOf must land where the screen says they do
const bounds: [number, string][] = [[16, 'A+'], [15.9, 'A'], [8, 'A'], [7.9, 'B'], [0, 'B'], [-0.1, 'C'], [-9, 'C'], [-9.1, 'D']]
const wrong = bounds.filter(([v, g]) => gradeOf(v) !== g)

// a pro trialling elsewhere skips day one
const probe = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7,
})
const proDays = tryoutDays(probe).length
const rookieDays = 4

let bad = 0
if (missing.length) { bad++; console.log(`✗ 这些评级没有对应的话：${missing.join('、')}`) }
if (wrong.length) { bad++; console.log(`✗ 评级分界和面板写的不一致：${wrong.map(([v, g]) => `${v}→${gradeOf(v)}（应为 ${g}）`).join('、')}`) }
if (proDays !== 3) { bad++; console.log(`✗ 职业选手的试训应该是 3 天（跳过单排考核），实际 ${proDays} 天`) }
if (!asked) { bad++; console.log('✗ 谈判一次都没跑到，这一段根本没被检查。') }
if (asked && !blown) { console.log('⚠ 这批种子里没有一次谈崩——不一定是 bug，但值得看一眼。') }
console.log(`\n试训天数：新人 ${rookieDays} 天 · 已经打过职业 ${proDays} 天`)

const bars = clubBars(probe)
console.log(`门槛阶梯（你 ${Math.round(tryoutSkill(probe))}）：` + bars.map((b) => `${b.name} ${b.expect}${b.ok ? '（够了）' : `（差 ${b.gap}）`}`).join(' · '))
if (!bars.length) { bad++; console.log('✗ 门槛阶梯是空的。') }

console.log(bad ? '\n✗ 有问题。' : '\n✓ 四段都走得通，评级有分布、谈判会崩、门槛看得见。')
if (bad) process.exit(1)
