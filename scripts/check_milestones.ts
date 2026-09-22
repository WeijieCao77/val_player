import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { careerMilestones } from '../src/engine/me/milestones'
import { ACHIEVEMENTS, ACH_BY_KEY, checkAchievements, earnedTitles } from '../src/engine/me/achievements'
import { trimDetail } from '../src/engine/me/detail'
import { MeMatch } from '../src/engine/me/matchplay'
import { autoWeek } from '../src/engine/me/auto'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { SEASON_DAYS } from '../src/engine/calendar'
import type { Fixture } from '../src/engine/types'

Object.assign(globalThis, { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} }, fetch: () => Promise.reject(new Error('offline')) })
const base = createCareer({ name: '里程碑验收', region: 'Europe', role: '先锋', talents: emptyTalents(), originKey: 'netcafe', start: 't1', seed: 721, year: 2026 })
const fresh = () => structuredClone(base)
const counts = (s: typeof base) => careerMilestones(s).map((m) => m.count)
const reload = (s: typeof base) => migratePlayerSave(unpackState(packState(s)))

{
  const s = fresh(), me = s.me!, p = s.players[me.id]
  me.seasonStart.starts = 99; p.career.maps = 999; p.career.kills = 9999
  assert.deepEqual(counts(s), [99, 999, 9999])
  for (const key of ['matches100', 'maps1000', 'kills10000']) assert.equal(ACH_BY_KEY[key].cond(s), false)
  me.seasonStart.starts++; p.career.maps++; p.career.kills++
  for (const key of ['matches100', 'maps1000', 'kills10000']) assert.equal(ACH_BY_KEY[key].cond(s), true)
  // Set all existing rewards paid to isolate the two newly-added title rewards.
  me.achievements = ACHIEVEMENTS.filter((a) => a.key !== 'maps1000' && a.key !== 'kills10000').map((a) => a.key)
  me.achState = { paid: [...me.achievements], seen: me.achievements.length }
  const before = JSON.stringify({ p, mental: me.mental, body: me.body, heat: me.heat, fans: me.fans, money: me.money })
  assert.deepEqual(checkAchievements(s).map((a) => a.key), ['maps1000', 'kills10000'])
  assert.equal(JSON.stringify({ p, mental: me.mental, body: me.body, heat: me.heat, fans: me.fans, money: me.money }), before)
  assert.ok(earnedTitles(me).includes('千图征途')); assert.ok(earnedTitles(me).includes('万杀选手'))
  assert.deepEqual(ACH_BY_KEY.matches100.reward, { heat: 10 })
  const paid = [...me.achState.paid], logs = me.log.length
  checkAchievements(s); assert.deepEqual(me.achState.paid, paid); assert.equal(me.log.length, logs)
  const loaded = reload(s); checkAchievements(loaded)
  assert.deepEqual(loaded.me!.achState!.paid, paid); assert.deepEqual(counts(loaded), [100, 1000, 10000])
  trimDetail(me, s.year + 5, 1); assert.deepEqual(counts(s), [100, 1000, 10000])
  console.log('PASS threshold/title-only/reward-once/reload/detail-trim/old matches100 reward')
}
{
  const s = fresh(), p = s.players[s.me!.id]
  for (const value of [NaN, Infinity, -5, undefined]) {
    p.career.maps = value as number; p.career.kills = value as number
    assert.deepEqual(counts(s).slice(1), [0, 0]); assert.equal(ACH_BY_KEY.maps1000.cond(s), false)
  }
  delete (p as Partial<typeof p>).career
  assert.deepEqual(counts(s).slice(1), [0, 0]); assert.deepEqual(counts(reload(s)).slice(1), [0, 0])
  console.log('PASS missing/invalid legacy counters never fabricated')
}
// Actual match consumers: same roster and Bo3, three different real branches.
for (const mode of ['official', 'scrim', 'friendly'] as const) {
  const s = fresh(), me = s.me!, team = s.teams[s.myTeam], p = s.players[me.id]
  team.starters = [me.id, ...team.roster.filter((id) => id !== me.id)].slice(0, 5)
  const opp = Object.values(s.teams).find((t) => t.id !== team.id && t.roster.length >= 5)!
  const f: Fixture = { id: `milestone-${mode}`, day: s.day, stage: s.stage, comp: mode === 'scrim' ? 'scrim' : 'milestone-official', label: '验收', teamA: team.id, teamB: opp.id, bo: 3, played: false }
  const before = counts(s)
  const rec = new MeMatch(s, mode === 'friendly' ? { aId: team.id, bId: opp.id, bo: 3, comp: '验收友谊赛', label: '验收' } : f).runOut()
  assert.ok(rec.started); assert.ok(rec.maps >= 2); assert.ok(rec.kills > 0)
  if (mode === 'official') assert.deepEqual(counts(s), [before[0] + 1, before[1] + rec.maps, before[2] + rec.kills])
  else assert.deepEqual(counts(s), before)
  assert.equal(p.career.maps, mode === 'official' ? rec.maps : 0)
  console.log(`PASS actual ${mode} series ${rec.maps} maps / ${rec.kills} kills; official counter delta ${JSON.stringify(counts(s).map((n, i) => n - before[i]))}`)
}
{
  // Real week/year boundary invokes onSeasonEnd, not a hand-written archive.
  const s = fresh(), me = s.me!, p = s.players[me.id]
  s.day = SEASON_DAYS - 2; me.weekDay = 0; me.pending = []; me.moments = []
  me.seasonStart.starts = 100; me.seasonStart.matches = 110; p.career.maps = 1000; p.career.kills = 10000
  const year = s.year
  for (let i = 0; i < 5 && s.year === year; i++) { autoWeek(s); me.moments = [] }
  assert.equal(s.year, year + 1); assert.ok(me.seasons.some((x) => x.year === year && x.starts === 100))
  assert.deepEqual(counts(s), [100, 1000, 10000]); assert.deepEqual(counts(reload(s)), [100, 1000, 10000])
  console.log('PASS actual autoWeek season rollover preserves lifetime counters and reload')
}
