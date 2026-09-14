/**
 * 外语 and who calls. Reported 2026-09-14: a player who took the language by accident has had every tryout
 * invitation from another region since; no club of his own region asks any more. The author's rule:
 * 「外语学习只是优势，即使会外语国内的俱乐部也应该要来邀请」.
 *
 *   npx tsx scripts/probe_lang.ts [seeds=2] [years=3] [draws=120]
 *
 * 一 careers from the ladder, the same seed with and without the language: invitations and offers by region
 * 二 in the no-language career, at every third week the invitation channel is open: the same draws of
 *    rollInvites with the language off and on, and the pool the draw is made from
 * 三 careers from a club, the same way, with rollOffers' draws (a listed round) at open windows
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { INVITE_FANS, INVITE_LADDER, cupInvite, expectOf, reachableClubs, rollInvites, tryoutSkill } from '../src/engine/me/prepro'
import { rollOffers } from '../src/engine/me/transfer'
import { clubOpen, inviteBlock, moveBlock, windowAt } from '../src/engine/me/window'
import { formatOf, regionIn } from '../src/engine/era'
import { Rng, hashStr } from '../src/engine/rng'
import type { GameState, Region, Team } from '../src/engine/types'

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

const SEEDS = [11, 23, 37, 41, 53, 67].slice(0, Number(process.argv[2] ?? 2))
const YEARS = Number(process.argv[3] ?? 3)
const DRAWS = Number(process.argv[4] ?? 120)
const t0 = Date.now()
const secs = (): string => `${((Date.now() - t0) / 1000).toFixed(0)} 秒`

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

/** me/transfer.ts foreignLeague, read the same way */
function foreignLeague(s: GameState, t: Team): boolean {
  const league = regionIn(t.region, s.year)
  const mine = s.teams[s.myTeam]
  if (mine && regionIn(mine.region, s.year) === league) return false
  return regionIn(s.me!.region, s.year) !== league
}

const named = (s: GameState, name: string): Team | undefined => Object.values(s.teams).find((t) => t.name === name)

interface Tally { invDom: number; invFor: number; offDom: number; offFor: number; unknown: number }
const tally = (): Tally => ({ invDom: 0, invFor: 0, offDom: 0, offFor: 0, unknown: 0 })

const INV = /^(.+?) 的人也?(?:看了你的杯赛|在天梯上注意到你|看了你的直播|知道你在找队|教练组推荐)[，：]/
const VCT_INV = /^转会窗：(.+?)（[^）]*） 的教练组看过你这个赛季的比赛，想请你去试训/
const OFFER = /^转会窗：(.+?)（[^）]*）(（外赛区）)? 开价了/
const VCT_OFFER = /^转会窗：(.+?)（[^）]*） 来找你/
const RUT = /^(?:你的俱乐部今年没有联赛可打。)?(.+?)（[^）]*）来问了：那边给首发/
const STORY = /^外区邀约：转会窗开了，(.+?) 按之前谈的开出了报价/

/** invitations by the region field pickClub weighs (me/prepro.ts); offers by league, as the offer's own line says */
function scan(s: GameState, lines: { text: string }[], t: Tally): void {
  const me = s.me!
  for (const l of lines) {
    const inv = INV.exec(l.text) ?? VCT_INV.exec(l.text)
    if (inv) {
      const team = named(s, inv[1])
      if (!team) t.unknown++
      else if (team.region === me.region) t.invDom++
      else t.invFor++
      continue
    }
    const off = OFFER.exec(l.text)
    if (off) { if (off[2]) t.offFor++; else t.offDom++; continue }
    if (VCT_OFFER.test(l.text)) { t.offDom++; continue }
    if (STORY.test(l.text)) { t.offFor++; continue }
    const rut = RUT.exec(l.text)
    if (rut) {
      const team = named(s, rut[1])
      if (!team) t.unknown++
      else if (foreignLeague(s, team)) t.offFor++
      else t.offDom++
    }
  }
}

interface Draws { dom: number; for: number; none: number }
const draws = (): Draws => ({ dom: 0, for: 0, none: 0 })
interface Acc {
  off: Tally; on: Tally
  invOff: Draws; invOn: Draws; cupOff: Draws; cupOn: Draws; offerOff: Draws; offerOn: Draws
  inviteMoments: number; offerMoments: number
  poolDom: number; poolFor: number; wDomOff: number; wForOff: number; wForOn: number
  /** home-region invitations the language took away from the same draw, or added to it */
  homeLost: number; homeGained: number
}
const acc = (): Acc => ({
  off: tally(), on: tally(), invOff: draws(), invOn: draws(), cupOff: draws(), cupOn: draws(), offerOff: draws(), offerOn: draws(),
  inviteMoments: 0, offerMoments: 0, poolDom: 0, poolFor: 0, wDomOff: 0, wForOff: 0, wForOn: 0, homeLost: 0, homeGained: 0,
})

/** pickClub's weights, off and on, for the pool as it stands (me/prepro.ts) — for reading the draw, not deciding it */
function poolRead(s: GameState, a: Acc): void {
  const me = s.me!
  const pool = reachableClubs(s).filter((t) => !me.pre.invites.some((i) => i.teamId === t.id) && clubOpen(s, t.id))
  const skill = tryoutSkill(s)
  const open = formatOf(s.year) === 'open'
  for (const t of pool) {
    const v = 10 + Math.max(0, skill - expectOf(t)) * 2
    if (t.region === me.region) { a.poolDom++; a.wDomOff += v } else {
      a.poolFor++
      a.wForOff += v * (open ? 0.5 : 0.04)
      // the same with the language since 2026-09-14; before, 0.8 / 0.2
      a.wForOn += v * (open ? 0.5 : 0.04)
    }
  }
}

/**
 * The same draws of the invitation channels with the language off and on, and the state put back: the weekly
 * channel (rollInvites) where the ladder or the following opens it, and a cup run's end (cupInvite) — won, which
 * asks any tier, or deep, which asks Challengers first — which calls nearly every time and so gives the draw.
 */
function drawInvites(s: GameState, seed: number, a: Acc): void {
  const me = s.me!
  if ((me.phase !== 'pre' && me.phase !== 'free') || me.pre.invites.length || me.tryout || inviteBlock(s)) return
  const weekly = me.pre.ladder >= INVITE_LADDER || me.fans >= INVITE_FANS || me.pre.wasPro
  a.inviteMoments++
  poolRead(s, a)
  const snap = { pending: me.pending.slice(), log: me.log.slice(), flags: { ...me.flags }, courses: me.courses.slice(), scout: me.pre.scoutSeen }
  const restore = (): void => {
    me.pre.invites = []
    me.pending = snap.pending.slice()
    me.log = snap.log.slice()
    me.flags = { ...snap.flags }
    me.courses = snap.courses.slice()
    me.pre.scoutSeen = snap.scout
  }
  const pair = (tag: string, i: number, off: Draws, onD: Draws, call: (rng: Rng) => void): void => {
    const got: Team[][] = []
    for (const on of [false, true]) {
      restore()
      setLang(s, on)
      call(new Rng(hashStr(`probe:lang:${tag}:${seed}:${s.year}:${s.day}:${i}`)))
      const ts = me.pre.invites.map((inv) => s.teams[inv.teamId]).filter((t): t is Team => !!t)
      got.push(ts)
      const d = on ? onD : off
      if (!ts.length) d.none++
      for (const t of ts) { if (t.region === me.region) d.dom++; else d.for++ }
    }
    const home = (ts: Team[]): number => ts.filter((t) => t.region === me.region).length
    const [x, y] = got
    if (home(y) < home(x)) a.homeLost += home(x) - home(y)
    if (home(y) > home(x)) a.homeGained += home(y) - home(x)
  }
  for (let i = 0; i < DRAWS; i++) {
    if (weekly) pair('inv', i, a.invOff, a.invOn, (rng) => rollInvites(s, rng))
    pair('cup', i, a.cupOff, a.cupOn, (rng) => cupInvite(s, { key: 'probe', year: s.year, reached: 3, rounds: 3, won: i % 2 === 0, prize: 0 }, rng))
  }
  restore()
}

/** The same listed round of offers with the language off and on, and the state put back. */
function drawOffers(s: GameState, seed: number, a: Acc): void {
  const me = s.me!
  if (me.phase !== 'pro' || me.moveAfter || moveBlock(s) || !windowAt(s).open) return
  a.offerMoments++
  const snap = { deals: me.deals.slice(), pending: me.pending.slice(), intents: me.intents.slice(), flags: { ...me.flags }, courses: me.courses.slice(), log: me.log.slice() }
  const restore = (): void => {
    me.deals = snap.deals.slice()
    me.pending = snap.pending.slice()
    me.intents = snap.intents.slice()
    me.flags = { ...snap.flags }
    me.courses = snap.courses.slice()
    me.log = snap.log.slice()
  }
  for (let i = 0; i < DRAWS; i++) {
    for (const on of [false, true]) {
      restore()
      setLang(s, on)
      rollOffers(s, new Rng(hashStr(`probe:lang:off:${seed}:${s.year}:${s.day}:${i}`)), true, 1)
      const d = on ? a.offerOn : a.offerOff
      const fresh = me.deals.slice(snap.deals.length)
      if (!fresh.length) d.none++
      for (const deal of fresh) {
        const t = s.teams[deal.teamId]
        if (t && foreignLeague(s, t)) d.for++
        else d.dom++
      }
    }
  }
  restore()
}

function run(region: Region, year: 2021 | 2026, start: StartPoint, a: Acc): string {
  let where = ''
  for (const seed of SEEDS) {
    for (const on of [false, true]) {
      const s = createCareer({ name: 'Lang', region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed, year })
      setLang(s, on)
      const me = s.me!
      where = me.region
      const t = on ? a.on : a.off
      let weeks = 0
      while (s.year < year + YEARS && me.phase !== 'retired' && weeks++ < YEARS * 60) {
        const last = me.log[me.log.length - 1]
        if (autoWeek(s).kind === 'game-over') break
        scan(s, me.log.slice(last ? me.log.lastIndexOf(last) + 1 : 0), t)
        // the controlled draws on the no-language career only: it is the baseline both variants are read against
        if (!on && weeks % 3 === 0) { drawInvites(s, seed, a); drawOffers(s, seed, a) }
      }
    }
  }
  return where
}

const pct = (x: number, n: number): string => (n ? `${Math.round((x / n) * 100)}%` : '—')
function report(label: string, a: Acc): void {
  console.log(`\n${label}（${SEEDS.length} 档 × ${YEARS} 年，每档有外语/没外语各一条）· ${secs()}`)
  for (const [k, t] of [['没外语', a.off], ['有外语', a.on]] as const) {
    const inv = t.invDom + t.invFor
    const off = t.offDom + t.offFor
    console.log(`  ${k}：试训邀请 ${inv}（本赛区 ${t.invDom} · 外赛区 ${t.invFor}，外 ${pct(t.invFor, inv)}）· 报价 ${off}（本赛区 ${t.offDom} · 外赛区 ${t.offFor}）${t.unknown ? ` · 认不出 ${t.unknown}` : ''}`)
  }
  if (a.inviteMoments) {
    const m = a.inviteMoments
    console.log(`  同一时刻同样的抽签（邀请）：${m} 个时刻 × ${DRAWS} 次`)
    console.log(`    可去试训的俱乐部平均：本赛区 ${(a.poolDom / m).toFixed(1)} 家 · 外赛区 ${(a.poolFor / m).toFixed(1)} 家；权重和 本赛区 ${(a.wDomOff / m).toFixed(0)} · 外赛区 没外语 ${(a.wForOff / m).toFixed(0)} / 有外语 ${(a.wForOn / m).toFixed(0)}`)
    for (const [k, d] of [['天梯/粉丝 没外语', a.invOff], ['天梯/粉丝 有外语', a.invOn], ['杯赛 没外语', a.cupOff], ['杯赛 有外语', a.cupOn]] as const) {
      const n = d.dom + d.for
      console.log(`    ${k}：邀请 ${n}（本赛区 ${d.dom} · 外赛区 ${d.for}，外 ${pct(d.for, n)}）`)
    }
    console.log(`    同样的抽签，学了外语本赛区邀请少了 ${a.homeLost} 份，多了 ${a.homeGained} 份`)
  }
  if (a.offerMoments) {
    console.log(`  同一时刻同样的抽签（挂牌那一轮报价）：${a.offerMoments} 个时刻 × ${DRAWS} 次`)
    for (const [k, d] of [['没外语', a.offerOff], ['有外语', a.offerOn]] as const) {
      const n = d.dom + d.for
      console.log(`    ${k}：报价 ${n}（本赛区 ${d.dom} · 外赛区 ${d.for}，外 ${pct(d.for, n)}）`)
    }
  }
}

const LADDER: [Region, 2021 | 2026][] = [['China', 2021], ['China', 2026], ['Europe', 2021], ['North America', 2026]]
const CLUB: [Region, 2021 | 2026, StartPoint][] = [['North America', 2021, 'chal'], ['China', 2026, 't1'], ['Europe', 2021, 't1'], ['Pacific', 2026, 'chal']]
const only = process.argv[5]

if (only !== 'club') {
  console.log('一、二 天梯开局')
  for (const [region, year] of LADDER) {
    const a = acc()
    const where = run(region, year, 'pre', a)
    report(`${year} ${where} 天梯开局`, a)
  }
}
if (only !== 'ladder') {
  console.log('\n三 俱乐部开局')
  for (const [region, year, start] of CLUB) {
    const a = acc()
    const where = run(region, year, start, a)
    report(`${year} ${where} ${start === 't1' ? '一线队' : 'Challengers'}开局`, a)
  }
}
console.log(`\n共 ${secs()}`)
