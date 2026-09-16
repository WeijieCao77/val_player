/**
 * 转会窗口 (engine/me/window.ts): the rule year by year and club by club, and what it does to a career.
 *
 * Reported 2026-09-14: 「23年的档，第一把比赛在三四月但是中间的时间转会窗口一直不开」; then, the same day,
 * 「转会窗口太长了，在有vct联赛之后，联赛赛事期间都应该没办法转会，只有赛事间隔休息期才开转会窗口」.
 *
 *   npx tsx scripts/check_window.ts [careers=2] [seasons=3] [year=2021]
 *
 * 一、2021–2022（不变）：没有比赛时一线、Challengers 俱乐部都开着；2021 赛区大师赛锁、挑战者赛不锁；2022 国际赛锁、赛区赛事不锁；
 *     一条 2021 年的生涯打到 2023 年，每一天要么开着、说「这两年没有固定窗口」，要么被国际赛、最后机会资格赛、2021 赛区大师赛
 *     和挑战者决赛锁着
 * 二、2023–2026 每个赛季照真实赛程抽好签（不打比赛）：谁在哪项赛事里读数据、不读引擎——正赛的席位、资格赛送上来的，打几天锁几天；
 *     只打了海选、资格赛、升降级赛这类只留结果的阶段、没打进正赛的，那个阶段打几天锁几天。每一家在自己打的每一天都关；VCT 联赛
 *     俱乐部、Challengers 俱乐部各挑几家：赛事之间的空档开、休赛期开，开着时说开到下一项赛事的前一天、之后打哪项，关着时说哪天
 *     解除；休赛期说开到下个赛季第一项赛事的前一天（暂定）；报数和 2026 年开窗日期
 * 三、名单锁定：LOCK//IN 打到最后一天，出局了也锁、那一行写出局；联赛赛段从常规赛第一天锁；Challengers 赛段、晋升赛整段锁；
 *     只打了海选的，海选打几天锁几天；玩家俱乐部的决胜局：从那轮海选第一天锁（抢席位的决胜局从当天），没打之前解除日期暂定，
 *     输了第二天开，赢了锁到赛事结束；对方俱乐部锁定也算；还没抽签的赛事按形势说开到哪天
 * 四、锁定期间不来新报价、不能挂牌；锁定期间谈妥的转会，锁定解除才生效
 * 五、世界市场只在两个转会日（第 166、324 天）动
 * 六、2023 年从 1 月 1 日打：VCT、Challengers 俱乐部各打 160 天，打过的每项赛事整段关着、那一行不说开放中，
 *     没赛事的日子开着；出局以后锁到最后一天；锁定的日子里没有报价进来
 * 七、生涯里的报价和转会（报数，只拦爆炸）；签约的那个转会期里，没有试训邀请、没有 VCT 俱乐部来找
 * 八、签约的那个转会期（2026-09-14，作者：「如果玩家在同一个转会期签约了，那就不发了，只能等下一个
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
import { MARKET_DAYS, absDay, clubOpen, dateCn, inviteBlock, listBlock, marketDay, moveBlock, periodKey, signedThisPeriod, windowAt, windowLine, windowOfClub, windowRuleLines } from '../src/engine/me/window'
import type { WindowState } from '../src/engine/me/window'
import { eventOf, eventsOf, gameOf } from '../src/engine/circuit'
import type { CEvent } from '../src/engine/circuit'
import { makeFixture } from '../src/engine/league'
import { setupSeason } from '../src/engine/season'
import { hasPlace, inVctLeague } from '../src/engine/timeline'
import { regionIn } from '../src/engine/era'
import { Rng } from '../src/engine/rng'
import type { Competition, Fixture, GameState, Region, Role, Team } from '../src/engine/types'

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
const iso = (n: number | undefined): string => (n == null ? '—' : new Date(n * DAY).toISOString().slice(0, 10))
const said = (w: WindowState): string => `${w.open ? '开' : '关'}${w.closesOn != null ? ` 到 ${iso(w.closesOn)}` : ''}${w.nextOpens != null ? ` 下次 ${iso(w.nextOpens)}` : ''}${w.lock ? ` 锁定 ${w.lock.event}` : ''}`
const OFFER = /开价了|直接开了报价|想请你去试训|那边给首发|按之前谈的开出了报价/
const LEAGUE_OF = (e: CEvent, league: string): boolean =>
  !e.scene && e.region === league && ['kickoff', 'stage1', 'stage2'].includes(e.stage ?? '') && !/Open Playoffs/i.test(e.name)
const MAJOR = (e: CEvent | undefined): boolean => !!e && (e.region === null || e.stage === 'lcq' || ['s1masters', 's2finals', 's3finals'].includes(e.stage ?? ''))

const base = createCareer({ name: 'Win', region: 'Europe', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 77, year: 2026 })

/* ---- the data, read without the engine ---- */
/** the seats an event's own matches are drawn from, read off its graph: not its qualifiers' */
function mainSeeds(ev: CEvent): number[] {
  const out = new Set<number>()
  for (const u of ev.units) {
    if (u.type === 'open') continue
    for (const n of u.nodes ?? []) for (const s of [n.a, n.b]) if (s[0] === 's') out.add(s[1])
  }
  return [...out].sort((a, b) => a - b)
}
/** the sides an event's phases kept as results really sent on into its own matches */
function sentOn(ev: CEvent): Set<string> {
  const out = new Set<string>()
  for (const u of ev.units) {
    if (u.type === 'open') continue
    for (const n of u.nodes ?? []) for (const sl of [n.a, n.b]) {
      const v = sl[0] === 'g' && ev.units[sl[1]]?.type === 'open' ? ev.units[sl[1]].ranked?.[(sl[2] ?? 0) - 1] : undefined
      if (v) out.add(v)
    }
  }
  return out
}
const vlrOf = (id: string): string => id.replace(/^V21T/, '')
/** in an event's own matches by the data alone: a seat of its own matches, or a place its qualifier really sent it to */
function seatedIn(ev: CEvent, id: string): boolean {
  if (ev.projected) return false
  const v = vlrOf(id)
  return mainSeeds(ev).some((i) => ev.seeds[i] === v) || sentOn(ev).has(v)
}
/** in a phase kept as its result and no further, by the data alone: that phase's first and last day */
function phaseOf(ev: CEvent, id: string): [number, number] | null {
  if (ev.projected) return null
  const v = vlrOf(id)
  const main = new Set(mainSeeds(ev))
  if (!ev.seeds.some((x, i) => x === v && !main.has(i)) || seatedIn(ev, id)) return null
  let from = Infinity
  let until = -Infinity
  for (const u of ev.units) {
    if (u.type !== 'open' || !u.ranked?.includes(v)) continue
    from = Math.min(from, u.first ?? ev.start!)
    until = Math.max(until, u.last ?? ev.end!)
  }
  return until < from ? null : [from, until]
}
/** an event drawn with `ids` in the first of its own seats */
function drawn(ev: CEvent, ids: string[], mode: 'history' | 'sim' = 'history'): Competition {
  const main = mainSeeds(ev)
  const seeds: (string | null)[] = Array.from({ length: Math.max(ev.seeds.length, (main[main.length - 1] ?? -1) + 1) }, () => null)
  ids.forEach((id, i) => { if (main[i] != null) seeds[main[i]] = id })
  return {
    key: `ev:${ev.id}`, name: ev.cn, stage: ev.stage ?? 'offseason', teams: ids.slice(), standings: {}, finished: [], format: 'circuit',
    circuit: { id: ev.id, start: ev.start!, end: ev.end!, seeds, mode },
  }
}
/** an event drawn as history had it: every side this world holds by its own id in its own place */
function asHistory(s: GameState, ev: CEvent, mode: 'history' | 'sim' = 'history'): Competition {
  const seeds = ev.projected ? [] : ev.seeds.map((v) => (s.teams[`V21T${v}`] ? `V21T${v}` : null))
  return {
    key: `ev:${ev.id}`, name: ev.cn, stage: ev.stage ?? 'offseason', teams: [...new Set(seeds.filter((x): x is string => !!x))], standings: {}, finished: [], format: 'circuit',
    circuit: { id: ev.id, start: ev.start!, end: ev.end!, seeds, mode },
  }
}
const find = (year: number, f: (e: CEvent) => boolean, what: string): CEvent => {
  const e = eventsOf(year).find(f)
  if (!e) throw new Error(`circuit.json 里找不到 ${year} ${what}`)
  return e
}

interface Want { open: boolean; closesOn?: number | null; nextOpens?: number; lock?: boolean }
function at(s: GameState, team: Team, when: { year: number; day: number }, want: Want, label: string): WindowState {
  s.year = when.year
  s.day = when.day
  const w = windowOfClub(s, team, true)
  const where = `${label} ${iso(absDay(when.year, when.day))}`
  if (w.open !== want.open) fail(`${where}：应该${want.open ? '开' : '关'}，实际 ${said(w)}`)
  else if (want.closesOn !== undefined && (w.closesOn ?? null) !== want.closesOn) fail(`${where}：应该开到 ${iso(want.closesOn ?? undefined)}，实际 ${said(w)}`)
  else if (want.nextOpens !== undefined && w.nextOpens !== want.nextOpens) fail(`${where}：下次应该 ${iso(want.nextOpens)} 开，实际 ${said(w)}`)
  else if (want.lock !== undefined && !!w.lock !== want.lock) fail(`${where}：${want.lock ? '应该锁定' : '不该锁定'}，实际 ${said(w)}`)
  return w
}

/* ---- 一、2021–2022 ---- */
console.log('一、2021–2022（不变）')
const cal = structuredClone(base) as GameState
cal.comps = {}
const vctIn = (league: string): Team | undefined =>
  Object.values(cal.teams).find((t) => t.tier === 1 && !!t.league?.startsWith('VCT ') && regionIn(t.region, 2026) === league)
const vct = vctIn('EMEA')
const chal = Object.values(cal.teams).find((t) => t.tier === 2 && !t.dormant)
if (!vct || !chal) throw new Error('2026 年的世界里找不到 VCT EMEA 俱乐部或 Challengers 俱乐部')
{
  let samples = 0
  for (const y of [2021, 2022]) {
    for (const d of [0, 100, 166, 250, 324, 363]) {
      at(cal, vct, { year: y, day: d }, { open: true, closesOn: null }, `${y} 一线俱乐部`)
      at(cal, chal, { year: y, day: d }, { open: true, closesOn: null }, `${y} Challengers`)
      samples += 2
    }
  }
  const lk = structuredClone(base) as GameState
  lk.me!.phase = 'pro'
  // 2021: a regional Masters locks, a Challengers event does not
  const masters = find(2021, (e) => e.stage === 's1masters' && e.region === 'Europe', '欧洲第一赛段大师赛')
  const open = find(2021, (e) => e.stage === 's1chal' && e.region === 'Europe' && e.units.some((u) => u.type !== 'open'), '欧洲第一赛段挑战者赛')
  lk.comps = { [`ev:${masters.id}`]: drawn(masters, [vct.id]), [`ev:${open.id}`]: drawn(open, [chal.id]) }
  at(lk, vct, { year: 2021, day: masters.start! }, { open: false, lock: true }, '2021 赛区大师赛')
  at(lk, vct, { year: 2021, day: masters.end! + 1 }, { open: true, lock: false }, '2021 赛区大师赛打完')
  at(lk, chal, { year: 2021, day: Math.max(open.start!, masters.end! + 1) }, { open: true, lock: false }, '2021 挑战者赛')
  // 2022: an international locks from its first day to its last, played as history; a regional event does not
  const intl = find(2022, (e) => e.region === null && e.start != null && e.end != null, '2022 国际赛')
  const regional = find(2022, (e) => !!e.region && e.stage !== 'lcq' && e.start != null && e.units.some((u) => u.type !== 'open'), '2022 赛区赛事')
  lk.comps = { [`ev:${intl.id}`]: drawn(intl, [vct.id]), [`ev:${regional.id}`]: drawn(regional, [chal.id]) }
  at(lk, vct, { year: 2022, day: intl.start! }, { open: false, lock: true }, `2022 ${intl.cn} 第一天`)
  at(lk, vct, { year: 2022, day: intl.end! }, { open: false, lock: true }, `2022 ${intl.cn} 最后一天`)
  at(lk, vct, { year: 2022, day: intl.end! + 1 }, { open: true, lock: false }, `2022 ${intl.cn} 打完`)
  at(lk, chal, { year: 2022, day: regional.start! }, { open: true, lock: false }, `2022 ${regional.cn}`)
  lk.year = 2022
  lk.myTeam = vct.id
  lk.day = intl.start!
  const line = windowLine(lk)
  if (line !== `名单锁定 · 你的俱乐部正在打 ${intl.cn} · ${dateCn(absDay(2022, intl.end!), 2022)}后解除`) fail(`2022 国际赛期间那一行：${line}`)
  const rule = windowRuleLines(lk)[0]
  if (!rule.includes('没有固定的转会窗口')) fail(`2022 年帮助里的规则变了：${rule}`)
  console.log(`  ${samples} 个样本日 · ${line}`)
}

/* ---- 二、2023–2026 照真实赛程抽好签 ---- */
console.log('二、2023–2026：打的每项赛事从第一天到最后一天关，赛事之间的空档和休赛期开')
/** a season on the books, every event drawn as history had it and none played */
function season(Y: number): GameState {
  const s = structuredClone(base) as GameState
  s.year = Y
  s.day = 0
  setupSeason(s)
  for (const comp of Object.values(s.comps)) {
    const ev = comp.circuit && eventOf(comp.circuit.id)
    if (ev) s.comps[comp.key] = asHistory(s, ev)
  }
  s.me!.phase = 'pro'
  return s
}
/** absolute days in dates, run together: 「01-01–01-19、02-15–03-30」 */
const spansCn = (days: number[]): string => {
  const out: string[] = []
  let a = -1
  let b = -1
  const put = (): void => { if (a >= 0) out.push(`${iso(a).slice(5)}–${iso(b).slice(5)}`) }
  for (const d of days) {
    if (a >= 0 && d === b + 1) { b = d; continue }
    put()
    a = d
    b = d
  }
  put()
  return out.join('、')
}
for (const Y of [2023, 2024, 2025, 2026]) {
  const s = season(Y)
  const comps = Object.values(s.comps).filter((c) => !!c.circuit && !!eventOf(c.circuit.id))
  /** each club's days in each event, by the data: its own matches' event for the event's days, a phase kept as its result for that phase's */
  const daysOf = new Map<string, { from: number; until: number; name: string; phase: boolean }[]>()
  let seated = 0
  let phased = 0
  for (const comp of comps) {
    const ev = eventOf(comp.circuit!.id)!
    for (const id of comp.teams) {
      const span = seatedIn(ev, id) ? [ev.start!, ev.end!] : phaseOf(ev, id)
      if (!span) continue
      if (seatedIn(ev, id)) seated++
      else phased++
      daysOf.set(id, [...(daysOf.get(id) ?? []), { from: Math.max(0, span[0]), until: Math.min(363, span[1]), name: comp.name, phase: !seatedIn(ev, id) }])
    }
  }
  // the clubs read in full: two leagues', and three Challengers leagues'
  const groups: [string, Team[]][] = []
  const of = (pick: (e: CEvent) => boolean, keep: (t: Team) => boolean): Team[] => {
    const ids = new Set<string>()
    for (const comp of comps) {
      const ev = eventOf(comp.circuit!.id)!
      if (pick(ev)) for (const id of comp.teams) if (seatedIn(ev, id) && keep(s.teams[id])) ids.add(id)
    }
    return [...ids].map((id) => s.teams[id]).sort((a, b) => a.id.localeCompare(b.id))
  }
  groups.push(['VCT EMEA', of((e) => LEAGUE_OF(e, 'EMEA'), (t) => inVctLeague(s, t))])
  groups.push(['VCT Pacific', of((e) => LEAGUE_OF(e, 'Pacific'), (t) => inVctLeague(s, t))])
  for (const scene of ['North America', 'DACH', 'Japan']) {
    const list = of((e) => e.scene === scene, (t) => !inVctLeague(s, t))
    if (list.length) groups.push([`Challengers ${scene}`, list])
  }
  const openDays = new Map<string, number[]>()
  let wrong = 0
  let checked = 0
  for (let d = 0; d <= 363; d++) {
    s.day = d
    for (const [id, spans] of daysOf) {
      const x = spans.find((sp) => d >= sp.from && d <= sp.until)
      if (!x) continue
      checked++
      if (clubOpen(s, id)) {
        wrong++
        if (wrong <= 3) fail(`${Y} ${s.teams[id]?.name} 打 ${x.name}${x.phase ? '（只打了资格赛这类阶段）' : ''}，第 ${d} 天开着`)
      }
    }
    for (const [, list] of groups) for (const t of list) if (clubOpen(s, t.id)) openDays.set(t.id, [...(openDays.get(t.id) ?? []), absDay(Y, d)])
  }
  if (wrong > 3) fail(`${Y}：另外还有 ${wrong - 3} 个赛事日开着`)
  const summary: string[] = []
  for (const [g, list] of groups) {
    if (!list.length) { fail(`${Y} 找不到 ${g} 的俱乐部`); continue }
    const counts = list.map((t) => ({ t, n: openDays.get(t.id)?.length ?? 0 })).sort((a, b) => a.n - b.n || a.t.id.localeCompare(b.t.id))
    const m = counts[Math.floor((counts.length - 1) / 2)]
    summary.push(`${g} ${list.length} 家开窗中位 ${m.n} 天（${counts[0].n}–${counts[counts.length - 1].n}）`)
    // the median club, day by day: shut on its events' days, open between them and after the last
    const club = m.t
    s.myTeam = club.id
    const spans = (daysOf.get(club.id) ?? []).slice().sort((a, b) => a.from - b.from)
    const busy = (d: number) => spans.find((x) => d >= x.from && d <= x.until)
    let shutGap = 0
    let openBusy = 0
    for (let d = 0; d <= 363; d++) {
      const open = (openDays.get(club.id) ?? []).includes(absDay(Y, d))
      if (busy(d) && open) openBusy++
      if (!busy(d) && !open) shutGap++
    }
    if (openBusy || shutGap) fail(`${Y} ${g} ${club.name}：赛事期间开着 ${openBusy} 天，没有赛事关着 ${shutGap} 天`)
    // a gap between two of its events: open to the day before the next, which it names
    const gap = spans.findIndex((x, i) => i > 0 && x.from > Math.max(...spans.slice(0, i).map((y) => y.until)) + 1)
    if (gap > 0) {
      const d = Math.max(...spans.slice(0, gap).map((y) => y.until)) + 1
      s.day = d
      const w = windowAt(s)
      const line = windowLine(s)
      const next = spans.filter((x) => x.from > d).sort((a, b) => a.from - b.from)[0]
      if (!w.open || w.closesOn !== absDay(Y, next.from - 1) || w.closer !== next.name || !line.includes('开放中') || !line.includes(`之后打 ${next.name}`)) {
        fail(`${Y} ${club.name} 第 ${d} 天（两项赛事之间）：${line}，应该开到 ${iso(absDay(Y, next.from - 1))}、之后打 ${next.name}`)
      }
      // the first day of the next event: shut, and says the day it lifts
      s.day = next.from
      const lock = windowAt(s)
      let end = next.until
      for (const x of spans) if (x.from <= end + 1 && x.until > end) end = x.until
      if (lock.open || !lock.lock || lock.nextOpens !== absDay(Y, end + 1) || !windowLine(s).startsWith('名单锁定 · 你的俱乐部正在打 ')) {
        fail(`${Y} ${club.name} ${next.name} 第一天：${windowLine(s)}，应该第 ${end + 1} 天再开`)
      }
    } else if (spans.length > 1 && spans.some((x, i) => i > 0 && x.from > spans[i - 1].until + 1)) fail(`${Y} ${club.name}：赛事之间的空档没找到`)
    // the offseason: from the day after its last event, open to the day before next season's first (暂定)
    const last = Math.max(...spans.map((x) => x.until))
    if (last < 363) {
      s.day = last + 1
      const w = windowAt(s)
      const line = windowLine(s)
      const nextYear = w.closesOn != null && iso(w.closesOn).startsWith(String(Y + 1))
      if (!w.open || !nextYear || !w.tentative || !line.includes('（暂定）')) fail(`${Y} ${club.name} 休赛期第一天（第 ${last + 1} 天）：${line}`)
      if (g === 'VCT EMEA') {
        const ko = eventsOf(Y + 1).find((e) => LEAGUE_OF(e, 'EMEA') && e.stage === 'kickoff')
        const want = ko ? absDay(Y + 1, Math.max(0, ko.start!) - 1) : null
        // the report read 「转会窗口开放中 · 到 2026年8月7日（还剩 275 天）（暂定）」 over the offseason: Riot's window, to Stage 2
        if (w.closesOn !== want) fail(`${Y} ${club.name} 休赛期应该开到 ${Y + 1} 年 EMEA 揭幕赛前一天 ${iso(want ?? undefined)}：${line}`)
        if (Y === 2025) console.log(`  2025 休赛期 ${club.name}：${line}`)
      }
    }
    if (Y === 2026 && (g === 'VCT EMEA' || g === 'Challengers North America')) console.log(`  2026 ${club.name}（${g}）开窗：${spansCn(openDays.get(club.id) ?? [])}`)
  }
  console.log(`  ${Y}：${comps.length} 项赛事、${seated} 个正赛席位、${phased} 个只打资格赛这类阶段的、${checked} 个赛事日 · ${summary.join(' · ')}`)
}

/* ---- 三、名单锁定 ---- */
console.log('三、名单锁定')
const lk = structuredClone(base) as GameState
lk.me!.phase = 'pro'
{
  const lockin = find(2023, (e) => /LOCK\/\/IN/.test(e.name), 'LOCK//IN')
  const c = drawn(lockin, [vct.id, chal.id])
  lk.comps = { [c.key]: c }
  lk.myTeam = vct.id
  at(lk, vct, { year: 2023, day: lockin.start! - 1 }, { open: true, closesOn: absDay(2023, lockin.start! - 1), lock: false }, 'LOCK//IN 前一天')
  at(lk, vct, { year: 2023, day: lockin.start! }, { open: false, lock: true }, 'LOCK//IN 开打')
  const line = windowLine(lk)
  if (line !== '名单锁定 · 你的俱乐部正在打 LOCK//IN 圣保罗 · 3月4日后解除') fail(`LOCK//IN 期间那一行：${line}`)
  else console.log(`  ${line}`)
  at(lk, vct, { year: 2023, day: lockin.end! }, { open: false, lock: true }, 'LOCK//IN 最后一天')
  at(lk, vct, { year: 2023, day: lockin.end! + 1 }, { open: true, lock: false }, 'LOCK//IN 打完')
  // played here: a tie of its own to play holds it; out of it — another side's title — it is held to the last day all the same, and the line says so
  c.circuit!.mode = 'sim'
  lk.fixtures = [makeFixture(lk, lockin.start! + 3, 'kickoff', c.key, vct.id, chal.id, 3, 'KO:1:首轮')]
  at(lk, vct, { year: 2023, day: lockin.start! + 1 }, { open: false, lock: true }, 'LOCK//IN 还有比赛')
  lk.fixtures = []
  c.champion = chal.id
  at(lk, vct, { year: 2023, day: lockin.start! + 2 }, { open: false, lock: true }, 'LOCK//IN 出局')
  const out = windowLine(lk)
  if (!out.includes('已在 LOCK//IN 圣保罗 出局，名单锁到赛事结束 · 3月4日后解除') || out.includes('开放中')) fail(`LOCK//IN 出局以后那一行：${out}`)
  else console.log(`  ${out}`)
  c.champion = vct.id
  at(lk, vct, { year: 2023, day: lockin.start! + 3 }, { open: false, lock: true }, 'LOCK//IN 夺冠以后到最后一天')
}
{
  // 2025: a league stage from its first day, regular season and all; a Challengers stage and an Ascension all through
  const stage1 = find(2025, (e) => e.stage === 'stage1' && e.region === 'EMEA' && !e.scene, 'EMEA 第一赛段')
  const split = find(2025, (e) => !!e.scene && (e.start ?? 0) > 0 && e.units.some((u) => u.type !== 'open') && mainSeeds(e).length > 0, 'Challengers 赛段')
  const asc = find(2025, (e) => e.stage === 'ascension' && e.region === 'EMEA' && mainSeeds(e).length > 0, 'EMEA 晋升赛')
  lk.comps = { [`ev:${stage1.id}`]: drawn(stage1, [vct.id]), [`ev:${split.id}`]: drawn(split, [chal.id]) }
  at(lk, vct, { year: 2025, day: stage1.start! - 1 }, { open: true, closesOn: absDay(2025, stage1.start! - 1), lock: false }, 'EMEA 第一赛段前一天')
  at(lk, vct, { year: 2025, day: stage1.start! }, { open: false, lock: true }, 'EMEA 第一赛段常规赛第一天')
  at(lk, vct, { year: 2025, day: stage1.end! }, { open: false, lock: true }, 'EMEA 第一赛段最后一天')
  at(lk, chal, { year: 2025, day: split.start! }, { open: false, lock: true }, `${split.cn} 第一天`)
  at(lk, chal, { year: 2025, day: split.end! }, { open: false, lock: true }, `${split.cn} 最后一天`)
  lk.comps = { [`ev:${asc.id}`]: drawn(asc, [chal.id]) }
  at(lk, chal, { year: 2025, day: asc.start! }, { open: false, lock: true }, 'EMEA 晋升赛第一天')
  at(lk, chal, { year: 2025, day: asc.end! }, { open: false, lock: true }, 'EMEA 晋升赛最后一天')
  // the other club's lock closes a move as surely as mine: my Challengers club is open, the VCT club I would join is in its stage
  lk.year = 2025
  lk.day = stage1.start! + 1
  lk.myTeam = chal.id
  lk.comps = { [`ev:${stage1.id}`]: drawn(stage1, [vct.id]) }
  const w = windowAt(lk, vct.id)
  if (w.open || w.side !== 'other' || clubOpen(lk, vct.id)) fail(`对方俱乐部在打联赛，转会应该办不了：${said(w)}`)
}
{
  // a phase kept as its result — an open qualifier, a regular season, a promotion series — that history had a club in and no further: held for that phase's days
  let hit: { Y: number; ev: CEvent; id: string; span: [number, number] } | undefined
  for (const Y of [2025, 2024, 2023, 2026]) {
    for (const ev of eventsOf(Y)) {
      if (ev.projected || ev.start == null) continue
      for (const v of new Set(ev.seeds)) {
        const id = `V21T${v}`
        const span = lk.teams[id] && id !== vct.id && id !== chal.id ? phaseOf(ev, id) : null
        if (span && span[0] >= Math.max(1, ev.start) && span[1] < 362) { hit = { Y, ev, id, span }; break }
      }
      if (hit) break
    }
    if (hit) break
  }
  if (!hit) fail('2023–2026 找不到只打了资格赛这类阶段的俱乐部')
  else {
    const { Y, ev, id, span } = hit
    const team = lk.teams[id]
    const c = asHistory(lk, ev)
    lk.comps = { [c.key]: c }
    lk.myTeam = id
    at(lk, team, { year: Y, day: span[0] - 1 }, { open: true, closesOn: absDay(Y, span[0] - 1), lock: false }, `${ev.cn} ${team.name} 那一轮前一天`)
    at(lk, team, { year: Y, day: span[0] }, { open: false, lock: true }, `${ev.cn} ${team.name} 那一轮第一天`)
    const line = windowLine(lk)
    if (line !== `名单锁定 · 你的俱乐部正在打 ${ev.cn} · ${dateCn(absDay(Y, span[1]), Y)}后解除`) fail(`只打了资格赛这类阶段那一行：${line}`)
    at(lk, team, { year: Y, day: span[1] }, { open: false, lock: true }, `${ev.cn} ${team.name} 那一轮最后一天`)
    at(lk, team, { year: Y, day: span[1] + 1 }, { open: true, lock: false }, `${ev.cn} ${team.name} 那一轮打完`)
    console.log(`  只打了资格赛这类阶段：${line}`)
  }
}
{
  // the player's club in its decider for a seat: shut that day, its lift 暂定; lost, open the next day; won, shut to the event's last day
  const ev = find(2025, (e) => !!e.scene && (e.start ?? 0) > 5 && e.units.some((u) => u.type !== 'open') && mainSeeds(e).length >= 2, 'Challengers 赛事')
  const rival = Object.values(lk.teams).find((t) => t.id !== chal.id && t.id !== vct.id && t.tier === 2 && !t.dormant)!
  const c = drawn(ev, [rival.id], 'sim')
  const f = makeFixture(lk, ev.start! - 1, c.stage, c.key, chal.id, rival.id, 3, 'KO:0:升降级 · 决胜局')
  c.circuit!.playin = { key: `s:${mainSeeds(ev)[0]}`, fixture: f.id }
  lk.comps = { [c.key]: c }
  lk.fixtures = [f]
  lk.myTeam = chal.id
  at(lk, chal, { year: 2025, day: ev.start! - 2 }, { open: true, lock: false }, '决胜局前一天')
  at(lk, chal, { year: 2025, day: ev.start! - 1 }, { open: false, lock: true }, '决胜局当天')
  const toPlay = windowLine(lk)
  if (!toPlay.includes(`正在打 ${ev.cn}`) || !toPlay.endsWith('（暂定）')) fail(`决胜局没打之前那一行：${toPlay}`)
  f.played = true
  f.result = { mapsWonA: 0, mapsWonB: 2, maps: [{ scoreA: 9, scoreB: 13 }, { scoreA: 11, scoreB: 13 }] } as unknown as Fixture['result']
  lk.day = ev.start! - 1
  const lost = windowLine(lk)
  if (!lost.includes(`在 ${ev.cn} 的决胜局出局`) || lost.includes('开放中')) fail(`决胜局输了当天那一行：${lost}`)
  at(lk, chal, { year: 2025, day: ev.start! }, { open: true, lock: false }, '决胜局输了第二天')
  f.result = { mapsWonA: 2, mapsWonB: 0, maps: [{ scoreA: 13, scoreB: 9 }, { scoreA: 13, scoreB: 11 }] } as unknown as Fixture['result']
  at(lk, chal, { year: 2025, day: ev.start! + 1 }, { open: false, lock: true }, '决胜局赢了')
  at(lk, chal, { year: 2025, day: ev.end! }, { open: false, lock: true }, '决胜局赢了，赛事最后一天')
  at(lk, rival, { year: 2025, day: ev.start! + 2 }, { open: true, lock: false }, '决胜局输给玩家俱乐部的那家')
  lk.fixtures = []
  console.log(`  决胜局没打：${toPlay}；输了：${lost}`)
}
{
  // the player's club in its decider for an open qualifier's place: shut from that qualifier's first day, not only the decider's
  let hit: { ev: CEvent; ui: number; rank: number } | undefined
  for (const ev of eventsOf(2025)) {
    if (!ev.scene || ev.projected || ev.start == null) continue
    for (const u of ev.units) for (const n of u.nodes ?? []) for (const sl of [n.a, n.b]) {
      const q = sl[0] === 'g' ? ev.units[sl[1]] : undefined
      if (!hit && q?.type === 'open' && (q.first ?? 0) >= 2 && (q.last ?? 0) > (q.first ?? 0) + 2 && (q.last ?? 0) < ev.end!) hit = { ev, ui: sl[1], rank: sl[2] ?? 1 }
    }
    if (hit) break
  }
  if (!hit) fail('2025 找不到有海选送人进正赛的 Challengers 赛事')
  else {
    const { ev, ui, rank } = hit
    const q = ev.units[ui]
    const rival = Object.values(lk.teams).find((t) => t.id !== chal.id && t.id !== vct.id && t.tier === 2 && !t.dormant && !ev.seeds.includes(vlrOf(t.id)))!
    const c = drawn(ev, [], 'sim')
    c.circuit!.fill = { [`${ui}:${rank}`]: rival.id }
    const f = makeFixture(lk, q.last!, c.stage, c.key, chal.id, rival.id, 3, 'KO:0:海选 · 决胜局')
    c.circuit!.playin = { key: `${ui}:${rank}`, fixture: f.id }
    lk.comps = { [c.key]: c }
    lk.fixtures = [f]
    lk.myTeam = chal.id
    at(lk, chal, { year: 2025, day: q.first! - 1 }, { open: true, closesOn: absDay(2025, q.first! - 1), lock: false }, `${ev.cn} 海选前一天`)
    at(lk, chal, { year: 2025, day: q.first! }, { open: false, lock: true }, `${ev.cn} 海选第一天（决胜局在第 ${q.last} 天）`)
    at(lk, chal, { year: 2025, day: q.last! }, { open: false, lock: true }, `${ev.cn} 决胜局当天`)
    f.played = true
    f.result = { mapsWonA: 0, mapsWonB: 2, maps: [{ scoreA: 9, scoreB: 13 }, { scoreA: 11, scoreB: 13 }] } as unknown as Fixture['result']
    at(lk, chal, { year: 2025, day: q.last! + 1 }, { open: true, lock: false }, `${ev.cn} 决胜局输了第二天`)
    f.result = { mapsWonA: 2, mapsWonB: 0, maps: [{ scoreA: 13, scoreB: 9 }, { scoreA: 13, scoreB: 11 }] } as unknown as Fixture['result']
    at(lk, chal, { year: 2025, day: q.last! + 1 }, { open: false, lock: true }, `${ev.cn} 决胜局赢了第二天`)
    at(lk, rival, { year: 2025, day: q.last! + 1 }, { open: true, lock: false }, `${ev.cn} 决胜局输给玩家俱乐部的那家`)
    lk.fixtures = []
    console.log(`  海选决胜局：${ev.cn} 海选第 ${q.first}–${q.last} 天锁，赢了锁到第 ${ev.end} 天`)
  }
}
{
  // an event not drawn yet, as its draw stands today: open to its eve, and says which event shuts it
  const s = structuredClone(base) as GameState
  s.year = 2025
  s.day = 0
  setupSeason(s)
  const st1 = Object.values(s.comps).find((c) => { const e = eventOf(c.circuit?.id ?? ''); return !!e && LEAGUE_OF(e, 'EMEA') && e.stage === 'stage1' })
  const club = st1?.teams.find((id) => inVctLeague(s, s.teams[id]))
  if (!st1 || !club) fail('2025 EMEA 第一赛段的名单里找不到 VCT 俱乐部')
  else {
    s.me!.phase = 'pro'
    s.myTeam = club
    s.day = st1.circuit!.start - 10
    const w = windowAt(s)
    if (!w.open || w.closesOn !== absDay(2025, st1.circuit!.start - 1) || w.closer !== st1.name || w.tentative) fail(`还没抽签的第一赛段：${windowLine(s)}`)
    else console.log(`  还没抽签：${windowLine(s)}`)
  }
}

/* ---- 四、锁定期间不来报价；谈妥的转会锁定解除才生效 ---- */
console.log('四、锁定期间的报价和转会')
{
  const s = structuredClone(base) as GameState
  const me = s.me!
  const mine = s.teams[s.myTeam]
  const london = find(2026, (e) => e.stage === 'masters2' && e.region === null, '2026 第二站大师赛')
  const c = drawn(london, [mine.id])
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
    const agreed = acceptDeal(s, deal.id)
    if (!me.moveAfter || s.myTeam !== mine.id) fail('锁定期间签下的转会当场就生效了')
    if (!agreed.includes(dateCn(absDay(2026, london.end!), 2026))) fail(`谈妥时没说锁定到哪天：${agreed}`)
    if (windowRoll(s, new Rng(12), 'market')) fail('谈妥下一家以后还来了报价')
    settleMove(s)
    if (s.myTeam !== mine.id) fail('比赛还没打完就转走了')
    s.day = london.end! + 1
    settleMove(s)
    const made = me.log.find((l) => l.text.includes('名单锁定解除了，转会正式生效'))?.text
    if (s.myTeam !== buyer.id || me.moveAfter || !made?.startsWith(`${london.cn} `)) fail(`大师赛打完第二天应该正式转会：${made ?? '日志里没有'}`)
    else console.log(`  ${london.cn} 期间谈妥 ${buyer.name}（「${agreed}」），第 ${s.day} 天正式转会：「${made}」`)
  }
}

/* ---- 五、世界市场 ---- */
console.log('五、世界市场')
{
  const days = Array.from({ length: 364 }, (_, d) => d).filter((d) => marketDay({ day: d }))
  if (MARKET_DAYS.join() !== '166,324' || days.join() !== '166,324') fail(`世界市场应该只在第 166、324 天动，实际 ${days.join('、')}`)
  const week = readFileSync(new URL('../src/engine/me/week.ts', import.meta.url), 'utf8')
  const calls = week.match(/marketWindow\(/g)?.length ?? 0
  if (calls !== 1 || !/const market = marketDay\(state\)/.test(week) || !/if \(market\) marketWindow\(/.test(week)) {
    fail(`me/week.ts 里的 marketWindow 应该只调一次、只在转会日：调了 ${calls} 次`)
  } else console.log('  只在第 166、324 天，和球员自己的窗口无关')
}

/* ---- 六、2021–2022 一路打下来，2023 年从 1 月 1 日打 ---- */
console.log('六、2021–2022 一路打下来；2023 年从 1 月 1 日打')
{
  const UNTIL = 160
  const w21 = createCareer({ name: 'Win23', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 23, year: 2021 })
  {
    // 2021–2022 unchanged: each day's end is open with the open circuit's words, or locked by a major the club plays
    const me = w21.me!
    let value = w21.day
    const seen = { open: 0, locked: 0, bad: 0 }
    Object.defineProperty(w21, 'day', {
      get: () => value,
      set: (n: number) => {
        if (n === value + 1 && w21.year <= 2022 && me.phase === 'pro' && w21.teams[w21.myTeam]) {
          const w = windowAt(w21)
          const line = windowLine(w21)
          const ev = w.lock ? eventOf(w21.comps[w.lock.comp]?.circuit?.id ?? '') : undefined
          const ok = w.open
            ? !w.lock && w.closesOn == null && line === '转会窗口开放中 · 这两年没有固定窗口，不打大赛的日子都能转'
            : !!w.lock && w.lock.kind === 'major' && MAJOR(ev) && line === `名单锁定 · 你的俱乐部正在打 ${w.lock.event} · ${dateCn(absDay(w21.year, w.lock.until), w21.year)}后解除`
          if (w.open) seen.open++
          else seen.locked++
          if (!ok && seen.bad++ < 3) fail(`${w21.year} 第 ${value} 天：${line}（${w.lock?.kind ?? ''} ${ev?.name ?? ''}）`)
        }
        value = n
      },
      enumerable: true, configurable: true,
    })
    let g = 0
    while (w21.year < 2023 && g++ < 200 && w21.me!.phase !== 'retired') autoWeek(w21)
    Object.defineProperty(w21, 'day', { value, writable: true, enumerable: true, configurable: true })
    if (seen.bad > 3) fail(`2021–2022：另外还有 ${seen.bad - 3} 天不对`)
    if (!seen.locked) fail('2021–2022 一路打下来，一天大赛锁定都没有')
    console.log(`  2021–2022 一路打下来：开着 ${seen.open} 天、大赛锁定 ${seen.locked} 天`)
  }
  if (w21.year !== 2023) throw new Error('没打到 2023 年')

  interface Row { day: number; open: boolean; lock: boolean; club: string; line: string }
  const watch = (s: GameState): { rows: Row[]; inLock: number } => {
    const me = s.me!
    const rows: Row[] = []
    let inLock = 0
    let last = me.log[me.log.length - 1]
    let value = s.day
    Object.defineProperty(s, 'day', {
      get: () => value,
      set: (n: number) => {
        // the end of day `value`: its matches, its rolls and its week are done (engine/season.ts advanceDay opens the next with day++)
        if (n === value + 1 && s.year === 2023 && me.phase === 'pro') {
          const w = windowAt(s)
          const from = last ? me.log.lastIndexOf(last) + 1 : 0
          const fresh = me.log.slice(from)
          last = me.log[me.log.length - 1]
          if (w.lock && w.side === 'mine') inLock += fresh.filter((l) => l.kind === 'deal' && OFFER.test(l.text)).length
          rows.push({ day: value, open: w.open, lock: !!w.lock, club: s.myTeam, line: windowLine(s) })
        }
        value = n
      },
      enumerable: true, configurable: true,
    })
    let guard = 0
    while (s.year === 2023 && value < UNTIL && guard++ < 40 && s.me!.phase !== 'retired') autoWeek(s)
    Object.defineProperty(s, 'day', { value, writable: true, enumerable: true, configurable: true })
    return { rows, inLock }
  }
  /** the events the club played by day UNTIL, off their fields, the data and its own ties: each shut from its first day to its last, a qualifier's phase its own days, a lost decider to its day */
  const judge = (s: GameState, club: Team, rows: Row[], inLock: number, label: string): void => {
    const spans: { from: number; until: number; name: string; lastTie: number }[] = []
    for (const comp of Object.values(s.comps)) {
      const c = comp.circuit
      const ev = c && eventOf(c.id)
      if (!c || !ev || !c.mode || c.start > UNTIL) continue
      const ties = s.fixtures.filter((f) => f.comp === comp.key && (f.teamA === club.id || f.teamB === club.id))
      const decider = ties.find((f) => /^KO:0:/.test(f.label) && c.playin?.fixture === f.id)
      const lastTie = Math.max(-1, ...ties.filter((f) => f.played).map((f) => f.day))
      const main = new Set(mainSeeds(ev))
      const onFloor = c.seeds.some((t, i) => t === club.id && main.has(i)) || Object.values(c.fill ?? {}).includes(club.id)
        || sentOn(ev).has(vlrOf(club.id)) || ties.some((f) => !/^KO:0:/.test(f.label))
      if (decider) {
        const q = /^(\d+):/.exec(c.playin!.key)
        const first = Math.max(0, Math.min(q ? ev.units[Number(q[1])].first ?? c.start : decider.day, decider.day))
        const lost = decider.played && gameOf(decider)?.w !== club.id
        spans.push({ from: first, until: lost ? decider.day : c.end, name: comp.name, lastTie })
      } else if (onFloor) {
        spans.push({ from: Math.max(0, c.start), until: c.end, name: comp.name, lastTie })
      } else if (c.seeds.includes(club.id)) {
        const phase = phaseOf(ev, club.id)
        if (phase) spans.push({ from: Math.max(0, phase[0]), until: phase[1], name: comp.name, lastTie })
      }
    }
    const mine = rows.filter((r) => r.club === club.id)
    const inside = (d: number) => spans.find((x) => d >= x.from && d <= x.until)
    const openIn = mine.filter((r) => inside(r.day) && (r.open || r.line.includes('开放中')))
    const shutOut = mine.filter((r) => !inside(r.day) && !r.open)
    if (openIn.length) fail(`${label} ${club.name}：${inside(openIn[0].day)!.name} 期间开着 ${openIn.length} 天（第 ${openIn[0].day} 天「${openIn[0].line}」）`)
    if (shutOut.length) fail(`${label} ${club.name}：没有赛事也关着 ${shutOut.length} 天（第 ${shutOut[0].day} 天「${shutOut[0].line}」）`)
    if (!mine.some((r) => r.open)) fail(`${label} ${club.name}：前 ${UNTIL} 天一天都没开`)
    if (!spans.length) fail(`${label} ${club.name}：前 ${UNTIL} 天一项赛事都没打`)
    if (inLock) fail(`${label} ${club.name}：名单锁定的日子里进来 ${inLock} 份报价`)
    // out before the last day: still shut, and the line says it is out
    const early = spans.find((x) => x.lastTie >= 0 && x.lastTie < x.until - 1 && x.until <= UNTIL)
    let outSaid = ''
    if (early) {
      const after = mine.filter((r) => r.day > early.lastTie + 1 && r.day <= early.until)
      if (after.some((r) => r.open)) fail(`${label} ${club.name}：${early.name} 最后一场（第 ${early.lastTie} 天）以后、赛事结束前开了`)
      outSaid = ` · ${early.name} 最后一场第 ${early.lastTie} 天，锁到第 ${early.until} 天`
      const out = after.find((r) => r.line.includes('出局'))
      if (out) outSaid += `（「${out.line}」）`
    }
    const open = mine.filter((r) => r.open).length
    console.log(`  ${club.name}（${label}）：前 ${UNTIL} 天开 ${open} 天、关 ${mine.length - open} 天 · 打了 ${spans.map((x) => `${x.name} 第 ${x.from}–${x.until} 天`).join('、')}${outSaid} · 锁定时报价 ${inLock}`)
  }

  // at a VCT league club
  const v = structuredClone(w21) as GameState
  const had = v.teams[v.myTeam]
  const target = had && inVctLeague(v, had) ? had
    : Object.values(v.teams).filter((t) => inVctLeague(v, t) && regionIn(t.region, 2023) === 'Americas' && !t.dormant).sort((a, b) => a.rating - b.rating)[0]
  if (!target) fail('2023 年美洲联赛里找不到俱乐部')
  else {
    if (target.id !== v.myTeam) joinClub(v, makeDeal(v, target.id, 'transfer', 'A', new Rng(2)))
    v.me!.tenure = 1
    const { rows, inLock } = watch(v)
    judge(v, target, rows, inLock, 'VCT')
  }

  // at a Challengers club
  const c = structuredClone(w21) as GameState
  const club = Object.values(c.teams).filter((t) => t.tier === 2 && !t.dormant && t.roster.length >= 5 && hasPlace(c, t) && regionIn(t.region, 2023) === 'Americas')
    .sort((a, b) => b.rating - a.rating)[0]
  if (!club) fail('2023 年美洲找不到有比赛打的 Challengers 俱乐部')
  else {
    if (club.id !== c.myTeam) joinClub(c, makeDeal(c, club.id, 'transfer', 'A', new Rng(3)))
    c.me!.tenure = 1
    const { rows, inLock } = watch(c)
    judge(c, club, rows, inLock, 'Challengers')
  }
  const help = windowRuleLines(c)
  if (!help[0].includes('从第一天到最后一天都锁名单') || !help[1].includes('休赛期') || help.some((l) => l.includes('Riot') || l.includes('季后赛、晋级赛'))) fail(`2023 年帮助里的规则：${help.slice(0, 2).join(' / ')}`)
}

/* ---- 七、生涯里的报价和转会 ---- */
console.log('七、生涯里的报价和转会（和改之前量的是同一批种子）')
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

/* ---- 八、签约的那个转会期 ---- */
console.log('八、签约的那个转会期里：不来试训邀请、不来报价、不能挂牌，外区邀约顺延；下个转会期照常')
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
    // his own club's window shut: at a VCT club in its league's Stage 2, with no signing in that period
    joinClub(s, makeDeal(s, vctClub.id, 'transfer', 'A', new Rng(2)))
    me.flags.signedPeriod = 0
    const stage2 = find(2026, (e) => LEAGUE_OF(e, league) && e.stage === 'stage2', `${league} 第二赛段`)
    s.comps[`ev:${stage2.id}`] = drawn(stage2, [vctClub.id])
    s.day = 230
    if (windowAt(s).open) fail(`2026 第 230 天 VCT 俱乐部在打第二赛段，窗口应该关着：${windowLine(s)}`)
    const shut = draws()
    if (shut.invites) fail(`自己俱乐部的窗口关着（${windowLine(s)}），还来了 ${shut.invites} 份试训邀请`)
    if (inviteBlock(s) !== windowLine(s)) fail(`窗口关着时说的是「${inviteBlock(s)}」，应该是「${windowLine(s)}」`)
    // let go: nobody's club any more, and the rule is about a man under contract
    s.day = 240
    joinClub(s, makeDeal(s, chalClub.id, 'transfer', 'A', new Rng(3)))
    leaveClub(s, '和你解约了')
    if (signedThisPeriod(s) || inviteBlock(s)) fail(`被放走的自由人还挡着试训邀请：${inviteBlock(s)}`)
    if (!windowRuleLines(s).some((l) => l.includes('签约') && l.includes('试训'))) fail('帮助里的转会规则没写签约后这个转会期不来试训邀请')
    console.log(`  第 20 天签约：同一个转会期 ${same.invites} 份邀请 / ${same.offers} 份报价（「${why}」）；下个转会期 ${next.invites} 份邀请 / ${next.offers} 份报价；自己俱乐部打第二赛段 ${shut.invites} 份`)
  }
}

console.log(fails ? `\n✗ ${fails} 项不对。` : `\n✓ 转会窗口：2021–2022 只锁大赛；2023 起俱乐部打的每项赛事整段锁，赛事之间和休赛期开；锁定时不来报价，世界市场照旧两个转会日；试训邀请只在转会期发，签约的那个转会期里不再发。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
