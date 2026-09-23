/** Public feedback 3750a167: capped aim/reaction must not waste steady-plan AP.
 * Bounded, synthetic current-week checks only; no backend, saves, or season sim.
 * Run: npx tsx scripts/check_auto_training_room.ts
 */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan, practiceWithRoom, talentPick, weekEndFatigue, WEEK_END_FATIGUE } from '../src/engine/me/auto'
import { chasing, MECH_VALUE_MAX } from '../src/engine/me/bottleneck'
import { ACTION_BY_KEY } from '../src/engine/me/actions'
import { chainTask } from '../src/engine/me/storyweek'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState, Role } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'
import { recomputeOverall } from '../src/engine/player'
import { Rng } from '../src/engine/rng'
import { bondBetween } from '../src/engine/bonds'
import { duoMate } from '../src/engine/me/growth'

globalThis.fetch = () => Promise.reject(new Error('offline diagnostic'))
const base = createCareer({ name: '训练边界', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', year: 2026, seed: 3750 })
const fixture = (full = false): GameState => {
  const s = structuredClone(base)
  const m = s.me!, p = s.players[m.id]
  m.plan = {}; m.ap = m.apMax = 12; m.pending = []; m.quests = []; m.fans = 500
  m.tilt = 0; m.courses = []; m.weekNotes = []; m.chain = undefined; m.pre.cup = undefined
  m.weekStart = undefined; m.stream.deal = undefined
  p.fatigue = 0; p.xp = {}; s.fixtures = []
  for (const k of ATTR_KEYS) {
    p.attrs[k] = full ? 80 : 50
    p.caps![k] = 80
    m.bottleneck!.mechV![k] = MECH_VALUE_MAX
  }
  m.bottleneck!.aimStreak = 0
  recomputeOverall(p)
  return s
}
const own = (s: GameState) => s.players[s.me!.id]
const sessions = (s: GameState) => ['aim', 'vod', 'util'].reduce((n, k) => n + (s.me!.plan[k as MeAction] ?? 0), 0)
const account = (s: GameState, ap: number): void => {
  assert.equal(s.me!.ap, ap - Object.entries(s.me!.plan).reduce((n, [k, count]) => n + ACTION_BY_KEY[k as MeAction].cost * count!, 0))
  assert.ok(s.me!.ap >= 0)
  assert.ok(own(s).fatigue >= 0 && own(s).fatigue <= 100)
}
let checks = 0
function check(label: string, run: () => void): void {
  run(); checks++; console.log(`OK ${label}`)
}

check('both capped, dead breakthrough: no aim; AP goes to useful practice', () => {
  const s = fixture(), p = own(s)
  p.attrs.aim = p.attrs.reaction = 80
  assert.equal(chasing(s, 'aim'), false)
  autoPlan(s, false)
  assert.equal(s.me!.plan.aim ?? 0, 0)
  assert.equal(p.attrs.aim, 80); assert.equal(p.attrs.reaction, 80)
  assert.equal(p.xp.aim ?? 0, 0); assert.equal(p.xp.reaction ?? 0, 0)
  assert.ok(Object.values(p.xp).some((n) => n! > 0))
  account(s, 12)
  console.log('  fixed repro:', JSON.stringify({ plan: s.me!.plan, ap: s.me!.ap, fatigue: p.fatigue, xp: p.xp }))
})
check('mixed aim: retain practice when either aim OR reaction has room', () => {
  for (const open of ['aim', 'reaction'] as const) {
    const s = fixture(true), p = own(s)
    p.attrs[open] = 50
    assert.equal(practiceWithRoom(s, 'aim'), 'aim')
    autoPlan(s, false)
    assert.ok((s.me!.plan.aim ?? 0) > 0)
    assert.ok((p.xp[open] ?? 0) > 0)
    assert.equal(p.xp[open === 'aim' ? 'reaction' : 'aim'] ?? 0, 0)
  }
})
check('mixed vod/util: IGL-only and communication-only room still count', () => {
  for (const [key, attr] of [['vod', 'igl'], ['util', 'communication']] as const) {
    const s = fixture(true); own(s).attrs[attr] = 50
    assert.equal(practiceWithRoom(s, key), key)
    autoPlan(s, false)
    assert.ok((s.me!.plan[key] ?? 0) > 0)
    assert.ok((own(s).xp[attr] ?? 0) > 0)
  }
})
check('live aim breakthrough keeps exactly two capped sessions', () => {
  const s = fixture(true), m = s.me!
  m.bottleneck!.mechV!.aim = 0; m.bottleneck!.aimStreak = 2
  assert.equal(chasing(s, 'aim'), true)
  autoPlan(s, false)
  assert.equal(m.plan.aim, 2)
  assert.equal(own(s).xp.aim ?? 0, 0)
  account(s, 12)
})
check('a reaction breakthrough is not an aim-training task', () => {
  const s = fixture(true)
  s.me!.bottleneck!.mechV!.reaction = 0
  assert.equal(chasing(s, 'reaction'), true)
  assert.equal(practiceWithRoom(s, 'aim'), null)
  autoPlan(s, false)
  assert.equal(s.me!.plan.aim ?? 0, 0)
  assert.ok((s.me!.plan.ranked ?? 0) > 0)
})
check('story-required capped aim is preserved, without empty tail repeats', () => {
  const s = fixture(true)
  s.me!.chain = { id: 'showcase', step: 0, wk: 0, due: 10, score: 0, track: 'aim', need: 1, got: 0 }
  assert.equal(chainTask(s), 'aim')
  autoPlan(s, false)
  assert.equal(s.me!.plan.aim, 1)
  assert.equal(chainTask(s), null)
})
check('train quest runs at cap, then stops after its reward is earned', () => {
  const s = fixture(true)
  s.me!.quests = [{ id: 'room-test', title: '训练', kind: 'train', need: 1, done: 0, deadline: s.day + 7, rewardText: '', penaltyText: '', reward: {}, penalty: {} }]
  autoPlan(s, false)
  assert.equal(sessions(s), 1)
  assert.equal(s.me!.quests.length, 0)
})
check('review course tilt relief counts independently of attributes', () => {
  const s = fixture(true)
  s.me!.courses = ['review']; s.me!.tilt = 20
  assert.equal(practiceWithRoom(s, 'vod'), 'vod')
  autoPlan(s, false)
  assert.ok((s.me!.plan.vod ?? 0) > 0)
  assert.ok(s.me!.tilt < 20)
  s.me!.tilt = 0
  assert.equal(practiceWithRoom(s, 'vod'), null)
})
check('all capped: no empty practice, but ranked still has ladder/form benefits', () => {
  const s = fixture(true)
  autoPlan(s, false)
  assert.equal(sessions(s), 0)
  assert.ok((s.me!.plan.ranked ?? 0) > 0)
  account(s, 12)
})
check('selection is pure, deterministic, and consumes no RNG', () => {
  for (const full of [false, true]) {
    const s = fixture(full), before = JSON.stringify(s), next = Rng.prototype.next
    try {
      Rng.prototype.next = () => { throw new Error('practice selection must not roll') }
      for (const key of ['aim', 'vod', 'util'] as const) {
        assert.equal(practiceWithRoom(s, key), full ? null : key)
        assert.equal(practiceWithRoom(s, key), full ? null : key)
      }
    } finally { Rng.prototype.next = next }
    assert.equal(JSON.stringify(s), before)
  }
})
check('zero AP: no practice, fatigue, mutation, or RNG', () => {
  const s = fixture(true); s.me!.ap = 0
  const before = JSON.stringify(s), next = Rng.prototype.next
  try {
    Rng.prototype.next = () => { throw new Error('zero AP must not roll') }
    autoPlan(s, false)
  } finally { Rng.prototype.next = next }
  assert.equal(JSON.stringify(s), before)
})
check('recheck each session after the first session fills both bars', () => {
  const s = fixture(true), p = own(s)
  p.attrs.aim = p.attrs.reaction = 79
  p.xp.aim = p.xp.reaction = 99.999
  autoPlan(s, false)
  assert.equal(p.attrs.aim, 80); assert.equal(p.attrs.reaction, 80)
  assert.equal(s.me!.plan.aim, 1)
})
check('talent-selected IGL training remains useful at capped combat stats', () => {
  const s = fixture(true)
  own(s).attrs.igl = 50
  s.me!.talents = { ...emptyTalents(), igl: 12 }
  assert.equal(talentPick(s), 'igl')
  autoPlan(s, true)
  assert.ok((s.me!.plan.vod ?? 0) > 0)
  assert.ok((own(s).xp.igl ?? 0) > 0)
  assert.equal(s.me!.plan.aim ?? 0, 0)
})
check('capped duo story still improves the teammate bond', () => {
  const s = fixture(true), m = s.me!, p = own(s)
  const team = Object.values(s.teams).find((t) => t.roster.length >= 5)!
  s.myTeam = team.id; p.teamId = team.id; m.phase = 'pro'; m.ap = m.apMax = 8
  team.roster.push(p.id); team.starters[0] = p.id
  const mate = duoMate(s)!, before = bondBetween(s, p.id, mate.id)
  m.chain = { id: 'rift', step: 0, wk: 0, due: 10, score: 0, track: 'duo', need: 1, got: 0, mate: mate.id }
  autoPlan(s, false)
  assert.equal(m.plan.duo, 1)
  assert.ok(bondBetween(s, p.id, mate.id) > before)
  assert.equal(p.xp.communication ?? 0, 0)
  account(s, 8)
})
check('capped bench scrim still earns coach trust', () => {
  const s = fixture(true), m = s.me!, p = own(s)
  const team = Object.values(s.teams).find((t) => t.roster.length >= 5)!
  s.myTeam = team.id; p.teamId = team.id; m.phase = 'pro'; m.ap = m.apMax = 8
  team.roster.push(p.id); m.edge = 100; m.coachTrust = 20
  autoPlan(s, false)
  assert.equal(m.plan.scrim, 1)
  assert.ok(m.coachTrust > 20)
  assert.equal(sessions(s), 0)
  account(s, 8)
})
check('five roles, pre/pro, fresh/tired: no useless aim, correct AP, fatigue budget, repeatable', () => {
  for (const role of ['决斗者', '先锋', '控场', '哨卫', '自由人'] as Role[]) for (const pro of [false, true]) for (const tired of [false, true]) {
    const s = fixture(), m = s.me!, p = own(s)
    p.role = role; p.attrs.aim = p.attrs.reaction = 80; p.fatigue = tired ? 75 : 0
    if (pro) {
      const team = Object.values(s.teams).find((t) => t.roster.length >= 5)!
      s.myTeam = team.id; p.teamId = team.id; m.phase = 'pro'; m.ap = m.apMax = 8
      team.roster.push(p.id); team.starters[0] = p.id
    }
    const copy = structuredClone(s), ap = m.ap
    autoPlan(s, false); autoPlan(copy, false)
    assert.equal(m.plan.aim ?? 0, 0, `${role}/${pro}/${tired}`)
    account(s, ap)
    assert.ok(weekEndFatigue(s) <= WEEK_END_FATIGUE + 1e-6)
    assert.deepEqual(m.plan, copy.me!.plan)
    assert.deepEqual(p.attrs, own(copy).attrs)
    assert.deepEqual(p.xp, own(copy).xp)
    assert.equal(p.fatigue, own(copy).fatigue)
  }
})
// Public feedback a17ca0ba (2026-09-22): 「属性到99后自动分配还是会去练」. A duelist at 枪法 99 with 反应 and
// 意识 still open booked 枪法训练 in the weakest slot, the role's tail and the talent's slot alike — two or three
// sessions a week of which 0.65 of every hour banked nothing.
check('枪法 at its ceiling, 反应 open: 枪法训练 once a week, the rest to practice with room', () => {
  const s = fixture(), m = s.me!, p = own(s)
  p.attrs.aim = 80; p.attrs.reaction = 60; p.attrs.awareness = p.attrs.clutch = 70
  m.talents = { ...emptyTalents(), aim: 12, reaction: 12 }
  assert.equal(chasing(s, 'aim'), false)
  const line = autoPlan(s, true)
  assert.equal(m.plan.aim, 1, JSON.stringify(m.plan))
  assert.ok((m.plan.vod ?? 0) + (m.plan.util ?? 0) >= 1, JSON.stringify(m.plan))
  assert.ok((p.xp.reaction ?? 0) > 0)
  assert.equal(p.xp.aim ?? 0, 0)
  assert.match(line, /枪法已到顶，枪法训练练的是反应/)
  account(s, 12)
})
check('枪法训练 the only practice with room: repeats stay (nothing better to do with the hours)', () => {
  const s = fixture(true), m = s.me!, p = own(s)
  p.attrs.reaction = 50
  autoPlan(s, false)
  assert.ok((m.plan.aim ?? 0) >= 2, JSON.stringify(m.plan))
  assert.ok((p.xp.reaction ?? 0) > 0)
})
check('a live 枪法 break is not half-empty: its two sessions stay', () => {
  const s = fixture(true), m = s.me!
  own(s).attrs.reaction = 50; own(s).attrs.awareness = 50
  m.bottleneck!.mechV!.aim = 0; m.bottleneck!.aimStreak = 2
  assert.equal(chasing(s, 'aim'), true)
  autoPlan(s, false)
  assert.ok((m.plan.aim ?? 0) >= 2, JSON.stringify(m.plan))
})
console.log(`PASS ${checks} bounded auto-training checks`)
