import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { EVENTS, eventOf, fireEvent, resolveEvent } from '../src/engine/me/events'
import { conflictCore, MAJOR_EVENT_GAP, majorEventReady } from '../src/engine/me/events_career'
import { activeAbsence, absenceTick } from '../src/engine/me/absence'
import { autoResolve } from '../src/engine/me/auto'
import { ensureCareerEvents, recordCareerEvent } from '../src/engine/me/eventState'
import { normalizeCareerEvents } from '../src/engine/me/eventMigrate'
import { careerMarksFor } from '../src/engine/me/careerMarks'
import { duoBonded } from '../src/engine/bonds'
import type { GameState } from '../src/engine/types'
import { addQuest, questWeek } from '../src/engine/me/quests'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 }, fetch: () => Promise.reject(new Error('offline')) })
const base = createCareer({ name: '事件验证', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 2137, year: 2026 })
function fresh(): GameState {
  const s = structuredClone(base), me = s.me!, p = s.players[me.id]
  const team = Object.values(s.teams).find(t => t.region === 'China' && t.roster.length >= 5)!
  s.myTeam = team.id; p.teamId = team.id; me.phase = 'pro'; me.week = 60; s.day = 100
  team.roster.push(me.id); team.starters = [me.id, ...team.roster.filter(id => id !== me.id).slice(0, 4)]
  me.pending = []; me.pendingEvent = undefined; me.seasonStart.starts = 25
  return s
}

assert.equal(new Set(EVENTS.map(e => e.id)).size, EVENTS.length, 'event IDs unique')
const added = EVENTS.filter(e => e.id.startsWith('career_'))
assert.equal(added.length, 17)
for (const e of added) {
  assert.ok(e.a.length >= 2 && e.a[e.rec] && !e.a[e.rec].confirm, `${e.id} safe recommendation`)
  assert.ok((e.a[e.rec].e.money ?? 0) >= 0, `${e.id} recommendation cannot fall back into irreversible choice`)
  assert.ok(e.onResolve)
}

// A stale callback is a complete no-op, not just an absent second injury.
{
  const s = fresh(), before = JSON.stringify(s)
  assert.deepEqual(resolveEvent(s, 'career_diagnosis', 1), [])
  assert.equal(JSON.stringify(s), before)
  assert.ok(fireEvent(s, 'career_family_leave'))
  addQuest(s, 'scrim')
  const trust = s.me!.coachTrust
  resolveEvent(s, 'career_family_leave', 1)
  assert.equal(s.me!.quests.length, 0, 'unfulfillable old event promises cancelled without reward or penalty')
  assert.equal(activeAbsence(s)?.reason, 'family')
  assert.equal(activeAbsence(s)?.until.day, s.day + 28)
  const once = JSON.stringify(s)
  resolveEvent(s, 'career_family_leave', 1)
  assert.equal(JSON.stringify(s), once, 'double click gives no second effects/history/rewards')
  const reload = JSON.parse(once) as GameState
  normalizeCareerEvents(reload)
  const reloaded = JSON.stringify(reload)
  resolveEvent(reload, 'career_family_leave', 1)
  assert.equal(JSON.stringify(reload), reloaded, 'consumed card cannot replay after load')
  assert.deepEqual(careerMarksFor(s), [], 'family leave never grants a medical tragedy')
  s.day += 28; absenceTick(s); assert.equal(s.me!.careerEvents?.familyReturns, 1)
  questWeek(s); assert.equal(s.me!.coachTrust, trust, 'approved leave cannot fail an old scrim demand')
  assert.equal(majorEventReady(s), false)
  s.me!.week += MAJOR_EVENT_GAP
  assert.equal(majorEventReady(s), true)
}

// Surgery is offered for an actual substantial injury; it is not an extra weekly random injury.
{
  const s = fresh()
  assert.equal(fireEvent(s, 'career_surgery'), false)
  s.players[s.me!.id].injuredUntil = s.day + 14
  s.me!.injury = { kind: 'ill', from: s.day, played: 0 }
  assert.equal(fireEvent(s, 'career_surgery'), false, 'ordinary fever cannot turn into surgery')
  s.me!.injury.kind = 'wrist'
  assert.ok(fireEvent(s, 'career_surgery'))
  resolveEvent(s, 'career_surgery', 0)
  assert.equal(activeAbsence(s)?.until.year, 2027)
  assert.equal(activeAbsence(s)?.until.day, 0)
}

// Both automation and manual safety paths preserve the career, regardless of money.
{
  const s = fresh(); s.me!.money = -100000
  assert.ok(fireEvent(s, 'career_diagnosis'))
  autoResolve(s, s.me!.pending[0])
  assert.equal(s.me!.phase, 'pro')
  assert.equal(activeAbsence(s)?.reason, 'illness')
  assert.equal(activeAbsence(s)?.until.day, 212)
  assert.equal(s.me!.careerEvents?.medicalRetirement, undefined)
}
{
  const s = fresh(); s.players[s.me!.id].overall = 90; s.me!.seasonStart.overall = 88
  s.me!.titles = [{ year: 2026, title: '2026 全球冠军赛', started: true }]
  assert.ok(fireEvent(s, 'career_diagnosis'))
  const staged = JSON.parse(JSON.stringify(s)) as GameState
  normalizeCareerEvents(staged)
  assert.ok(staged.me!.careerEvents?.diagnosis?.atPeak)
  resolveEvent(staged, 'career_diagnosis', 1)
  assert.equal(staged.me!.phase, 'retired')
  assert.equal(staged.me!.ending?.key, 'world')
  assert.ok(staged.me!.ending?.marks?.some(m => m.id === 'peak_cut_short'))
}

function hostile(s: GameState) {
  const team = s.teams[s.myTeam], me = s.me!
  const core = team.starters.find(id => id !== me.id)!
  team.igl = core
  for (const id of team.roster.filter(id => id !== me.id)) duoBonded(s, me.id, id, 100)
  duoBonded(s, me.id, core, -150)
  return core
}
{
  const s = fresh()
  for (const id of s.teams[s.myTeam].roster.filter(id => id !== s.me!.id)) duoBonded(s, s.me!.id, id, 100)
  assert.equal(conflictCore(s), undefined, 'close teammates do not invent a feud')
  const core = hostile(s)
  assert.equal(conflictCore(s)?.id, core)
  assert.ok(fireEvent(s, 'career_core_dispute'))
  resolveEvent(s, 'career_core_dispute', 1)
  assert.equal(s.me!.phase, 'pro', 'one escalation is not yet dismissal')
  assert.equal(s.me!.pendingEvent, 'career_core_ultimatum', 'follow-up not clobbered by old card cleanup')
  autoResolve(s, s.me!.pending[0])
  assert.equal(s.me!.phase, 'pro')
  assert.equal(s.me!.careerEvents?.reconciliations, 1)
  assert.equal(s.me!.careerEvents?.disputes.length, 0)
}
{
  const s = fresh(), core = hostile(s), team = s.teams[s.myTeam]
  assert.ok(fireEvent(s, 'career_core_dispute'))
  resolveEvent(s, 'career_core_dispute', 1)
  resolveEvent(s, 'career_core_ultimatum', 1)
  assert.equal(s.me!.phase, 'free'); assert.equal(s.players[s.me!.id].teamId, null)
  assert.ok(!team.roster.includes(s.me!.id) && !team.starters.includes(s.me!.id))
  assert.equal(s.me!.careerEvents?.disputes[0].mateId, core)
  assert.equal(s.me!.careerEvents?.disputes[0].dismissed, true)
  assert.deepEqual(careerMarksFor(s), [], 'one dismissal is not three distinct people')
}
{
  const s = fresh(), core = hostile(s)
  assert.ok(fireEvent(s, 'career_core_dispute'))
  s.players[core].teamId = null
  const trust = s.me!.coachTrust
  resolveEvent(s, 'career_core_dispute', 1)
  assert.equal(s.me!.coachTrust, trust, 'stale teammate cannot punish player')
  assert.equal(s.me!.careerEvents?.disputes.length, 0)
}
{
  const s = fresh()
  for (let i = 0; i < 150; i++) recordCareerEvent(s, 'support', `记事${i}`)
  const log = ensureCareerEvents(s).records
  assert.equal(log.length, 96); assert.equal(new Set(log.map(r => r.id)).size, 96)
}
assert.equal(eventOf('career_info_partner')!.when(fresh()), true)
{
  const s = fresh()
  for (let i = 0; i < 3; i++) {
    assert.ok(fireEvent(s, 'career_quiet_evening'))
    resolveEvent(s, 'career_quiet_evening', 0)
    s.day += 60
  }
  assert.equal(s.me!.careerEvents?.supportChoices, 0, 'reading a book is not supporting teammates')
  assert.ok(!s.me!.achievements.includes('arc_support'))
}
console.log('PASS: 17 event contracts, safe recommendations, absence choices, cooldown, reload/idempotence, real core dismissal, retirement honors, bounded unique history')
