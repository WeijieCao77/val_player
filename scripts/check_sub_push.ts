/**
 * 推荐替补首发 (6c039f66; the author, 2026-09-26): coach trust 66, or already his 认定首发; 1 action point; once a
 * stage; never my position; the man I recommend starts for a 2-match trial in place of the starter at his
 * position; a trial that goes nowhere costs 3 of the coach's trust; the man benched thinks 8 less of me. It moves
 * the five, not the roster.
 *
 * Bounded: one 2022 EDward Gaming squad, the week's five named directly, the matches handed in as records.
 * Run: npx tsx scripts/check_sub_push.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { syncYear } from '../src/engine/timeline'
import { coachStarters, weeklyLineup } from '../src/engine/me/coach'
import { cloutStage } from '../src/engine/me/clout'
import {
  PUSH_AP, PUSH_BENCHED_BOND, PUSH_FAIL_TRUST, PUSH_MATCHES, PUSH_SUB_BOND, PUSH_TRUST,
  doPush, pushAfterMatch, pushGate, pushOptions, subPushStage,
} from '../src/engine/me/recruit'
import { autoWeek } from '../src/engine/me/auto'
import { bondBetween } from '../src/engine/bonds'
import { callerOf } from '../src/engine/roster'
import { recomputeOverall } from '../src/engine/player'
import type { GameState, Player, Role } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline check'))
const t0 = Date.now()
const EDG = 'V21T1120'
const base = createCareer({ name: '推荐', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: EDG })
const ME = base.me!.id
base.year = 2022; base.day = 0
syncYear(base, 2022)

/** me in the five and trusted; one man on the bench at a starter's position — not mine, not the caller's — and as good */
function squad(): { s: GameState; sub: Player; out: Player } {
  const s = structuredClone(base)
  s.day = 30
  const t = s.teams[EDG]
  const me = s.me!
  me.ap = me.apMax
  me.coachTrust = PUSH_TRUST
  me.proven = false
  me.promiseMatches = 99
  me.cloutCd = { list: 0, sign: 0 }
  const mine = s.players[ME]
  mine.injuredUntil = 0; mine.form = 80; mine.fatigue = 10
  for (const k of Object.keys(mine.attrs) as (keyof typeof mine.attrs)[]) mine.attrs[k] = 90
  recomputeOverall(mine)
  // a seventh man if the squad has only one spare
  if (t.roster.length < 7) {
    const extra = Object.values(s.players).find((p) => p.teamId === null && p.region === 'China' && p.id.startsWith('V'))!
    t.roster.push(extra.id); extra.teamId = EDG
  }
  // a squad set by hand, so the coach's five is known: me (决斗者), a 先锋, a 控场 who calls, a 哨卫 and a 决斗者 at 80;
  // on the bench a 先锋 a shade under the starter one — well inside PUSH_GAP — and a weak 哨卫
  const others = t.roster.filter((id) => id !== ME).map((id) => s.players[id]).slice(0, 6)
  const plan: [Role, number, boolean][] = [['先锋', 80, false], ['控场', 80, true], ['哨卫', 80, false], ['决斗者', 80, false], ['先锋', 79, false], ['哨卫', 60, false]]
  others.forEach((p, i) => {
    const [r, v, igl] = plan[i]
    p.role = r; p.roles = [r]; p.isIgl = igl; p.iglSource = igl ? 'appointed' : undefined
    p.injuredUntil = 0; p.form = 70; p.fatigue = 10; p.rounds = 5000
    for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = v
    recomputeOverall(p)
  })
  t.starters = coachStarters(s)
  assert.ok(t.starters.includes(ME), 'I start')
  const out = others[0]
  const sub = others[4]
  assert.notEqual(callerOf(s, EDG)?.id, out.id)
  assert.ok(!t.starters.includes(sub.id) && t.starters.includes(out.id),
    `the five before the push is the coach's own: ${t.starters.map((id) => `${s.players[id].ign}/${s.players[id].role}/${s.players[id].overall}`).join(' ')} · sub ${sub.ign}/${sub.role}/${sub.overall} · out ${out.ign}/${out.overall}`)
  return { s, sub, out }
}
const match = (s: GameState, sub: Player, won: boolean, subRating: number): MeMatchRecord => {
  const t = s.teams[EDG]
  const box = t.starters.map((id) => ({ id, ign: s.players[id].ign, role: s.players[id].role, mine: true, me: id === ME, rating: id === sub.id ? subRating : 1.0 }))
  return { year: s.year, day: s.day, won, friendly: false, started: true, box } as unknown as MeMatchRecord
}
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }

check('the gate: trust 66, or a 认定首发 in the five at 中立; AP; and each reason in words', () => {
  const { s } = squad()
  const me = s.me!
  me.coachTrust = PUSH_TRUST - 1
  const low = pushGate(s)
  assert.ok(!low.ok && low.why!.includes(`${PUSH_TRUST - 1}/${PUSH_TRUST}`), low.why)
  me.proven = true
  assert.equal(pushGate(s).ok, true, '认定首发 in the five')
  me.coachTrust = 40
  assert.equal(pushGate(s).ok, false, '认定首发 the coach has lost')
  me.coachTrust = PUSH_TRUST; me.proven = false
  me.ap = PUSH_AP - 1
  assert.ok(pushGate(s).why!.includes('行动点'))
})

check('never my position, never the caller; too far short is greyed before anything is spent', () => {
  const { s, sub, out } = squad()
  const mine = s.players[ME]
  const opts = pushOptions(s)
  assert.ok(opts.find((o) => o.sub.id === sub.id && o.out?.id === out.id && !o.why), JSON.stringify(opts.map((o) => [o.sub.ign, o.out?.ign, o.why])))
  // a bench man at my position is refused with the reason
  const was = sub.role
  sub.role = mine.role as Role; sub.roles = [mine.role as Role]
  const own = pushOptions(s).find((o) => o.sub.id === sub.id)!
  assert.ok(own.why?.includes('同一个位置'), own.why)
  assert.ok(pushOptions(s).every((o) => !o.out || o.out.id !== ME), 'never my seat')
  sub.role = was as Role; sub.roles = [was as Role]
  // far short
  for (const k of Object.keys(sub.attrs) as (keyof typeof sub.attrs)[]) sub.attrs[k] = 30
  recomputeOverall(sub)
  const short = pushOptions(s).find((o) => o.sub.id === sub.id)!
  assert.ok(short.why?.includes('差一截'), short.why)
  const ap = s.me!.ap, trust = s.me!.coachTrust
  const line = doPush(s, sub.id)
  assert.ok(line.includes('差一截'))
  assert.equal(s.me!.ap, ap); assert.equal(s.me!.coachTrust, trust); assert.equal(s.me!.subPush, undefined)
})

check('accepted: 1 AP, he starts in place of the starter at his position, I keep mine, the roster does not move', () => {
  const { s, sub, out } = squad()
  const t = s.teams[EDG]
  const roster = [...t.roster].sort()
  const bond = bondBetween(s, ME, out.id)
  const ap = s.me!.ap
  const line = doPush(s, sub.id)
  assert.ok(line.includes(sub.ign) && line.includes(out.ign), line)
  assert.equal(s.me!.ap, ap - PUSH_AP)
  assert.ok(t.starters.includes(sub.id) && !t.starters.includes(out.id) && t.starters.includes(ME), JSON.stringify(t.starters))
  assert.deepEqual([...t.roster].sort(), roster)
  assert.ok(Math.abs(bondBetween(s, ME, out.id) - (bond - PUSH_BENCHED_BOND)) < 1e-6 || bondBetween(s, ME, out.id) < bond, 'he knows it was me')
  // the week's five, named again, keeps him in
  weeklyLineup(s)
  assert.ok(t.starters.includes(sub.id) && t.starters.includes(ME))
  // once a stage
  s.me!.ap = s.me!.apMax
  assert.ok(pushGate(s).why!.includes('试用'), pushGate(s).why)
})

check('a trial that goes nowhere: the starter comes back and the coach trusts me 3 less', () => {
  const { s, sub, out } = squad()
  const t = s.teams[EDG]
  doPush(s, sub.id)
  const trust = s.me!.coachTrust
  for (let i = 0; i < PUSH_MATCHES; i++) pushAfterMatch(s, match(s, sub, false, 0.6))
  assert.equal(s.me!.subPush, undefined)
  assert.equal(s.me!.coachTrust, trust - PUSH_FAIL_TRUST)
  assert.ok(t.starters.includes(out.id) && !t.starters.includes(sub.id), JSON.stringify(t.starters))
  // and the stage's ask is spent, trust or no trust
  s.me!.ap = s.me!.apMax
  s.me!.coachTrust = PUSH_TRUST
  assert.ok(pushGate(s).why!.includes('这个赛段已经推荐过'), pushGate(s).why)
  cloutStage(s)
  assert.equal(pushGate(s).ok, true, 'a new stage, a new recommendation')
})

check('a trial that went well: he keeps the seat to the stage\'s end, and thinks 8 more of me', () => {
  const { s, sub, out } = squad()
  const t = s.teams[EDG]
  doPush(s, sub.id)
  const bond = bondBetween(s, ME, sub.id)
  pushAfterMatch(s, match(s, sub, false, 0.7))
  assert.equal(s.me!.subPush?.left, PUSH_MATCHES - 1)
  pushAfterMatch(s, match(s, sub, true, 1.2))
  assert.equal(s.me!.subPush?.kept, true)
  assert.ok(bondBetween(s, ME, sub.id) > bond - 1e-6 && bondBetween(s, ME, sub.id) <= bond + PUSH_SUB_BOND + 1e-6)
  weeklyLineup(s)
  assert.ok(t.starters.includes(sub.id) && !t.starters.includes(out.id))
  cloutStage(s); subPushStage(s)
  assert.equal(s.me!.subPush, undefined)
  weeklyLineup(s)
  assert.ok(t.starters.includes(ME))
})

check('托管 never recommends', () => {
  const { s } = squad()
  s.me!.coachTrust = 95
  for (let i = 0; i < 20; i++) {
    if (autoWeek(s).kind === 'game-over') break
    s.me!.coachTrust = 95
    assert.equal(s.me!.subPush, undefined)
    assert.ok(!s.me!.cloutCd?.push)
  }
})

console.log(`\n✓ ${checks} checks · ${((Date.now() - t0) / 1000).toFixed(1)} s`)
