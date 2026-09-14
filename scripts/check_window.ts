/**
 * 转会窗口 (engine/me/window.ts): the rule year by year and club by club, and what it does to a career.
 *
 * Reported 2026-09-14: 「23年的档，第一把比赛在三四月但是中间的时间转会窗口一直不开」.
 *
 *   npx tsx scripts/check_window.ts [careers=2] [seasons=3] [year=2021]
 *
 * 一、每年样本日（2021–2034）：VCT 联赛俱乐部照 Riot 的窗口，Challengers 俱乐部没有比赛时一直开着
 * 二、名单锁定：国际赛、2021 赛区大师赛、联赛季后赛、Challengers 季后赛、晋级赛；对方俱乐部锁定也算
 * 三、锁定期间不来新报价、不能挂牌；锁定期间谈妥的转会，比赛打完才生效
 * 四、世界市场只在两个转会日（第 166、324 天）动
 * 五、2023 年从 1 月 1 日打：VCT 俱乐部在 1/1–2/1、3/6–3/25 有开窗的时刻，其余时间关着；
 *     Challengers 俱乐部只有打大赛、季后赛时关；锁定的日子里没有报价进来；LOCK//IN 出局就解锁
 * 六、生涯里的报价和转会（报数，只拦爆炸）；签约的那个转会期里，没有试训邀请、没有 VCT 俱乐部来找
 * 七、签约的那个转会期（2026-09-14，作者：「如果玩家在同一个转会期签约了，那就不发了，只能等下一个
 *     转会期让他又跳槽的可能」，用到每一种转会来路上）：不来试训邀请、不来报价（坐板凳也不来，没签约的
 *     对照会来）、挂牌被拒并写明原因和日期、外区邀约顺延到下个转会期再兑现；自己俱乐部窗口关着不发邀请；
 *     下个转会期邀请、报价、挂牌照常；被放走的自由人不受这一条限制
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { acceptDeal, joinClub, leaveClub, makeDeal, settleMove } from '../src/engine/me/contract'
import { cupInvite } from '../src/engine/me/prepro'
import { storyWeek } from '../src/engine/me/storyweek'
import { VCT_SEEN, listSelf, rollOffers, vctApproach, vctRead, windowRoll } from '../src/engine/me/transfer'
import { MARKET_DAYS, absDay, clubOpen, inviteBlock, listBlock, marketDay, moveBlock, periodKey, playoffsFrom, signedThisPeriod, windowAt, windowLine, windowOfClub, windowRuleLines } from '../src/engine/me/window'
import type { WindowState } from '../src/engine/me/window'
import { eventsOf } from '../src/engine/circuit'
import type { CEvent } from '../src/engine/circuit'
import { makeFixture } from '../src/engine/league'
import { hasPlace, inVctLeague } from '../src/engine/timeline'
import { regionIn } from '../src/engine/era'
import { Rng } from '../src/engine/rng'
import type { Competition, GameState, Region, Role, Team } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
} as unknown as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let fails = 0
const fail = (m: string): void => { fails++; console.log(`  ✗ ${m}`) }
const t0 = Date.now()
const DAY = 86_400_000
const dayIn = (iso: string): { year: number; day: number } => {
  const [y, m, d] = iso.split('-').map(Number)
  return { year: y, day: Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / DAY) }
}
const abs = (iso: string): number => { const x = dayIn(iso); return absDay(x.year, x.day) }
const iso = (n: number | undefined): string => (n == null ? '—' : new Date(n * DAY).toISOString().slice(0, 10))
const said = (w: WindowState): string => `${w.open ? '开' : '关'}${w.closesOn != null ? ` 到 ${iso(w.closesOn)}` : ''}${w.nextOpens != null ? ` 下次 ${iso(w.nextOpens)}` : ''}${w.lock ? ` 锁定 ${w.lock.event}` : ''}`
const OFFER = /开价了|直接开了报价|想请你去试训|那边给首发|按之前谈的开出了报价/

const base = createCareer({ name: 'Win', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 77, year: 2026 })

/* ---- 一、日历 ---- */
console.log('一、每年样本日（没有比赛，只看日历）')
const cal = structuredClone(base) as GameState
cal.comps = {}
const vctIn = (league: string): Team | undefined =>
  Object.values(cal.teams).find((t) => t.tier === 1 && !!t.league?.startsWith('VCT ') && regionIn(t.region, 2026) === league)
const vct = vctIn('EMEA')
const chal = Object.values(cal.teams).find((t) => t.tier === 2 && !t.dormant)
if (!vct || !chal) throw new Error('2026 年的世界里找不到 VCT EMEA 俱乐部或 Challengers 俱乐部')

interface Want { open: boolean; closesOn?: number | null; nextOpens?: number; lock?: boolean }
function at(s: GameState, team: Team, when: string | { year: number; day: number }, want: Want, label: string): WindowState {
  const d = typeof when === 'string' ? dayIn(when) : when
  s.year = d.year
  s.day = d.day
  const w = windowOfClub(s, team, true)
  const where = `${label} ${iso(absDay(d.year, d.day))}`
  if (w.open !== want.open) fail(`${where}：应该${want.open ? '开' : '关'}，实际 ${said(w)}`)
  else if (want.closesOn !== undefined && (w.closesOn ?? null) !== want.closesOn) fail(`${where}：应该开到 ${iso(want.closesOn ?? undefined)}，实际 ${said(w)}`)
  else if (want.nextOpens !== undefined && w.nextOpens !== want.nextOpens) fail(`${where}：下次应该 ${iso(want.nextOpens)} 开，实际 ${said(w)}`)
  else if (want.lock !== undefined && !!w.lock !== want.lock) fail(`${where}：${want.lock ? '应该锁定' : '不该锁定'}，实际 ${said(w)}`)
  return w
}

// the leagues' Stage 2 playoffs, as the data has them: the window closes a week before each (暂定 by league)
const po = (year: number, league: string): number => {
  const ev = eventsOf(year).find((e) => e.stage === 'stage2' && !e.scene && e.region === league && !/Open Playoffs/i.test(e.name))
  return (ev && playoffsFrom(ev)) ?? -1
}
for (const [year, league, want] of [[2025, 'EMEA', 232], [2025, 'Americas', 232], [2025, 'Pacific', 224], [2025, 'China', 220], [2026, 'EMEA', 231]] as [number, string, number][]) {
  if (po(year, league) !== want) fail(`${year} ${league} 第二赛段季后赛应该第 ${want} 天开打，读到第 ${po(year, league)} 天`)
}

let samples = 0
for (const y of [2021, 2022]) {
  for (const d of [0, 100, 166, 250, 324, 363]) { at(cal, vct, { year: y, day: d }, { open: true, closesOn: null }, `${y} 一线俱乐部`); samples++ }
}
const V = (when: string | { year: number; day: number }, want: Want) => { samples++; return at(cal, vct, when, want, 'VCT EMEA') }
V('2023-01-01', { open: true, closesOn: abs('2023-02-01') })
V('2023-02-01', { open: true, closesOn: abs('2023-02-01') })
V('2023-02-02', { open: false, nextOpens: abs('2023-03-06') })
V('2023-03-06', { open: true, closesOn: abs('2023-03-25') })
V('2023-03-25', { open: true })
V('2023-03-26', { open: false, nextOpens: abs('2023-09-11') })
V('2023-06-16', { open: false, nextOpens: abs('2023-09-11') })
V('2023-09-10', { open: false, nextOpens: abs('2023-09-11') })
V('2023-09-11', { open: true, closesOn: abs('2024-07-15') })
V('2024-01-01', { open: true, closesOn: abs('2024-07-15') })
V('2024-07-15', { open: true })
V('2024-07-16', { open: false, nextOpens: abs('2024-10-07') })
V('2024-10-07', { open: true, closesOn: absDay(2025, 225) })
V('2025-01-01', { open: true, closesOn: absDay(2025, 225) })
V({ year: 2025, day: 225 }, { open: true })
V({ year: 2025, day: 226 }, { open: false, nextOpens: abs('2025-10-13') })
V('2025-10-13', { open: true, closesOn: absDay(2026, 224) })
V({ year: 2026, day: 225 }, { open: false, nextOpens: absDay(2026, 298) })
// a league's own close day: a Pacific and a Chinese club in 2025
for (const [league, close] of [['Pacific', 217], ['China', 213]] as [string, number][]) {
  const t = vctIn(league)
  if (!t) { fail(`2026 年的世界里找不到 VCT ${league} 俱乐部`); continue }
  at(cal, t, { year: 2025, day: close }, { open: true, closesOn: absDay(2025, close) }, `VCT ${league}`)
  at(cal, t, { year: 2025, day: close + 1 }, { open: false }, `VCT ${league}`)
  samples += 2
}
// 2027–2034: 2026's shape, every date 暂定
for (let y = 2027; y <= 2034; y++) {
  const w = V({ year: y, day: 0 }, { open: true })
  const close = w.closesOn
  const closeDay = close == null ? -1 : close - absDay(y, 0)
  if (!w.tentative) fail(`${y} VCT 窗口应该标暂定`)
  if (closeDay < 150 || closeDay > 300) { fail(`${y} VCT 窗口应该在年中关（第二赛段季后赛前一周），实际到 ${iso(close)}`); continue }
  const shut = V({ year: y, day: closeDay + 1 }, { open: false })
  const next = shut.nextOpens == null ? -1 : shut.nextOpens - absDay(y, 0)
  if (next <= closeDay + 30 || next > 363) { fail(`${y} VCT 下个窗口应该在冠军赛之后开，实际 ${iso(shut.nextOpens)}`); continue }
  V({ year: y, day: next }, { open: true })
}
for (let y = 2021; y <= 2034; y++) {
  for (const d of [0, 100, 200, 300, 363]) { at(cal, chal, { year: y, day: d }, { open: true, closesOn: null }, `${y} Challengers`); samples++ }
}
console.log(`  ${samples} 个样本日`)

/* ---- 二、名单锁定 ---- */
console.log('二、名单锁定')
const lk = structuredClone(base) as GameState
lk.me!.phase = 'pro'
const comp = (ev: CEvent, teams: string[]): Competition => ({
  key: `ev:${ev.id}`, name: ev.cn, stage: ev.stage ?? 'offseason', teams, standings: {}, finished: [], format: 'circuit',
  circuit: { id: ev.id, start: ev.start!, end: ev.end!, seeds: [...teams], mode: 'history' },
})
const find = (year: number, f: (e: CEvent) => boolean, what: string): CEvent => {
  const e = eventsOf(year).find(f)
  if (!e) throw new Error(`circuit.json 里找不到 ${year} ${what}`)
  return e
}
{
  const lockin = find(2023, (e) => /LOCK\/\/IN/.test(e.name), 'LOCK//IN')
  const c = comp(lockin, [vct.id])
  lk.comps = { [c.key]: c }
  lk.myTeam = vct.id
  at(lk, vct, { year: 2023, day: lockin.start! - 1 }, { open: false, lock: false }, 'LOCK//IN 前一天')
  at(lk, vct, { year: 2023, day: lockin.start! }, { open: false, lock: true }, 'LOCK//IN 开打')
  const line = windowLine(lk)
  if (line !== '名单锁定 · 你的俱乐部正在打 LOCK//IN 圣保罗 · 3月4日后解除') fail(`LOCK//IN 期间那一行：${line}`)
  else console.log(`  ${line}`)
  at(lk, vct, { year: 2023, day: lockin.end! }, { open: false, lock: true }, 'LOCK//IN 最后一天')
  at(lk, vct, { year: 2023, day: lockin.end! + 1 }, { open: false, lock: false }, 'LOCK//IN 打完')
  // played here, not as history: a tie of its own still to play keeps it locked; the event settled lets it go
  c.circuit!.mode = 'sim'
  lk.fixtures = [makeFixture(lockin.start! + 3, 'kickoff', c.key, vct.id, chal.id, 3, 'KO:1:首轮')]
  at(lk, vct, { year: 2023, day: lockin.start! + 1 }, { open: false, lock: true }, 'LOCK//IN 还有比赛')
  c.champion = vct.id
  at(lk, vct, { year: 2023, day: lockin.start! + 1 }, { open: false, lock: false }, 'LOCK//IN 决出冠军')
  lk.fixtures = []
}
{
  // 2021: a regional Masters locks, a Challengers event does not
  const masters = find(2021, (e) => e.stage === 's1masters' && e.region === 'Europe', '欧洲第一赛段大师赛')
  const open = find(2021, (e) => e.stage === 's1chal' && e.region === 'Europe' && e.units.some((u) => u.type !== 'open'), '欧洲第一赛段挑战者赛')
  lk.comps = { [`ev:${masters.id}`]: comp(masters, [vct.id]), [`ev:${open.id}`]: comp(open, [chal.id]) }
  at(lk, vct, { year: 2021, day: masters.start! }, { open: false, lock: true }, '2021 赛区大师赛')
  at(lk, vct, { year: 2021, day: masters.end! + 1 }, { open: true, lock: false }, '2021 赛区大师赛打完')
  at(lk, chal, { year: 2021, day: Math.max(open.start!, masters.end! + 1) }, { open: true, lock: false }, '2021 挑战者赛')
}
{
  // 2025: a league's stage playoffs lock its sides from the playoffs' first day; a Challengers split only in its playoffs; an Ascension all through
  const stage1 = find(2025, (e) => e.stage === 'stage1' && e.region === 'EMEA' && !e.scene, 'EMEA 第一赛段')
  const from = playoffsFrom(stage1)!
  const split = find(2025, (e) => !!e.scene && (playoffsFrom(e) ?? -1) > (e.start ?? 0) + 3, '有季后赛的 Challengers 赛段')
  const asc = find(2025, (e) => e.stage === 'ascension' && e.region === 'EMEA', 'EMEA 晋级赛')
  lk.comps = { [`ev:${stage1.id}`]: comp(stage1, [vct.id]), [`ev:${split.id}`]: comp(split, [chal.id]) }
  at(lk, vct, { year: 2025, day: from - 1 }, { open: true, lock: false }, 'EMEA 第一赛段常规赛')
  at(lk, vct, { year: 2025, day: from }, { open: false, lock: true }, 'EMEA 第一赛段季后赛')
  at(lk, chal, { year: 2025, day: split.start! }, { open: true, lock: false }, `${split.cn} 常规赛`)
  at(lk, chal, { year: 2025, day: playoffsFrom(split)! }, { open: false, lock: true }, `${split.cn} 季后赛`)
  lk.comps = { [`ev:${asc.id}`]: comp(asc, [chal.id]), [`ev:${stage1.id}`]: comp(stage1, [vct.id]) }
  at(lk, chal, { year: 2025, day: asc.start! }, { open: false, lock: true }, 'EMEA 晋级赛')
  // the other club's lock closes a move as surely as mine: my Challengers club is open, the VCT club I would join is in its playoffs
  lk.year = 2025
  lk.day = from + 1
  lk.myTeam = chal.id
  lk.comps = { [`ev:${stage1.id}`]: comp(stage1, [vct.id]) }
  const w = windowAt(lk, vct.id)
  if (w.open || w.side !== 'other' || clubOpen(lk, vct.id)) fail(`对方俱乐部在打季后赛，转会应该办不了：${said(w)}`)
}

/* ---- 三、锁定期间不来报价；谈妥的转会打完才生效 ---- */
console.log('三、锁定期间的报价和转会')
{
  const s = structuredClone(base) as GameState
  const me = s.me!
  const mine = s.teams[s.myTeam]
  const london = find(2026, (e) => e.stage === 'masters2' && e.region === null, '2026 第二站大师赛')
  const c = comp(london, [mine.id])
  s.comps = { [c.key]: c }
  s.year = 2026
  s.day = london.start! + 2
  // a champion whom every club would call, a season at the club behind him
  me.titles.push({ year: 2026, title: '圣地亚哥大师赛', started: true })
  me.tenure = 2
  s.players[me.id].overall = 95
  const before = me.deals.length
  for (const kind of ['market', 'stage', 'week'] as const) {
    const n = windowRoll(s, new Rng(11), kind)
    if (n || me.deals.length !== before) fail(`名单锁定时（${kind}）来了 ${n} 份报价`)
  }
  const listed = listSelf(s)
  if (me.listedYear === s.year || !listed.includes('名单锁定')) fail(`名单锁定时挂了牌：${listed}`)
  // the same man the day after: the lock is all that stopped them
  s.day = london.end! + 1
  const n = windowRoll(s, new Rng(11), 'market')
  if (!n) fail('大师赛打完第二天，国际赛冠军也没来报价——拦住报价的应该只是锁定')
  else console.log(`  锁定时 0 份报价，打完第二天 ${n} 份`)
  // agreed under the lock, made the day after the event
  s.day = london.start! + 2
  me.deals = []
  me.flags.winGot = 0
  const buyer = Object.values(s.teams).find((t) => t.tier === 1 && t.id !== mine.id && !t.dormant && clubOpen(s, t.id))
  if (!buyer) fail('找不到窗口开着的买家')
  else {
    const deal = makeDeal(s, buyer.id, 'transfer', 'A', new Rng(5))
    me.deals.push(deal)
    acceptDeal(s, deal.id)
    if (!me.moveAfter || s.myTeam !== mine.id) fail('锁定期间签下的转会当场就生效了')
    if (windowRoll(s, new Rng(12), 'market')) fail('谈妥下一家以后还来了报价')
    settleMove(s)
    if (s.myTeam !== mine.id) fail('比赛还没打完就转走了')
    s.day = london.end! + 1
    settleMove(s)
    if (s.myTeam !== buyer.id || me.moveAfter) fail('大师赛打完第二天应该正式转会')
    else console.log(`  ${london.cn} 期间谈妥 ${buyer.name}，第 ${s.day} 天正式转会`)
  }
}

/* ---- 四、世界市场 ---- */
console.log('四、世界市场')
{
  const days = Array.from({ length: 364 }, (_, d) => d).filter((d) => marketDay({ day: d }))
  if (MARKET_DAYS.join() !== '166,324' || days.join() !== '166,324') fail(`世界市场应该只在第 166、324 天动，实际 ${days.join('、')}`)
  const week = readFileSync(new URL('../src/engine/me/week.ts', import.meta.url), 'utf8')
  const calls = week.match(/marketWindow\(/g)?.length ?? 0
  if (calls !== 1 || !/const market = marketDay\(state\)/.test(week) || !/if \(market\) marketWindow\(/.test(week)) {
    fail(`me/week.ts 里的 marketWindow 应该只调一次、只在转会日：调了 ${calls} 次`)
  } else console.log('  只在第 166、324 天，和球员自己的窗口无关')
}

/* ---- 五、2023 年从 1 月 1 日打 ---- */
console.log('五、2023 年从 1 月 1 日打')
{
  const w21 = createCareer({ name: 'Win23', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 23, year: 2021 })
  let g = 0
  while (w21.year < 2023 && g++ < 200 && w21.me!.phase !== 'retired') autoWeek(w21)
  if (w21.year !== 2023) throw new Error('没打到 2023 年')

  interface Row { day: number; open: boolean; lock: boolean; mine: boolean; week: number; stage: string }
  const watch = (s: GameState, until: number): { rows: Row[]; inLock: number } => {
    const me = s.me!
    const rows: Row[] = []
    let inLock = 0
    let last = me.log[me.log.length - 1]
    let value = s.day
    Object.defineProperty(s, 'day', {
      get: () => value,
      set: (n: number) => {
        // the end of day `value`: its matches, its rolls and its week are done (engine/season.ts advanceDay opens the next with day++)
        if (n === value + 1 && s.year === 2023) {
          const w = windowAt(s)
          const from = last ? me.log.lastIndexOf(last) + 1 : 0
          const fresh = me.log.slice(from)
          last = me.log[me.log.length - 1]
          if (w.lock && w.side === 'mine') inLock += fresh.filter((l) => l.kind === 'deal' && OFFER.test(l.text)).length
          rows.push({ day: value, open: w.open, lock: !!w.lock, mine: me.phase === 'pro', week: me.week, stage: s.stage })
        }
        value = n
      },
      enumerable: true, configurable: true,
    })
    let guard = 0
    while (s.year === 2023 && value < until && guard++ < 40 && s.me!.phase !== 'retired') autoWeek(s)
    Object.defineProperty(s, 'day', { value, writable: true, enumerable: true, configurable: true })
    return { rows, inLock }
  }
  /** a week's end or a stage's, on a day the window was open: a moment a call could come */
  const chances = (rows: Row[], a: number, b: number): number =>
    rows.filter((r, i) => i > 0 && r.day >= a && r.day <= b && r.open && r.mine && (r.week !== rows[i - 1].week || r.stage !== rows[i - 1].stage)).length

  // at a VCT league club
  const v = structuredClone(w21) as GameState
  const had = v.teams[v.myTeam]
  const target = had && inVctLeague(v, had) ? had
    : Object.values(v.teams).filter((t) => inVctLeague(v, t) && regionIn(t.region, 2023) === 'Americas' && !t.dormant).sort((a, b) => a.rating - b.rating)[0]
  if (!target) fail('2023 年美洲联赛里找不到俱乐部')
  else {
    if (target.id !== v.myTeam) joinClub(v, makeDeal(v, target.id, 'transfer', 'A', new Rng(2)))
    v.me!.tenure = 1
    const { rows, inLock } = watch(v, 110)
    const jan = chances(rows, 0, 31)
    const mar = chances(rows, 64, 83)
    const wrongOpen = rows.filter((r) => r.mine && r.open && ((r.day >= 32 && r.day <= 63) || r.day >= 84))
    const wrongShut = rows.filter((r) => r.mine && !r.open && !r.lock && (r.day <= 31 || (r.day >= 64 && r.day <= 83)))
    if (!jan) fail(`${target.name}：2023-01-01→02-01 没有开窗的时刻`)
    if (!mar) fail(`${target.name}：2023-03-06→03-25 没有开窗的时刻`)
    if (wrongOpen.length) fail(`${target.name}：窗口外开着 ${wrongOpen.length} 天（第 ${wrongOpen[0].day} 天起）`)
    if (wrongShut.length) fail(`${target.name}：窗口里关着 ${wrongShut.length} 天（第 ${wrongShut[0].day} 天起）`)
    if (inLock) fail(`${target.name}：名单锁定的日子里进来 ${inLock} 份报价`)
    // LOCK//IN: from its first day, lifted the day the club is out
    const lockin = Object.values(v.comps).find((c) => /LOCK\/\/IN/.test(c.name))
    const locked = rows.filter((r) => r.lock).map((r) => r.day)
    const lastMatch = Math.max(-1, ...v.fixtures.filter((f) => f.played && f.comp === lockin?.key && (f.teamA === target.id || f.teamB === target.id)).map((f) => f.day))
    let lockSaid = '没进 LOCK//IN'
    if (lockin && lastMatch >= 0) {
      if (!locked.includes(lockin.circuit!.start)) fail(`${target.name}：LOCK//IN 第一天没有锁名单`)
      if (locked.some((d) => d >= lastMatch && d > lockin.circuit!.start && !lockin.champion?.includes(target.id))) fail(`${target.name}：LOCK//IN 最后一场（第 ${lastMatch} 天）打完还锁着`)
      lockSaid = `LOCK//IN 锁第 ${Math.min(...locked)}–${Math.max(...locked)} 天，最后一场第 ${lastMatch} 天`
    }
    console.log(`  ${target.name}（VCT）：1/1–2/1 开窗时刻 ${jan} 个，3/6–3/25 ${mar} 个 · ${lockSaid} · 锁定时报价 ${inLock}`)
  }

  // at a Challengers club
  const c = structuredClone(w21) as GameState
  const club = Object.values(c.teams).filter((t) => t.tier === 2 && !t.dormant && t.roster.length >= 5 && hasPlace(c, t) && regionIn(t.region, 2023) === 'Americas')
    .sort((a, b) => b.rating - a.rating)[0]
  if (!club) fail('2023 年美洲找不到有比赛打的 Challengers 俱乐部')
  else {
    if (club.id !== c.myTeam) joinClub(c, makeDeal(c, club.id, 'transfer', 'A', new Rng(3)))
    c.me!.tenure = 1
    const { rows, inLock } = watch(c, 110)
    const shutByCalendar = rows.filter((r) => r.mine && !r.open && !r.lock)
    const all = chances(rows, 0, 110)
    const lockDays = rows.filter((r) => r.lock).length
    if (shutByCalendar.length) fail(`${club.name}：没在打比赛也关着 ${shutByCalendar.length} 天（第 ${shutByCalendar[0].day} 天起）`)
    if (!all) fail(`${club.name}：前 110 天没有开窗的时刻`)
    if (inLock) fail(`${club.name}：名单锁定的日子里进来 ${inLock} 份报价`)
    console.log(`  ${club.name}（Challengers）：前 110 天开窗时刻 ${all} 个 · 锁定 ${lockDays} 天 · 锁定时报价 ${inLock}`)
  }
}

/* ---- 六、生涯里的报价和转会 ---- */
console.log('六、生涯里的报价和转会（和改之前量的是同一批种子）')
{
  const careers = Number(process.argv[2] ?? 2)
  const seasons = Number(process.argv[3] ?? 3)
  const year = Number(process.argv[4] ?? 2021) as 2021 | 2026
  const PLACES: [Region, StartPoint][] = year === 2021
    ? [['Europe', 'chal'], ['North America', 't1'], ['Korea', 'chal'], ['Brazil', 't1'], ['Europe', 't1'], ['Japan', 'chal'], ['North America', 'chal'], ['Turkey', 'chal']]
    : [['Europe', 'chal'], ['Americas', 't1'], ['Pacific', 'chal'], ['EMEA', 't1'], ['Americas', 'chal'], ['Pacific', 't1'], ['China', 't1'], ['EMEA', 'chal']]
  const ROLES: Role[] = ['决斗者', '先锋', '控场', '哨卫']
  const tot = { offers: 0, moves: 0, pro: 0, afterSign: 0 }
  // a club's call that would move him: a tryout invitation (me/prepro.ts, me/transfer.ts approach), or a VCT club coming for him
  const CALL = /想请你去试训|邀请你去试训|来找你——|的人.*直接给了报价/
  for (let i = 0; i < careers; i++) {
    const [region, start] = PLACES[i % PLACES.length]
    const s = createCareer({ name: `Win${i}`, region, role: ROLES[i % 4], talents: emptyTalents(), originKey: 'netcafe', start, seed: 4100 + i * 53, year })
    const me = s.me!
    let weeks = 0
    // the transfer period of the last signing made in the career — a career opening at its club is not one — while under that contract
    let signedAt = -1
    while (s.year < year + seasons && me.phase !== 'retired' && weeks < seasons * 60) {
      const last = me.log[me.log.length - 1]
      const wasPro = me.phase === 'pro'
      if (autoWeek(s).kind === 'game-over') break
      weeks++
      for (const l of me.log.slice(last ? me.log.lastIndexOf(last) + 1 : 0)) {
        if (l.text.includes('你成了自由人')) signedAt = -1
        if (l.text.startsWith('签约 ')) signedAt = periodKey(l.year, l.day)
        else if (CALL.test(l.text) && periodKey(l.year, l.day) === signedAt) tot.afterSign++
        if (l.kind !== 'deal') continue
        if (OFFER.test(l.text)) tot.offers++
        if (wasPro && l.text.startsWith('签约 ')) tot.moves++
      }
    }
    tot.pro += me.seasons.filter((x) => x.tier > 0).length
  }
  const perSeason = tot.offers / Math.max(1, tot.pro)
  const perCareer = tot.moves / Math.max(1, careers)
  console.log(`  ${careers} 条 × ${seasons} 季（${year} 起）：报价每职业季 ${perSeason.toFixed(2)} · 转会每条 ${perCareer.toFixed(2)}（改之前 8×6 季从 2021：1.16 / 1.63；8×5 季从 2026：1.27 / 1.63）· 签约那个转会期里又来的邀请 ${tot.afterSign}`)
  if (perSeason > 3) fail(`报价每职业季 ${perSeason.toFixed(2)}，比改之前多出一倍以上`)
  if (perCareer > seasons) fail(`转会每条 ${perCareer.toFixed(2)}，比一季一次还多`)
  if (tot.afterSign) fail(`签约的那个转会期里，又来了 ${tot.afterSign} 份试训邀请或 VCT 俱乐部来找`)
}

/* ---- 七、签约的那个转会期 ---- */
console.log('七、签约的那个转会期里：不来试训邀请、不来报价、不能挂牌，外区邀约顺延；下个转会期照常')
{
  const s = structuredClone(base) as GameState
  const me = s.me!
  const p = s.players[me.id]
  const vctClub = s.teams[s.myTeam]
  const league = regionIn(vctClub.region, 2026)
  const chalClub = Object.values(s.teams)
    .filter((t) => t.tier === 2 && !t.dormant && t.roster.length >= 5 && regionIn(t.region, 2026) === league)
    .sort((x, y) => y.rating - x.rating)[0]
  const abroadClub = Object.values(s.teams)
    .filter((t) => t.tier === 1 && !t.dormant && t.roster.length >= 5 && regionIn(t.region, 2026) !== league && hasPlace(s, t))
    .sort((x, y) => x.rating - y.rating)[0]
  if (!chalClub || !abroadClub) fail(`2026 年找不到 ${league} 的 Challengers 俱乐部，或外赛区的 VCT 俱乐部`)
  else {
    const run = { key: 'probe', year: 2026, reached: 3, rounds: 3, won: true, prize: 0 }
    const clear = (): void => {
      me.pre.invites = []
      me.deals = []
      me.pending = []
      me.intents = []
      me.flags.vctGot = 0
      me.flags.winGot = 0
    }
    /** six draws of each way a club comes: the VCT clubs of his league (vctApproach), a cup run's end (cupInvite), a round of offers (rollOffers) */
    const draws = (): { invites: number; offers: number; market: number } => {
      let invites = 0
      let offers = 0
      let market = 0
      for (let i = 1; i <= 6; i++) {
        clear()
        vctApproach(s, new Rng(700 + i), 1)
        cupInvite(s, run, new Rng(800 + i))
        invites += me.pre.invites.length
        offers += me.deals.length
        clear()
        rollOffers(s, new Rng(900 + i), false, 1)
        market += me.deals.length
      }
      clear()
      return { invites, offers, market }
    }
    const since = (mark: typeof me.log[number] | undefined): string[] => me.log.slice(mark ? me.log.lastIndexOf(mark) + 1 : 0).map((l) => l.text)
    // signed on day 20 at a Challengers club, at a VCT starter's level: reproduced 2026-09-14, the week after brought 12 invitations in 8 draws
    s.year = 2026
    s.day = 20
    joinClub(s, makeDeal(s, chalClub.id, 'transfer', 'A', new Rng(1)))
    me.seasonStart.starts = VCT_SEEN
    const read = vctRead(s)
    if (!read) fail(`${chalClub.name}：读不出 VCT 首发的线`)
    else p.overall = Math.max(p.overall, read.bar + 1)
    // just signed and on the bench, with an international title this year: a round of offers is a certainty for him (rollOffers)
    me.tenure = 0
    me.titles.push({ year: 2026, title: '圣地亚哥大师赛', started: true })
    const club = s.teams[s.myTeam]
    club.starters = club.starters.filter((id) => id !== me.id)
    s.day = 27
    if (!windowAt(s).open) fail(`2026 第 27 天 ${chalClub.name} 的窗口应该开着：${windowLine(s)}`)
    const same = draws()
    const why = inviteBlock(s)
    if (same.invites || same.offers || same.market) fail(`第 20 天签约，第 27 天（同一个转会期、坐板凳）还来了 ${same.invites} 份试训邀请、${same.offers} 份 VCT 俱乐部的报价、${same.market} 份报价`)
    if (!signedThisPeriod(s) || !why?.includes('刚签约')) fail(`同一个转会期签约以后，没说为什么不来邀请：${why}`)
    // the same man the same day, had he not signed this period: what the signing alone holds back
    me.flags.signedPeriod = 0
    const control = draws()
    me.flags.signedPeriod = periodKey(2026, 20)
    if (!control.market) fail('对照：同一天没在这个转会期签约的同一个人也一份报价都没有——挡住报价的应该只是签约')
    // 挂牌: refused with the reason and the next period's date; the button's helper says the same line
    const block = listBlock(s)
    const listed = listSelf(s)
    if (me.listedYear === 2026 || !listed.includes('刚签约') || !listed.includes('才能挂牌') || !/\d+月\d+日/.test(listed) || listed !== `${block}。`) fail(`签约的转会期里挂牌：「${listed}」，按钮说「${block}」`)
    // 外区邀约: terms promised for a market day already past, due now — held to the next transfer period, not dropped
    me.abroad = false
    me.pendingEvent = undefined
    me.chain = { id: 'overseas', step: 1, wk: me.week, due: me.week, score: 1, club: abroadClub.id, track: 'window', fromYear: 2025, fromDay: 300 }
    let mark = me.log[me.log.length - 1]
    storyWeek(s)
    const held = since(mark)
    const heldTo = me.chain?.due ?? me.week
    if (!me.chain || me.deals.length || !held.some((t) => t.includes('外区邀约') && t.includes('下个转会期'))) fail(`签约的转会期里外区邀约没有顺延：${me.chain ? '还在' : '没了'}，报价 ${me.deals.length}，日志「${held.join(' | ')}」`)
    if (heldTo <= me.week + 1) fail(`外区邀约只顺延到第 ${heldTo} 周（现在第 ${me.week} 周），应该等到下个转会期`)
    // a week on and still this period: asked again, and says nothing again
    me.week += 1
    s.day += 7
    mark = me.log[me.log.length - 1]
    storyWeek(s)
    if (!me.chain || me.deals.length || since(mark).some((t) => t.includes('外区邀约'))) fail('外区邀约顺延以后每周又说一遍，或者没到下个转会期就兑现了')
    // the next transfer period: after the market day that closed the first
    s.day = MARKET_DAYS[0] + 4
    if (periodKey(2026, 20) === periodKey(2026, s.day)) fail(`第 20 天和第 ${s.day} 天算成了同一个转会期`)
    me.week = Math.max(me.week + 1, heldTo)
    mark = me.log[me.log.length - 1]
    storyWeek(s)
    const came = since(mark)
    if (me.chain || !me.deals.some((d) => d.teamId === abroadClub.id) || !came.some((t) => t.includes('按之前谈的开出了报价'))) fail(`下个转会期外区邀约没兑现：${came.join(' | ') || '没动静'}`)
    const next = draws()
    if (signedThisPeriod(s) || inviteBlock(s) || moveBlock(s)) fail(`下个转会期还挡着：${inviteBlock(s)}`)
    if (!next.invites) fail(`下个转会期、两边窗口开着，6 次里一份试训邀请都没来（报价 ${next.offers}）`)
    if (!next.market) fail('下个转会期，坐板凳的国际赛冠军 6 次里一份报价都没来')
    const again = listSelf(s)
    if (me.listedYear !== 2026) fail(`下个转会期挂不了牌：${again}`)
    clear()
    console.log(`  第 20 天签约、坐板凳：同一个转会期 ${same.invites} 份邀请 / ${same.offers + same.market} 份报价（没签约的对照 ${control.market} 份）· 挂牌「${listed}」· 外区邀约「${held.find((t) => t.includes('外区邀约')) ?? ''}」→ ${came.find((t) => t.includes('外区邀约')) ?? ''}`)
    console.log(`  下个转会期 ${next.invites} 份邀请 / ${next.offers + next.market} 份报价，挂牌「${again}」`)
    // his own club's window shut: at a VCT club after its 2026 window closed, with no signing in that period
    joinClub(s, makeDeal(s, vctClub.id, 'transfer', 'A', new Rng(2)))
    me.flags.signedPeriod = 0
    s.day = 230
    if (windowAt(s).open) fail(`2026 第 230 天 VCT 俱乐部的窗口应该关着：${windowLine(s)}`)
    const shut = draws()
    if (shut.invites) fail(`自己俱乐部的窗口关着（${windowLine(s)}），还来了 ${shut.invites} 份试训邀请`)
    if (inviteBlock(s) !== windowLine(s)) fail(`窗口关着时说的是「${inviteBlock(s)}」，应该是「${windowLine(s)}」`)
    // let go: nobody's club any more, and the rule is about a man under contract
    s.day = 240
    joinClub(s, makeDeal(s, chalClub.id, 'transfer', 'A', new Rng(3)))
    leaveClub(s, '和你解约了')
    if (signedThisPeriod(s) || inviteBlock(s)) fail(`被放走的自由人还挡着试训邀请：${inviteBlock(s)}`)
    if (!windowRuleLines(s).some((l) => l.includes('签约') && l.includes('试训'))) fail('帮助里的转会规则没写签约后这个转会期不来试训邀请')
    console.log(`  第 20 天签约：同一个转会期 ${same.invites} 份邀请 / ${same.offers} 份报价（「${why}」）；下个转会期 ${next.invites} 份邀请 / ${next.offers} 份报价；自己窗口关着 ${shut.invites} 份`)
  }
}

console.log(fails ? `\n✗ ${fails} 项不对。` : `\n✓ 转会窗口照年份和俱乐部开关，锁定时不来报价，世界市场照旧两个转会日；试训邀请只在转会期发，签约的那个转会期里不再发。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
