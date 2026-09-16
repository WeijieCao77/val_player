/**
 * 上报这件事：不会弄坏游戏，不会无限长，永远不带名字。
 *
 * engine/me/telemetry.ts records how the game is played and nothing about who
 * is playing it. That promise is only worth as much as this file, so it is
 * checked rather than trusted:
 *
 *  - localStorage that throws on every call (隐私窗口、存储被拒) breaks nothing:
 *    starting, reporting and counting all swallow it, and such a visitor can
 *    still play a career from beginning to end
 *  - the queue is bounded: a thousand events with the network down never leave
 *    more than one batch in memory
 *  - the rolled-up counters report running totals, and only the rows that
 *    moved: reporting twice with nothing changed sends nothing, and a re-sent
 *    total is the same total, so a re-delivered beacon cannot double a figure
 *  - the same offer reaching its card twice (set aside, then reopened from the
 *    转会 page) is one arrival, not two
 *  - **no name ever reaches a payload**: a whole career is played with a
 *    distinctive IGN and neither it, nor any of the several hundred real
 *    players' handles in the world, nor a club's name appears anywhere — and
 *    every field is a number, a boolean or a short enumerated token, never
 *    prose
 *  - half an hour away starts a NEW session instead of inflating the old one's
 *    playtime: the minutes counted are the ones confirmed, not the wall clock
 *
 *   npx tsx scripts/check_telemetry.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { retire } from '../src/engine/me/endings'
import {
  _rollupNow, _rollupState, _stopTelemetry,
  countCeremony, countCup, countMatch, countOffer, countPitchWhy, countScreen, countTurn,
  startTelemetry, track,
} from '../src/engine/me/telemetry'

/* ------------------------------------------------------------------ */
/*  a browser, as far as the module can tell                           */
/* ------------------------------------------------------------------ */

type Fn = (e?: unknown) => void
const listeners: Record<string, Fn[]> = {}
const on = (k: string, f: Fn) => { (listeners[k] ??= []).push(f) }
const fire = (k: string) => { for (const f of listeners[k] ?? []) f() }

/** every body that actually left the page, as a string or the beacon's Blob */
const rawSent: (string | Blob)[] = []
/** the heartbeat, so a minute can be made to pass on demand */
let beat: (() => void) | null = null

/** localStorage that works */
class Store {
  private map = new Map<string, string>()
  get length(): number { return this.map.size }
  key(i: number): string | null { return [...this.map.keys()][i] ?? null }
  getItem(k: string): string | null { return this.map.get(k) ?? null }
  setItem(k: string, v: string): void { this.map.set(k, String(v)) }
  removeItem(k: string): void { this.map.delete(k) }
  clear(): void { this.map.clear() }
}

/** ...and localStorage that does not: a private window with storage denied */
const denied = new Error('SecurityError: storage is denied')
const dead = {
  get length(): number { throw denied },
  key(): string | null { throw denied },
  getItem(): string | null { throw denied },
  setItem(): void { throw denied },
  removeItem(): void { throw denied },
  clear(): void { throw denied },
}

const doc = { visibilityState: 'visible', referrer: '', addEventListener: on }

let clock = Date.UTC(2026, 5, 1, 12, 0, 0)
Date.now = () => clock

/**
 * Node exposes some of these as getter-only accessors (navigator, fetch), so a
 * plain assignment throws. Defining over them works whichever way the runtime
 * declared it.
 */
const def = (k: string, v: unknown): void => {
  Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true })
}

const realSetTimeout = globalThis.setTimeout
def('document', doc)
def('window', { innerWidth: 1280, innerHeight: 800, addEventListener: on })
def('location', { protocol: 'https:', hostname: 'valplayer-production.up.railway.app' })
def('navigator', { sendBeacon: (_u: string, b: Blob) => { rawSent.push(b); return true } })
def('fetch', (_u: string, init?: { body?: string }) => {
  if (init?.body) rawSent.push(init.body)
  return Promise.reject(new Error('offline'))
})
// held, never fired: the heartbeat and the 5s flush are driven by hand here
def('setInterval', (f: () => void) => { beat = f; return 1 })
def('clearInterval', () => {})
def('setTimeout', (_f: () => void) => 2)
def('clearTimeout', () => {})
const use = (s: unknown): void => { def('localStorage', s) }
use(new Store())

const hide = () => { doc.visibilityState = 'hidden'; fire('visibilitychange') }
const show = () => { doc.visibilityState = 'visible'; fire('visibilitychange') }

interface Batch { seq: number; sid: string; events: { name: string; props?: Record<string, unknown> }[] }

/** Everything sent since the last drain, parsed, and the record wiped. */
async function drain(): Promise<Batch[]> {
  const out: Batch[] = []
  for (const s of rawSent) {
    const body = typeof s === 'string' ? s : await s.text()
    try { out.push(JSON.parse(body) as Batch) } catch { /* not ours */ }
  }
  rawSent.length = 0
  return out
}
const events = (bs: Batch[]) => bs.flatMap((b) => b.events ?? [])
const named = (bs: Batch[], name: string) => events(bs).filter((e) => e.name === name)
const rows = (bs: Batch[], name: string) => named(bs, name).map((e) => e.props ?? {})

/** A fresh visitor with working storage, looking at the page. */
function fresh(): void {
  _stopTelemetry()
  use(new Store())
  // the section before may have left the tab in the background, and a heartbeat
  // only counts a minute the page was actually visible for
  doc.visibilityState = 'visible'
  rawSent.length = 0
  startTelemetry()
  rawSent.length = 0
}

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

/* ------------------------------------------------------------------ */
/*  1. storage denied                                                  */
/* ------------------------------------------------------------------ */

console.log('存储被拒的浏览器')
{
  _stopTelemetry()
  use(dead)
  let threw = ''
  try {
    startTelemetry()
    track('probe', { a: 1 })
    countScreen('week')
    countTurn({ day: 30, year: 2026, phase: 'pre', tier: 0 })
    countOffer('deal_in', 'deal:1')
    _rollupNow()
    hide()
  } catch (e) { threw = String(e) }
  check(!threw, `localStorage 每个方法都抛异常：开启、上报、计数、汇总、切后台都不往外抛${threw ? `（抛了 ${threw}）` : ''}`)

  let played = false
  let far = ''
  try {
    const s = createCareer({
      name: 'DeniedStorage', role: '决斗者', talents: emptyTalents(),
      originKey: 'netcafe', seed: 3, year: 2026, region: 'China', start: 'pre',
    } as CareerOpts)
    for (let i = 0; i < 30; i++) if (autoWeek(s).kind === 'game-over') break
    far = `${s.year} D${s.day}`
    played = !!s.me && s.day >= 0
  } catch { played = false }
  check(played, `存储被拒的访客照样能玩：开局推到 ${far} 都跑得通`)
}

/* ------------------------------------------------------------------ */
/*  2. the queue is bounded                                            */
/* ------------------------------------------------------------------ */

console.log('\n队列')
{
  fresh()
  let worst = 0
  for (let i = 0; i < 1000; i++) {
    track('spam', { i })
    worst = Math.max(worst, _rollupState().queued)
  }
  check(worst <= 20, `网络不通时连发 1000 条：队列最多只到 ${worst} 条，不会一直涨`)
}

/* ------------------------------------------------------------------ */
/*  3. the rolled-up counters: totals, and only what moved             */
/* ------------------------------------------------------------------ */

console.log('\n汇总计数')
{
  fresh()
  countScreen('week'); countScreen('week'); countScreen('week')
  hide()
  const one = rows(await drain(), 'screens')
  check(one.length === 1 && one[0].to === 'week' && one[0].hits === 3,
    `三次打开「本周」报成一行累计：${JSON.stringify(one[0] ?? null)}`)

  hide()
  const again = await drain()
  check(events(again).length === 0, '总数没变时再报一次：一条都不发（重发的信标不会把数字翻倍）')

  countScreen('week'); countScreen('week')
  const third = rows(await (async () => { hide(); return drain() })(), 'screens')
  check(third.length === 1 && third[0].hits === 5,
    `再点两次，报的是累计总数 5 而不是增量 2 —— 同一个总数重复到达也还是这个总数（${JSON.stringify(third[0] ?? null)}）`)
}

/* ------------------------------------------------------------------ */
/*  4. an offer that comes to its card twice is one arrival            */
/* ------------------------------------------------------------------ */

console.log('\n报价到达')
{
  fresh()
  countOffer('deal_in', 'deal:2026:100:TEAM_A')
  // 放下再从「转会」页打开：同一份报价又走了一遍 pending.push（me/aside.ts reopen）
  countOffer('deal_in', 'deal:2026:100:TEAM_A')
  countOffer('deal_in', 'deal:2026:101:TEAM_B')
  countOffer('invite_in', 'inv:2026:100:TEAM_C')
  hide()
  const o = rows(await drain(), 'offers')[0] ?? {}
  check(o.deal_in === 2 && o.invite_in === 1,
    `放下再打开的那份只算一次到达：报价 ${o.deal_in} 份、邀请 ${o.invite_in} 份`)
}

/* ------------------------------------------------------------------ */
/*  5. 半小时之后是新的一段，不是挂机                                   */
/* ------------------------------------------------------------------ */

console.log('\n隔了半小时再回来')
{
  fresh()
  for (let i = 0; i < 3; i++) {
    track('tap', {})
    if (i === 0) countTurn({ day: 40, year: 2026, phase: 'pre', tier: 0 })
    clock += 60_000
    beat?.()
  }
  const played = _rollupState()
  clock += 31 * 60_000
  show()
  const after = _rollupState()
  fire('pagehide')
  const bs = await drain()
  const ends = named(bs, 'session_end').map((e) => e.props ?? {})
  const gap = ends.find((p) => p.reason === 'gap')
  check(!!gap, '离开超过三十分钟再回来：上一段以 gap 收尾')
  check(gap?.active_s === 180,
    `收尾记的是确认在玩的 ${gap?.active_s} 秒，不是挂机的 ${3 * 60 + 31 * 60} 秒`)
  // two in all: the one this sitting opened with, and the one the gap started
  const starts = named(bs, 'session_start').length
  const seqs = [...new Set(bs.map((b) => b.seq))].length
  check(starts === 2 && seqs === 2,
    `紧接着开了新的一段：${starts} 次 session_start、${seqs} 个会话编号`)
  check(played.turnCount === 1 && after.turnCount === 0,
    `新的一段从零开始计数，不把上一段的 ${played.turnCount} 个回合带过来`)
}

/* ------------------------------------------------------------------ */
/*  6. 一个名字都不许出去                                               */
/* ------------------------------------------------------------------ */

console.log('\n隐私：上报里不许有名字')
{
  fresh()
  const NEEDLE = 'QxZvNeedleIgn77'
  const s = createCareer({
    name: NEEDLE, role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', seed: 11, year: 2026, region: 'China', start: 'pre',
  } as CareerOpts)

  // the screens and cards a player actually touches, with this career's own values
  countScreen('week'); countScreen('transfer'); countScreen('me')
  countMatch('masters', true, true)
  countMatch('chal', false, false)
  countCeremony('draw', false, 'silver')
  countCeremony('final', true, 'gold')
  countCup('enter'); countCup('round'); countCup('forfeit')
  countPitchWhy('gap'); countPitchWhy('starter')
  countOffer('pitch'); countOffer('pitch_no')
  track('career_start', {
    year: 2026, region: 'China', role: '决斗者', start: 'pre', origin: 'netcafe',
    talent_max: 3, talent_spread: 5, talent_points: 20,
  })

  // and three years really played, which is where the engine itself would leak one:
  // offers arriving, invitations running out, clubs saying no
  let weeks = 0
  while (s.me!.phase !== 'retired' && weeks++ < 3 * 52) {
    if (autoWeek(s).kind === 'game-over') break
  }
  countTurn({ day: s.day, year: s.year, phase: s.me!.phase, tier: 0 })
  track('career_resume', {
    day: s.day, year: s.year, phase: s.me!.phase, tier: 0,
    pro_seasons: s.me!.seasons.filter((x) => x.tier > 0).length,
    age: s.players[s.me!.id]?.age ?? 0,
  })
  // every road out of a career goes through retire(): the ending's key, never its words
  if (s.me!.phase !== 'retired') retire(s, `${s.players[s.me!.id]?.age ?? 0} 岁，你决定退役`, 'chose')

  fire('pagehide')
  const bs = await drain()
  const text = bs.map((b) => JSON.stringify(b)).join('\n')

  check(!text.includes(NEEDLE), `玩家自己起的 ID（${NEEDLE}）一次都没出现在上报里`)

  // A name could only ever ride in a field's VALUE. The event names and the
  // field names are this module's own vocabulary, and matching against those is
  // a false alarm: 'career_start' contains 「star」, which is also a real
  // player's handle. Short and all-hex names are skipped too — they collide
  // with the random visitor id rather than saying anything about a leak.
  const values = events(bs)
    .flatMap((e) => Object.values(e.props ?? {}))
    .filter((v): v is string => typeof v === 'string')
  const realName = (n: unknown): n is string =>
    typeof n === 'string' && n.length >= 4 && !/^[0-9a-f]+$/i.test(n)

  /**
   * A name has leaked when a field's value IS it, or carries it as a piece of
   * its own — not when it merely happens to sit inside a longer word.
   *
   * 'starter' is one of the seven reasons a club says no (me/types.ts PitchWhy)
   * and 「star」 is a real player's handle: a plain substring match calls that a
   * leak, which it is not. A boundary is what tells the two apart. The needle
   * above is still matched against the whole payload, so a name folded into a
   * longer string could not get past that one.
   */
  const escape = (s0: string) => s0.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const leaks = (name: string): boolean =>
    values.some((v) => v === name || new RegExp(`(^|[^A-Za-z0-9])${escape(name)}([^A-Za-z0-9]|$)`).test(v))

  const igns = [...new Set(Object.values(s.players).map((p) => p.ign))].filter(realName)
  const leakedIgn = igns.filter(leaks)
  check(leakedIgn.length === 0,
    `世界里 ${igns.length} 名真实选手的 ID 一个都没进过字段值${leakedIgn.length ? `（漏了 ${leakedIgn.slice(0, 3).join('、')}）` : ''}`)

  const clubs = [...new Set(Object.values(s.teams).map((t) => t.name))].filter(realName)
  const leakedClub = clubs.filter(leaks)
  check(leakedClub.length === 0,
    `${clubs.length} 家俱乐部的名字一个都没进过字段值${leakedClub.length ? `（漏了 ${leakedClub.slice(0, 3).join('、')}）` : ''}`)

  // 每个字段都得是数字、真假，或者一个短的枚举值 —— 成句的中文一律不合格
  const prose = /[\s，。！？、；：「」（）…—]/
  const offenders: string[] = []
  for (const e of events(bs)) {
    for (const [k, v] of Object.entries(e.props ?? {})) {
      if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') continue
      if (typeof v === 'string' && v.length <= 48 && !prose.test(v)) continue
      offenders.push(`${e.name}.${k}=${JSON.stringify(v)}`)
    }
  }
  check(offenders.length === 0,
    `${events(bs).length} 条事件的每个字段都是数字、真假或短枚举值${offenders.length ? `（不合格：${offenders.slice(0, 3).join('，')}）` : ''}`)

  const ending = rows(bs, 'ending')[0]
  check(!!ending && typeof ending.key === 'string' && !('title' in ending) && !('text' in ending),
    `生涯走到了结局，报的是 key「${ending?.key}」而不是结局的标题和正文`)

  const off = rows(bs, 'offers')[0]
  console.log(`  · 这三年里：转会计数 ${JSON.stringify(off ?? null)}`)
}

def('setTimeout', realSetTimeout)
_stopTelemetry()

if (bad) {
  console.log(`\n✗ 上报有 ${bad} 处不对。`)
  process.exit(1)
}
console.log('\n✓ 上报不会弄坏游戏、队列有上限、汇总只发变化过的累计数；隔了半小时算新的一段；任何名字都不会离开浏览器。')
