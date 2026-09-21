import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { CAREER_MARKS, careerMarksFor, cleanCareerMarks } from '../src/engine/me/careerMarks'
import { ensureCareerEvents } from '../src/engine/me/eventState'
import { normalizeCareerEvents } from '../src/engine/me/eventMigrate'
import { migratePlayerSave } from '../src/engine/me/save'
import { ACH_BY_KEY, checkAchievements } from '../src/engine/me/achievements'
import { endingFor, retire } from '../src/engine/me/endings'
import { HALL_KEY, noteHall, readHall, exportHall, importHall, cleanHall } from '../src/engine/me/hall'
import type { CoreDispute } from '../src/engine/me/eventState'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 }, fetch: () => Promise.reject(new Error('offline')) })
const s = createCareer({ name: '印记测试', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 771901, year: 2026 })
assert.deepEqual(careerMarksFor(s), [])
normalizeCareerEvents(s)
assert.equal(s.me!.careerEvents, undefined, 'old saves gain no invented life history')
const a = ensureCareerEvents(s)
const dispute = (mateId: string, dismissed = true): CoreDispute => ({ year: 2026, day: 3, mateId, mateName: mateId, clubId: 'club', wasCore: true, dismissed })
a.disputes = [dispute('same'), dispute('same'), dispute('same')]
assert.deepEqual(careerMarksFor(s), [], 'three quarrels with one core do not count as three people')
a.disputes = [dispute('one'), dispute('two'), dispute('three', false)]
assert.deepEqual(careerMarksFor(s), [], 'a disagreement without dismissal is not a third dismissal')
a.disputes[2].dismissed = true
assert.deepEqual(careerMarksFor(s).map((m) => m.id), ['core_exile'])
a.disputes = []
s.me!.flags.released = 3
a.familyReturns = 1
assert.deepEqual(careerMarksFor(s), [], 'ordinary transfers and family leave create no negative marks')
a.medicalRetirement = { year: 2026, day: 12, peakOverall: 90, atPeak: false }
assert.deepEqual(careerMarksFor(s), [])
a.medicalRetirement.atPeak = true
a.missedFinals = [{ year: 2026, day: 10, fixtureId: 'champ-final', eventId: 'champ', competition: '全球冠军赛', clubId: 'club', reason: 'injury' }]
a.disputes = [dispute('one'), dispute('two'), dispute('three')]
a.returns = 1; a.reconciliations = 1; a.supportChoices = 3
assert.equal(careerMarksFor(s).length, 3)
for (const m of CAREER_MARKS) assert.deepEqual(ACH_BY_KEY[`arc_${m.id}`].reward, { title: m.title }, 'negative marks only award a cosmetic title')
checkAchievements(s)
const before = JSON.stringify({ attrs: s.players[s.me!.id].attrs, money: s.me!.money, achievements: s.me!.achievements, rewards: s.me!.achRewards })
checkAchievements(s)
assert.equal(JSON.stringify({ attrs: s.players[s.me!.id].attrs, money: s.me!.money, achievements: s.me!.achievements, rewards: s.me!.achRewards }), before, 'rechecking never pays twice')
for (const key of ['arc_return', 'arc_family_return', 'arc_reconcile', 'arc_support']) assert.ok(s.me!.achievements.includes(key))
s.me!.titles = [{ year: 2026, title: '2026 全球冠军赛', started: true }]
assert.equal(endingFor(s).key, 'world')
retire(s, '因病告别赛场')
assert.equal(s.me!.ending!.key, 'world', 'medical ending must not erase a championship')
assert.equal(s.me!.ending!.marks!.length, 3)
noteHall(s, true)
const exported = exportHall()!
assert.equal(readHall()!.cards[0].ending.marks!.length, 3)
mem.delete(HALL_KEY)
assert.equal(importHall(exported), 'ok')
assert.equal(importHall(exported), 'ok')
assert.equal(readHall()!.cards.length, 1)
assert.deepEqual(readHall()!.cards[0].ending.marks, s.me!.ending!.marks)
const stripped = JSON.parse(exported)
delete stripped.cards[0].ending.marks
mem.set(HALL_KEY, JSON.stringify(stripped))
assert.equal(importHall(exported), 'ok')
assert.deepEqual(readHall()!.cards[0].ending.marks, s.me!.ending!.marks, 'import restores marks to an existing card without replacing its ending')
assert.deepEqual(cleanHall(JSON.parse(exported)), cleanHall(cleanHall(JSON.parse(exported))))
assert.deepEqual(cleanCareerMarks([{ id: 'invented' }, { id: 'core_exile', title: 'injected' }, { id: 'core_exile' }, null]), [CAREER_MARKS[1]].map(({ id, title, text }) => ({ id, title, text })))
// The real save migration is idempotent for these facts and never resets paid rewards.
migratePlayerSave(s)
const saved = JSON.stringify({ events: s.me!.careerEvents, ending: s.me!.ending, rewards: s.me!.achRewards })
migratePlayerSave(s)
assert.equal(JSON.stringify({ events: s.me!.careerEvents, ending: s.me!.ending, rewards: s.me!.achRewards }), saved)
const broken = JSON.parse(JSON.stringify(s))
broken.me.careerEvents = { records: [null, 1], disputes: [{ ...dispute('fake'), wasCore: 'true' }], missedFinals: [{ year: 2026, day: 2, fixtureId: 'a', eventId: 'b', clubId: 'c', reason: 'family' }], returns: NaN, familyReturns: -5, reconciliations: '9', supportChoices: Infinity, absence: { id: 'bad', reason: 'family', from: { year: 2026, day: 20 }, until: { year: 2026, day: 2 } } }
normalizeCareerEvents(broken)
assert.deepEqual(careerMarksFor(broken), [])
assert.equal(broken.me.careerEvents.absence, undefined)
assert.equal(broken.me.careerEvents.returns, 0)
assert.equal(broken.me.careerEvents.reconciliations, 0)
console.log('PASS career marks: strict event facts, cosmetic rewards, champion preserved, hall round-trip, malformed/old saves, migration idempotence')
