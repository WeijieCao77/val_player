/**
 * The player's club follows history: public feedback 47eadfcf, f12ac3f3, 23c5b08a 「24年life还在edg」,
 * 535927c8 (2026-09-21..23).
 *
 * Joined in 2021, EDward Gaming used to keep its 2021 roster through 2022 and 2023 — timeline.ts left the
 * player's club and everyone on it out of history — while the book had Life joining Attacking Soul Esports
 * and Smoggy arriving in 2023. Now the club's real signings and departures happen at their dates, the
 * player stays as one more man on the roster, and only an eighth man makes the weakest bench seat go.
 *
 * Bounded and synthetic: the year turns and an event's roster call are made directly, no season sim.
 * Run: npx tsx scripts/check_club_history.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { historyKeeps, reachOf, syncEvent, syncYear } from '../src/engine/timeline'
import { clubWindow, clubWinter } from '../src/engine/me/club'
import { coachStarters, weeklyLineup, outplayedBy, ROTATE_EVERY, ROTATE_EVERY_TRUSTED, ROTATE_FATIGUE } from '../src/engine/me/coach'
import { recomputeOverall } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

globalThis.fetch = () => Promise.reject(new Error('offline check'))
const EDG = 'V21T1120'
const ASE = 'V21T1837'
const LIFE = 'V3028'
const base = createCareer({ name: '历史', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 7, year: 2021, teamId: EDG })
const me = base.me!.id
assert.equal(base.myTeam, EDG)
const igns = (s: GameState, id = EDG) => s.teams[id].roster.filter((x) => x !== me).map((x) => s.players[x]?.ign).sort()
const turn = (s: GameState, year: number) => { s.year = year; s.day = 0; return syncYear(s, year) }
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }

check('2022: EDG opens with its real roster, the player on it as one more', () => {
  const s = structuredClone(base)
  const t = s.teams[EDG]
  t.starters = [me, ...t.starters.filter((x) => x !== me).slice(0, 4)]
  assert.ok(igns(s).includes('York'), 'the 2021 roster the world opened with')
  turn(s, 2022)
  assert.deepEqual(igns(s), ['CHICHOO', 'Haodong', 'Life', 'ZmjjKK', 'nobody'].sort())
  assert.ok(t.roster.includes(me) && s.players[me].teamId === EDG)
  assert.equal(t.starters.length, 5)
  assert.ok(t.starters.includes(me), 'history does not take the player\'s own place in the five')
  assert.ok(t.starters.every((x) => t.roster.includes(x)))
  assert.ok(s.news.some((n) => n.year === 2022 && n.text.startsWith('📜 EDward Gaming 按真实历史调整阵容') && n.text.includes('York')))
})
check('2023: Life leaves for Attacking Soul Esports and Smoggy arrives, at the real turn', () => {
  const s = structuredClone(base)
  turn(s, 2022)
  assert.equal(s.players[LIFE].teamId, EDG)
  turn(s, 2023)
  assert.equal(s.players[LIFE].teamId, ASE, 'Life goes where history took him')
  assert.deepEqual(igns(s), ['CHICHOO', 'Haodong', 'Smoggy', 'ZmjjKK', 'nobody'].sort())
  assert.ok(s.teams[EDG].roster.includes(me))
  assert.ok(s.news.some((n) => n.year === 2023 && n.text.includes("Life（去了 Attacking Soul Esports）")), JSON.stringify(s.news.filter((n) => n.text.startsWith("📜 EDward"))))
  // the season's real rosters are the club's moves: it makes none of its own
  assert.equal(historyKeeps(s, EDG), true)
})
check('a team-mate is rated off the year\'s real numbers like everyone else; the player is not', () => {
  const s = structuredClone(base)
  const mine = s.players[me]
  const was = { ...mine.attrs }
  s.players[LIFE].attrs.aim = 20
  turn(s, 2022)
  assert.ok(s.players[LIFE].attrs.aim > 20)
  assert.deepEqual(mine.attrs, was)
})
check('an event roster: history\'s signing arrives; an eighth man sends the weakest bench seat, never the player', () => {
  const s = structuredClone(base)
  turn(s, 2022)
  const t = s.teams[EDG]
  // two of history's and the player make eight with a signing of the book's
  const extra = Object.values(s.players).filter((p) => p.teamId === null && p.id.startsWith('V') && p.region === 'China').slice(0, 3)
  assert.equal(extra.length, 3)
  const bookIds = [...t.roster.filter((x) => x !== me), ...extra.map((p) => p.id)].map((x) => x.slice(1))
  syncEvent(s, { 1120: bookIds })
  assert.equal(t.roster.length, 7, `roster ${t.roster.length}`)
  assert.ok(t.roster.includes(me))
  assert.equal(t.starters.length, 5)
  assert.ok(t.starters.every((x) => t.roster.includes(x)))
})
// Refined 2026-09-24 by the author: 「进去队伍之后……同位置的引援就作为替补然后轮换，其他位置的引援就照历史执行」.
/** 2022 at EDG with me in the five, one of history's signings made my position's (the rival) and another a strong one elsewhere */
function held() {
  const s = structuredClone(base)
  const t = s.teams[EDG]
  const mine = s.players[me]
  t.starters = [me, ...t.starters.filter((x) => x !== me).slice(0, 4)]
  turn(s, 2022)
  const a = s.me!.historyArrivals!
  assert.equal(a.club, EDG)
  const rival = s.players['V3017']
  const other = Object.values(s.players).find((p) => p.ign === 'ZmjjKK')!
  assert.ok(a.ids.includes(rival.id) && a.ids.includes(other.id), JSON.stringify(a.ids))
  rival.role = mine.role; rival.roles = [mine.role]; rival.isIgl = false; rival.rounds = 5000; rival.injuredUntil = 0
  for (const k of Object.keys(rival.attrs) as (keyof typeof rival.attrs)[]) rival.attrs[k] = Math.min(99, mine.attrs[k] + 4)
  recomputeOverall(rival)
  const offRole = mine.role === '控场' ? '哨卫' : '控场'
  other.role = offRole; other.roles = [offRole]; other.isIgl = false; other.rounds = 5000; other.injuredUntil = 0
  for (const k of Object.keys(other.attrs) as (keyof typeof other.attrs)[]) other.attrs[k] = 95
  recomputeOverall(other)
  mine.fatigue = 20; mine.form = 75; mine.injuredUntil = 0
  s.me!.proven = false; s.me!.coachTrust = 60; s.me!.graceMatches = 0; s.me!.trial = undefined; s.me!.benchLock = undefined
  s.me!.promiseMatches = 99
  a.seat = true; a.since = s.me!.week; a.rot = undefined
  return { s, t, a, mine, rival, other }
}
/** twelve weeks of lineups: in how many the rival starts and I do not */
function rotations(s: GameState, rival: string): number {
  let n = 0
  const w0 = s.me!.week
  for (let i = 0; i < 12; i++) {
    s.me!.week = w0 + i
    weeklyLineup(s)
    const five = s.teams[EDG].starters
    if (five.includes(rival) && !five.includes(me)) n++
  }
  s.me!.week = w0
  return n
}
check('history\'s signing at my own position still arrives, and the week says he is the 替补 who rotates', () => {
  const probe = structuredClone(base)
  turn(probe, 2022); turn(probe, 2023)
  const smoggy = Object.values(probe.players).find((p) => p.ign === 'Smoggy')!
  const s = structuredClone(base)
  s.players[me].role = smoggy.role
  const t = s.teams[EDG]
  t.starters = [me, ...t.starters.filter((x) => x !== me).slice(0, 4)]
  turn(s, 2022)
  if (!t.starters.includes(me)) t.starters = [me, ...t.starters.filter((x) => x !== me).slice(0, 4)]
  turn(s, 2023)
  const sm = Object.values(s.players).find((p) => p.ign === 'Smoggy')!
  assert.equal(sm.teamId, EDG, 'the same-position signing is made')
  assert.ok(s.news.some((n) => n.text === `📜 Smoggy 按真实历史加盟 EDward Gaming，和你打同一个位置，先作为替补轮换。`))
  assert.equal(s.me!.historyArrivals!.seat, true)
})
check('the seat yields only at my position: history\'s signing elsewhere starts as history has him', () => {
  const { s, t, mine, rival, other } = held()
  const plain = (() => { const a = s.me!.historyArrivals!; a.seat = false; const f = coachStarters(s); a.seat = true; return f })()
  assert.ok(plain.includes(rival.id) && !plain.includes(me), 'on merit alone the rival would start')
  s.me!.historyArrivals!.rot = { week: s.me!.week, sub: null, why: 'turn' }
  const five = coachStarters(s)
  assert.ok(five.includes(me) && !five.includes(rival.id), 'the man at my position takes the bench')
  assert.ok(five.includes(other.id), 'the signing at another position plays')
  assert.equal(five.length, 5)
  void t
})
check(`the 替补 at my position rotates in: one week in ${ROTATE_EVERY}, one in ${ROTATE_EVERY_TRUSTED} for 认定首发, none after a title`, () => {
  let x = held()
  assert.equal(rotations(x.s, x.rival.id), 12 / ROTATE_EVERY)
  assert.ok(x.s.me!.log.some((l) => l.text === `本周轮换：${x.rival.ign} 首发，你歇一周，首发位置还是你的。`))
  assert.equal(x.a.seat, true, 'a rotation week keeps the seat')
  x = held(); x.s.me!.proven = true; x.s.me!.coachTrust = 80
  assert.equal(rotations(x.s, x.rival.id), 12 / ROTATE_EVERY_TRUSTED)
  x = held(); x.s.me!.graceMatches = 4
  assert.equal(rotations(x.s, x.rival.id), 0)
})
check('worn out: he starts that week, whatever the schedule', () => {
  const x = held()
  x.mine.fatigue = ROTATE_FATIGUE + 5
  weeklyLineup(x.s)
  assert.ok(x.t.starters.includes(x.rival.id) && !x.t.starters.includes(me))
  assert.ok(x.s.me!.log.some((l) => l.text === `本周轮换：你太累了，${x.rival.ign} 替你首发。`))
  // every call that week names the same five, however the legs change in it
  x.mine.fatigue = 10
  assert.ok(!coachStarters(x.s).includes(me))
})
check('clearly outplayed at my position over time — on the field, from his rotation starts — he takes the seat', () => {
  const x = held()
  // a star at my position is still the 替补 on arrival: 综合 alone does not take the seat
  for (const k of Object.keys(x.rival.attrs) as (keyof typeof x.rival.attrs)[]) x.rival.attrs[k] = 99
  recomputeOverall(x.rival)
  x.s.me!.week += 1
  weeklyLineup(x.s)
  assert.ok(x.t.starters.includes(me), 'held on arrival')
  // what was played: three of my starts at 0.90, three of his rotation starts at 1.20
  const rec = (daysAgo: number, started: boolean, his: number | null) => ({
    year: x.s.year, day: x.s.day - daysAgo, started, friendly: false, won: true, rating: started ? 0.9 : 0, label: '第 1 轮', nodes: [],
    box: his == null ? [] : [{ id: x.rival.id, ign: x.rival.ign, role: x.rival.role, mine: true, me: false, k: 0, d: 0, a: 0, acs: 0, rating: his, firstKills: 0, clutches: 0 }],
  }) as unknown as MeMatchRecord
  x.s.me!.matches = [rec(40, true, null), rec(33, true, null), rec(26, true, null), rec(19, false, 1.2), rec(12, false, 1.2), rec(5, false, 1.2)]
  assert.equal(outplayedBy(x.s, x.rival), true)
  x.s.me!.week += 1
  weeklyLineup(x.s)
  assert.ok(!x.t.starters.includes(me) && x.t.starters.includes(x.rival.id))
  assert.equal(x.a.seat, false)
  // two of his are not enough to judge
  x.s.me!.matches = x.s.me!.matches.slice(0, 5)
  assert.equal(outplayedBy(x.s, x.rival), false)
  // benched for form: no hold either
  const y = held(); y.s.me!.benchLock = y.s.day + 7
  assert.ok(!coachStarters(y.s).includes(me))
})
check('a second five entered under the club\'s name (fewer than three shared) does not swap the player\'s team-mates', () => {
  const s = structuredClone(base)
  turn(s, 2022)
  const t = s.teams[EDG]
  const before = [...t.roster].sort()
  const reserves = Object.values(s.players).filter((p) => p.teamId === null && p.id.startsWith('V') && p.region === 'China').slice(0, 5)
  syncEvent(s, { 1120: reserves.map((p) => p.id.slice(1)) })
  assert.deepEqual([...t.roster].sort(), before)
  assert.ok(reserves.every((p) => p.teamId === null))
})
check('the club\'s own market stays out of a season history has its roster for', () => {
  const s = structuredClone(base)
  turn(s, 2022)
  const before = [...s.teams[EDG].roster]
  for (let i = 0; i < 6; i++) clubWindow(s, new Rng(i))
  clubWinter(s)
  assert.deepEqual(s.teams[EDG].roster, before)
  assert.notEqual(s.me!.flags.clubSigned, 2022)
})
check('a manager\'s save still keeps its own squad out of history\'s hands', () => {
  const s = structuredClone(base)
  const squad = [...s.teams[EDG].roster]
  s.me = undefined
  const r = reachOf(s)
  assert.equal(r.club, EDG)
  for (const id of squad) assert.ok(r.people.has(id))
  turn(s, 2022)
  assert.deepEqual([...s.teams[EDG].roster].sort(), squad.sort())
})
console.log(`PASS ${checks} club-history checks`)
