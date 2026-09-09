/**
 * Does every dollar go through the one door?
 *
 * me/money.ts's whole claim is that after the port nothing can change
 * `me.money` without being booked. That claim is checkable: run a career for a
 * few seasons and assert
 *
 *     money_now  ===  money_at_start + lifetimeIn − lifetimeOut
 *
 * If any site still writes `me.money` directly, the two sides drift apart and
 * this fails. It also prints what a career actually earns, so the prize-share
 * numbers can be looked at rather than assumed.
 *
 *   npx tsx scripts/check_money.ts [seasons=4] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { KIND_CN, PRIZE_ROWS, prizePreview } from '../src/engine/me/money'
import type { GameState } from '../src/engine/types'

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

const seasons = Number(process.argv[2] ?? 4)
const seed = Number(process.argv[3] ?? 7)

const state: GameState = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
})
const me = state.me!
const money0 = me.money
const year0 = state.year

// Everything the ledger ever saw, not just this stage — cur is rotated away
// at every stage boundary, so the totals are accumulated here as we go.
const totalIn: Record<string, number> = {}
const totalOut: Record<string, number> = {}
let lastLabel = me.ledger!.label
const harvest = () => {
  const led = me.ledger!
  if (led.label === lastLabel) return
  // a rotation happened: bank what prev holds
  for (const [k, v] of Object.entries(led.prev?.in ?? {})) totalIn[k] = (totalIn[k] ?? 0) + v
  for (const [k, v] of Object.entries(led.prev?.out ?? {})) totalOut[k] = (totalOut[k] ?? 0) + v
  lastLabel = led.label
}

const prizeLines: string[] = []
let seenLog = 0

let guard = 0
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  const stop = autoWeek(state)
  harvest()
  for (const l of me.log.slice(seenLog)) if (l.text.includes('奖金分成到账')) prizeLines.push(`${l.year} ${l.text}`)
  seenLog = me.log.length
  if (stop.kind === 'game-over') break
}
harvest()
for (const [k, v] of Object.entries(me.ledger!.cur.in)) totalIn[k] = (totalIn[k] ?? 0) + v
for (const [k, v] of Object.entries(me.ledger!.cur.out)) totalOut[k] = (totalOut[k] ?? 0) + v

const led = me.ledger!
const expected = money0 + led.lifetimeIn - led.lifetimeOut
const drift = me.money - expected

console.log(`${year0} 起 ${state.year - year0} 季，seed ${seed}，最终 phase=${me.phase}\n`)
console.log('收入')
for (const [k, v] of Object.entries(totalIn).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(KIND_CN[k] ?? k).padEnd(10)} $${v.toLocaleString()}`)
}
console.log('支出')
for (const [k, v] of Object.entries(totalOut).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${(KIND_CN[k] ?? k).padEnd(10)} $${v.toLocaleString()}`)
}
console.log(`\n起始 $${money0.toLocaleString()}  进 $${led.lifetimeIn.toLocaleString()}  出 $${led.lifetimeOut.toLocaleString()}`)
console.log(`账面 $${me.money.toLocaleString()}   对账 $${expected.toLocaleString()}   差额 ${drift}`)

console.log(`\n赛事奖金分成，共 ${prizeLines.length} 笔：`)
for (const l of prizeLines.slice(0, 12)) console.log(`  ${l}`)
if (prizeLines.length > 12) console.log(`  …另有 ${prizeLines.length - 12} 笔`)

if (state.me && me.phase === 'pro') {
  const p = state.players[me.id]
  console.log(`\n当前合同分成 ${p.contract?.bonusShare ?? 0}%，队伍 ${state.teams[p.teamId ?? '']?.roster.length ?? 0} 人，冠/亚/四强到手：`)
  for (const r of PRIZE_ROWS) {
    const v = prizePreview(state, r.stage)
    if (!v.some((x) => x > 0)) continue
    console.log(`  ${r.name.padEnd(12)} ${v.map((x) => `$${x.toLocaleString()}`).join('  ')}`)
  }
}

if (drift !== 0) {
  console.log(`\n✗ 有 ${drift} 美元没走 addMoney()——还有地方在直接写 me.money。`)
  process.exit(1)
}
if (!prizeLines.length && me.phase === 'pro') {
  console.log('\n✗ 打了几个赛季一笔赛事奖金都没有，prizeWeek 没接上。')
  process.exit(1)
}
console.log('\n✓ 每一笔钱都走了唯一入口，账对得上。')
