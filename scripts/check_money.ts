/**
 * Does every yuan go through the one door, and is every amount written the one way?
 *
 * me/money.ts's whole claim is that after the port nothing can change
 * `me.money` without being booked. That claim is checkable: run a career for a
 * few seasons and assert
 *
 *     money_now  ===  money_at_start + lifetimeIn − lifetimeOut
 *
 * If any site still writes `me.money` directly, the two sides drift apart and
 * this fails. It also prints what a career actually earns, holds the prize
 * table to a few amounts anyone can check on Liquipedia — and the estimates for
 * the events that never published theirs to their rules — and, since the four
 * currencies (me/currency.ts, 2026-09-14):
 *
 *  - no player-facing file writes a currency sign next to a number itself —
 *    every amount goes through me/moneyfmt.ts;
 *  - every non-RMB amount the diary writes carries its RMB (「（约 ¥…）」);
 *  - my contract is in my club's league currency, inside its band;
 *  - an old dollar save is converted once, and converting it again changes nothing.
 *
 *   npx tsx scripts/check_money.ts [seasons=4] [seed=7]
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoBuy, autoWeek } from '../src/engine/me/auto'
import { KIND_CN, prizeRows } from '../src/engine/me/money'
import { prizeFor, prizeNote, prizeTableOf } from '../src/engine/me/prizes'
import { CNY_FLAG, migrateToCny } from '../src/engine/me/cnyMigrate'
import { leagueCurOf, perUsd, toUsd } from '../src/engine/me/currency'
import type { Cur } from '../src/engine/me/currency'
import { cny, money } from '../src/engine/me/moneyfmt'
import { payBand, payOf } from '../src/engine/me/paytable'
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
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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
const bandBreaks: string[] = []

// the autopilot's shopping as the UI's 托管 does it, so the prices are paid through the door too
me.auto.buy = true
let guard = 0
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  autoBuy(state)
  const stop = autoWeek(state)
  harvest()
  for (const l of me.log.slice(seenLog)) if (l.text.includes('奖金分成到账')) prizeLines.push(`${l.year} ${l.text}`)
  seenLog = me.log.length
  // my contract, whenever I have one: its club's league currency, inside that league's band
  const pay = payOf(state)
  const team = state.teams[state.myTeam]
  if (pay && team && me.pay) {
    // the band of the tier the club was in when it signed me: a club relegated since keeps paying what it agreed
    const b = payBand(team.region, me.pay.tier ?? team.tier, me.pay.year)
    if (pay.cur !== leagueCurOf(team.region) || pay.salary < b.floor || pay.salary > b.cap) bandBreaks.push(`${state.year} ${team.name} ${money(pay.salary, pay.cur, state.year)}（带 ${b.floor}–${b.cap} ${b.cur}）`)
  }
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
for (const [k, v] of Object.entries(totalIn).sort((a, b) => b[1] - a[1])) console.log(`  ${(KIND_CN[k] ?? k).padEnd(10)} ${cny(v)}`)
console.log('支出')
for (const [k, v] of Object.entries(totalOut).sort((a, b) => b[1] - a[1])) console.log(`  ${(KIND_CN[k] ?? k).padEnd(10)} ${cny(v)}`)
console.log(`\n起始 ${cny(money0)}  进 ${cny(led.lifetimeIn)}  出 ${cny(led.lifetimeOut)}`)
console.log(`账面 ${me.money}   对账 ${expected}   差额 ${drift}`)

console.log(`\n赛事奖金分成，共 ${prizeLines.length} 笔：`)
for (const l of prizeLines.slice(0, 12)) console.log(`  ${l}`)
if (prizeLines.length > 12) console.log(`  …另有 ${prizeLines.length - 12} 笔`)

const mine = payOf(state)
if (mine) {
  const p = state.players[me.id]
  console.log(`\n合同：${state.teams[state.myTeam]?.name} 年薪 ${money(mine.salary, mine.cur, state.year)}，分成 ${p.contract?.bonusShare ?? 0}%，队伍 ${state.teams[p.teamId ?? '']?.roster.length ?? 0} 人，接下来的赛事冠/亚/季军到手：`)
  for (const r of prizeRows(state)) {
    const shown = r.table.status === 'paid' || r.table.status === 'est'
    const v = shown ? r.mine.map((x) => cny(x)).join('  ') : r.table.status === 'none' ? '无奖金' : '奖金未公开'
    const note = prizeNote(r.table)
    console.log(`  ${r.name}  ${v}${note ? `（${note}）` : ''}`)
  }
}

/* ------------------------------------------------------------------ */
/*  the prize table: the events' own amounts                           */
/* ------------------------------------------------------------------ */

const ev = (id: string): Competition =>
  ({ key: `ev:${id}`, name: id, stage: 'champions', teams: [], standings: {}, finished: [], circuit: { id, start: 0, end: 0, seeds: [] } }) as Competition
const table = (id: string, y: number) => prizeTableOf(ev(id), y)
/** a place's amount in dollars, whatever the table pays in — to compare tables of two currencies */
const usdAt = (id: string, place: number, y: number) => toUsd(prizeFor(ev(id), place, y), table(id, y).cur, y)

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
  ['2021 冠军赛冠军 $350,000（美元表按美元发）', prizeFor(ev('449'), 1, 2021) === 350000 && table('449', 2021).cur === 'USD'],
  ['2023 冠军赛冠军 $1,000,000、亚军 $400,000', prizeFor(ev('1657'), 1, 2023) === 1000000 && prizeFor(ev('1657'), 2, 2023) === 400000],
  ['东京大师赛冠军 $350,000', prizeFor(ev('1494'), 1, 2023) === 350000],
  ['东京大师赛并列第三平分三、四名（$125,000 与 $75,000）', prizeFor(ev('1494'), 3, 2023, 2) === 100000],
  ['2027 冠军赛按 2026 年金额暂定', table('F2027:champions', 2027).basis === 2026 && prizeFor(ev('F2027:champions'), 1, 2027) === 1000000],
  // a real table is left as it was published, even where it stops short of the playoffs
  ['真实表不变：2024 美洲联赛第二赛段付 1–6 名 $100,000…$10,000，第 7 名仍是 0',
    table('2095', 2024).status === 'paid' && JSON.stringify(table('2095', 2024).pay) === '[[1,1,100000],[2,2,65000],[3,3,40000],[4,4,25000],[5,6,10000]]'
    && prizeFor(ev('2095'), 7, 2024) === 0 && prizeNote(table('2095', 2024)) === ''],
  ['明写 $0 的仍是 0：2021 日本第一赛段挑战者赛 1「无奖金」', table('316', 2021).status === 'none' && prizeFor(ev('316'), 1, 2021) === 0],
  // a table published in yuan, euros or won pays its page's own amounts
  ['人民币表按原额：2023 中国进化系列赛第一幕冠军 ¥100,000、亚军 ¥60,000、季军 ¥45,000',
    table('1747', 2023).cur === 'CNY' && prizeFor(ev('1747'), 1, 2023) === 100000 && prizeFor(ev('1747'), 2, 2023) === 60000 && prizeFor(ev('1747'), 3, 2023) === 45000],
  ['韩元表按原额：2021 韩国第一赛段挑战者赛 1 前两名各 ₩4,000,000', table('298', 2021).cur === 'KRW' && prizeFor(ev('298'), 1, 2021) === 4_000_000],
  ['欧元表按原额：2024 EMEA 东区第一赛段冠军 €7,500', table('1932', 2024).cur === 'EUR' && prizeFor(ev('1932'), 1, 2024) === 7500],
  // any other currency: its league's, and the table says what it was published in
  ['日元表折成韩元并注明：2021 日本第一赛段大师赛冠军 ₩31,545,000（原表日元）',
    table('352', 2021).cur === 'KRW' && table('352', 2021).src === 'JPY' && prizeFor(ev('352'), 1, 2021) === 31_545_000],
  // an unpublished league stage pays its estimate, and says what it is drawn from
  ['2024 美洲揭幕赛奖金未公开，按 2024 美洲联赛第二赛段估算：冠军 $100,000',
    table('1923', 2024).status === 'est' && table('1923', 2024).from?.lp === 'VCT/2024/Americas League/Stage 2' && prizeFor(ev('1923'), 1, 2024) === 100000],
  ['2026 美洲第一赛段估算：季后赛第 7、8 名也有 $5,000，标「估算：奖金未公开，按 2026 美洲联赛第二赛段推算」',
    prizeFor(ev('2860'), 7, 2026) === 5000 && prizeFor(ev('2860'), 6, 2026) === 10000 && prizeNote(table('2860', 2026)) === '估算：奖金未公开，按 2026 美洲联赛第二赛段推算'],
  ['2027 美洲揭幕赛按 2026 年的估算暂定，标「估算，按 2026 年暂定」',
    table('F2027:kickoff:Americas', 2027).status === 'est' && prizeFor(ev('F2027:kickoff:Americas'), 1, 2027) === 100000 && prizeNote(table('F2027:kickoff:Americas', 2027)) === '估算，按 2026 年暂定'],
  // the new format's open events: under their league's Challengers stages (scripts/build_prize_estimates.ts, rule open), in the base table's own currency
  ['2027 EMEA 公开季后赛按 EMEA 2026 年奖金最少的挑战者联赛赛段（德语区第二赛段，欧元表）×0.5 估算：冠军 €1,751，第 12 名也有钱，标「估算」',
    table('F2027:open1:EMEA', 2027).status === 'est' && table('F2027:open1:EMEA', 2027).from?.lp === 'VCL/2026/DACH/Stage 2' && table('F2027:open1:EMEA', 2027).cur === 'EUR'
    && prizeFor(ev('F2027:open1:EMEA'), 1, 2027) === 1751 && prizeFor(ev('F2027:open1:EMEA'), 12, 2027) > 0
    && prizeNote(table('F2027:open1:EMEA', 2027)).startsWith('估算')],
  ['2027 美洲公开季后赛按美洲 2026 年奖金最少的挑战者联赛自己的赛段（拉美南区第一赛段）估算，不按 ACE Masters 这类附加赛：冠军 $7,250',
    table('F2027:open1:Americas', 2027).from?.lp === 'VCL/2026/Latin America/South/Stage 1' && prizeFor(ev('F2027:open1:Americas'), 1, 2027) === 7250
    && table('F2027:oq1:na', 2027).from?.lp === 'VCL/2026/Latin America/South/Stage 1'],
  ['2027 太平洋公开季后赛每个名次折成美元都低于 2026 东南亚挑战者联赛第一赛段（冠军 $12,500）',
    [1, 2, 3, 4, 5, 6, 7, 8].every((p) => prizeFor(ev('2823'), p, 2026) <= 0 || usdAt('F2027:open1:Pacific', p, 2027) < usdAt('2823', p, 2026))
    && prizeFor(ev('2823'), 1, 2026) === 12500],
  ['2027 东南亚公开资格赛按所在联赛（太平洋）的估算付韩元：冠军 ₩3,516,000，按 2026 日本第二赛段推算',
    table('F2027:oq1:sea', 2027).status === 'est' && table('F2027:oq1:sea', 2027).from?.lp === 'VCL/2026/Japan/Split 2' && table('F2027:oq1:sea', 2027).cur === 'KRW'
    && prizeFor(ev('F2027:oq1:sea'), 1, 2027) === 3_516_000],
  [`估算表 ${Object.keys(EST).length} 张：季后赛每个名次都有钱，冠军 > 亚军 > 四强 > 八强 > 其余${misordered.length ? `（没排好：${misordered.join(', ')}）` : ''}`, misordered.length === 0],
]

/* ------------------------------------------------------------------ */
/*  one way of writing money                                            */
/* ------------------------------------------------------------------ */

// the formatter itself: RMB alone, anything else with its RMB
const fmtFacts: [string, boolean][] = [
  ['¥30 万 写作「¥30 万」，没有换算', money(300000, 'CNY', 2025) === '¥30 万'],
  ['€80,000（2025）写作「€80,000（约 ¥64 万）」', money(80000, 'EUR', 2025) === '€80,000（约 ¥64 万）'],
  ['$50,000（2023）写作「$50,000（约 ¥35 万）」', money(50000, 'USD', 2023) === '$50,000（约 ¥35 万）'],
  ['₩67,000,000（2023）写作「₩6700 万（约 ¥36 万）」', money(67_000_000, 'KRW', 2023) === '₩6700 万（约 ¥36 万）'],
  ['2026 年起用 2025 年的汇率', money(80000, 'EUR', 2031) === money(80000, 'EUR', 2025)],
  ['小额 ¥8,500、¥1.6 万、¥1.26 亿', cny(8500) === '¥8,500' && cny(16000) === '¥1.6 万' && cny(126_000_000) === '¥1.26 亿'],
]

// no player-facing file writes a currency sign next to an amount itself: only me/moneyfmt.ts does
const SCAN_DIRS = [join(ROOT, 'src', 'engine', 'me'), join(ROOT, 'src', 'ui', 'me')]
const ALLOWED = new Set(['moneyfmt.ts', 'currency.ts'])
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
const hardcoded: string[] = []
for (const dir of SCAN_DIRS) {
  for (const f of readdirSync(dir).filter((x) => /\.(ts|tsx)$/.test(x) && !ALLOWED.has(x))) {
    const lines = stripComments(readFileSync(join(dir, f), 'utf8')).split('\n')
    lines.forEach((line, i) => {
      // $${…}, €${…}, ¥{…} in JSX, or a sign straight before digits: '$2,000', '¥800'
      if (/\$\$\{|[€₩¥]\$?\{|[$€₩¥]\d/.test(line)) hardcoded.push(`${f}:${i + 1} ${line.trim().slice(0, 90)}`)
    })
  }
}
fmtFacts.push([`玩家看得到的文件里没有自己拼的金额${hardcoded.length ? `（${hardcoded.length} 处：${hardcoded.slice(0, 4).join(' | ')}）` : ''}`, hardcoded.length === 0])

// every non-RMB amount the diary wrote carries its RMB
// the whole amount (no backing off a digit to dodge the lookahead), then what follows it
const bare = me.log.flatMap((l) => [...l.text.matchAll(/[$€₩](\d[\d,]*(?:\.\d+)?(?: [万亿])?)(.{0,4})/g)]
  .filter((m) => !m[2].startsWith('（约 ¥'))
  .map((m) => `${l.year} ${m[0]} ← ${l.text.slice(0, 60)}`))
fmtFacts.push([`日记里的外币金额都带人民币换算${bare.length ? `（${bare.length} 处：${bare.slice(0, 3).join(' | ')}）` : ''}`, bare.length === 0])
fmtFacts.push([`合同一直按俱乐部所在联赛的货币、在联赛工资带里${bandBreaks.length ? `（${bandBreaks.slice(0, 3).join(' | ')}）` : ''}`, bandBreaks.length === 0])

/* ------------------------------------------------------------------ */
/*  an old dollar save, converted once                                  */
/* ------------------------------------------------------------------ */

const legacy: GameState = createCareer({ name: 'Old', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: seed + 1, year: 2021 })
{
  const lm = legacy.me!
  const lp = legacy.players[lm.id]
  const team = legacy.teams[legacy.myTeam]
  // as a save from before looked: dollars everywhere, no contract terms of its own, no flag
  delete lm.flags[CNY_FLAG]
  delete lm.pay
  lm.money = 12_345
  lm.upkeep = 120
  lp.salary = 12_000
  lm.flags.buyout = 30_000
  lm.ledger = { cur: { in: { salary: 7000 }, out: { living: 2000 } }, prev: { in: { prize: 500 }, out: {} }, label: 'x', prevLabel: 'y', lifetimeIn: 7500, lifetimeOut: 2000 }
  lm.deals = [{ id: 'd', teamId: team.id, kind: 'renew', tier: team.tier, role: 'starter', cur: 'USD' as Cur, salary: 15_000, signBonus: 1000, years: 1, buyout: 40_000, asks: [], blown: 0, leverage: 10, grade: 'B', day: legacy.day, expires: legacy.day + 14, abroad: false }]
  delete (lm.deals[0] as { cur?: Cur }).cur
}
const k = perUsd('CNY', legacy.year)
const first = migrateToCny(legacy)
const once = JSON.stringify(legacy.me)
const second = migrateToCny(legacy)
const lm = legacy.me!
fmtFacts.push([`旧存档换算：存款 $12,345 → ¥${Math.round(12_345 * k).toLocaleString('en-US')}（${legacy.year} 年汇率），账本、每周固定支出一起换，报价换成俱乐部的人民币，合同按签约年汇率换`,
  first && lm.money === Math.round(12_345 * k) && lm.upkeep === Math.round(120 * k) && lm.ledger!.lifetimeIn === Math.round(7500 * k)
  && lm.deals[0].cur === 'CNY' && lm.pay?.cur === 'CNY' && lm.pay.salary > 0 && !!lm.flags[CNY_FLAG]])
fmtFacts.push(['旧存档换算只做一次：再读一遍什么都不变', second === false && JSON.stringify(legacy.me) === once])

console.log('')
for (const [what, ok] of [...facts, ...fmtFacts]) console.log(`${ok ? '✓' : '✗'} ${what}`)

if (drift !== 0) {
  console.log(`\n✗ 有 ${drift} 元没走 addMoney()——还有地方在直接写 me.money。`)
  process.exit(1)
}
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 奖金表和真实赛事的金额、或估算的规则对不上。')
  process.exit(1)
}
if (fmtFacts.some(([, ok]) => !ok)) {
  console.log('\n✗ 金额的写法、合同的币种或旧存档的换算不对。')
  process.exit(1)
}
if (!prizeLines.length && me.phase === 'pro') {
  console.log('\n✗ 打了几个赛季一笔赛事奖金都没有，prizeWeek 没接上。')
  process.exit(1)
}
console.log('\n✓ 每一笔钱都走了唯一入口，账对得上；金额只有一种写法，外币都带人民币。')
