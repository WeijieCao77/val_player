import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { eventOf } from '../src/engine/circuit'
import { fmvpEvidence, isTitleFinal, rememberFMVPs } from '../src/engine/me/fmvp'
import { fmvpTotals } from '../src/engine/me/fmvpRead'
import { trimDetail } from '../src/engine/me/detail'
import { migratePlayerSave } from '../src/engine/me/save'
import { packState, unpackState } from '../src/engine/save'
import { ensureCeilings, finalMvp } from '../src/engine/me/bottleneck'
import { careerOverview } from '../src/ui/me/careerOverviewRead'
import { careerTrophies } from '../src/engine/me/trophies'
import { retire } from '../src/engine/me/endings'
import { HALL_KEY, noteHall, readHall, exportHall, importHall } from '../src/engine/me/hall'
import { syncTitles } from '../src/engine/me/week'
import type { MeMatchRecord } from '../src/engine/me/types'
import type { Fixture } from '../src/engine/types'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k), clear: () => mem.clear(), key: () => null, length: 0 }, fetch: () => Promise.reject(new Error('offline')) })
const s = createCareer({ name: 'FMVP', region: 'China', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 741, year: 2026 })
const me = s.me!
const comp = Object.values(s.comps).find(c => c.circuit && eventOf(c.circuit.id)?.cn === '圣地亚哥大师赛')!
assert.ok(comp)
const ev = eventOf(comp.circuit!.id)!
const nodes = ev.units.flatMap(u => u.nodes ?? [])
const end = nodes.findIndex(n => n.round === '总决赛')
const upper = nodes.findIndex(n => n.round === '胜者组决赛')
assert.ok(end > upper && upper >= 0)
const r = (label: string, extra: Partial<MeMatchRecord> = {}): MeMatchRecord => ({ fixtureId: 'test-final', year: 2026, day: 50, comp: comp.name, label, opp: '对手', oppTag: 'OPP', started: true, won: true, score: '3-1', maps: 4, rounds: 80, kills: 80, deaths: 40, assists: 30, firstKills: 10, clutches: 2, acs: 280, rating: 1.35, mvp: true, carried: false, nodes: [], rank: 1, ...extra })
s.fixtures.push({ id: 'test-final', comp: comp.key, node: end, teamA: s.myTeam, teamB: comp.teams.find(x => x !== s.myTeam)!, day: 50, label: '总决赛', bo: 5, played: true } as Fixture)
me.titles = [{ year: 2026, title: comp.name, started: true }]
me.matches = [r('总决赛')]
assert.equal(fmvpEvidence(s, me.titles[0]), true)
const finalFixture = s.fixtures.at(-1)!
finalFixture.node = upper
assert.equal(isTitleFinal(s, me.matches[0]), false, 'graph defeats even a misleading translated final label')
finalFixture.node = end
for (const extra of [{ mvp: false }, { started: false }, { won: false }]) {
  me.matches = [r('总决赛', extra)]
  assert.equal(fmvpEvidence(s, me.titles[0]), false)
}
me.matches = [r('总决赛', { friendly: true })]
assert.equal(fmvpEvidence(s, me.titles[0]), undefined, 'friendly final cannot award FMVP')
s.fixtures.pop()
for (const label of ['半决赛', '胜者组决赛', '败者组决赛', 'Final Four', '第 5 轮', 'Upper Final', 'Lower Final']) {
  me.matches = [r(label)]
  assert.equal(fmvpEvidence(s, me.titles[0]), undefined, `${label} is not the championship final`)
}
me.matches = [r('总决赛')]
const negative = structuredClone(s)
negative.me!.matches = [r('胜者组决赛')]
negative.me!.titles = []
negative.me!.moments = []
negative.players[negative.me!.id].titles = [{ year: 2026, title: comp.name }]
syncTitles(negative)
assert.equal(finalMvp(negative, comp.name, 2026), false)
assert.ok(negative.me!.moments.every(m => !m.fmvp), 'moment cards cannot contradict non-final evidence')
assert.ok(!negative.me!.bottleneck?.seen.includes(`fmvp:2026:${comp.name}`), 'no final-specific reward for an upper-final MVP')
const statsBefore = JSON.stringify(s.players[me.id].career)
me.titles = []
s.players[me.id].titles = [{ year: 2026, title: comp.name }]
syncTitles(s)
assert.equal(me.titles[0].fmvp, true)
assert.equal(finalMvp(s, comp.name, 2026), true)
assert.ok(me.moments.some(m => m.kind === 'title' && m.fmvp === true), 'the moment and permanent award agree')
assert.equal(JSON.stringify(s.players[me.id].career), statsBefore, 'honor recording does not recalculate a match MVP')
const persisted = JSON.stringify(me.titles)
rememberFMVPs(s)
assert.equal(JSON.stringify(me.titles), persisted)
s.year = 2028; s.day = 100
trimDetail(me, s.year, s.day)
assert.equal(me.matches.length, 0)
rememberFMVPs(s)
assert.equal(me.titles[0].fmvp, true)
const loaded = migratePlayerSave(unpackState(packState(s)))
assert.equal(loaded.me!.titles[0].fmvp, true, 'cross-year/save/migration preserves recorded FMVP')
assert.equal(careerOverview(loaded, 'career').fmvps.confirmed, 1)
assert.equal(careerOverview(loaded, 'season').fmvps.confirmed, 0)
assert.equal(careerTrophies(loaded)[0].fmvp, true)
me.titles.push({ year: 2025, title: '旧档未记赛事', started: true })
assert.deepEqual(fmvpTotals(me.titles), { confirmed: 1, unknown: 1 })
const key = `fmvp:2026:${comp.name}`
delete me.titles[0].fmvp
ensureCeilings(s)!.seen.push(key)
rememberFMVPs(s)
assert.equal(me.titles[0].fmvp, true, 'retained historical award key proves old international FMVP')
assert.equal(me.titles[1].fmvp, undefined, 'absence of evidence must not invent a negative')
me.titles.push({ year: 2026, title: '没有决赛的循环赛', started: true })
ensureCeilings(s)!.seen.push('fmvp:2026:没有决赛的循环赛')
rememberFMVPs(s)
assert.equal(me.titles[2].fmvp, undefined, 'reward-like key alone does not invent a final')
me.titles.push({ year: 2026, title: '未登场奖杯', started: false, fmvp: true })
rememberFMVPs(s)
assert.equal(me.titles[3].fmvp, false)
const readSnapshot = JSON.stringify(s)
careerOverview(s, 'career'); careerTrophies(s); fmvpTotals(me.titles)
assert.equal(JSON.stringify(s), readSnapshot, 'UI consumers are read-only')
retire(s, '测试结束')
noteHall(s, true)
assert.equal(readHall()!.cards[0].titles.filter(t => t.fmvp).length, 1)
const exported = exportHall()!
mem.delete(HALL_KEY)
assert.equal(importHall(exported), 'ok')
assert.equal(importHall(exported), 'ok')
assert.equal(readHall()!.cards.length, 1)
assert.equal(readHall()!.cards[0].titles.filter(t => t.fmvp).length, 1)
const older = JSON.parse(exported)
for (const t of older.cards[0].titles) delete t.fmvp
mem.set(HALL_KEY, JSON.stringify(older))
noteHall(s, true)
assert.equal(readHall()!.cards[0].titles.filter(t => t.fmvp).length, 1, 'loading an old retired career updates its existing hall card')
mem.set(HALL_KEY, JSON.stringify(older))
assert.equal(importHall(exported), 'ok')
assert.equal(readHall()!.cards[0].titles.filter(t => t.fmvp).length, 1, 'merge supplements same-card old honors')
console.log('PASS FMVP: actual final graph, non-finals/friendlies/bench/loss excluded, persist/trim/reload, old evidence/unknown, read-only consumers, hall round-trip, MVP stats untouched')
