/** Positional trials, club selection and poor-performance guards. Offline synthetic fixtures only. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { afterMyMatch, coachView, duelTarget, runDuel } from '../src/engine/me/coach'
import { duelScene, duelOptP, startDuel, DUEL_SCENES } from '../src/engine/me/duel'
import { roleCoreDims } from '../src/engine/me/roleCore'
import { startTryout, tryoutChoose, tryoutDays, TRYOUT_DAYS } from '../src/engine/me/tryout'
import { tryoutSkill, expectOf, skillRead } from '../src/engine/me/prepro'
import { makeDeal } from '../src/engine/me/contract'
import { pitchOdds } from '../src/engine/me/selfpitch'
import { Rng } from '../src/engine/rng'
import { recomputeOverall, weightsFor } from '../src/engine/player'
import { ATTR_KEYS, ATTR_CN, ROLES } from '../src/engine/types'
import type { GameState, Role } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

const mem: Record<string, string> = {}
Object.assign(globalThis, {
  localStorage: { getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = v }, removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0 },
  fetch: () => Promise.reject(new Error('offline')),
})
let checks = 0
const check = (ok: unknown, text: string) => { assert.ok(ok, text); checks++; console.log(`PASS ${text}`) }
const fresh = (role: Role, start: 'pre' | 't1' = 'pre') => createCareer({ name: 'RoleCheck', region: 'EMEA', role, start, originKey: 'netcafe', talents: emptyTalents(), seed: 7133, year: 2026 })

const prototype = fresh('决斗者')
const teamId = Object.values(prototype.teams).filter(t => t.tier === 2 && !t.dormant && t.region === prototype.me!.region).sort((a, b) => a.id.localeCompare(b.id))[0].id
const readings: unknown[] = []
for (const role of ROLES) {
  const s = structuredClone(prototype)
  const me = s.me!, p = s.players[me.id]
  p.role = role; p.roles = [role]; p.stageBonus = 0
  const core = roleCoreDims(role), weights = weightsFor(p)
  check(new Set(core).size === 3, `${role}: 三项岗位维度不重复`)
  const coreWeight = core.reduce((sum, k) => sum + weights[k], 0)
  const other = (80 - coreWeight * 88) / (1 - coreWeight)
  for (const k of ATTR_KEYS) p.attrs[k] = core.includes(k) ? 88 : other
  recomputeOverall(p)
  p.rounds = 5000; p.form = 70; p.fatigue = 0
  me.coachTrust = 60; me.proven = false; me.pre.tac = 20; me.pre.ladder = 50
  check(p.overall === 80 && p.attrs.aim >= 60, `${role}: 等质80综合构建保留枪法基础`)
  // Remove differing roster needs, not skill requirements, to isolate a club's valuation.
  for (const id of s.teams[teamId].starters) { s.players[id].roles = [...ROLES]; s.players[id].overall = 70 }
  const odds = pitchOdds(s, s.teams[teamId])
  const deal = makeDeal(s, teamId, 'sign', 'B', new Rng(39))
  const renew = makeDeal(s, teamId, 'renew', 'B', new Rng(39))
  readings.push({ skill: tryoutSkill(s), coach: coachView(s, p, false), odds: odds.pct, seat: deal.role, renew: renew.role, bar: expectOf(s.teams[teamId]) })
  check(skillRead(s).shown === Math.round(tryoutSkill(s)), `${role}: UI试训实力与实际判定一致`)
  const day = tryoutDays(s)[0]
  check(day.opts[day.rec].dim === core[0] && day.opts.some(o => o.dim === 'aim'), `${role}: 新试训以岗位专项为推荐且保留枪法选项`)
  me.pre.invites.push({ id: 'test', teamId, via: 'self', day: s.day, expires: s.day + 14, direct: false })
  check(startTryout(s, 'test') === null && me.tryout?.assessmentVersion === 1, `${role}: 试训持久化新版本标记`)
  const logged = tryoutChoose(s, 0)
  check(logged.dim === ATTR_CN[core[0]], `${role}: 实际第一天使用岗位属性而非固定枪法`)
  delete me.tryout!.assessmentVersion
  me.tryout!.step = 0
  check(tryoutDays(s)[0] === TRYOUT_DAYS[0], `${role}: 旧存档进行中的试训保留原题`)
  me.pre.wasPro = true
  check(tryoutDays(s).length === 3 && tryoutDays(s)[0] === TRYOUT_DAYS[1], `${role}: 职业履历继续跳过首日`)
}
for (const row of readings) assert.deepEqual(row, readings[0], '等质不同岗位不应被俱乐部标签额外奖励或惩罚')
check(true, '等综合、同背景五位置：试训/自荐/教练/签约续约估值一致')

for (const role of ROLES) {
  const s = fresh(role, 't1'), me = s.me!, p = s.players[me.id]
  const team = s.teams[s.myTeam]
  me.trial = undefined; me.benchLock = undefined; me.duelsThisWeek = 0; me.ap = 8
  me.promiseMatches = 3; me.mental = 50; p.fatigue = 54; p.form = 70; p.injuredUntil = 0
  team.starters = team.roster.filter(id => id !== me.id).slice(0, 5)
  for (const id of team.starters) {
    const q = s.players[id]; q.isIgl = false; q.role = role; q.roles = [role]
    for (const k of ATTR_KEYS) q.attrs[k] = 70
  }
  for (const k of ATTR_KEYS) p.attrs[k] = 70
  for (const k of roleCoreDims(role)) p.attrs[k] = 80
  check(!!duelTarget(s), `${role}: 确实有同岗位首发作对手`)
  const bot = structuredClone(s)
  const result = runDuel(bot, new Rng(11))!
  assert.deepEqual(result.rounds.map(r => r.dim), roleCoreDims(role).map(k => ATTR_CN[k]))
  check(startDuel(s) === null, `${role}: 手动对位可以开始`)
  const live = me.duelLive!
  for (let i = 0; i < 3; i++) {
    live.round = i + 1
    const scene = duelScene(s)!
    check(scene.a.length === 2 && scene.a[1].risk === 1.2, `${role}: 只留标准和冒险两种不同回报选择`)
    check(scene.a[0].dim === roleCoreDims(role)[i], `${role}: 第${i + 1}题手动/托管同维度`)
    check(Math.round(duelOptP(s, scene.a[0]) * 100) === result.rounds[i].p, `${role}: 第${i + 1}题标准风险手动/托管同胜率`)
  }
  live.pool = [0, 1, 2, 3, 4]; live.round = 1
  check(duelScene(s) === DUEL_SCENES[0] && duelScene(s)!.a[0].dim === 'reaction', `${role}: 旧对位存档保留旧场景索引`)
}

function record(s: GameState, rating: number, version?: 1): MeMatchRecord {
  return { fixtureId: 'role-low-rank', day: s.day, year: s.year, comp: 'probe', label: '', opp: 'Probe', oppTag: 'PRB', started: true, won: false, score: '0-2', maps: 2, rounds: 44, kills: 30, deaths: 28, assists: 10, firstKills: 3, clutches: 1, acs: 200, rating, performanceVersion: version, mvp: false, carried: false, nodes: [], rank: 5 }
}
for (const role of ROLES) {
  for (const [rating, version, punished] of [[1.05, 1, false], [0.94, 1, true], [1.05, undefined, true]] as const) {
    const s = fresh(role, 't1'), me = s.me!, p = s.players[me.id]
    p.isIgl = false; p.iglSource = undefined; me.trial = undefined; me.benchLock = undefined
    me.badStreak = 0; me.rotateHeat = 0; me.graceMatches = 0; me.coachTrust = 60; me.proven = false
    for (let i = 0; i < 3; i++) afterMyMatch(s, record(s, rating, version))
    check(!!me.benchLock === punished, `${role}: rating=${rating} version=${version ?? 'legacy'} 末位处罚=${punished}`)
  }
}

for (const role of ROLES) {
  const prepareTrial = () => {
    const s = fresh(role, 't1'), me = s.me!
    const displaced = s.teams[s.myTeam].roster.find(id => id !== me.id)!
    me.trial = { left: 2, displaced, forgiven: false }; me.proven = false; me.benchLock = undefined
    me.coachTrust = 60
    return s
  }
  {
    const s = prepareTrial(), me = s.me!
    const rec = { ...record(s, 1.10, 1), rank: 3 }
    afterMyMatch(s, rec)
    check(me.trial?.left === 1 && !me.proven, `${role}: 新评分正好1.10虽输且第3通过一场，不直接免两场试用`)
    afterMyMatch(s, rec)
    check(!me.trial && me.proven, `${role}: 两次实际达标才完成试用`)
  }
  for (const [rating, version] of [[1.099, 1], [1.5, undefined]] as const) {
    const s = prepareTrial()
    afterMyMatch(s, { ...record(s, rating, version), rank: 3 })
    check(!s.me!.trial && !s.me!.proven, `${role}: ${version ? '未到1.10' : '无新评分标记'}仍未通过试用`)
  }
  {
    const s = prepareTrial(), me = s.me!
    const opp = Object.values(s.teams).find(t => t.id !== s.myTeam)!
    opp.rating = s.teams[s.myTeam].rating + 6
    const rec = { ...record(s, 0.8, 1), oppTag: opp.tag, rank: 3 }
    afterMyMatch(s, rec)
    check(me.trial?.left === 2 && me.trial.forgiven, `${role}: 强队差距6仍只有一次宽容，不扣剩余场`)
    afterMyMatch(s, rec)
    check(!me.trial && !me.proven, `${role}: 第二次不达标不能无限宽容`)
  }
  for (const [won, rank] of [[true, 5], [false, 2]] as const) {
    const s = prepareTrial()
    afterMyMatch(s, { ...record(s, 0.8, 1), won, rank })
    check(s.me!.trial?.left === 1, `${role}: 保留${won ? '胜局' : '贡献前二'}原达标路径`)
  }
}
console.log(`role selection: ${checks} assertions passed`)
