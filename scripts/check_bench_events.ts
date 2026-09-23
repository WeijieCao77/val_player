/**
 * Public feedback 1bf81754 (2026-09-23): 「在替补席的时候触发的首发才应该做的事件有点太多了」.
 *
 * The cards that assume I played — 夺冠之夜 (the manager wants my interview first), 赛后采访, the four role
 * cards about a round I was in, a loss blamed on me, and the echo whose steady answer is two wins started in —
 * come to a man on the floor lately (me/story.ts onFloor), not the bench. In six 强队替补 careers 夺冠之夜 came
 * 18 times from the bench and 3 from the five before this.
 *
 * Bounded and synthetic: one fresh career, no season sim.
 * Run: npx tsx scripts/check_bench_events.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { eventOf } from '../src/engine/me/events'
import { onFloor, ON_FLOOR_DAYS } from '../src/engine/me/story'
import { syncTitles } from '../src/engine/me/week'
import type { GameState } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

globalThis.fetch = () => Promise.reject(new Error('offline check'))
const base = createCareer({ name: '替补席', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 1123, year: 2026 })
assert.equal(base.me!.phase, 'pro')

const started = (s: GameState, daysAgo: number, comp = 'VCT China · Stage 1'): MeMatchRecord =>
  ({ year: s.year, day: s.day - daysAgo, comp, started: true, friendly: false, won: true, score: '2-0', label: '第 3 轮', box: [], nodes: [] }) as unknown as MeMatchRecord
/** the same career with me on the bench, nothing started, 200 fans */
function bench(): GameState {
  const s = structuredClone(base)
  const t = s.teams[s.myTeam]
  const me = s.me!
  t.starters = t.starters.filter((id) => id !== me.id)
  if (t.starters.length < 5) t.starters.push(...t.roster.filter((id) => id !== me.id && !t.starters.includes(id)).slice(0, 5 - t.starters.length))
  s.day = 120
  me.matches = []
  me.fans = 200
  me.pendingEvent = undefined
  me.pending = []
  return s
}
function starter(): GameState {
  const s = bench()
  const t = s.teams[s.myTeam]
  t.starters = [s.me!.id, ...t.starters.slice(0, 4)]
  return s
}
let checks = 0
const check = (label: string, run: () => void) => { run(); checks++; console.log(`OK ${label}`) }
const when = (id: string, s: GameState) => eventOf(id)!.when(s)

const FLOOR_CARDS = ['interview', 'locker_blame', 'career_entry_followup']
check('on the bench with no start lately: the played-it cards stay away', () => {
  const s = bench()
  assert.equal(onFloor(s), false)
  for (const id of [...FLOOR_CARDS, 'rumor', 'echo_cheat_old']) assert.equal(when(id, s), false, id)
  // the bench's own cards are still the bench's
  assert.equal(when('bench_notes', s), true)
  assert.equal(when('coach_talk', s), true)
})
check('named in the five: they come', () => {
  const s = starter()
  assert.equal(onFloor(s), true)
  for (const id of [...FLOOR_CARDS, 'rumor', 'echo_cheat_old']) assert.equal(when(id, s), true, id)
})
check(`a substitute who started within ${ON_FLOOR_DAYS} days is still that match's man; older starts are not`, () => {
  const s = bench()
  s.me!.matches = [started(s, 10)]
  assert.equal(onFloor(s), true)
  for (const id of FLOOR_CARDS) assert.equal(when(id, s), true, id)
  // 用下一场说话 needs wins started in from now on: the bench cannot take it
  assert.equal(when('echo_cheat_old', s), false)
  s.me!.matches = [started(s, ON_FLOOR_DAYS + 1)]
  assert.equal(onFloor(s), false)
  // a cup or an exhibition is not one of the club's matches
  s.me!.matches = [{ ...started(s, 3), friendly: true } as MeMatchRecord]
  assert.equal(onFloor(s), false)
  // a start across the year's turn still counts by days
  s.day = 3
  s.me!.matches = [{ ...started(s, 0), year: s.year - 1, day: 360 } as MeMatchRecord]
  assert.equal(onFloor(s), true)
})
check('a role card is still the role\'s own', () => {
  const s = starter()
  s.players[s.me!.id].role = '哨卫'
  assert.equal(when('career_entry_followup', s), false)
  assert.equal(when('career_watch_flank', s), true)
})
check('夺冠之夜 follows a title I started in, not one won from the bench', () => {
  const title = 'VCT China · Stage 1'
  const s = bench()
  s.players[s.me!.id].titles = [{ year: s.year, title }]
  syncTitles(s)
  assert.equal(s.me!.titles.length, 1)
  assert.equal(s.me!.titles[0].started, false)
  assert.notEqual(s.me!.pendingEvent, 'after_title')
  assert.ok(s.me!.moments?.some((m) => m.kind === 'title' && m.bench), 'the bench title keeps its own card')

  const t = bench()
  t.me!.matches = [started(t, 2, title)]
  t.players[t.me!.id].titles = [{ year: t.year, title }]
  syncTitles(t)
  assert.equal(t.me!.titles[0].started, true)
  assert.equal(t.me!.pendingEvent, 'after_title')
})
console.log(`PASS ${checks} bench-event checks`)
