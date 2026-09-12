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
 * numbers can be looked at rather than assumed, and holds the prize table to a
 * few amounts anyone can check on Liquipedia — and the estimates for the events
 * that never published theirs to their rules.
 *
 *   npx tsx scripts/check_money.ts [seasons=4] [seed=7]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { KIND_CN, prizeRows } from '../src/engine/me/money'
import { prizeFor, prizeNote, prizeTableOf } from '../src/engine/me/prizes'
import estimates from '../src/data/prize_estimates_me.json'
import type { Competition, GameState } from '../src/engine/types'

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
  // 2026 opens on the real 2026, whose Chinese second-tier clubs play their first event in the summer:
  // a Challengers start is a European club's
  name: 'Probe', region: 'Europe', role: '决斗者',
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
  console.log(`\n当前合同分成 ${p.contract?.bonusShare ?? 0}%，队伍 ${state.teams[p.teamId ?? '']?.roster.length ?? 0} 人，接下来的赛事冠/亚/季军到手：`)
  for (const r of prizeRows(state)) {
    const shown = r.table.status === 'paid' || r.table.status === 'est'
    const v = shown ? r.mine.map((x) => `$${x.toLocaleString()}`).join('  ') : r.table.status === 'none' ? '无奖金' : '奖金未公开'
    const note = prizeNote(r.table)
    console.log(`  ${r.name}  ${v}${note ? `（${note}）` : ''}`)
  }
}

// the table is the events' own: amounts anyone can look up on the events' Liquipedia pages
const ev = (id: string): Competition =>
  ({ key: `ev:${id}`, name: id, stage: 'champions', teams: [], standings: {}, finished: [], circuit: { id, start: 0, end: 0, seeds: [] } }) as Competition
const table = (id: string, y: number) => prizeTableOf(ev(id), y)

// every estimate pays each playoff place, the champion more than the runner-up, the semi-finalists more than the quarter-finalists, and those more than the rest
type Row = [number, number, number]
const EST = (estimates as unknown as { events: Record<string, { playoffs: number; pay: Row[] }> }).events
const amountAt = (pay: Row[], p: number): number => pay.find(([a, b]) => p >= a && p <= b)?.[2] ?? 0
const misordered = Object.entries(EST).filter(([, e]) => {
  const tiers = ([[1, 1], [2, 2], [3, 4], [5, 8], [9, 64]] as const)
    .map(([a, b]) => { const xs: number[] = []; for (let p = a; p <= Math.min(b, e.playoffs); p++) xs.push(amountAt(e.pay, p)); return xs })
    .filter((t) => t.length)
  return tiers.some((t) => t.some((v) => !(v > 0))) || tiers.some((t, i) => i > 0 && !(Math.min(...tiers[i - 1]) > Math.max(...t)))
}).map(([id]) => id)

const facts: [string, boolean][] = [
  ['2021 冠军赛冠军 $350,000', prizeFor(ev('449'), 1, 2021) === 350000],
  ['2023 冠军赛冠军 $1,000,000、亚军 $400,000', prizeFor(ev('1657'), 1, 2023) === 1000000 && prizeFor(ev('1657'), 2, 2023) === 400000],
  ['东京大师赛冠军 $350,000', prizeFor(ev('1494'), 1, 2023) === 350000],
  ['东京大师赛并列第三平分三、四名（$125,000 与 $75,000）', prizeFor(ev('1494'), 3, 2023, 2) === 100000],
  ['2027 冠军赛按 2026 年金额暂定', table('F2027:champions', 2027).basis === 2026 && prizeFor(ev('F2027:champions'), 1, 2027) === 1000000],
  // a real table is left as it was published, even where it stops short of the playoffs
  ['真实表不变：2024 美洲联赛第二赛段付 1–6 名 $100,000…$10,000，第 7 名仍是 0',
    table('2095', 2024).status === 'paid' && JSON.stringify(table('2095', 2024).pay) === '[[1,1,100000],[2,2,65000],[3,3,40000],[4,4,25000],[5,6,10000]]'
    && prizeFor(ev('2095'), 7, 2024) === 0 && prizeNote(table('2095', 2024)) === ''],
  ['明写 $0 的仍是 0：2021 日本第一赛段挑战者赛 1「无奖金」', table('316', 2021).status === 'none' && prizeFor(ev('316'), 1, 2021) === 0],
  // an unpublished league stage pays its estimate, and says what it is drawn from
  ['2024 美洲揭幕赛奖金未公开，按 2024 美洲联赛第二赛段估算：冠军 $100,000',
    table('1923', 2024).status === 'est' && table('1923', 2024).from?.lp === 'VCT/2024/Americas League/Stage 2' && prizeFor(ev('1923'), 1, 2024) === 100000],
  ['2026 美洲第一赛段估算：季后赛第 7、8 名也有 $5,000，标「估算：奖金未公开，按 2026 美洲联赛第二赛段推算」',
    prizeFor(ev('2860'), 7, 2026) === 5000 && prizeFor(ev('2860'), 6, 2026) === 10000 && prizeNote(table('2860', 2026)) === '估算：奖金未公开，按 2026 美洲联赛第二赛段推算'],
  ['2027 美洲揭幕赛按 2026 年的估算暂定，标「估算，按 2026 年暂定」',
    table('F2027:kickoff:Americas', 2027).status === 'est' && prizeFor(ev('F2027:kickoff:Americas'), 1, 2027) === 100000 && prizeNote(table('F2027:kickoff:Americas', 2027)) === '估算，按 2026 年暂定'],
  ['2027 EMEA 公开季后赛按 2022 南美 LCQ 估算，第 12 名也有钱',
    table('F2027:open1:EMEA', 2027).status === 'est' && table('F2027:open1:EMEA', 2027).from?.lp === 'VCT/2022/South America/Last Chance Qualifier' && prizeFor(ev('F2027:open1:EMEA'), 12, 2027) > 0],
  [`估算表 ${Object.keys(EST).length} 张：季后赛每个名次都有钱，冠军 > 亚军 > 四强 > 八强 > 其余${misordered.length ? `（没排好：${misordered.join(', ')}）` : ''}`, misordered.length === 0],
]
console.log('')
for (const [what, ok] of facts) console.log(`${ok ? '✓' : '✗'} ${what}`)

if (drift !== 0) {
  console.log(`\n✗ 有 ${drift} 美元没走 addMoney()——还有地方在直接写 me.money。`)
  process.exit(1)
}
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 奖金表和真实赛事的金额、或估算的规则对不上。')
  process.exit(1)
}
if (!prizeLines.length && me.phase === 'pro') {
  console.log('\n✗ 打了几个赛季一笔赛事奖金都没有，prizeWeek 没接上。')
  process.exit(1)
}
console.log('\n✓ 每一笔钱都走了唯一入口，账对得上。')
