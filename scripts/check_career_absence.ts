/** Strict career leave: real engine entry points, real circuit graphs, no network. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { activeAbsence, beginAbsence, absenceTick, absenceActionBlock } from '../src/engine/me/absence'
import { internationalFinal, finishMedicalFinal } from '../src/engine/me/absenceFinal'
import { coachStarters, afterMyMatch, runDuel } from '../src/engine/me/coach'
import { selectLineup } from '../src/engine/match'
import { doAction, actionBlock, settleWeek } from '../src/engine/me/week'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { injuryRelax } from '../src/engine/me/injury'
import { startDuel } from '../src/engine/me/duel'
import { startTryout, tryoutChoose } from '../src/engine/me/tryout'
import { enterCup, mountCupMatch, cupFor, resumeCup } from '../src/engine/me/cups'
import { hurtBeforeMatch, answerHurt, playsHurt } from '../src/engine/me/hurtplay'
import { MeMatch } from '../src/engine/me/matchplay'
import { weeklyTick } from '../src/engine/training'
import { eventsOf } from '../src/engine/circuit'
import { SEASON_DAYS } from '../src/engine/calendar'
import { Rng } from '../src/engine/rng'
import type { GameState, Fixture, Competition } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

Object.assign(globalThis, { fetch: () => Promise.reject(new Error('offline')) })
let checks = 0
const ok = (v: unknown, line: string) => { assert.ok(v, line); checks++; console.log(`PASS ${line}`) }
const base = createCareer({ name: 'AbsenceTest', region: 'EMEA', role: '先锋', start: 't1', originKey: 'rich', talents: emptyTalents(), seed: 8771, year: 2026 })
const fresh = () => structuredClone(base)
const putStarter = (s: GameState) => {
  const me = s.me!, team = s.teams[s.myTeam]
  team.starters = [me.id, ...team.roster.filter(id => id !== me.id).slice(0, 4)]
}

{
  const s = fresh(), me = s.me!, p = s.players[me.id]
  s.day = SEASON_DAYS - 7
  putStarter(s)
  p.injuredUntil = s.day + 20; p.injuryNote = '手腕劳损'; me.injury = { kind: 'wrist', from: s.day, played: 0 }
  const a = beginAbsence(s, 'surgery', 21, '术后休养')
  assert.deepEqual(a.until, { year: 2027, day: 14 })
  ok(a.wasStarter && !coachStarters(s).includes(me.id) && !selectLineup(s, s.myTeam).some(x => x.id === me.id), '医疗缺阵跨年21天，首发/比赛阵容硬排除')
  const until = JSON.stringify(a.until)
  for (let i = 0; i < 50; i++) injuryRelax(s, 'physio')
  ok(JSON.stringify(a.until) === until && activeAbsence(s) === a, '普通理疗不能缩短长期缺阵')
  const same = beginAbsence(s, 'family', 1, '另一个事件')
  ok(same === a && me.careerEvents!.records.length === 1, '重复开始不覆盖期限或重复记账')
  s.year = 2027; s.day = 13; absenceTick(s)
  ok(!!activeAbsence(s) && me.careerEvents!.returns === 0, '到期前一天不能提前复出')
  s.day = 14; absenceTick(s); absenceTick(s)
  ok(!activeAbsence(s) && me.careerEvents!.returns === 1 && me.careerEvents!.familyReturns === 0, '到期日恢复且回归只计一次')
  beginAbsence(s, 'family', 'season', '家庭照料')
  assert.deepEqual(activeAbsence(s)!.until, { year: 2028, day: 0 })
  s.year = 2028; s.day = 0; absenceTick(s)
  ok(me.careerEvents!.familyReturns === 1 && me.careerEvents!.returns === 1, '家庭缺席与医疗康复分账，赛季报销跨年恢复')
}

{
  const s = fresh(), me = s.me!, p = s.players[me.id]
  beginAbsence(s, 'family', 42, '家庭照料')
  const before = JSON.stringify({ attrs: p.attrs, xp: p.xp })
  for (const action of ['aim', 'util', 'ranked', 'scrim', 'duo', 'duel', 'stream'] as const) ok(!!actionBlock(s, action) && !!doAction(s, action), `${action}不能绕过缺阵限制`)
  ok(JSON.stringify({ attrs: p.attrs, xp: p.xp }) === before, '被拦训练无成长副作用')
  ok(doAction(s, 'vod') === null && !!doAction(s, 'vod') && doAction(s, 'rest') === null, '只允许每周一次轻量复盘与休息')
  ok(!!startDuel(s) && runDuel(s, new Rng(1)) === null, '手动与直接托管对位都被拦截')
  me.pre.invites.push({ id: 'absence-invite', teamId: s.myTeam, via: 'self', day: s.day, expires: s.day + 14 })
  ok(!!startTryout(s, 'absence-invite') && !me.tryout, '缺阵无法开始试训')
  me.tryout = { inviteId: 'old-trial', teamId: s.myTeam, startDay: s.day, step: 0, score: 0, log: [] }
  tryoutChoose(s, 0)
  ok(me.tryout.step === 0 && me.tryout.score === 0, '旧存档进行中试训不能在缺阵时推进')
  autoResolve(s, { kind: 'tryout', id: 'old-trial' })
  ok(!me.tryout, '托管结束无法继续的试训而非死循环')
  ok(!!enterCup(s, 'premier', new Rng(1)), '不能报名杯赛绕过正式赛事禁赛')
  assert.throws(() => mountCupMatch(s, cupFor(s, 'premier')!, 0, new Rng(1)))
  ok(!s.teams.CUP_MINE, '直接杯赛入场也不生成临时参赛阵容')
  me.pre.cup = { key: 'premier', round: 0, alive: true, mates: [], results: [], next: s.day, year: s.year, club: s.myTeam }
  resumeCup(s)
  ok(!me.pre.cup && me.pre.cups.at(-1)?.forfeit, '已经报名的杯赛在缺阵比赛日实际弃权而非挂起')
  p.injuredUntil = s.day + 3; me.injury = { kind: 'ill', from: s.day, played: 0 }
  answerHurt(s, 'fake', true)
  ok(!me.injury.play && !playsHurt(s, 'fake', true), '带伤硬上与杯赛asFit无法绕过长期缺阵')
  const xp = JSON.stringify(p.xp)
  s.training[me.id] = 'aim'
  weeklyTick(s, new Rng(17))
  ok(JSON.stringify(p.xp) === xp, '俱乐部被动训练也不能在家庭请假期间加点')
  me.trial = { left: 2, displaced: s.teams[s.myTeam].roster.find(id => id !== me.id)!, forgiven: false }
  me.promiseMatches = 0
  const trust = me.coachTrust
  afterMyMatch(s, { started: false, friendly: false } as MeMatchRecord)
  ok(me.trial.left === 2 && me.promiseMatches === 0 && me.coachTrust === trust, '医疗/家庭缺席不消耗试用、保底或信任')
  // Even with no other registered or free player, leave is never overridden by emergency fill.
  s.teams[s.myTeam].roster = [me.id]; s.teams[s.myTeam].starters = [me.id]
  ok(!selectLineup(s, s.myTeam).some(x => x.id === me.id), '人手不足不会强制缺阵玩家上场')
}

{
  const s = fresh(), me = s.me!
  beginAbsence(s, 'illness', 42, '医疗休养')
  me.plan = {}; me.ap = me.apMax = 8
  autoPlan(s)
  ok(me.plan.vod === 1 && Object.keys(me.plan).every(k => k === 'vod' || k === 'rest'), '推荐与托管只安排轻量复盘/休息')
  me.coachTrust = 60
  me.plan = {}; me.pending = []; me.pendingEvent = undefined
  me.chain = { id: 'rift', step: 1, wk: me.week - 2, due: me.week, score: 0, track: 'duo', need: 1, got: 0 }
  const due = me.chain.due
  settleWeek(s)
  ok(me.coachTrust === 60, '批准缺阵不吃未参加训练导致的每周信任扣分')
  ok(me.chain.due === due + 1 && me.chain.got === 0, '缺阵期间剧情任务截止顺延而不是算失约')
}

// Build fixtures from the real graph. The test oracle selects the data's explicit final round;
// production code must independently identify its terminal graph node.
function withEvent(s: GameState, ev: ReturnType<typeof eventsOf>[number], node: number): Fixture {
  const club = s.myTeam
  const opp = Object.values(s.teams).find(t => t.id !== club && t.tier === 1 && !t.dormant)!.id
  const flat = ev.units.flatMap(u => u.nodes ?? [])
  const key = `ev:${ev.id}`
  const comp: Competition = { key, name: ev.cn, stage: ev.stage!, teams: [club, opp], standings: {}, finished: [], format: 'circuit', circuit: { id: ev.id, start: ev.start ?? 0, end: ev.end ?? 0, seeds: [club, opp], mode: 'sim' } }
  s.comps[key] = comp
  const n = flat[node]
  const f: Fixture = { id: `absence:${ev.id}:${node}`, day: s.day, comp: key, stage: ev.stage!, teamA: club, teamB: opp, bo: n.bo, label: n.round, node, played: false }
  s.fixtures = [f]
  return f
}
let globals = 0, rejected = 0
for (const year of [2021, 2022, 2023, 2024, 2025, 2026, 2027]) {
  for (const ev of eventsOf(year).filter(e => e.region === null && ['s2finals', 's3finals', 'masters1', 'masters2', 'champions'].includes(e.stage ?? ''))) {
    const flat = ev.units.flatMap(u => u.nodes ?? [])
    const final = flat.findIndex(n => /^(总决赛|Grand Final|Grand Finals|决赛|Final)$/i.test(n.round))
    if (final < 0) continue
    const s = fresh(); s.year = year
    ok(!!internationalFinal(s, withEvent(s, ev, final)), `${year} ${ev.cn}：真实总决赛图节点被识别`)
    globals++
    for (let i = 0; i < flat.length; i++) if (i !== final) {
      assert.equal(internationalFinal(s, withEvent(s, ev, i)), null, `${ev.cn} ${flat[i].round} must not be final`)
      rejected++
    }
  }
}
ok(globals >= 15 && rejected >= 100, `真实国际赛事 ${globals} 个决赛、${rejected} 个非决赛节点独立分类`)
{
  const ev = eventsOf(2021).find(e => e.region !== null && e.stage === 's1masters' && e.units.some(u => u.nodes?.some(n => n.round === '总决赛')))!
  const flat = ev.units.flatMap(u => u.nodes ?? [])
  ok(!internationalFinal(base, withEvent(base, ev, flat.findIndex(n => n.round === '总决赛'))), '2021区域大师赛总决赛不冒充国际大赛')
}
{
  const ev = eventsOf(2026).find(e => e.region === null && e.stage === 'champions')!
  const final = ev.units.flatMap(u => u.nodes ?? []).findIndex(n => n.round === '总决赛')
  const s = fresh(); putStarter(s)
  const f = withEvent(s, ev, final)
  beginAbsence(s, 'surgery', 100, '术后休养')
  hurtBeforeMatch(s, f)
  ok(s.me!.careerEvents!.pendingMedicalFinal?.fixtureId === f.id, '真实医疗原首发的决赛缺席在赛前留证')
  const reloaded = JSON.parse(JSON.stringify(s)) as GameState
  const rf = reloaded.fixtures[0]
  const rec = new MeMatch(reloaded, rf).runOut()
  ok(!rec.started && reloaded.me!.careerEvents!.missedFinals.length === 1, '保存重载后真实比赛结算确认零出场并记录空悲切')
  finishMedicalFinal(reloaded, rf, rec)
  ok(reloaded.me!.careerEvents!.missedFinals.length === 1, '重复结算不重复记录决赛缺席')
  for (const kind of ['family', 'bench'] as const) {
    const other = fresh()
    if (kind === 'family') putStarter(other)
    else other.teams[other.myTeam].starters = other.teams[other.myTeam].starters.filter(id => id !== other.me!.id)
    const ff = withEvent(other, ev, final)
    beginAbsence(other, kind === 'family' ? 'family' : 'surgery', 42, '缺席')
    hurtBeforeMatch(other, ff)
    ok(!other.me!.careerEvents!.pendingMedicalFinal, `${kind}不获得医疗原首发决赛证明`)
  }
  const moved = fresh(); putStarter(moved)
  beginAbsence(moved, 'surgery', 42, '休养')
  moved.myTeam = Object.keys(moved.teams).find(id => id !== moved.myTeam && moved.teams[id].tier === 1)!
  const mf = withEvent(moved, ev, final)
  hurtBeforeMatch(moved, mf)
  ok(!moved.me!.careerEvents!.pendingMedicalFinal, '旧队首发快照不能跨转会授予新队决赛缺席证明')

  const ordinary = fresh(), om = ordinary.me!, op = ordinary.players[om.id]
  putStarter(ordinary)
  op.overall = 99; op.form = 99; op.fatigue = 0; om.coachTrust = 100; om.promiseMatches = 10; om.trial = undefined
  ok(coachStarters(ordinary).includes(om.id), '普通重伤测试前确认确为健康时首发')
  const of = withEvent(ordinary, ev, final)
  op.injuredUntil = ordinary.day + 25; op.injuryNote = '手腕劳损'; om.injury = { kind: 'wrist', from: ordinary.day, played: 0, sit: true }
  hurtBeforeMatch(ordinary, of)
  ok(om.careerEvents?.pendingMedicalFinal?.reason === 'injury', '之前选择养伤不再弹卡，仍可记录真实决赛缺席')
  const or = new MeMatch(ordinary, of).runOut()
  ok(!or.started && om.careerEvents!.missedFinals.length === 1, '普通重伤原首发真实缺席冠军决赛也计入空悲切')
}
ok(absenceActionBlock(fresh(), 'aim') === null, '普通档案没有缺阵字段时行为不变')
console.log(`Career absence: ${checks} checks passed`)
