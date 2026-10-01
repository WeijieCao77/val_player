/** Regression coverage for #d22f178b chronology and #519c5a5f coach status. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ACH_BY_KEY, checkAchievements } from '../src/engine/me/achievements'
import { standingLine } from '../src/engine/me/coach'
import { beginAbsence } from '../src/engine/me/absence'
import type { MeMatchRecord } from '../src/engine/me/types'

Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  fetch: () => Promise.reject(new Error('offline')),
})
const s = createCareer({ name: 'Bug', region: 'EMEA', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 't1', year: 2026, seed: 5 })
const me = s.me!, team = s.teams[s.myTeam], p = s.players[me.id]
let fx = 0
const rec = (day: number, extra: Partial<MeMatchRecord> = {}): MeMatchRecord => ({
  fixtureId: `oct01-${fx++}`, day, year: 2026, comp: 'VCT', label: '', opp: 'Probe', oppTag: 'PRB',
  started: true, won: false, score: '0-2', maps: 2, rounds: 44, kills: 30, deaths: 28, assists: 10,
  firstKills: 3, clutches: 1, acs: 200, rating: 1, mvp: false, carried: false, nodes: [], rank: 3, ...extra,
})
const final = rec(20, { won: true, label: '总决赛' })
const cond = ACH_BY_KEY.skid_title.cond
me.titles = [{ year: 2026, title: 'VCT', started: true }]
me.matches = [rec(10), rec(11), rec(12), final]
assert(cond(s), 'same-year three losses followed by title')
me.matches = [final, rec(21), rec(22), rec(23)]
assert(!cond(s), 'title before three losses must not unlock')
me.matches.push(rec(30, { won: true, label: '总决赛', comp: 'Another league' }))
assert(!cond(s), 'another event of the same class cannot date this title')
me.matches = [rec(10, { year: 2025 }), rec(11, { year: 2025 }), rec(12, { year: 2025 }), final]
assert(!cond(s), 'losses from another year do not count')
me.matches = [rec(10, { friendly: true }), rec(11, { started: false }), rec(12), rec(13), final]
assert(!cond(s), 'friendly and bench losses do not count')
me.matches = [rec(10), rec(11, { drawn: true }), rec(12), final]
assert(!cond(s), 'draw breaks losing streak')
me.matches = [rec(10), rec(11), rec(12)]
assert(!cond(s), 'old title with no victory evidence cannot guess chronology')
me.matches = [rec(10), rec(11), rec(12), { ...final, friendly: true }]
assert(!cond(s), 'friendly final is not championship evidence')
me.matches = [rec(12), final, rec(10), rec(11)]
const ids = me.matches.map(m => m.fixtureId)
assert(cond(s), 'sort chronology without mutating records')
assert.deepEqual(me.matches.map(m => m.fixtureId), ids)
me.titles[0].started = false
assert(!cond(s), 'bench title does not count')
me.achievements.push('skid_title')
checkAchievements(s)
assert(me.achievements.includes('skid_title'), 'existing unlocks remain')

const start = () => { team.starters = [me.id, ...team.starters.filter(id => id !== me.id).slice(0, 4)] }
const bench = () => { team.starters = team.starters.filter(id => id !== me.id) }
me.promiseMatches = 3
me.trial = undefined
me.benchLock = undefined
me.proven = true
p.injuredUntil = 0
start()
for (const where of ['week', 'team'] as const) assert.match(standingLine(s, where), /认定的首发/)
bench()
for (const where of ['week', 'team'] as const) assert.doesNotMatch(standingLine(s, where), /你是教练认定的首发/)
me.trial = { left: 1, displaced: team.starters[0], forgiven: false }
for (const where of ['week', 'team'] as const) assert.match(standingLine(s, where), /替补席.*试用期/)
start()
assert.match(standingLine(s, 'week'), /^试用期/)
p.injuredUntil = s.day + 10
assert.match(standingLine(s, 'week'), /伤停/)
p.injuredUntil = 0
me.trial = undefined
me.promiseMatches = 0
p.contract!.promisedRole = 'starter'
assert.match(standingLine(s, 'week'), /合同承诺的首发/)
bench()
assert.doesNotMatch(standingLine(s, 'week'), /写死是你的/)
p.contract!.promisedRole = 'bench'
assert.match(standingLine(s, 'week'), /替补，还剩 3 场/)
start()
assert.match(standingLine(s, 'week'), /已列入首发名单/)
bench()
me.trial = { left: 1, displaced: team.starters[0], forgiven: false }
me.benchLock = s.day + 7
assert.match(standingLine(s, 'week'), /7 天后重新考虑/)
beginAbsence(s, 'medical', 10, '休养')
for (const where of ['week', 'team'] as const) assert.match(standingLine(s, where), /休养期间暂停出场/)
console.log('October 1 achievement chronology and coach status checks passed')
