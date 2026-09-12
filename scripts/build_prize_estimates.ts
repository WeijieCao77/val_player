/**
 * Estimated prize tables for the events whose amounts were never published:
 * src/data/prize_estimates_me.json.
 *
 * The author, 2026-09-12: 「每个赛段都应该有奖金比如打进季后赛，拿下冠军等等」.
 * data/prizes_me.json is what each event really paid, and an event whose
 * amounts were never published paid nothing. This gives such an event an
 * estimate built only out of real published tables. Every estimate names the
 * real event it is drawn from (its Liquipedia page) and the rule, and the game
 * labels it 「估算」. Nothing is fetched: it reads prizes_me.json and the circuit.
 *
 * A base table must be real, and it must pay its champion more than its
 * runner-up, its semi-finalists more than its quarter-finalists, and those more
 * than anyone below them. The rules:
 *
 *  league     a VCT league's Kickoff or Stage 1, and China's Stage 2 before 2026:
 *             the same league's Stage 2, the same year if it was published,
 *             else the league's nearest year. ×1.0: no league ever published both.
 *  split      a Challengers league's stage: the same league's nearest published
 *             stage (the nearest year, then the nearest dates). ×k_split.
 *  emea       Challengers EMEA, which never published a table: EMEA Ascension
 *             ×k_asc — what each region's biggest Challengers league paid for a
 *             stage against its own Ascension, the same year.
 *  finals     a Challengers league's season finals: its last stage before them
 *             ×k_finals — Challengers finals against their own league's last stage.
 *  ascension  China's Ascension: the same year's Pacific Ascension. ×1.0.
 *  lcq        a VCT Last Chance Qualifier, and China's 2023 Champions qualifier:
 *             the same league's nearest published LCQ; with none, the nearest
 *             LCQ anywhere. ×1.0.
 *  open       from 2027, a league's open qualifiers, the Pacific's open-qualifier
 *             finals and a league's Open Playoffs: the league's 2026 Challengers
 *             stage that pays least ×k_open — a stage paid by estimate lends its
 *             own real table, its k multiplied in — so none of them pays any place
 *             more than a Challengers stage its sides could be playing instead.
 *             Only a league's own stages count, named as Riot's Challengers
 *             leagues name them (Kickoff, Stage, Split, Act): a side event its
 *             operator runs, such as LATAM South ACE Masters, is neither the base
 *             nor held against.
 *             k_open = k_asc: an open event is a rung below a Challengers stage,
 *             and a Challengers stage pays about half of the rung above it, its
 *             region's Ascension. No open event ever published a table; each
 *             estimate is checked place by place against every stage of its league.
 *
 * Each k is the median of the real pairs where both tables were published,
 * rounded to one decimal; the pairs are printed.
 *
 * A playoff place the base table does not reach gets half of the last amount it
 * pays, halving again at each round further out (…5–8, 9–16…), so every side
 * that reached the playoffs is paid something, and less than the side above it.
 *
 * Not estimated, each with its reason in the file: a series whose nearest
 * published table pays every place $0; a promotion/relegation event or a
 * Challengers qualifier (no real table of either kind exists); a qualifier
 * played only as open rounds, which this world never plays; an event with no
 * page and nothing published in its region that year.
 *
 *   npx tsx scripts/build_prize_estimates.ts [--verbose]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventsOf } from '../src/engine/circuit'
import type { CEvent, CUnit } from '../src/engine/circuit'
import { OQ_POOLS } from '../src/engine/ahead'

const mem: Record<string, string> = {}
;(globalThis as any).localStorage = { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 }
;(globalThis as any).fetch = () => Promise.reject(new Error('offline'))

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'src', 'data')
const OUT = join(DATA, 'prize_estimates_me.json')
const VERBOSE = process.argv.includes('--verbose')

type Row = [number, number, number]
interface Real { y: number; lp: string; status?: 'none' | 'unpublished'; cur?: string; pay?: Row[] }
const BOOK = (JSON.parse(readFileSync(join(DATA, 'prizes_me.json'), 'utf8')) as { events: Record<string, Real> }).events

interface Ev { id: string; y: number; ev: CEvent; real?: Real }
const REAL_YEARS = [2021, 2022, 2023, 2024, 2025, 2026]
/** Every event circuit.json holds — the ones that were really played. */
const ALL: Ev[] = REAL_YEARS.flatMap((y) => eventsOf(y).filter((ev) => !ev.id.startsWith('F')).map((ev) => ({ id: ev.id, y, ev, real: BOOK[ev.id] })))

/* ------------------------------------------------------------------ */
/*  tables                                                             */
/* ------------------------------------------------------------------ */

const isPaid = (e: Ev): e is Ev & { real: Real & { pay: Row[] } } => !!e.real && !e.real.status && !!e.real.pay?.length
const isNone = (e: Ev): boolean => e.real?.status === 'none'
const total = (pay: Row[]): number => pay.reduce((s, [a, b, v]) => s + v * (b - a + 1), 0)
const amountAt = (pay: Row[], p: number): number => pay.find(([a, b]) => p >= a && p <= b)?.[2] ?? 0
const lastPaid = (pay: Row[]): number => Math.max(0, ...pay.filter((r) => r[2] > 0).map((r) => r[1]))
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round1 = (x: number): number => Math.round(x * 10) / 10
const usd = (x: number): string => `$${Math.round(x).toLocaleString('en-US')}`

/** Champion over runner-up over the semi-finalists over the quarter-finalists over everyone else, every place to `upTo` paid. */
function ordered(pay: Row[], upTo: number): boolean {
  const tiers = ([[1, 1], [2, 2], [3, 4], [5, 8], [9, 64]] as const)
    .map(([a, b]) => { const xs: number[] = []; for (let p = a; p <= Math.min(b, upTo); p++) xs.push(amountAt(pay, p)); return xs })
    .filter((t) => t.length)
  if (tiers.some((t) => t.some((v) => !(v > 0)))) return false
  for (let i = 1; i < tiers.length; i++) if (!(Math.min(...tiers[i - 1]) > Math.max(...tiers[i]))) return false
  return true
}
/** A real table an estimate may be drawn from. */
const usable = (e: Ev): boolean => isPaid(e) && ordered(e.real.pay, lastPaid(e.real.pay))

const scale = (pay: Row[], k: number): Row[] => pay.filter((r) => r[2] > 0).map(([a, b, v]) => [a, b, Math.round(v * k)] as Row)

/** Places past the table's last paid one, to `upTo`: half the amount above, halving again at each round further out. */
function extend(pay: Row[], upTo: number): { pay: Row[]; ext?: [number, number] } {
  const rows = pay.map((r) => [...r] as Row).sort((a, b) => a[0] - b[0])
  const last = lastPaid(rows)
  if (upTo <= last) return { pay: rows }
  let amount = rows[rows.length - 1][2]
  for (let p = last + 1; p <= upTo;) {
    let edge = 2
    while (edge < p) edge *= 2
    const end = Math.min(upTo, edge)
    amount = Math.round(amount / 2)
    rows.push([p, end, amount])
    p = end + 1
  }
  return { pay: rows, ext: [last + 1, upTo] }
}

const SIDE = /relegation|promotion|降级|升级/i
/**
 * The playoffs: the phase that decides the winner — the last one that is not
 * played after the final (engine/circuit.ts placesFrom ranks phases the same
 * way) — its size, and how many parallel groups it is.
 */
function playoffsOf(ev: CEvent): { size: number; groups: number } {
  const phases = new Map<string, CUnit[]>()
  for (const u of ev.units) {
    const k = u.phase ?? u.label.replace(/ · [A-Z0-9]+组$/, ' · 组')
    phases.set(k, [...(phases.get(k) ?? []), u])
  }
  const keys = [...phases.keys()].filter((k) => !SIDE.test(k) && !phases.get(k)!.some((u) => u.side))
  const top = phases.get(keys[keys.length - 1]) ?? []
  return { size: top.reduce((s, u) => s + u.size, 0), groups: Math.max(1, top.length) }
}

/** 「挑战者联赛 · 西班牙 · 第二赛段」, 2024 → 「2024 西班牙第二赛段」. */
const shortCn = (e: Ev): string =>
  `${e.y} ${e.ev.cn.replace(/^挑战者联赛 · /, '').replace(/ · /g, '').replace(/([A-Za-z])([一-鿿])/g, '$1 $2')}`

/* ------------------------------------------------------------------ */
/*  what kind of event                                                 */
/* ------------------------------------------------------------------ */

const LEAGUES = ['Americas', 'EMEA', 'Pacific', 'China']
const PROMO = /Relegation|Promotion|Consolidation|ECLIPSE|Up and Down/i
const FINALS = /Finals|Regional Playoffs|Road to Ascension|Ascension Qualifier/i
const QUALIFIER = /Qualifier|Last Chance/i

type Kind = 'league' | 'split' | 'finals' | 'ascension' | 'lcq' | 'promo' | 'qualifier' | 'openOnly' | 'other'
function kindOf(e: Ev): Kind {
  const { ev } = e
  if (PROMO.test(ev.name)) return 'promo'
  if (ev.units.every((u) => u.type === 'open')) return 'openOnly'
  if (ev.stage === 'lcq' || /Champions China Qualifier/i.test(ev.name)) return 'lcq'
  if (ev.stage === 'ascension' && ev.region === 'China') return 'ascension'
  if (!ev.scene && LEAGUES.includes(ev.region ?? '') && (ev.stage === 'kickoff' || ev.stage === 'stage1' || ev.stage === 'stage2') && e.y >= 2024) return 'league'
  if (ev.scene) return FINALS.test(ev.name) ? 'finals' : QUALIFIER.test(ev.name) ? 'qualifier' : 'split'
  return 'other'
}

/** LATAM's finals are between its North and South leagues. */
const sceneFamily = (scene: string): string[] => (scene === 'LATAM' ? ['LATAM', 'LATAM North', 'LATAM South'] : [scene])

/** A Last Chance Qualifier's league, by the 2023 map. */
const LCQ_LEAGUE: Record<string, string> = {
  'North America': 'Americas', Brazil: 'Americas', LATAM: 'Americas', 'South America': 'Americas', Americas: 'Americas',
  EMEA: 'EMEA', Europe: 'EMEA', APAC: 'Pacific', 'East Asia': 'Pacific', Pacific: 'Pacific', China: 'China',
}

/** A series whose nearest published table pays every place $0: its other events are not given money it never showed. */
const ZERO_SERIES: { test: RegExp; ids: string[]; why: string }[] = [
  { test: /FGC/i, ids: ['1025', '1105'], why: '同系列公开过的奖金表每个名次都明写 $0（FGC 2022 第二、三幕）' },
  { test: /^Champions Tour Japan Stage 2: Challengers Week/i, ids: ['851', '852'], why: '同系列公开过的奖金表每个名次都明写 $0（日本 2022 第一赛段第一、二周）' },
]
for (const z of ZERO_SERIES) for (const id of z.ids) if (BOOK[id]?.status !== 'none') throw new Error(`${id} 不再是明写 $0 的表，ZERO_SERIES 要改`)

const byNearest = (t: { y: number; start: number | null }) => (a: Ev, b: Ev) =>
  Math.abs(a.y - t.y) - Math.abs(b.y - t.y) || Math.abs((a.ev.start ?? 0) - (t.start ?? 0)) - Math.abs((b.ev.start ?? 0) - (t.start ?? 0)) || a.y - b.y

/* ------------------------------------------------------------------ */
/*  k from the real pairs                                              */
/* ------------------------------------------------------------------ */

const splits = ALL.filter((e) => isPaid(e) && kindOf(e) === 'split' && e.y >= 2023)
const uniqLp = (xs: Ev[]): Ev[] => xs.filter((e, i) => xs.findIndex((x) => x.real?.lp === e.real?.lp) === i)

// the same Challengers league, the same year: each stage against the one before it
const splitPairs: string[] = []
const splitRatios: number[] = []
{
  const groups = new Map<string, Ev[]>()
  for (const e of splits) groups.set(`${e.ev.scene}|${e.y}`, [...(groups.get(`${e.ev.scene}|${e.y}`) ?? []), e])
  for (const g of groups.values()) {
    const s = uniqLp(g).sort((a, b) => (a.ev.start ?? 0) - (b.ev.start ?? 0))
    for (let i = 1; i < s.length; i++) {
      const r = total(s[i].real!.pay!) / total(s[i - 1].real!.pay!)
      splitRatios.push(r)
      splitPairs.push(`${s[i].real!.lp} ÷ ${s[i - 1].real!.lp} = ${r.toFixed(2)}`)
    }
  }
}
const K_SPLIT = round1(median(splitRatios))

// a Challengers league's season finals against that league's last stage before them, the same year
const finalsPairs: string[] = []
const finalsRatios: number[] = []
for (const f of ALL.filter((e) => e.y >= 2023 && kindOf(e) === 'finals' && (isPaid(e) || isNone(e)))) {
  const base = splits.filter((s) => s.y === f.y && sceneFamily(f.ev.scene!).includes(s.ev.scene!) && (s.ev.start ?? 0) < (f.ev.start ?? 0))
    .sort((a, b) => (b.ev.start ?? 0) - (a.ev.start ?? 0))[0]
  if (!base) continue
  const r = (isPaid(f) ? total(f.real.pay) : 0) / total(base.real!.pay!)
  finalsRatios.push(r)
  finalsPairs.push(`${f.real!.lp}${isNone(f) ? '（明写 $0）' : ''} ÷ ${base.real!.lp} = ${r.toFixed(2)}`)
}
const K_FINALS = round1(median(finalsRatios))

// each region's biggest Challengers league that year, a stage of it against that region's Ascension (Americas, Pacific)
const ascOf = (region: string, y: number): Ev | undefined =>
  ALL.find((e) => e.y === y && e.ev.stage === 'ascension' && e.ev.region === region && usable(e))
const SCENE_ASC = (e: Ev): string | null => {
  const r = e.ev.region ?? ''
  if (['North America', 'Brazil', 'LATAM'].includes(r)) return 'Americas'
  if (['Japan', 'Korea', 'SEA', 'Indonesia', 'Philippines', 'Thailand', 'Vietnam', 'Malaysia & Singapore', 'Hong Kong & Taiwan', 'South Asia', 'Oceania'].includes(r)) return 'Pacific'
  return null
}
const ascPairs: string[] = []
const ascRatios: number[] = []
for (const region of ['Americas', 'Pacific']) {
  for (const y of REAL_YEARS) {
    const asc = ascOf(region, y)
    if (!asc) continue
    const scenes = new Map<string, Ev[]>()
    for (const s of splits.filter((x) => x.y === y && SCENE_ASC(x) === region)) scenes.set(s.ev.scene!, [...(scenes.get(s.ev.scene!) ?? []), s])
    const biggest = [...scenes.values()].map(uniqLp).sort((a, b) => b.reduce((t, e) => t + total(e.real!.pay!), 0) - a.reduce((t, e) => t + total(e.real!.pay!), 0))[0]
    for (const s of biggest ?? []) {
      const r = total(s.real!.pay!) / total(asc.real!.pay!)
      ascRatios.push(r)
      ascPairs.push(`${s.real!.lp} ÷ ${asc.real!.lp} = ${r.toFixed(2)}`)
    }
  }
}
const K_ASC = round1(median(ascRatios))
/** An open event sits a rung below a Challengers stage, which pays about half of the rung above it: the same step down again. */
const K_OPEN = K_ASC

/* ------------------------------------------------------------------ */
/*  estimates                                                          */
/* ------------------------------------------------------------------ */

interface Estimate {
  y: number; lp: string | null; name: string
  rule: string; from: string; fromId: string; fromCn: string; k: number
  playoffs: number; ext?: [number, number]; pay: Row[]
}
interface Unestimated { y: number; lp: string | null; name: string; why: string }

const RULE_TEXT = {
  league: '揭幕赛、第一赛段（及 2026 年前的中国第二赛段）= 同一联赛第二赛段（同年没公布取最近一年）×1.0；没有哪个联赛两边都公布过，k 取 1.0',
  split: `挑战者联赛赛段 = 同一挑战者联赛最近公布的赛段（先比年份再比日期）×${K_SPLIT.toFixed(1)}；k 为同联赛同年相邻两段奖池比的中位数`,
  emea: `挑战者联赛 EMEA 从未公布奖金 = 年份最近的 EMEA 晋级赛 ×${K_ASC.toFixed(1)}；k 为美洲、太平洋各年最大的挑战者联赛单段奖池与同年本区晋级赛之比的中位数`,
  finals: `挑战者联赛总决赛 = 同一联赛此前最后一个公布的赛段 ×${K_FINALS.toFixed(1)}；k 为挑战者联赛总决赛与同年本联赛上一段奖池比的中位数`,
  ascension: '中国晋级赛 = 同年（没有则最近一年）太平洋晋级赛 ×1.0；中国晋级赛从未公布，k 取 1.0',
  lcq: '最后机会资格赛 = 同一联赛最近公布的 LCQ（最近一张明写 $0 就不估；没有则取任何赛区最近的 LCQ）×1.0；同类赛事照搬，k 取 1.0',
  open: `新赛制公开资格赛、太平洋公开资格赛决赛、公开季后赛 = 同一联赛 2026 年奖金最少的挑战者联赛赛段（只算 Riot 挑战者联赛自己的揭幕赛、Stage、Split、Act，不算 LATAM South ACE Masters 这类运营方办的附加赛）×${K_OPEN.toFixed(1)}（那个赛段本身是估算的，就用它的真实底表，两个 k 相乘）；k 取 k_asc：公开赛事比挑战者联赛赛段低一级，而挑战者联赛赛段大约拿上一级（本区晋级赛）的一半，再往下一级照这个比例；每个名次都低于该联赛每个挑战者联赛赛段`,
  ext: '底表没覆盖到的季后赛名次：取底表最后一档的一半，再往外每轮（5–8、9–16…）再减半',
} as const
type RuleKey = keyof typeof RULE_TEXT

const estimates: Record<string, Estimate> = {}
const unestimated: Record<string, Unestimated> = {}
const failures: string[] = []

function estimate(key: string, t: { y: number; lp: string | null; name: string; ev: CEvent }, rule: RuleKey, base: Ev, k: number): void {
  const { size } = playoffsOf(t.ev)
  const { pay, ext } = extend(scale(base.real!.pay!, k), size)
  if (!ordered(pay, size)) failures.push(`${key} ${t.name}：按 ${base.real!.lp} 推出的表季后赛名次没排好`)
  estimates[key] = {
    y: t.y, lp: t.lp, name: t.name, rule, from: base.real!.lp, fromId: base.id, fromCn: shortCn(base), k,
    playoffs: size, ...(ext ? { ext } : {}), pay,
  }
}

/** The nearest usable table among `cands`, unless the nearest published one pays every place $0. */
function pick(cands: Ev[], t: { y: number; start: number | null }): Ev | 'zero' | undefined {
  for (const c of [...cands].sort(byNearest(t))) {
    if (isNone(c)) return 'zero'
    if (usable(c)) return c
  }
  return undefined
}

const NO_PAGE = '没有 Liquipedia 页面，同赛区同年也没有公布过可比的奖金表'

for (const t of ALL) {
  if (isPaid(t) || isNone(t)) continue
  const lp = t.real?.lp ?? null
  const info = { y: t.y, lp, name: t.ev.name, ev: t.ev }
  const skip = (why: string) => { unestimated[t.id] = { y: t.y, lp, name: t.ev.name, why } }
  const zero = ZERO_SERIES.find((z) => z.test.test(t.ev.name))
  if (zero) { skip(zero.why); continue }
  const kind = kindOf(t)
  // with no page there is no telling whether the event paid at all: only its own region's tables that year stand in
  const sameYear = (xs: Ev[]) => (lp ? xs : xs.filter((x) => x.y === t.y))
  const at = { y: t.y, start: t.ev.start }
  if (kind === 'promo') { skip('升降级赛：真实数据里没有任何一张升降级赛奖金表可作底'); continue }
  if (kind === 'openOnly') { skip('每一轮都是公开资格赛，这个世界里不开打，没有季后赛'); continue }
  if (kind === 'qualifier') { skip('挑战者级资格赛：真实数据里没有资格赛奖金表可作底（仅有的日本 2022 资格周明写 $0）'); continue }
  if (kind === 'other') { skip(lp ? '没有可比的真实奖金表' : NO_PAGE); continue }

  if (kind === 'league') {
    const base = pick(sameYear(ALL.filter((c) => c.ev.stage === 'stage2' && !c.ev.scene && c.ev.region === t.ev.region && c.y >= 2024 && (isPaid(c) || isNone(c)))), at)
    if (base && base !== 'zero') estimate(t.id, info, 'league', base, 1)
    else skip(base === 'zero' ? '同一联赛第二赛段明写 $0' : '同一联赛没有公布过第二赛段奖金')
    continue
  }
  if (kind === 'split') {
    const fam = sceneFamily(t.ev.scene!)
    const base = pick(sameYear(ALL.filter((c) => c.id !== t.id && fam.includes(c.ev.scene ?? '') && kindOf(c) === 'split' && (isPaid(c) || isNone(c)))), at)
    if (base === 'zero') { skip('同一挑战者联赛最近公布的赛段明写 $0'); continue }
    if (base) { estimate(t.id, info, 'split', base, K_SPLIT); continue }
    if (t.ev.scene === 'EMEA' && lp) {
      const asc = pick(ALL.filter((c) => c.ev.stage === 'ascension' && c.ev.region === 'EMEA' && isPaid(c)), at)
      if (asc && asc !== 'zero') { estimate(t.id, info, 'emea', asc, K_ASC); continue }
    }
    skip(lp ? '同一挑战者联赛从没公布过奖金表' : NO_PAGE)
    continue
  }
  if (kind === 'finals') {
    const fam = sceneFamily(t.ev.scene!)
    const own = pick(sameYear(ALL.filter((c) => c.id !== t.id && fam.includes(c.ev.scene ?? '') && kindOf(c) === 'finals' && (isPaid(c) || isNone(c)))), at)
    if (own === 'zero') { skip('同一联赛公布过的总决赛奖金表明写 $0'); continue }
    const before = sameYear(splits.filter((c) => fam.includes(c.ev.scene ?? '') && usable(c)))
    const base = before.filter((c) => c.y === t.y && (c.ev.start ?? 0) < (t.ev.start ?? 0)).sort((a, b) => (b.ev.start ?? 0) - (a.ev.start ?? 0))[0]
      ?? [...before].sort(byNearest(at))[0]
    if (base) estimate(t.id, info, 'finals', base, K_FINALS)
    else skip(lp ? '同一挑战者联赛从没公布过奖金表' : NO_PAGE)
    continue
  }
  if (kind === 'ascension') {
    const base = pick(ALL.filter((c) => c.ev.stage === 'ascension' && c.ev.region === 'Pacific' && isPaid(c)), at)
    if (base && base !== 'zero') estimate(t.id, info, 'ascension', base, 1)
    else skip('太平洋晋级赛也没有可用的奖金表')
    continue
  }
  if (kind === 'lcq') {
    const league = LCQ_LEAGUE[t.ev.region ?? ''] ?? t.ev.region
    const lcqs = ALL.filter((c) => c.id !== t.id && kindOf(c) === 'lcq' && (isPaid(c) || isNone(c)))
    const own = pick(lcqs.filter((c) => LCQ_LEAGUE[c.ev.region ?? ''] === league), at)
    if (own === 'zero') { skip('同一赛区最近公布的 LCQ 奖金表每个名次都明写 $0（2021 亚太 LCQ）'); continue }
    const base = own ?? pick(lcqs.filter(isPaid), at)
    if (base && base !== 'zero') estimate(t.id, info, 'lcq', base, 1)
    else skip('没有可用的 LCQ 奖金表')
    continue
  }
}

// from 2027: the new format's open events, which had no 2026 edition — a league's open qualifiers, the Pacific's
// open-qualifier finals, a league's Open Playoffs. China's Ascension, Kickoff and Cups go by their 2026 edition's
const BASIS_YEAR = REAL_YEARS[REAL_YEARS.length - 1]
const LEAGUE_CN: Record<string, string> = { Americas: '美洲', EMEA: 'EMEA ', Pacific: '太平洋', China: '中国' }
/** A club region's league: a league by its own name, else the league its open-qualifier pool plays into (engine/ahead.ts). */
const leagueOfRegion = (r: string | null): string | undefined =>
  !r ? undefined : LEAGUES.includes(r) ? r : OQ_POOLS.find((p) => (p.regions as string[]).includes(r))?.league
/** What a Challengers stage pays in the game: its published table, or its estimate. */
const stagePay = (e: Ev): Row[] | undefined => (isPaid(e) ? e.real.pay : estimates[e.id]?.pay)
/** A Challengers league's own stage, named as Riot's leagues name them. 「LATAM South ACE Masters」 is a side event its operator runs. */
const LEAGUE_STAGE = /\b(Kickoff|Stage \d|Split \d|Act \d)\b/i
const openLines: string[] = []
{
  const ahead = eventsOf(2027)
  for (const league of LEAGUES) {
    const stages = ALL.filter((e) => e.y === BASIS_YEAR && kindOf(e) === 'split' && LEAGUE_STAGE.test(e.ev.name)
      && leagueOfRegion(e.ev.region) === league && !!stagePay(e))
    const sideEvents = ALL.filter((e) => e.y === BASIS_YEAR && kindOf(e) === 'split' && !LEAGUE_STAGE.test(e.ev.name) && leagueOfRegion(e.ev.region) === league)
    if (sideEvents.length) openLines.push(`  ${league} 不算作挑战者联赛赛段：${sideEvents.map((e) => e.ev.name).join('、')}`)
    const least = stages.filter((e) => !isPaid(e) || usable(e))
      .sort((a, b) => total(stagePay(a)!) - total(stagePay(b)!) || Number(a.id) - Number(b.id))[0]
    if (!least) throw new Error(`${league}：${BASIS_YEAR} 年没有可比的挑战者联赛赛段，新赛制公开赛事没法估算`)
    // a stage paid by estimate: the real table under it, with its own k carried along
    const est = estimates[least.id]
    const base = est ? ALL.find((e) => e.id === est.fromId)! : least
    const k = Math.round((est ? est.k : 1) * K_OPEN * 100) / 100
    const champs = stages.map((s) => amountAt(stagePay(s)!, 1))
    const shapes: [string, string, CEvent | undefined][] = [
      [`new:oq:${league}`, `新赛制 · ${LEAGUE_CN[league]}公开资格赛`, ahead.find((e) => e.plan?.kind === 'oq' && e.plan.league === league)],
      [`new:oqFinal:${league}`, `新赛制 · ${LEAGUE_CN[league]}公开资格赛决赛`, ahead.find((e) => e.plan?.kind === 'oqFinal' && e.plan.league === league)],
      [`new:open:${league}`, `新赛制 · ${LEAGUE_CN[league]}公开季后赛`, ahead.find((e) => e.plan?.kind === 'open' && e.plan.league === league)],
    ]
    for (const [key, name, ev] of shapes) {
      if (!ev) continue
      estimate(key, { y: 2027, lp: null, name, ev }, 'open', base, k)
      const pay = estimates[key].pay
      // every place both pay, against every Challengers stage of the league
      let compared = 0
      for (const s of stages) {
        const sp = stagePay(s)!
        for (let p = 1; p <= lastPaid(pay); p++) {
          const a = amountAt(pay, p)
          const b = amountAt(sp, p)
          if (!(b > 0)) continue
          compared++
          if (!(a < b)) failures.push(`${key} ${name}：第 ${p} 名 ${usd(a)}，不低于 ${shortCn(s)} 的 ${usd(b)}`)
        }
      }
      openLines.push(`  ${name} ← ${shortCn(least)}${est ? `（估算，底表 ${shortCn(base)}）` : ''} ×${k} · 冠军 ${usd(amountAt(pay, 1))}`
        + ` · ${league} ${BASIS_YEAR} 年 ${stages.length} 个挑战者联赛赛段冠军 ${usd(Math.min(...champs))}–${usd(Math.max(...champs))} · 逐名次比了 ${compared} 处`)
    }
  }
}

/* ------------------------------------------------------------------ */
/*  write, and say what was done                                       */
/* ------------------------------------------------------------------ */

const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a.startsWith('new') ? 1 : 0) - (b.startsWith('new') ? 1 : 0) || Number(a) - Number(b) || a.localeCompare(b)))

const doc = {
  source: 'Estimates for events whose prize amounts were never published, each drawn from a real table in prizes_me.json (from = its Liquipedia page). Built by scripts/build_prize_estimates.ts; nothing here is a published figure.',
  rules: RULE_TEXT,
  k: {
    split: { k: K_SPLIT, median: +median(splitRatios).toFixed(3), pairs: splitRatios.length },
    finals: { k: K_FINALS, median: +median(finalsRatios).toFixed(3), pairs: finalsPairs },
    emea: { k: K_ASC, median: +median(ascRatios).toFixed(3), pairs: ascPairs },
    open: { k: K_OPEN, as: 'emea' },
  },
  events: sortKeys(estimates),
  unestimated: sortKeys(unestimated),
}
writeFileSync(OUT, JSON.stringify(doc, null, 0).replace(/\},"/g, '},\n"').replace(/("events":\{|"unestimated":\{)/g, '$1\n') + '\n')

console.log(`写入 ${OUT}`)
console.log(`\nk_split = ${K_SPLIT}（中位数 ${median(splitRatios).toFixed(3)}，${splitRatios.length} 对）`)
if (VERBOSE) for (const p of splitPairs) console.log(`  ${p}`)
console.log(`k_finals = ${K_FINALS}（中位数 ${median(finalsRatios).toFixed(3)}，${finalsRatios.length} 对）`)
for (const p of finalsPairs) console.log(`  ${p}`)
console.log(`k_asc = ${K_ASC}（中位数 ${median(ascRatios).toFixed(3)}，${ascRatios.length} 对）`)
for (const p of ascPairs) console.log(`  ${p}`)

const real = ALL
const count = (f: (e: Ev) => boolean) => real.filter(f).length
console.log(`\n2021–2026 真实赛事 ${real.length} 场：真实奖金表 ${count(isPaid)} · 明写 $0 ${count(isNone)} · 估算 ${count((e) => !!estimates[e.id])} · 仍未公开 ${count((e) => !!unestimated[e.id])}`)
const byRule = new Map<string, Estimate[]>()
for (const e of Object.values(estimates)) {
  byRule.set(e.rule, [...(byRule.get(e.rule) ?? []), e])
}
for (const [rule, xs] of byRule) {
  console.log(`\n【${rule}】${xs.length} 场`)
  for (const e of xs) console.log(`  ${e.y} ${e.name} ← ${e.from}${e.k !== 1 ? ` ×${e.k}` : ''} · 季后赛 ${e.playoffs}${e.ext ? ` · 补 ${e.ext[0]}–${e.ext[1]} 名` : ''} · 冠军 ${usd(e.pay[0][2])}`)
}
const whyGroups = new Map<string, string[]>()
for (const [id, u] of Object.entries(unestimated)) whyGroups.set(u.why, [...(whyGroups.get(u.why) ?? []), `${u.y} ${id} ${u.name}`])
console.log(`\n仍未公开 ${Object.keys(unestimated).length} 场：`)
for (const [why, xs] of whyGroups) { console.log(`  ${why}（${xs.length}）`); for (const x of xs) console.log(`    ${x}`) }

console.log(`\n明写 $0 的 ${count(isNone)} 场：`)
for (const e of real.filter(isNone)) console.log(`  ${e.y} ${e.id} ${e.real!.lp}`)

// real tables that stop short of the playoffs: reported, not changed
const short: string[] = []
const noChampion: string[] = []
for (const e of real.filter(isPaid)) {
  const { size, groups } = playoffsOf(e.ev)
  const pay = e.real.pay
  // conferences side by side are each paid off their own copy of a one-winner table (engine/me/money.ts placeAt)
  const rows = groups > 1 && pay[0][0] === 1 && pay[0][1] === 1 ? Math.ceil(size / groups) : size
  if (!(amountAt(pay, 1) > 0)) noChampion.push(`${e.y} ${e.id} ${e.real.lp}：第 1 名没有金额`)
  const unpaid: number[] = []
  for (let p = 1; p <= rows; p++) if (!(amountAt(pay, p) > 0)) unpaid.push(p)
  if (unpaid.length && amountAt(pay, 1) > 0) short.push(`${e.y} ${e.id} ${e.real.lp}：付到第 ${lastPaid(pay)} 名，季后赛 ${rows} 名`)
}
console.log(`\n只付前几名、季后赛有队拿 0 的真实表 ${short.length} 场（不改）：`)
for (const s of short) console.log(`  ${s}`)
console.log(`\n冠军没有金额的真实表 ${noChampion.length} 场（不改）：`)
for (const s of noChampion) console.log(`  ${s}`)

console.log(`\n新赛制公开赛事（k_open = ${K_OPEN}；逐名次低于同一联赛 ${BASIS_YEAR} 年每个挑战者联赛赛段，只比两边都付钱的名次）：`)
for (const l of openLines) console.log(l)

if (failures.length) {
  console.log(`\n✗ ${failures.length} 张估算表季后赛名次没排好：`)
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
