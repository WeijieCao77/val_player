import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ACH_BY_KEY, checkAchievements, earnedTitles } from '../src/engine/me/achievements'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import type { MeMatchRecord } from '../src/engine/me/types'

const fresh = () => createCareer({ scenario: 'boaster-2023', name: 'probe', region: 'EMEA', role: '控场', start: 't1', talents: emptyTalents(), originKey: 'real', seed: 7 })
const match: MeMatchRecord = {
  fixtureId: 'lockin-final-test', day: 63, year: 2023, comp: 'LOCK//IN 圣保罗', label: '总决赛',
  opp: 'test-opponent', oppTag: 'TEST', started: true, won: false, score: '2:3', maps: 5,
  rounds: 100, kills: 70, deaths: 70, assists: 20, firstKills: 10, clutches: 1, acs: 200,
  rating: 1, mvp: false, carried: false, nodes: [], rank: 3,
}
const key = 'title_lockin', crown = ACH_BY_KEY[key], participation = ACH_BY_KEY.lockin
assert.ok(crown && participation)
assert.equal(participation.reward?.title, 'LOCK//IN 一代', 'existing participation reward is unchanged')
const s = fresh(), me = s.me!
assert.equal(crown.cond(s), false)
me.matches.push(match)
assert.equal(participation.cond(s), true)
assert.equal(crown.cond(s), false, 'a finals loss is participation, not a championship')
me.matches[0].won = true
me.matches[0].label = '首轮'
assert.equal(crown.cond(s), false, 'a won match alone is not a title')
me.titles.push({ year: 2023, title: '东京大师赛', started: true }, { year: 2023, title: '2023 全球冠军赛', started: true })
assert.equal(crown.cond(s), false, 'other international titles do not count')
me.scenario!.historicalHonors.push('2023 LOCK//IN 圣保罗冠军')
assert.equal(crown.cond(s), false, 'real-world pre-takeover honors do not count')

for (const started of [true, false]) {
  const winner = fresh()
  winner.me!.titles.push({ year: 2023, title: 'LOCK//IN 圣保罗', started })
  assert.equal(crown.cond(winner), true, 'team champion title counts for starters and substitutes')
  // Simulate an older save which earned the trophy before this new achievement existed.
  const loaded = migratePlayerSave(unpackState(packState(winner)))
  assert.equal(loaded.me!.achievements.includes(key), false)
  assert.ok(checkAchievements(loaded).some(a => a.key === key))
  assert.ok(earnedTitles(loaded.me!).includes('LOCK//IN 冠军'))
  assert.equal(checkAchievements(loaded).some(a => a.key === key), false)
  assert.equal(loaded.me!.achState!.paid.filter(k => k === key).length, 1)
  const again = migratePlayerSave(unpackState(packState(loaded)))
  assert.ok(earnedTitles(again.me!).includes('LOCK//IN 冠军'))
  assert.equal(checkAchievements(again).some(a => a.key === key), false)
  assert.equal(again.me!.achievements.filter(k => k === key).length, 1)
}
console.log('PASS LOCK//IN champion achievement: separate participation, title evidence, historical exclusion, starter/substitute, old-save unlock and one-time reward')
