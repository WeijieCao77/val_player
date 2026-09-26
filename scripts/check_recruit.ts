/**
 * 提议补强, 点名要人 and the world line (the author, 2026-09-26).
 *
 *  - 提议补强: manager trust 60, 2 action points, once a transfer period; never my position; nobody fitting greys
 *    the position with the reason before a point is spent; odds 0.40 + (trust − 60)/100, +0.15 in a losing
 *    season, held to 15–80%.
 *  - 点名要人 (要求签人): its gate stays 威望 66 + trust 72; nobody at my position; its cooldown says stages;
 *    a 很铁 former team-mate can be named, at +0.10.
 *  - 「类似俱乐部去挖人」: a man my ask takes from another club in a year history has the rosters for stays at my
 *    club through the next event (syncEvent) and the year's turn (syncYear → followBook); a man 提出换人 sent
 *    away is not signed back to my club; the club he left fields five again.
 *  - the manager's regard settles each stage with results and drifts back toward 50; 托管 asks for nothing.
 *
 * Bounded: the year turns and the event rosters are called directly; 托管 runs two short careers.
 * Run: npx tsx scripts/check_recruit.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { syncEvent, syncYear } from '../src/engine/timeline'
import { autoWeek } from '../src/engine/me/auto'
import {
  REINFORCE_AP, REINFORCE_GM, REINFORCE_ODDS, bringIn, doReinforce, reinforceFor, reinforceGate, reinforceOdds,
  reinforceOptions, seasonWinRate, closeFormerMate, MATE_SIGN_BONUS,
} from '../src/engine/me/recruit'
import { canSign, cloutOf, cloutStage, doList, doSign, signOdds, signTargets, SIGN_GATE } from '../src/engine/me/clout'
import { gmStage, GM_DRIFT, GM_HOME, GM_RECORD, GM_TITLE } from '../src/engine/me/gmTrust'
import { pitchOdds } from '../src/engine/me/selfpitch'
import { periodKey } from '../src/engine/me/window'
import { duoBonded, bondBetween } from '../src/engine/bonds'
import { Rng } from '../src/engine/rng'
import type { GameState, Player } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, get length() { return 0 },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline check'))

const t0 = Date.now()
const EDG = 'V21T1120'
const base = createCareer({ name: '引援', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: EDG })
const ME = base.me!.id
const turn = (s: GameState, year: number) => { s.year = year; s.day = 0; return syncYear(s, year) }
/** 2022 at EDG, a quiet day with the window open, AP to spend */
function at2022(): GameState {
  const s = structuredClone(base)
  turn(s, 2022)
  s.day = 30
  s.me!.ap = s.me!.apMax
  s.me!.gmTrust = 60
  s.teams[EDG].budget = 5_000_000
  return s
}
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }
const role = (s: GameState) => s.players[ME].role
const vlrOf = (id: string) => id.slice(1)
const clubVlr = (id: string) => id.slice(4)

check('提议补强: the gate — trust 60, AP, window, once a period — and every reason in words', () => {
  const s = at2022()
  s.me!.gmTrust = REINFORCE_GM - 1
  const low = reinforceGate(s)
  assert.equal(low.ok, false)
  assert.ok(low.why!.includes(`${REINFORCE_GM - 1}/${REINFORCE_GM}`), low.why)
  s.me!.gmTrust = REINFORCE_GM
  assert.equal(reinforceGate(s).ok, true, reinforceGate(s).why)
  s.me!.ap = REINFORCE_AP - 1
  assert.ok(reinforceGate(s).why!.includes('行动点'))
  s.me!.ap = s.me!.apMax
  s.me!.reinforceAsked = periodKey(s.year, s.day)
  const asked = reinforceGate(s)
  assert.ok(asked.why!.includes('这个转会期已经提过'), asked.why)
  s.day = 200 // the next transfer period
  assert.equal(reinforceGate(s).ok, true, 'a new period, a new ask')
  // no 威望 gate: a rookie's clout is far under 点名要人's and 提议补强 is open to him
  assert.ok(cloutOf(s) < SIGN_GATE.clout)
})

check('nobody at my own position — 提议补强, 点名要人\'s list, and 点名要人 by id', () => {
  const s = at2022()
  const mine = reinforceFor(s, role(s))
  assert.ok(!mine.pick && mine.why!.includes('自己的位置'), mine.why)
  assert.equal(reinforceOptions(s).filter((o) => o.role === role(s)).every((o) => !!o.why), true)
  s.me!.gmTrust = 95
  s.me!.titles = Array.from({ length: 6 }, (_, i) => ({ year: 2021, title: `${2015 + i} 全球冠军赛`, started: true }))
  s.me!.cloutCd = { list: 0, sign: 0 }
  assert.ok(cloutOf(s) >= SIGN_GATE.clout, `clout ${cloutOf(s)}`)
  assert.equal(canSign(s).ok, true, canSign(s).why)
  const list = signTargets(s)
  assert.ok(list.length > 0)
  assert.ok(list.every((t) => t.role !== role(s)), JSON.stringify(list.map((t) => t.role)))
  const rival = Object.values(s.players).find((p) => p.teamId && p.teamId !== EDG && p.role === role(s))!
  const before = s.teams[EDG].roster.length
  assert.ok(doSign(s, rival.id).includes('同一个位置'))
  assert.equal(s.teams[EDG].roster.length, before)
})

check('odds: 0.40 + (trust − 60)/100, +0.15 when the season is under 45%, held to 15–80%', () => {
  const s = at2022()
  s.me!.matches = []
  s.me!.gmTrust = 60
  assert.equal(seasonWinRate(s), null)
  assert.equal(reinforceOdds(s), 0.40)
  const rec = (won: boolean): MeMatchRecord => ({ year: s.year, day: 10, won, friendly: false } as unknown as MeMatchRecord)
  s.me!.matches = [rec(true), rec(false), rec(false), rec(false)]
  assert.equal(seasonWinRate(s), 0.25)
  assert.ok(Math.abs(reinforceOdds(s) - 0.55) < 1e-9, String(reinforceOdds(s)))
  for (const gm of [0, 30, 60, 72, 90, 100]) {
    for (const losing of [false, true]) {
      s.me!.gmTrust = gm
      s.me!.matches = losing ? [rec(false), rec(false), rec(false)] : [rec(true), rec(true), rec(true)]
      const p = reinforceOdds(s)
      assert.ok(p >= REINFORCE_ODDS.min && p <= REINFORCE_ODDS.max, `${gm} ${losing} ${p}`)
    }
  }
})

check('nobody fitting: every position greyed with its reason, and asking spends nothing', () => {
  const s = at2022()
  s.teams[EDG].budget = 0
  const opts = reinforceOptions(s)
  assert.ok(opts.every((o) => !o.pick && !!o.why), JSON.stringify(opts.map((o) => o.why)))
  assert.ok(opts.filter((o) => o.role !== role(s)).every((o) => o.why!.includes('预算')), JSON.stringify(opts.map((o) => o.why)))
  const ap = s.me!.ap, gm = s.me!.gmTrust
  const other = opts.find((o) => o.role !== role(s))!.role
  const line = doReinforce(s, other)
  assert.ok(line.includes('预算'), line)
  assert.equal(s.me!.ap, ap)
  assert.equal(s.me!.gmTrust, gm)
  assert.equal(s.me!.reinforceAsked, undefined)
  // and a bar nobody clears: the club's starter at the position far above everyone
  const t = at2022()
  const at = reinforceOptions(t).find((o) => o.role !== role(t) && o.pick)!
  for (const id of t.teams[EDG].starters) {
    const p = t.players[id]
    if (p.id !== ME && (p.roles ?? [p.role]).includes(at.role)) p.overall = 120
  }
  const why = reinforceFor(t, at.role).why
  assert.ok(why && why.includes('强一截'), why)
})

check('提议补强 end to end: a no costs 2 AP and 2 trust; a yes signs, pays, pins, and says who and from where', () => {
  let yes: GameState | null = null
  let no: GameState | null = null
  for (let d = 20; d < 120 && (!yes || !no); d++) {
    const s = at2022()
    s.day = d
    s.me!.gmTrust = 70
    const opt = reinforceOptions(s).find((o) => o.pick)
    if (!opt) continue
    const budget = s.teams[EDG].budget
    const ap = s.me!.ap
    const line = doReinforce(s, opt.role)
    assert.equal(s.me!.ap, ap - REINFORCE_AP)
    assert.equal(s.me!.reinforceAsked, periodKey(s.year, s.day))
    if (s.players[opt.pick!.id].teamId === EDG) {
      if (yes) continue
      yes = s
      assert.ok(line.includes(opt.pick!.ign) && line.includes(opt.role), line)
      assert.ok(s.me!.pinned!.ids.includes(opt.pick!.id))
      if (opt.fee) assert.ok(s.teams[EDG].budget <= budget - opt.fee, 'the fee is paid')
      assert.equal(s.me!.gmTrust, 70)
      console.log(`   yes: ${line}`)
    } else {
      if (no) continue
      no = s
      assert.equal(s.me!.gmTrust, 68)
      assert.ok(line.includes('自荐') && line.includes('挂牌'), line)
    }
  }
  assert.ok(yes && no, 'both outcomes seen')
})

check('poaching in a book year: pinned through the next event and the year\'s turn; the club he left fields five', () => {
  const s = at2022()
  const t = s.teams[EDG]
  const target = Object.values(s.players).find((p) => p.teamId?.startsWith('V21T') && p.teamId !== EDG && p.role !== role(s)
    && p.region === 'China' && s.teams[p.teamId].tier >= t.tier && s.teams[p.teamId].roster.length >= 5)!
  const from = s.teams[target.teamId!]
  const fromRoster = [...from.roster]
  const moved = bringIn(s, target, t, new Rng(1))
  assert.ok(moved.ok, JSON.stringify(moved))
  assert.equal(target.teamId, EDG)
  assert.ok(from.roster.length >= 5, `the club he left has ${from.roster.length}`)
  // his old club's event roster still lists him: it does not get him back
  syncEvent(s, { [clubVlr(from.id)]: fromRoster.map(vlrOf), [clubVlr(EDG)]: t.roster.filter((x) => x !== ME && x !== target.id).map(vlrOf) })
  assert.equal(target.teamId, EDG, 'an event roster does not take him back')
  // and the year turns: the book's EDG does not have him; he stays anyway
  turn(s, 2023)
  assert.equal(target.teamId, EDG, 'the year\'s turn does not let him go')
  assert.ok(t.roster.includes(ME))
  assert.ok(t.roster.length <= 8)
})

check('提出换人 in a book year: the man sent away is not signed back by history', () => {
  const s = at2022()
  const t = s.teams[EDG]
  s.me!.titles = Array.from({ length: 6 }, (_, i) => ({ year: 2021, title: `${2015 + i} 全球冠军赛`, started: true }))
  s.me!.coachTrust = 95
  let gone: Player | undefined
  for (let d = 30; d < 200 && !gone; d++) {
    s.day = d
    s.me!.cloutCd = { list: 0, sign: 0 }
    s.me!.coachTrust = 95
    if (t.roster.length < 6) break
    const mate = t.roster.map((id) => s.players[id]).filter((p) => p.id !== ME).sort((a, b) => a.overall - b.overall)[0]
    doList(s, mate.id)
    if (mate.teamId !== EDG) gone = mate
  }
  assert.ok(gone, 'a request went through')
  assert.ok(s.me!.pinned!.out.includes(gone!.id))
  syncEvent(s, { [clubVlr(EDG)]: [...t.roster.filter((x) => x !== ME), gone!.id].map(vlrOf) })
  assert.notEqual(gone!.teamId, EDG, 'the next event does not bring him back')
})

check('点名要人: the gate is unchanged, the cooldown says stages, and a 很铁 former team-mate is on the list at +0.10', () => {
  const s = at2022()
  s.me!.gmTrust = SIGN_GATE.gm - 1
  s.me!.titles = Array.from({ length: 6 }, (_, i) => ({ year: 2021, title: `${2015 + i} 全球冠军赛`, started: true }))
  assert.ok(canSign(s).why!.includes(`${SIGN_GATE.gm - 1}/${SIGN_GATE.gm}`))
  s.me!.gmTrust = SIGN_GATE.gm
  s.me!.cloutCd = { list: 0, sign: 4 }
  const cd = canSign(s).why!
  assert.ok(cd.includes('4 个赛段') && !cd.includes('本赛季'), cd)
  for (let i = 0; i < 4; i++) cloutStage(s)
  assert.equal(canSign(s).ok, true)
  // a former team-mate, now elsewhere, at a level the band would not reach
  const mate = Object.values(s.players).find((p) => p.teamId && p.teamId !== EDG && p.role !== role(s) && p.overall < 50 && s.teams[p.teamId].tier >= s.teams[EDG].tier)
    ?? Object.values(s.players).find((p) => p.teamId && p.teamId !== EDG && p.role !== role(s))!
  s.me!.mates ??= {}
  s.me!.mates[mate.id] = { id: mate.id, ign: mate.ign, role: mate.role, firstYear: 2021, lastYear: 2021, titles: [], roles: {} } as never
  const cold = signOdds(s, mate)
  duoBonded(s, ME, mate.id, 60 - bondBetween(s, ME, mate.id))
  assert.ok(bondBetween(s, ME, mate.id) >= 45)
  assert.ok(closeFormerMate(s, mate.id))
  const warm = signOdds(s, mate)
  assert.ok(Math.abs(warm - Math.min(0.82, cold + MATE_SIGN_BONUS)) < 1e-9 || warm === 0.82, `${cold} → ${warm}`)
  const row = signTargets(s).find((x) => x.id === mate.id)
  assert.ok(row?.mate, 'on the list, marked 老队友')
  // and a 自荐 to his club reads him as a word put in
  s.me!.phase = 'pro'
  const odds = pitchOdds(s, s.teams[mate.teamId!])
  assert.ok(odds.parts.some((x) => x.key === 'mate' && x.label.includes(mate.ign)), JSON.stringify(odds.parts))
})

check('manager trust settles each stage with results and drifts back toward 50', () => {
  const s = at2022()
  const me = s.me!
  me.fans = 1400
  me.gmTrust = 80
  me.gmBook = { year: s.year, day: 1, seen: me.titles.length }
  me.matches = []
  gmStage(s)
  assert.equal(me.gmTrust, Math.round(80 + (GM_HOME - 80) * GM_DRIFT), 'a quiet stage drifts back')
  const rec = (won: boolean, day: number): MeMatchRecord => ({ year: s.year, day, won, friendly: false } as unknown as MeMatchRecord)
  s.day = 80
  me.gmTrust = 50
  me.matches = [rec(true, 40), rec(true, 41), rec(true, 42), rec(false, 43)]
  me.titles.push({ year: s.year, title: '东京大师赛', started: true })
  const expect = Math.round(50 + GM_TITLE.intl + (0.75 - 0.5) * GM_RECORD)
  gmStage(s)
  assert.equal(me.gmTrust, expect, `${me.gmTrust} vs ${expect}`)
  assert.ok(me.weekNotes.some((n) => n.includes('经理看了上个赛段')))
  // the same matches and the same title are not counted twice
  s.day = 120
  gmStage(s)
  assert.equal(me.gmTrust, Math.round(expect + (GM_HOME - expect) * GM_DRIFT))
  // a losing stage costs
  s.day = 160
  me.gmTrust = 50
  me.matches.push(rec(false, 130), rec(false, 131), rec(false, 132), rec(false, 133))
  gmStage(s)
  assert.equal(me.gmTrust, 44)
})

check('托管 never asks, and the manager\'s regard moves over a season it plays', () => {
  for (const [year, seed, region] of [[2021, 3, 'China'], [2026, 11, 'Europe']] as const) {
    const s = createCareer({ name: '托管', region, role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed, year })
    s.me!.gmTrust = 100
    s.me!.coachTrust = 100
    const seen = new Set<number>()
    for (let i = 0; i < 40; i++) {
      if (autoWeek(s).kind === 'game-over') break
      seen.add(Math.round(s.me!.gmTrust))
      s.me!.coachTrust = Math.max(s.me!.coachTrust, 90)
      s.me!.gmTrust = Math.max(s.me!.gmTrust, 90)
      assert.equal(s.me!.reinforceAsked, undefined, '托管 made a 提议补强')
      assert.equal(s.me!.subPush, undefined, '托管 made a 推荐替补首发')
      assert.ok(!s.me!.cloutCd?.push, '托管 made a 推荐替补首发')
      assert.ok(!s.me!.pinned?.ids.length && !s.me!.pinned?.out.length, '托管 moved a man')
      assert.ok(!s.me!.cloutCd?.sign && !s.me!.cloutCd?.list, '托管 used 话语权')
    }
    assert.ok(seen.size > 1, `${year}: the regard never moved (${[...seen]})`)
    console.log(`   ${year}: manager trust over 40 weeks took ${seen.size} values`)
  }
})

console.log(`\n✓ ${checks} checks · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
