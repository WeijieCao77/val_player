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
import { Rng } from '../src/engine/rng'
import type { GameState } from '../src/engine/types'

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
