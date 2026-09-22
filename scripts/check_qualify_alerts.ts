import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { momentMark, noteQualify, pushMoment, takeMoment } from '../src/engine/me/moments'
import { qualificationMode, setQualificationMode, normalizeQualifyAlertPrefs } from '../src/engine/me/qualifyAlerts'
import { advanceUntil } from '../src/engine/me/auto'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import type { Competition } from '../src/engine/types'
Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, fetch: () => Promise.reject(new Error('offline')) })
const base = createCareer({ name: '出线提醒验收', region: 'Europe', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 723, year: 2026 })
const fresh = () => { const s = structuredClone(base); s.me!.moments = []; return s }
const qual = (s: typeof base, key: string, comp = '东京大师赛') => pushMoment(s, { kind: 'qualify', key, comp })
const keys = (s: typeof base) => s.me!.moments!.map((m) => m.key)
const reload = (s: typeof base) => migratePlayerSave(unpackState(packState(s)))
{
  const s = fresh(); assert.equal(qualificationMode(s), 'all')
  qual(s, 'a'); qual(s, 'b'); qual(s, 'c', '2026 全球冠军赛'); qual(s, 'd', 'LOCK//IN')
  for (const kind of ['title', 'sign', 'award', 'rank'] as const) pushMoment(s, { kind, key: kind })
  setQualificationMode(s, 'first'); assert.deepEqual(keys(s), ['a', 'c', 'd', 'title', 'sign', 'award', 'rank'])
  takeMoment(s); setQualificationMode(s, 'all'); qual(s, 'e'); setQualificationMode(s, 'first')
  assert.ok(!keys(s).includes('e')); assert.equal(s.me!.qualifyAlerts!.firstKeys!.masters, 'a')
  const back = reload(s), before = momentMark(back); qual(back, 'f'); assert.equal(momentMark(back), before)
  setQualificationMode(back, 'all'); assert.equal(momentMark(back), before, 'no replay when re-enabled')
  console.log('PASS defaults/per-category career-first/all other moments/order/consumed-first/reload/no replay')
}
{
  const s = fresh(); setQualificationMode(s, 'yearly'); qual(s, 'a'); takeMoment(s); qual(s, 'b'); assert.deepEqual(keys(s), [])
  s.year++; qual(s, 'c'); qual(s, 'd'); qual(s, 'e', '2027 全球冠军赛'); assert.deepEqual(keys(s), ['c', 'e'])
  setQualificationMode(s, 'all'); qual(s, 'f'); setQualificationMode(s, 'yearly'); assert.deepEqual(keys(s), ['c', 'e'])
  setQualificationMode(s, 'first'); assert.deepEqual(keys(s), ['e']); qual(s, 'g'); assert.deepEqual(keys(s), ['e'])
  console.log('PASS annual reset + switching modes preserves consumed earlier career-first')
}
{
  const s = fresh()
  s.me!.moments = [{ kind: 'qualify', key: 'old1', comp: '东京大师赛', year: 2025, day: 1 }, { kind: 'qualify', key: 'old2', comp: '东京大师赛', year: 2025, day: 2 }, { kind: 'qualify', key: 'new1', comp: '东京大师赛', year: 2026, day: 1 }, { kind: 'qualify', key: 'new2', comp: '东京大师赛', year: 2026, day: 2 }]
  setQualificationMode(s, 'yearly'); assert.deepEqual(keys(s), ['old1', 'new1'])
  for (const raw of [null, [], 'bad', { mode: 'oops', firstKeys: [], yearFirstKeys: { masters: { year: Infinity, key: 'x' } } }]) {
    s.me!.qualifyAlerts = raw as never; const before = JSON.stringify(s); assert.equal(qualificationMode(s), 'all'); assert.equal(JSON.stringify(s), before)
    assert.deepEqual(normalizeQualifyAlertPrefs(raw), { mode: 'all', firstKeys: {}, yearFirstKeys: {} })
  }
  console.log('PASS old multi-year queue and malformed import; getters pure')
}
function addComp(s: typeof base, key: string, name = '东京大师赛') {
  const comp: Competition = { key, name, stage: s.stage, teams: [s.myTeam], standings: {}, finished: [] }
  s.comps[key] = comp
  return s.comps[key]
}
{
  const s = fresh(); s.comps = {}; s.fixtures = []; setQualificationMode(s, 'first')
  addComp(s, 'a'); addComp(s, 'b'); addComp(s, 'c', '全球冠军赛'); noteQualify(s)
  assert.deepEqual(keys(s), ['qualify:a', 'qualify:c']); assert.equal(s.me!.log.filter((l) => l.text.startsWith('国际赛出线｜')).length, 3)
  const mark = momentMark(s); noteQualify(s); assert.equal(momentMark(s), mark)
  assert.equal(s.me!.log.filter((l) => l.text.startsWith('国际赛出线｜')).length, 3)
  console.log('PASS noteQualify suppressed card still logs exactly once')
}
{
  const s = fresh(); s.comps = {}; s.fixtures = []
  const history = addComp(s, 'history'); history.circuit = { id: 'history', start: 0, end: 10, seeds: [s.myTeam], mode: 'history' }
  const booked = addComp(s, 'booked'); booked.circuit = { id: 'booked', start: 0, end: 10, seeds: [s.myTeam] }
  addComp(s, 'finished').finished = [s.myTeam]
  addComp(s, 'champion').champion = s.myTeam
  addComp(s, 'joined-midway')
  s.fixtures.push({ id: 'already-played', comp: 'joined-midway', stage: s.stage, day: s.day, teamA: s.myTeam, teamB: 'other', bo: 3, label: '小组赛', played: true })
  noteQualify(s); assert.deepEqual(keys(s), [])
  assert.equal(s.me!.log.filter((l) => l.text.startsWith('国际赛出线｜')).length, 0)
  assert.equal(s.me!.qualifyAlerts, undefined, 'ineligible events do not consume category-first')
  console.log('PASS historical booking/finished/joined-midway guards preserved; no false log or first key')
}
// The actual week/run loop sees an eligible comp on day advancement. A repeat
// in first mode must run past that day; a first/default card must return then.
{
  const s = fresh(); s.me!.pending = []; s.fixtures = []; s.comps = {}
  qual(s, 'consumed'); takeMoment(s)
  addComp(s, 'during-run')
  const all = structuredClone(s), first = structuredClone(s)
  setQualificationMode(first, 'first')
  const start = s.day
  advanceUntil(all, 'month'); const allDay = all.day
  assert.ok(keys(all).includes('qualify:during-run'))
  advanceUntil(first, 'month'); assert.ok(!keys(first).includes('qualify:during-run')); assert.ok(first.day > allDay, `suppressed repeat progresses past ${allDay}, got ${first.day}`)
  assert.ok(first.me!.log.some((l) => l.text.includes('东京大师赛')))
  const before = first.day; first.me!.moments = []; advanceUntil(first, 'month')
  assert.ok(first.day > before || first.year > s.year, 'second advance continues, no hidden queue deadlock')
  console.log(`PASS actual advanceUntil starts ${start}: all stops ${allDay}, first runs ${before} then ${first.day}`)
}
console.log('PASS qualification alert checks')
