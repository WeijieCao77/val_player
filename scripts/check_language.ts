/**
 * 外语 is an advantage, never a door shut; and without it, 外赛区 is held under half.
 *
 * Reported 2026-09-14: a player who took the language by accident had every tryout invitation from another region
 * since, and no club of his own region asked. The author: 「外语学习只是优势，即使会外语国内的俱乐部也应该要来邀请」.
 * Measured before the fix (scripts/probe_lang.ts): the language raised foreign clubs' weight inside the one draw a
 * call is made from, so the same draws gave a 2026 North American ladder player 246 home invitations without it
 * and 112 with it, and a listed round of offers 3,456 home offers and 2,731.
 *
 * The same day, on what that measured without the language — most calls came from abroad, 92% of a 2021 Chinese
 * player's cup calls: 「控制外赛区邀请，在不会外语的时候外赛区邀请占比不要超过一半」 and 「统一按联赛算」
 * (me/prepro.ts ABROAD_CAP, abroadClub).
 *
 * 一 the same draws of a call — a cup run's end and the weekly channel — with the language off and on, 2021 and
 *    2026: every call brings the same club; not one home invitation is lost; foreign ones come on top, at most one
 *    a call, at about LANG_EXTRA of the calls; without the language none comes for it
 * 二 an invitation that came for the language, waiting, does not hold the channel shut; a club's own call does
 * 三 a listed round of offers, the same way: the same home offers, at most one foreign offer more, none added
 *    without the language; a gold agent adds and never takes
 * 四 the words: the 语言课, the help and the transfer screen say what is true
 * 五 without the language, every channel that calls (a cup won, a cup final lost, the ladder, the ladder's top, a
 *    following, a large one, a former professional), 2021 and 2026, six places: 外赛区 no more than half of the calls,
 *    no draw weighing it past ABROAD_CAP of home; the same draws under the rule before 2026-09-14 — not one home
 *    invitation fewer; 2021–2022 read by a club's own region as before, home weights untouched, the clubs abroad
 *    only pressed down together
 * 六 from 2023 by the league: a club of my league based in another country is home, and calls without the language
 * 七 no club of my own within reach: a club from abroad still calls
 * 八 「给个中间分量」 and 「标签按联赛、出海按国家」 (the author, 2026-09-14): from 2023 a club of my league from another
 *    country weighs MATE_SHARE of one of my own country's and is home all the same — in 五's draws of a call, read as well
 *    under the rule before (each weighed whole), and in a listed round of offers read the same way — so my own
 *    country's clubs call and offer more, the league's other countries less, and 外赛区 stays under the cap; 2021–2022
 *    and a league of one country draw exactly as before. The word on a club by year and league (「外赛区」 by league,
 *    「国外俱乐部」 by country), on the invitation and offer cards and the transfer screen; going abroad still by
 *    country (me.abroad, 「语言会是个问题」)
 *
 *   npx tsx scripts/check_language.ts [draws=120]
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import {
  ABROAD_CAP, INVITE_FANS, INVITE_FANS_T1, INVITE_LADDER, INVITE_LADDER_T1, LANG_EXTRA, MATE_SHARE,
  abroadClub, awayWord, cupInvite, foreignLeague, holdAbroad, inviteWeight, leagueMate, markDeclined, reachableClubs, rollInvites,
} from '../src/engine/me/prepro'
import { rollOffers } from '../src/engine/me/transfer'
import { joinClub, makeDeal } from '../src/engine/me/contract'
import { COURSES } from '../src/engine/me/shop'
import { clubOpen, inviteBlock, moveBlock, windowAt } from '../src/engine/me/window'
import { recomputeOverall } from '../src/engine/player'
import { regionIn } from '../src/engine/era'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region, Team } from '../src/engine/types'
import type { Invite } from '../src/engine/me/types'
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

let fails = 0
const fail = (m: string): void => { fails++; console.log(`  ✗ ${m}`) }
const pass = (m: string): void => { console.log(`  ✓ ${m}`) }
const info = (m: string): void => { console.log(`    ${m}`) }
const t0 = Date.now()
const DRAWS = Number(process.argv[2] ?? 120)
const pct = (x: number, n: number): string => (n ? `${Math.round((x / n) * 100)}%` : '—')
const rateOk = (x: number, n: number): boolean => { const r = x / Math.max(1, n); return r >= LANG_EXTRA / 2 && r <= LANG_EXTRA + 0.08 }
/** the most of a draw 外赛区 may weigh: ABROAD_CAP of home, out of home and it together */
const CAP_SHARE = ABROAD_CAP / (1 + ABROAD_CAP)

function setLang(s: GameState, on: boolean): void {
  const me = s.me!
  if (on) {
    me.flags.lang = 1
    if (!me.courses.includes('lang')) me.courses.push('lang')
  } else {
    delete me.flags.lang
    me.courses = me.courses.filter((c) => c !== 'lang')
  }
}

/** a player a range of clubs at home and abroad would ask: every one of the eight at least `level` */
function lift(s: GameState, level: number): void {
  const p = s.players[s.me!.id]
  for (const k of ATTR_KEYS) p.attrs[k] = Math.max(p.attrs[k], level)
  recomputeOverall(p)
}

/* ---- 一、二 invitations ---- */
function invitations(region: Region, year: 2021 | 2026, seed: number): void {
  const s = createCareer({ name: 'Lang', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year })
  const me = s.me!
  lift(s, 70)
  me.week = 30
  me.pre.ladder = 80
  const label = `${year} ${me.region} 天梯`
  // 本赛区 as a call reads it (me/prepro.ts abroadClub): from 2023 the league
  const home = (id: string): boolean => { const t = s.teams[id]; return !!t && !abroadClub(s, t) }
  const pool = reachableClubs(s).filter((t) => clubOpen(s, t.id))
  const poolHome = pool.filter((t) => home(t.id)).length
  const block = inviteBlock(s)
  console.log(`\n${label}：能去试训的本赛区 ${poolHome} 家、外赛区 ${pool.length - poolHome} 家；杯赛和天梯各 ${DRAWS} 次同样的抽签`)
  if (!poolHome || poolHome === pool.length || block) {
    fail(`探针设置不对：本赛区和外赛区都要有俱乐部能去试训，邀请也要能来${block ? `（${block}）` : ''}`)
    return
  }
  const snap = { log: me.log.slice(), pending: me.pending.slice(), flags: { ...me.flags }, courses: me.courses.slice(), scout: me.pre.scoutSeen }
  const restore = (on: boolean): void => {
    me.pre.invites = []
    me.log = snap.log.slice()
    me.pending = snap.pending.slice()
    me.flags = { ...snap.flags }
    me.courses = snap.courses.slice()
    me.pre.scoutSeen = snap.scout
    setLang(s, on)
  }
  const c = { calls: 0, homeOff: 0, homeOn: 0, forOff: 0, forOn: 0, extra: 0, other: 0, fewer: 0, over: 0, extraHome: 0, noLang: 0 }
  const seed0 = s.seed
  const draw = (tag: string, i: number, call: (rng: Rng) => void): void => {
    const got: Invite[][] = []
    for (const on of [false, true]) {
      restore(on)
      // the language's call rolls on a stream of the save and the day (me/prepro.ts callFrom): one fixed day would roll
      // it once for every draw, so each draw is a save of its own. The call itself reads only `rng` — the same club
      // both ways, checked below
      s.seed = seed0 ^ hashStr(`check:lang:seed:${tag}:${i}`)
      call(new Rng(hashStr(`check:lang:${tag}:${seed}:${i}`)))
      got.push(me.pre.invites.slice())
    }
    const [off, on] = got
    const h = (xs: Invite[]): number => xs.filter((x) => home(x.teamId)).length
    c.homeOff += h(off)
    c.homeOn += h(on)
    c.forOff += off.length - h(off)
    c.forOn += on.length - h(on)
    if (off.length) c.calls++
    const extra = on.filter((x) => x.lang)
    c.extra += extra.length
    // the call itself: the same club, the language or not
    if (off.find((x) => !x.lang)?.teamId !== on.find((x) => !x.lang)?.teamId) c.other++
    if (h(on) < h(off)) c.fewer++
    // on top of a call: at most one, never with no call, and from abroad
    if (extra.length > 1 || (extra.length > 0 && !off.length) || on.length > off.length + 1) c.over++
    if (extra.some((x) => home(x.teamId))) c.extraHome++
    if (off.some((x) => x.lang) || off.length > 1) c.noLang++
  }
  for (let i = 0; i < DRAWS; i++) {
    draw('cup', i, (rng) => cupInvite(s, { key: 'check', year: s.year, reached: 3, rounds: 3, won: i % 2 === 0, prize: 0 }, rng))
    draw('week', i, (rng) => rollInvites(s, rng))
  }
  s.seed = seed0
  if (c.calls < DRAWS / 2) fail(`来电只有 ${c.calls} 次，这组抽签测不出东西`)
  if (c.fewer || c.other || c.homeOn < c.homeOff) fail(`学了外语，本赛区邀请 ${c.homeOff} → ${c.homeOn}：${c.fewer} 次同样的抽签少了本赛区的，${c.other} 次来电的不是同一家`)
  else pass(`本赛区邀请：没外语 ${c.homeOff} 份，有外语 ${c.homeOn} 份；${c.calls} 次来电，有没有外语都是同一家`)
  if (!c.extra || c.forOn <= c.forOff) fail(`有外语，外赛区邀请没有多出来：${c.forOff} → ${c.forOn}`)
  else if (!rateOk(c.extra, c.calls)) fail(`会外语另外来的邀请是来电的 ${pct(c.extra, c.calls)}，应该在 ${Math.round(LANG_EXTRA * 100)}% 上下`)
  else pass(`有外语，外赛区邀请 ${c.forOff} → ${c.forOn}：会外语另外来了 ${c.extra} 份，是来电的 ${pct(c.extra, c.calls)}；外赛区占 ${pct(c.forOff, c.homeOff + c.forOff)} → ${pct(c.forOn, c.homeOn + c.forOn)}`)
  if (c.over || c.extraHome) fail(`会外语多出来的邀请不对：${c.over} 次一次多了不止一家或没人来电也来了，${c.extraHome} 份是本赛区的`)
  if (c.noLang) fail(`没外语也来了凭外语的邀请，或一次来了两家：${c.noLang} 次`)
  else pass(`没外语：一次来电一家，没有一份凭外语来；外赛区的 ${c.forOff} 份是抽签本来就有的${year <= 2022 ? '（2021–2022 年各赛区的俱乐部都能来）' : ''}`)

  // 二 an invitation that came for the language, waiting, holds nothing shut; a club's own call waiting still does
  const abroad = pool.find((t) => !home(t.id))!
  const waitingOne = (lang: boolean): Invite => ({ id: 'check:lang:waiting', teamId: abroad.id, via: 'cup', day: s.day, expires: s.day + 21, direct: false, ...(lang ? { lang: true } : {}) })
  const run = { key: 'check', year: s.year, reached: 3, rounds: 3, won: true, prize: 0 }
  let through = 0
  let held = 0
  for (let i = 0; i < 24; i++) {
    restore(true)
    me.pre.invites = [waitingOne(true)]
    cupInvite(s, run, new Rng(hashStr(`check:lang:gate:${seed}:${i}`)))
    if (me.pre.invites.some((x) => !x.lang)) through++
    restore(true)
    me.pre.invites = [waitingOne(false)]
    cupInvite(s, run, new Rng(hashStr(`check:lang:gate:${seed}:${i}`)))
    if (me.pre.invites.length > 1) held++
  }
  restore(false)
  if (!through) fail('一份凭外语来的邀请挂着，24 次杯赛夺冠也没有俱乐部再来——凭外语来的邀请不该占着名额')
  if (held) fail(`一家俱乐部自己的邀请挂着，又来了 ${held} 次——一次只挂一家的规矩变了`)
  if (through && !held) pass(`凭外语来的邀请挂着时，24 次杯赛夺冠照样来了 ${through} 次；俱乐部自己的邀请挂着时照旧不来`)
}

/* ---- 三 offers ---- */
function offers(region: Region, year: 2021 | 2026, start: StartPoint, seed: number): void {
  const s = createCareer({ name: 'Lang', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year })
  const me = s.me!
  lift(s, 76)
  me.tenure = 1
  // an international title this year: a round of offers is a certainty (rollOffers), so every draw is a round to read
  me.titles.push({ year: s.year, title: '圣地亚哥大师赛', started: true })
  const club = s.teams[s.myTeam]
  const label = `${year} ${me.region} ${start === 't1' ? '一线队' : 'Challengers'}（${club?.name ?? '没有俱乐部'}）`
  console.log(`\n${label}：挂牌那一轮 ${DRAWS} 次同样的抽签，没外语 / 有外语 / 金牌经纪人`)
  const shut = !windowAt(s).open
  if (!club || shut || moveBlock(s)) { fail(`探针设置不对：${shut ? '窗口关着' : moveBlock(s) ?? '没有俱乐部'}`); return }
  const snap = { deals: me.deals.slice(), pending: me.pending.slice(), intents: me.intents.slice(), flags: { ...me.flags }, courses: me.courses.slice(), log: me.log.slice(), agent: me.agentTier }
  const restore = (on: boolean, agent = snap.agent): void => {
    me.deals = snap.deals.slice()
    me.pending = snap.pending.slice()
    me.intents = snap.intents.slice()
    me.flags = { ...snap.flags }
    me.courses = snap.courses.slice()
    me.log = snap.log.slice()
    me.agentTier = agent
    setLang(s, on)
  }
  const ids = (): string[] => me.deals.slice(snap.deals.length).map((d) => d.teamId)
  const away = (id: string): boolean => { const t = s.teams[id]; return !!t && foreignLeague(s, t) }
  const homeOf = (xs: string[]): string[] => xs.filter((id) => !away(id))
  const c = { rounds: 0, homeOff: 0, homeOn: 0, forOff: 0, forOn: 0, extra: 0, changed: 0, over: 0, extraHome: 0, noLang: 0, agentFewer: 0, agentHome: 0, agentFor: 0 }
  const seed0 = s.seed
  for (let i = 0; i < DRAWS; i++) {
    // each draw a save of its own for the language's stream (rollOffers seeds it by the save and the day), the round's own draw the same
    s.seed = seed0 ^ hashStr(`check:lang:offer:seed:${i}`)
    const rng = (): Rng => new Rng(hashStr(`check:lang:offer:${seed}:${i}`))
    restore(false)
    rollOffers(s, rng(), true, 1)
    const off = ids()
    if (me.log.slice(snap.log.length).some((l) => l.text.includes('你会外语') || l.text.includes('金牌经纪人牵的线'))) c.noLang++
    restore(true)
    rollOffers(s, rng(), true, 1)
    const on = ids()
    restore(false, 2)
    rollOffers(s, rng(), true, 1)
    const agent = ids()
    if (off.length) c.rounds++
    c.homeOff += homeOf(off).length
    c.homeOn += homeOf(on).length
    c.forOff += off.length - homeOf(off).length
    c.forOn += on.length - homeOf(on).length
    // the round's own offers are the same clubs in the same order; the language's comes after them, from another league
    if (on.slice(0, off.length).join() !== off.join()) c.changed++
    const more = on.slice(off.length)
    c.extra += more.length
    if (more.length > 1 || (more.length > 0 && !off.length)) c.over++
    if (more.some((id) => !away(id))) c.extraHome++
    // a gold agent: the same first offer, a second more often, one abroad on top — never a home offer fewer
    if (homeOf(agent).length < homeOf(off).length) c.agentFewer++
    c.agentHome += homeOf(agent).length
    c.agentFor += agent.length - homeOf(agent).length
  }
  s.seed = seed0
  restore(false)
  if (c.rounds < DRAWS / 2) fail(`有人来的只有 ${c.rounds} 轮，这组抽签测不出东西`)
  if (c.changed || c.homeOn !== c.homeOff) fail(`学了外语，本赛区报价 ${c.homeOff} → ${c.homeOn}，${c.changed} 轮本来的报价换了人`)
  else pass(`本赛区报价：没外语 ${c.homeOff} 份，有外语 ${c.homeOn} 份；${c.rounds} 轮有人来，本来的报价每轮都是同几家`)
  if (!c.extra || c.forOn <= c.forOff) fail(`有外语，外赛区报价没有多出来：${c.forOff} → ${c.forOn}`)
  else if (!rateOk(c.extra, c.rounds)) fail(`会外语另外来的报价是有人来的轮次的 ${pct(c.extra, c.rounds)}，应该在 ${Math.round(LANG_EXTRA * 100)}% 上下`)
  else pass(`有外语，外赛区报价 ${c.forOff} → ${c.forOn}：会外语另外来了 ${c.extra} 份，是有人来的轮次的 ${pct(c.extra, c.rounds)}`)
  if (c.over || c.extraHome) fail(`会外语多出来的报价不对：${c.over} 轮多了不止一家或没人来也来了，${c.extraHome} 份是本赛区的`)
  if (c.noLang) fail(`没外语、没有金牌经纪人，也有 ${c.noLang} 轮来了凭外语或经纪人另外来的报价`)
  if (c.agentFewer) fail(`金牌经纪人让 ${c.agentFewer} 轮少了本赛区的报价`)
  else pass(`金牌经纪人：本赛区报价 ${c.homeOff} → ${c.agentHome}，外赛区 ${c.forOff} → ${c.agentFor}，本赛区一份没少`)
}

/* ---- 五、六、七 外赛区 without the language ---- */

/** a seed's bits spread over the word: xorshift's first draws from seeds a hash apart are not independent of each other */
function spread(x: number): number {
  let h = x >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * A call's stream with its gate held open — whether a club calls is not what changed, only who calls — and the draw
 * read as it is made: the clubs in the order drawn, their weights, and the stream just before it.
 */
class Spy extends Rng {
  pool: Team[] = []
  w: number[] = []
  before = 0
  constructor(seed: number) { super(spread(seed)) }
  chance(p: number): boolean { void p; this.next(); return true }
  weighted<T>(xs: readonly T[], ws: readonly number[]): T {
    this.before = this.state
    this.pool = xs.slice() as unknown as Team[]
    this.w = ws.slice()
    return super.weighted(xs, ws)
  }
}

/**
 * The rule before 2026-09-14 (me/prepro.ts pickClub at 61c0220), on the pool a draw was made from: home by a club's
 * own region, home clubs first, each club of another region at 0.5 of its weight in 2021–2022 and 0.04 from 2023, and
 * nothing holding them together. Read against draws recorded at that commit on the same streams, 2026-09-14: 25,200
 * of 25,200 the same club.
 */
function weightsBefore(s: GameState, pool: Team[], prefer: 0 | 1 | 2, order: Map<string, number>): { pool: Team[]; w: number[] } {
  const me = s.me!
  const home = (t: Team): boolean => t.region === me.region
  const sorted = pool.slice().sort((a, b) => (Number(home(b)) - Number(home(a))) || b.rating - a.rating || order.get(a.id)! - order.get(b.id)!)
  const per = s.year <= 2022 ? 0.5 : 0.04
  return { pool: sorted, w: sorted.map((t) => inviteWeight(s, t, prefer) * (home(t) ? 1 : per)) }
}

interface Channel { name: string; via: Invite['via']; ladder: number; fans: number; wasPro: boolean; prefer: 0 | 1 | 2; call: (s: GameState, rng: Rng) => void }
const cupRun = (won: boolean) => (s: GameState, rng: Rng): void => cupInvite(s, { key: 'check', year: s.year, reached: 3, rounds: 3, won, prize: 0 }, rng)
/** every road a call comes by (me/prepro.ts cupInvite, rollInvites), each asking the tier it asks first */
const CHANNELS: Channel[] = [
  { name: '杯赛夺冠', via: 'cup', ladder: INVITE_LADDER - 1, fans: 0, wasPro: false, prefer: 0, call: cupRun(true) },
  { name: '杯赛亚军', via: 'cup', ladder: INVITE_LADDER - 1, fans: 0, wasPro: false, prefer: 2, call: cupRun(false) },
  { name: '天梯', via: 'rank', ladder: INVITE_LADDER + 18, fans: 0, wasPro: false, prefer: 2, call: rollInvites },
  { name: '天梯前列', via: 'rank', ladder: INVITE_LADDER_T1 + 2, fans: 0, wasPro: false, prefer: 1, call: rollInvites },
  { name: '粉丝', via: 'fans', ladder: INVITE_LADDER - 1, fans: INVITE_FANS + 80, wasPro: false, prefer: 2, call: rollInvites },
  { name: '粉丝多', via: 'fans', ladder: INVITE_LADDER - 1, fans: INVITE_FANS_T1 + 100, wasPro: false, prefer: 1, call: rollInvites },
  { name: '前职业', via: 'free', ladder: INVITE_LADDER - 1, fans: 0, wasPro: true, prefer: 0, call: rollInvites },
]

function held(region: Region, year: 2021 | 2026, seed: number): void {
  const s = createCareer({ name: 'Abroad', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year })
  const me = s.me!
  lift(s, 70)
  me.week = 30
  setLang(s, false)
  const away = (t: Team): boolean => abroadClub(s, t)
  const league = regionIn(me.region, s.year)
  const order = new Map(Object.keys(s.teams).map((id, i) => [id, i]))
  const snap = { log: me.log.slice(), pending: me.pending.slice(), scout: me.pre.scoutSeen, ladder: me.pre.ladder, fans: me.fans, wasPro: me.pre.wasPro }
  const reset = (ch?: Channel): void => {
    me.pre.invites = []
    me.log = snap.log.slice()
    me.pending = snap.pending.slice()
    me.pre.scoutSeen = snap.scout
    me.pre.ladder = ch?.ladder ?? snap.ladder
    me.fans = ch?.fans ?? snap.fans
    me.pre.wasPro = ch?.wasPro ?? snap.wasPro
  }
  const pool0 = reachableClubs(s).filter((t) => clubOpen(s, t.id))
  const block = inviteBlock(s)
  console.log(`\n${year} ${me.region}，综合 ${Math.round(s.players[me.id].overall)}：能去试训的本赛区 ${pool0.filter((t) => !away(t)).length} 家、外赛区 ${pool0.filter(away).length} 家；${CHANNELS.length} 条来电的路各 ${DRAWS} 次，同样的抽签按改之前和现在的规矩各读一遍`)
  if (block || !pool0.length) { fail(`探针设置不对：${block ?? '没有俱乐部能去试训'}`); return }

  const T = {
    calls: 0, home: 0, far: 0, homeWas: 0, farWas: 0, lost: 0, lostSplit: 0, worst: 0, noHome: 0, wrongVia: 0, noCall: 0, moved: 0, nat: 0, natWas: 0, mate: 0, mateWas: 0,
    // 八 under the rule before MATE_SHARE: a club of my league from another country weighed whole
    wrongShare: 0, mateSeen: 0, natWhole: 0, mateWhole: 0, farWhole: 0, movedWhole: 0,
  }
  const lines: string[] = []
  for (const ch of CHANNELS) {
    const c = { calls: 0, far: 0, farWas: 0 }
    for (let i = 0; i < DRAWS; i++) {
      reset(ch)
      // a stream of each place's own: held to the same share, the same streams would bring home and abroad in the same draws everywhere
      const spy = new Spy(hashStr(`check:abroad:${year}:${region}:${ch.via}:${ch.prefer}:${ch.name}:${seed}:${i}`))
      ch.call(s, spy)
      const inv = me.pre.invites.find((x) => !x.lang)
      if (!inv || !spy.pool.length) { T.noCall++; continue }
      if (inv.via !== ch.via) T.wrongVia++
      const t = s.teams[inv.teamId]
      const was = weightsBefore(s, spy.pool, ch.prefer, order)
      const w0 = new Rng(spy.before).weighted(was.pool, was.w)
      c.calls++
      T.calls++
      if (away(t)) { c.far++; T.far++ } else T.home++
      if (away(w0)) { c.farWas++; T.farWas++ } else T.homeWas++
      if (t.region === me.region) T.nat++
      if (w0.region === me.region) T.natWas++
      if (t.region !== me.region && !away(t)) T.mate++
      if (w0.region !== me.region && !away(w0)) T.mateWas++
      // 八 the draw's weights as they must be — my own country's whole, my league's other countries MATE_SHARE each, 外赛区
      // pressed under the cap together — and the same draw under the rule before, each club of my league weighed whole
      const aw = spy.pool.map(away)
      const per = s.year <= 2022 ? 0.5 : 0.04
      const wNow = holdAbroad(spy.pool.map((x, j) => inviteWeight(s, x, ch.prefer) * (aw[j] ? per : leagueMate(s, x) ? MATE_SHARE : 1)), aw)
      if (spy.w.some((v, j) => Math.abs(v - wNow[j]) > 1e-9 * Math.max(1, wNow[j]))) T.wrongShare++
      const mates = spy.pool.filter((x) => leagueMate(s, x)).length
      T.mateSeen += mates
      const w1 = new Rng(spy.before).weighted(spy.pool, holdAbroad(spy.pool.map((x, j) => inviteWeight(s, x, ch.prefer) * (aw[j] ? per : 1)), aw))
      if (w1.region === me.region) T.natWhole++
      else if (away(w1)) T.farWhole++
      else T.mateWhole++
      if (!mates && w1.id !== t.id) T.movedWhole++
      // the rule's own split the same as the old one for every club of this draw: 2021–2022, or no club of my league abroad in it
      const split = spy.pool.every((x) => away(x) === (x.region !== me.region))
      if (!away(w0) && away(t)) { T.lost++; if (split) T.lostSplit++ }
      // what 外赛区 weighs of this draw
      let far = 0
      let tot = 0
      spy.w.forEach((v, j) => { tot += v; if (away(spy.pool[j])) far += v })
      if (tot - far <= 0) T.noHome++
      else T.worst = Math.max(T.worst, far / tot)
      // where the split is the old one: the same clubs in the same order, home weights as they were, the clubs abroad pressed down by one share
      if (split) {
        const sameOrder = was.pool.every((x, j) => x.id === spy.pool[j].id)
        let k = -1
        let ok = sameOrder
        spy.w.forEach((v, j) => {
          const old = was.w[j]
          if (!away(spy.pool[j])) { if (Math.abs(v - old) > 1e-9 * Math.max(1, old)) ok = false; return }
          const r = v / old
          if (k < 0) k = r
          else if (Math.abs(r - k) > 1e-9) ok = false
        })
        if (!ok || k > 1 + 1e-9) T.moved++
      }
    }
    lines.push(`${ch.name} ${pct(c.far, c.calls)}（改之前 ${pct(c.farWas, c.calls)}）`)
    if (c.calls > DRAWS / 2 && c.far / c.calls > 0.5) fail(`${ch.name}：不会外语，外赛区的邀请 ${c.far}/${c.calls}，过了一半`)
  }
  reset()
  if (T.noCall > (DRAWS * CHANNELS.length) / 2 || T.wrongVia) { fail(`探针设置不对：${T.noCall} 次没来电，${T.wrongVia} 次来电走的不是设好的那条路`); return }
  const farShare = T.far / T.calls
  if (farShare > 0.5 || T.worst > CAP_SHARE + 1e-9) fail(`不会外语，外赛区邀请 ${T.far}/${T.calls}（${pct(T.far, T.calls)}），单次抽签外赛区最多占了 ${pct(T.worst, 1)}：上限是一半，抽签里是 ${Math.round(CAP_SHARE * 100)}%`)
  else pass(`不会外语，外赛区邀请 ${T.farWas} → ${T.far} 份，占 ${pct(T.farWas, T.calls)} → ${pct(T.far, T.calls)}；单次抽签里外赛区最多占 ${pct(T.worst, 1)}（上限 ${Math.round(CAP_SHARE * 100)}%）`)
  info(lines.join(' · '))
  if (T.home < T.homeWas || T.lostSplit) fail(`本赛区邀请 ${T.homeWas} → ${T.home}：${T.lostSplit} 次同样的抽签本来来的是本赛区的，现在成了外赛区的`)
  else pass(`本赛区邀请 ${T.homeWas} → ${T.home} 份，${T.calls} 次同样的抽签${T.lost ? `（${T.lost} 次换成了外赛区的：同联赛别国的俱乐部排进了本赛区，抽签顺序跟着变了；总数照样多了）` : '里本来是本赛区的一次也没换成外赛区的'}`)
  if (T.moved) fail(`${T.moved} 次抽签本赛区俱乐部的分量被动了，或外赛区的不是按同一个比例一起压下来`)
  info(`本赛区一家都够不着的抽签：${T.noHome} 次`)

  if (s.year <= 2022) {
    // 六 before 2023: a club's own region, as before
    const clubs = Object.values(s.teams)
    const changed = clubs.filter((t) => away(t) !== (t.region !== me.region))
    const future = clubs.filter((t) => t.region !== me.region && regionIn(t.region, 2023) === regionIn(me.region, 2023))
    if (changed.length) fail(`${year} 年有 ${changed.length} 家俱乐部不按所在赛区算本赛区、外赛区了：${changed.slice(0, 4).map((t) => t.name).join('、')}`)
    else if (T.moved) fail('2021–2022 年的抽签不只是外赛区一起压下来')
    else pass(`${year} 年照旧按俱乐部所在赛区算：${clubs.length} 家俱乐部一家没变${future.length ? `（2023 年同联赛的 ${future.length} 家这时还算外赛区）` : ''}；本赛区的分量没动，外赛区的只是按同一个比例一起压下来`)
  } else {
    // 六 from 2023: the league
    const clubs = Object.values(s.teams).filter((t) => !t.dormant)
    const mates = clubs.filter((t) => t.region !== me.region && regionIn(t.region, s.year) === league)
    const wrongMates = mates.filter((t) => away(t) || foreignLeague(s, t))
    const wrongOthers = clubs.filter((t) => regionIn(t.region, s.year) !== league && !away(t))
    if (wrongMates.length || wrongOthers.length) fail(`${year} 年按联赛算不对：同联赛别国的 ${wrongMates.length} 家算了外赛区，别的联赛的 ${wrongOthers.length} 家算了本赛区`)
    else if (mates.length && !T.mate) fail(`${league} 联赛里别的国家的俱乐部有 ${mates.length} 家，不会外语一份邀请也没来`)
    else if (mates.length) {
      const where = [...new Set(mates.map((t) => t.region))].join('、')
      pass(`${year} 年按联赛算：${league} 里 ${where} 的 ${mates.length} 家俱乐部（Challengers ${mates.filter((t) => t.tier === 2).length} 家）算本赛区，别的联赛的都算外赛区；不会外语，同样的抽签它们来了 ${T.mateWas} → ${T.mate} 份，本国俱乐部 ${T.natWas} → ${T.nat} 份`)
    } else pass(`${year} 年按联赛算：${league} 联赛里没有别的国家的俱乐部，本赛区就是本国的；别的联赛的都算外赛区`)
  }

  // 七 no club of my own within reach: turned down, every one, this year — a club from abroad still calls, weighed as it is
  if (year === 2021) {
    const keep = me.declined
    const homes = reachableClubs(s, 99).filter((t) => !away(t))
    for (const t of homes) markDeclined(s, t.id)
    const ch = CHANNELS[0]
    let calls = 0
    let far = 0
    let pressed = 0
    for (let i = 0; i < 40; i++) {
      reset(ch)
      const spy = new Spy(hashStr(`check:abroad:nohome:${year}:${region}:${seed}:${i}`))
      ch.call(s, spy)
      const inv = me.pre.invites.find((x) => !x.lang)
      if (!inv) continue
      calls++
      if (away(s.teams[inv.teamId])) far++
      const was = weightsBefore(s, spy.pool, ch.prefer, order)
      if (spy.w.some((v, j) => Math.abs(v - was.w[j]) > 1e-9 * Math.max(1, was.w[j]))) pressed++
    }
    me.declined = keep
    reset()
    if (calls < 40 || far < calls || pressed) fail(`本赛区一家都够不着（${homes.length} 家都回绝了）：40 次杯赛夺冠来了 ${calls} 次，外赛区的 ${far} 次，${pressed} 次外赛区的分量还被压了`)
    else pass(`本赛区一家都够不着（${homes.length} 家都回绝了）：40 次杯赛夺冠照样来了 ${calls} 次，都是外赛区的，分量没压`)
  }

  // 八 from 2023 a club of my league from another country weighs MATE_SHARE of one of my own country's, home all the same:
  // the same draws read under the rule before (each weighed whole). With none in a draw — 2021–2022, a league of one country — nothing moves
  if (T.wrongShare) fail(`${T.wrongShare} 次抽签的分量对不上：本国俱乐部整份，同联赛别国的每家 ${MATE_SHARE} 份，外赛区的照旧一起压在上限以下`)
  else if (!T.mateSeen) {
    if (T.movedWhole) fail(`抽签里没有同联赛别国的俱乐部，却有 ${T.movedWhole} 次来的和上一版不是同一家`)
    else pass(`${s.year <= 2022 ? '2023 年以前不分同联赛别国' : '联赛里只有本国的俱乐部'}：${T.calls} 次抽签的分量和上一版一样，来的是同一家`)
  } else {
    const where = [...new Set(Object.values(s.teams).filter((t) => !t.dormant && leagueMate(s, t)).map((t) => t.region))].join('、')
    const line = `本国俱乐部 ${T.natWhole} → ${T.nat} 份，${where} ${T.mateWhole} → ${T.mate} 份，外赛区 ${T.farWhole} → ${T.far} 份`
    if (T.nat <= T.natWhole || T.mate >= T.mateWhole) fail(`同联赛别国的俱乐部减到 ${MATE_SHARE} 份，本国俱乐部的邀请没有回来：${line}`)
    else if (T.nat <= T.mate) fail(`本国俱乐部不再是邀请的主要来源：${line}`)
    else pass(`同联赛别国的俱乐部每家是本国俱乐部的 ${MATE_SHARE} 份（在抽签里出现 ${T.mateSeen} 次，分量一次不差；仍算本赛区，不受外赛区上限压）。同样的抽签按上一版（每家和本国一样重）读：${line}`)
  }
  // 八 the word on a club (me/prepro.ts awayWord): 「外赛区」 by a club's region before 2023 and by league from it, 「国外俱乐部」 my league's other countries
  {
    const clubs = Object.values(s.teams).filter((t) => !t.id.startsWith('CUP_'))
    const want = (t: Team): string => (t.region === me.region ? '' : s.year <= 2022 || regionIn(t.region, s.year) !== league ? '外赛区' : '国外俱乐部')
    const wrong = clubs.filter((t) => awayWord(s, t) !== want(t))
    const n = (w: string): number => clubs.filter((t) => want(t) === w).length
    if (wrong.length) fail(`卡片上的字有 ${wrong.length} 家不对：${wrong.slice(0, 4).map((t) => `${t.name}「${awayWord(s, t)}」应为「${want(t)}」`).join('、')}`)
    else pass(`卡片上的字：本国 ${n('')} 家不标，「国外俱乐部」${n('国外俱乐部')} 家，「外赛区」${n('外赛区')} 家${s.year <= 2022 ? '（2023 年以前按俱乐部所在赛区，和以前一样）' : '（外赛区按联赛，国外俱乐部按国家）'}`)
  }
}

/* ---- 八 a round of offers, going abroad ---- */

/** A round's stream with its gate held open, every draw of it read as it is made: a round of offers picks up to twice */
class Tape extends Rng {
  draws: { pool: Team[]; w: number[]; before: number }[] = []
  constructor(seed: number) { super(spread(seed)) }
  chance(p: number): boolean { void p; this.next(); return true }
  weighted<T>(xs: readonly T[], ws: readonly number[]): T {
    this.draws.push({ pool: xs.slice() as unknown as Team[], w: ws.slice(), before: this.state })
    return super.weighted(xs, ws)
  }
}

type Kind = 'nat' | 'mate' | 'far'
const kinds = (): Record<Kind, number> => ({ nat: 0, mate: 0, far: 0 })

/**
 * A listed round of offers (me/transfer.ts rollOffers → pickBuyer), every pick read under today's weights and under the
 * rule before MATE_SHARE on the same stream. A buyer's weight is its own part — how far above my club, a VCT club, a name
 * written down — times 1.5 at home and 0.015 in another league; a club of my league from another country 1.5 × MATE_SHARE
 * now and 1.5 before.
 */
function mateOffers(region: Region, year: 2021 | 2026, start: StartPoint, seed: number): void {
  const s = createCareer({ name: 'Mate', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year })
  const me = s.me!
  lift(s, start === 't1' ? 82 : 76)
  me.tenure = 1
  setLang(s, false)
  const mine = s.teams[s.myTeam]
  console.log(`\n${year} ${me.region} ${start === 't1' ? '一线队' : 'Challengers'}（${mine?.name ?? '没有俱乐部'}，综合 ${Math.round(s.players[me.id].overall)}）：挂牌那一轮 ${DRAWS} 次，同样的抽签按上一版（同联赛别国每家和本国一样重）和现在各读一遍`)
  const shut = !windowAt(s).open
  if (!mine || shut || moveBlock(s)) { fail(`探针设置不对：${shut ? '窗口关着' : moveBlock(s) ?? '没有俱乐部'}`); return }
  const snap = { deals: me.deals.slice(), pending: me.pending.slice(), intents: me.intents.slice(), flags: { ...me.flags }, log: me.log.slice() }
  const restore = (): void => {
    me.deals = snap.deals.slice()
    me.pending = snap.pending.slice()
    me.intents = snap.intents.slice()
    me.flags = { ...snap.flags }
    me.log = snap.log.slice()
  }
  const kind = (t: Team): Kind => (foreignLeague(s, t) ? 'far' : leagueMate(s, t) ? 'mate' : 'nat')
  const own = (t: Team): number => (10 + Math.max(0, t.rating - mine.rating) * 3 + (t.tier === 1 ? 6 : 0)) * (snap.intents.some((x) => x.teamId === t.id) ? 4 : 1)
  const share: Record<Kind, number> = { nat: 1.5, mate: 1.5 * MATE_SHARE, far: 0.015 }
  const now = (t: Team): number => own(t) * share[kind(t)]
  const whole = (t: Team): number => own(t) * (kind(t) === 'far' ? 0.015 : 1.5)
  const N = kinds()
  const W = kinds()
  const P = kinds()
  const c = { picks: 0, wrong: 0, mateSeen: 0, moved: 0 }
  for (let i = 0; i < DRAWS; i++) {
    restore()
    const tape = new Tape(hashStr(`check:lang:mate:${year}:${region}:${start}:${seed}:${i}`))
    rollOffers(s, tape, true, 1)
    for (const d of tape.draws) {
      if (!c.picks) for (const t of d.pool) P[kind(t)]++
      c.picks++
      if (d.w.some((v, j) => Math.abs(v - now(d.pool[j])) > 1e-9 * Math.max(1, v))) c.wrong++
      const mates = d.pool.filter((t) => kind(t) === 'mate').length
      c.mateSeen += mates
      const got = new Rng(d.before).weighted(d.pool, d.w)
      const was = new Rng(d.before).weighted(d.pool, d.pool.map(whole))
      N[kind(got)]++
      W[kind(was)]++
      if (!mates && got.id !== was.id) c.moved++
    }
  }
  restore()
  info(`挑了 ${c.picks} 次人；第一次的池子：本国 ${P.nat} 家、同联赛别国 ${P.mate} 家、外赛区 ${P.far} 家`)
  const line = `本国俱乐部 ${W.nat} → ${N.nat} 份，同联赛别国 ${W.mate} → ${N.mate} 份，外赛区 ${W.far} → ${N.far} 份`
  if (c.picks < DRAWS) fail(`只挑了 ${c.picks} 次人，这组抽签测不出东西`)
  else if (c.wrong) fail(`${c.wrong} 次挑人的分量对不上：本国俱乐部 ×1.5，同联赛别国 ×1.5×${MATE_SHARE}，外赛区 ×0.015`)
  else if (!c.mateSeen) {
    if (c.moved) fail(`池子里没有同联赛别国的俱乐部，却有 ${c.moved} 次挑的和上一版不是同一家`)
    else pass(`${year <= 2022 ? '2023 年以前不分同联赛别国' : '池子里没有同联赛别国的俱乐部'}：${c.picks} 次挑人的分量和上一版一样，挑的是同一家（本国 ${N.nat} 份，外赛区 ${N.far} 份）`)
  } else if (N.nat <= W.nat || N.mate >= W.mate) fail(`同联赛别国的俱乐部减到 ${MATE_SHARE} 份，本国俱乐部的报价没有回来：${line}`)
  else if (N.nat <= N.mate) fail(`本国俱乐部不再是报价的主要来源：${line}`)
  else pass(`报价：同联赛别国的俱乐部每家是本国俱乐部的 ${MATE_SHARE} 份（在池子里 ${c.mateSeen} 次，分量一次不差）；${line}`)
}

/**
 * A North American signing: going abroad by country (me/contract.ts joinClub `me.abroad`, the signing's 「语言会是个问题」),
 * the word on the club by league (me/prepro.ts awayWord) — and, playing in another league, that league's clubs are
 * 「国外俱乐部」, not 外赛区, as an offer reads them (foreignLeague).
 */
function goAbroad(year: 2021 | 2026, seed: number): void {
  const s0 = createCareer({ name: 'Abroad', region: 'North America', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed, year })
  setLang(s0, false)
  const f0 = fails
  const top = (s: GameState, region: Region): Team | undefined => Object.values(s.teams)
    .filter((t) => t.region === region && t.tier === 1 && !t.dormant && t.roster.length >= 5 && t.id !== s.myTeam)
    .sort((a, b) => b.rating - a.rating)[0]
  const cases: [Region, string][] = year <= 2022
    ? [['North America', ''], ['Brazil', '外赛区'], ['Korea', '外赛区']]
    : [['North America', ''], ['Brazil', '国外俱乐部'], ['Korea', '外赛区']]
  console.log(`\n${year} 北美选手签约：卡片上的字按${year <= 2022 ? '俱乐部所在赛区' : '联赛'}，出海按国家`)
  const said: string[] = []
  let pacific: GameState | null = null
  for (const [region, word] of cases) {
    const s = structuredClone(s0) as GameState
    const t = top(s, region)
    if (!t) { fail(`${year} 年找不到 ${region} 的一线俱乐部`); continue }
    const abroad = region !== 'North America'
    const card = awayWord(s, t)
    const deal = makeDeal(s, t.id, 'transfer', 'B', new Rng(hashStr(`check:lang:abroad:${year}:${region}`)))
    joinClub(s, deal)
    const me = s.me!
    const line = me.log.map((l) => l.text).filter((x) => x.startsWith('签约 ')).pop() ?? ''
    const lang = line.includes('语言会是个问题')
    if (card !== word || deal.abroad !== abroad || me.abroad !== abroad || lang !== abroad || (abroad && !line.includes(`这是${word}`))) {
      fail(`签 ${t.name}（${region}）：卡片「${card}」应为「${word}」，出海 ${me.abroad}（报价上 ${deal.abroad}）应为 ${abroad}，签约那一行「${line}」`)
    }
    said.push(`${t.name}（${region}）${card ? `「${card}」` : '不标'}、${me.abroad ? '出海' : '不算出海'}${lang ? '、「语言会是个问题」' : ''}`)
    if (region === 'Korea') pacific = s
  }
  if (fails === f0) pass(said.join('；'))
  if (pacific && year >= 2023) {
    const s = pacific
    const want: [Region, string][] = [['Korea', '国外俱乐部'], ['Japan', '国外俱乐部'], ['Brazil', '国外俱乐部'], ['North America', ''], ['Europe', '外赛区']]
    const got = want.map(([r, w]) => ({ r, w, t: top(s, r) })).map((g) => ({ ...g, word: g.t ? awayWord(s, g.t) : null }))
    const bad = got.filter((g) => g.word !== g.w)
    if (bad.length || !s.me!.abroad) fail(`在 ${s.teams[s.myTeam]?.name} 时卡片上的字不对，或不算出海（${s.me!.abroad}）：${bad.map((g) => `${g.t?.name ?? g.r}「${g.word ?? '找不到'}」应为「${g.w}」`).join('、')}`)
    else pass(`在 ${s.teams[s.myTeam].name}（Pacific）打的时候：${got.map((g) => `${g.t!.name}${g.word ? `「${g.word}」` : '不标'}`).join('、')}——自己在打的联赛不算外赛区；仍算出海`)
  }
}

console.log('一、二 试训邀请')
invitations('North America', 2026, 31)
invitations('China', 2021, 17)
console.log('\n三 报价')
offers('Europe', 2026, 't1', 77)
offers('North America', 2021, 'chal', 5)

console.log('\n四 字面')
{
  const course = COURSES.find((x) => x.key === 'lang')
  const help = readFileSync(new URL('../src/ui/me/HelpScreen.tsx', import.meta.url), 'utf8')
  const transfer = readFileSync(new URL('../src/ui/me/TransferScreen.tsx', import.meta.url), 'utf8')
  if (!course || /权重/.test(course.blurb) || !/本赛区/.test(course.blurb) || !/照常/.test(course.blurb) || !/联赛/.test(course.blurb)) fail(`语言课的说明「${course?.blurb ?? ''}」：应该说本赛区照常来、外赛区另外多来，2023 年起按联赛分赛区`)
  else pass(`语言课：「${course.blurb}」`)
  if (/会外语的多一些/.test(help) || !/LANG_EXTRA/.test(help)) fail('帮助「俱乐部怎么注意到你」还是旧说法，或者几成没从 LANG_EXTRA 读')
  else pass('帮助「俱乐部怎么注意到你」：本赛区照常来，外赛区另外多来的几成从 LANG_EXTRA 读')
  if (/来找你的不一定少/.test(help) || !/ABROAD_CAP/.test(help) || !/联赛/.test(help)) fail('帮助没说不会外语时外赛区邀请的上限（从 ABROAD_CAP 读），或没说 2023 年起按联赛分赛区')
  else pass('帮助：不会外语时外赛区邀请的上限从 ABROAD_CAP 读，2023 年起按 VCT 联赛分赛区')
  if (!/abroadClub\(/.test(transfer) || /t\.region [!=]== me\.region/.test(transfer)) fail('转会页的门槛表还按俱乐部所在国家分本赛区、外赛区')
  else pass('转会页的门槛表：本赛区、外赛区和来电用同一条规矩（abroadClub）')
  // 八 the word on a club: one rule on every card and table (me/prepro.ts awayWord), and the help says it
  const modals = readFileSync(new URL('../src/ui/me/Modals.tsx', import.meta.url), 'utf8')
  const teamPage = readFileSync(new URL('../src/ui/me/TeamScreen.tsx', import.meta.url), 'utf8')
  const cards = (modals.match(/awayWord\(game, team\)/g) ?? []).length
  const table = /awayWord\(game, t\)/.test(transfer) && !/' · 外赛区'/.test(transfer)
  const ask = !/' · 外赛区'/.test(teamPage)
  if (cards < 2 || /d\.abroad &&/.test(modals) || !table || !ask) fail(`「外赛区」「国外俱乐部」没在每张卡片和表上用同一条规矩：邀请卡、报价卡 ${cards}/2 处读 awayWord，转会页门槛表${table ? '读了' : '没读'}，队伍页「要人」${ask ? '按联赛' : '还按国家标外赛区'}`)
  else pass('邀请卡、报价卡、转会页门槛表：「外赛区」按联赛、「国外俱乐部」按国家，和来电、报价同一条规矩（awayWord）；队伍页「要人」从自己俱乐部那边按同样的分法')
  if (!/MATE_SHARE/.test(help) || !/国外俱乐部/.test(help)) fail('帮助没说同联赛别国的俱乐部标「国外俱乐部」、每家的分量（从 MATE_SHARE 读）')
  else pass('帮助：同联赛别国的俱乐部标「国外俱乐部」，每家的分量从 MATE_SHARE 读，别的联赛的才标「外赛区」')
}

console.log(`\n五、六、七 不会外语：外赛区的邀请不过半；2023 年起按联赛算`)
held('China', 2021, 31)
held('Europe', 2021, 31)
held('North America', 2021, 31)
held('China', 2026, 31)
held('North America', 2026, 31)
held('Europe', 2026, 31)

console.log('\n八 同联赛别国的俱乐部：报价也按这个分量；卡片上的字按联赛，出海按国家')
mateOffers('North America', 2026, 't1', 77)
mateOffers('North America', 2026, 'chal', 77)
mateOffers('Europe', 2026, 't1', 77)
mateOffers('Europe', 2026, 'chal', 77)
mateOffers('North America', 2021, 'chal', 5)
goAbroad(2026, 41)
goAbroad(2021, 41)

console.log(fails ? `\n✗ ${fails} 项不对。` : `\n✓ 外语只加不减：本赛区的试训邀请和报价和不会外语时一份不少，外赛区的另外多来，一次最多一家；不会外语，外赛区的邀请不过半，本赛区的一份没少；2023 年起按联赛算，同联赛别国的俱乐部每家 ${MATE_SHARE} 份、本国俱乐部还是主要来源；卡片上的字按联赛，出海按国家。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
