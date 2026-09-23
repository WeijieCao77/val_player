/**
 * Targeted checks for the retirement-choice patch:
 * autopilot never volunteers retirement, manual season card still blocks,
 * forced endings stay intact and produce no duplicate side effects.
 *
 *   npx tsx scripts/check_retirement_choice.ts
 */
import { careerRegions, createCareer, emptyTalents, startBlocked } from '../src/engine/me/career'
import { autoWeek, autoResolve, runBlocked, advanceUntil, stopLine } from '../src/engine/me/auto'
import { retirementTick, seasonHorizonLine } from '../src/engine/me/endings'
import { Rng } from '../src/engine/rng'
import { WORLD_END } from '../src/engine/era'
import type { StartPoint } from '../src/engine/me/talent'
import type { Region } from '../src/engine/types'

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

const YEAR = 2026
const START: StartPoint = 'pre'
const region = careerRegions(YEAR).find((r) => !startBlocked(r, START, YEAR)) as Region
if (!region) {
  console.error('no open region for pre in 2026')
  process.exit(1)
}

function baseState(seed = 1) {
  const s = createCareer({ name: 'Probe', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: START, seed, year: YEAR })
  s.me!.pending = []
  return s
}

let bad = 0
function check(name: string, cond: boolean, extra?: string) {
  if (!cond) {
    bad++
    console.log(`✗ ${name}${extra ? ` —— ${extra}` : ''}`)
  }
}

// A voluntary retirement remains a manual decision with either career dial value.
for (const enabled of [false, true]) {
  const s = baseState()
  const me = s.me!
  me.retireAsk = true
  s.players[me.id].age = 31
  me.auto.career = enabled
  me.pending.push({ kind: 'season', id: String(s.year), day: s.day })
  const blocked = runBlocked(s)
  check(`manual season card blocks at 31, career=${enabled}`, blocked?.kind === 'season', blocked?.kind)
  const before = JSON.stringify(s)
  const result = advanceUntil(s, 'month')
  check('fast-forward pauses before the decision', result.weeks === 0 && JSON.stringify(s) === before)
  check('reason does not misreport an off dial', !!blocked && !stopLine(s, blocked).includes('没开'))
}

// 2 autopilot career dial on: season card is answered by continuing
{
  const s = baseState()
  const me = s.me!
  me.retireAsk = true
  s.players[me.id].age = 31
  me.auto.career = true
  me.pending.push({ kind: 'season', id: String(s.year), day: s.day })
  const before = me.phase
  autoResolve(s, me.pending[0])
  check('autoResolve season continues', me.phase === before && !me.pending.some(p => p.kind === 'season'), me.phase)
}

{
  const s = baseState()
  s.players[s.me!.id].age = 26
  const before = JSON.stringify(s)
  const text = seasonHorizonLine(s)
  check('horizon describes world cutoff, not a 26-year age cap', text.includes(String(WORLD_END - 1)) && text.includes('不是你的年龄上限') && text.includes('26'))
  check('horizon read is pure', JSON.stringify(s) === before)
}

// 3 2035 hard world end
{
  const s = baseState(2)
  const me = s.me!
  me.phase = 'pro'
  s.players[me.id].age = 30
  s.year = WORLD_END
  retirementTick(s, new Rng(1))
  check('2035 world end retires', me.phase === 'retired' && me.ending?.year === WORLD_END, `${me.phase} ${me.ending?.year}`)
}

// 4 age 33 cap
{
  const s = baseState(3)
  const me = s.me!
  me.phase = 'pro'
  s.players[me.id].age = 33
  s.year = 2030
  retirementTick(s, new Rng(1))
  check('age 33 cap retires', me.phase === 'retired', me.phase)
}

// 5 pre unsigned ending
{
  const s = baseState(4)
  const me = s.me!
  me.phase = 'pre'
  me.pre.year = 4
  s.players[me.id].age = 20
  s.year = 2027
  retirementTick(s, new Rng(1))
  check('four unsigned years retires', me.phase === 'retired', me.phase)
}

// 6 free uncalled ending
{
  const s = baseState(5)
  const me = s.me!
  me.phase = 'free'
  me.freeYears = 2
  s.players[me.id].age = 25
  s.year = 2028
  retirementTick(s, new Rng(1))
  check('two free years retires', me.phase === 'retired', me.phase)
}

// 7 no duplicate ending card on repeated retirement tick
{
  const s = baseState(6)
  const me = s.me!
  me.phase = 'pro'
  s.players[me.id].age = 33
  s.year = 2030
  retirementTick(s, new Rng(1))
  const endings = me.pending.filter(i => i.kind === 'ending').length
  retirementTick(s, new Rng(1))
  check('no duplicate ending card', me.pending.filter(i => i.kind === 'ending').length === endings, `count=${me.pending.filter(i => i.kind === 'ending').length}`)
}

// 8 full career under autoWeek reaches an ending without voluntary chose
{
  const s = baseState(7)
  const me = s.me!
  let weeks = 0
  while (me.phase !== 'retired' && weeks++ < 1320) {
    if (autoWeek(s).kind === 'game-over') break
  }
  check('full career reaches forced ending', me.phase === 'retired' && !!me.ending, `weeks=${weeks} phase=${me.phase}`)
  check('autopilot did not choose retirement', !(s.gameOver ?? '').includes('你决定退役'), s.gameOver)
}

console.log(bad ? `\n✗ ${bad} 项不对。` : `\n✓ retirement choice checks passed.`)
if (bad) process.exit(1)
