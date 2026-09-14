/**
 * 外语 is an advantage, never a door shut.
 *
 * Reported 2026-09-14: a player who took the language by accident had every tryout invitation from another region
 * since, and no club of his own region asked. The author: 「外语学习只是优势，即使会外语国内的俱乐部也应该要来邀请」.
 * Measured before the fix (scripts/probe_lang.ts): the language raised foreign clubs' weight inside the one draw a
 * call is made from, so the same draws gave a 2026 North American ladder player 246 home invitations without it
 * and 112 with it, and a listed round of offers 3,456 home offers and 2,731.
 *
 * 一 the same draws of a call — a cup run's end and the weekly channel — with the language off and on, 2021 and
 *    2026: every call brings the same club; not one home invitation is lost; foreign ones come on top, at most one
 *    a call, at about LANG_EXTRA of the calls; without the language none comes for it
 * 二 an invitation that came for the language, waiting, does not hold the channel shut; a club's own call does
 * 三 a listed round of offers, the same way: the same home offers, at most one foreign offer more, none added
 *    without the language; a gold agent adds and never takes
 * 四 the words: the 语言课 and the help say what is true
 *
 *   npx tsx scripts/check_language.ts [draws=120]
 */
import { readFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { LANG_EXTRA, cupInvite, reachableClubs, rollInvites } from '../src/engine/me/prepro'
import { foreignLeague, rollOffers } from '../src/engine/me/transfer'
import { COURSES } from '../src/engine/me/shop'
import { clubOpen, inviteBlock, moveBlock, windowAt } from '../src/engine/me/window'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Region } from '../src/engine/types'
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
const t0 = Date.now()
const DRAWS = Number(process.argv[2] ?? 120)
const pct = (x: number, n: number): string => (n ? `${Math.round((x / n) * 100)}%` : '—')
const rateOk = (x: number, n: number): boolean => { const r = x / Math.max(1, n); return r >= LANG_EXTRA / 2 && r <= LANG_EXTRA + 0.08 }

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
  const home = (id: string): boolean => s.teams[id]?.region === me.region
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
  else pass(`有外语，外赛区邀请 ${c.forOff} → ${c.forOn}：会外语另外来了 ${c.extra} 份，是来电的 ${pct(c.extra, c.calls)}`)
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
  if (!course || /权重/.test(course.blurb) || !/本赛区/.test(course.blurb) || !/照常/.test(course.blurb)) fail(`语言课的说明「${course?.blurb ?? ''}」：应该说本赛区照常来、外赛区另外多来`)
  else pass(`语言课：「${course.blurb}」`)
  if (/会外语的多一些/.test(help) || !/LANG_EXTRA/.test(help)) fail('帮助「俱乐部怎么注意到你」还是旧说法，或者几成没从 LANG_EXTRA 读')
  else pass('帮助「俱乐部怎么注意到你」：本赛区照常来，外赛区另外多来的几成从 LANG_EXTRA 读')
}

console.log(fails ? `\n✗ ${fails} 项不对。` : `\n✓ 外语只加不减：本赛区的试训邀请和报价和不会外语时一份不少，外赛区的另外多来，一次最多一家。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
