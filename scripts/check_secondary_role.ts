import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { chooseSecondary, normalizePositionTraining, secondaryMastery, secondarySwitchBlock, switchSecondaryRole, trainSecondary } from '../src/engine/me/secondaryRole'
import { doAction, undoAction } from '../src/engine/me/week'
import { readGrowthWeek, growthNet } from '../src/engine/me/growthWeek'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { buildSaveMeta } from '../src/engine/me/saveMeta'
import { ATTR_KEYS, ATTR_CN } from '../src/engine/types'
import { recomputeOverall, marketValue } from '../src/engine/player'
import { ceilingPotential } from '../src/engine/me/bottleneck'
import { agentFit } from '../src/engine/agents'
import { coachStarters, duelTarget, runDuel } from '../src/engine/me/coach'
import { tryoutDays } from '../src/engine/me/tryout'
import { roleCoreDims } from '../src/engine/me/roleCore'
import { tryoutSkill } from '../src/engine/me/prepro'
import { makeDeal } from '../src/engine/me/contract'
import { needOf, pitchOdds } from '../src/engine/me/selfpitch'
import { autoPlan } from '../src/engine/me/auto'
import { careerIdOf } from '../src/engine/me/hall'
import { beginAbsence } from '../src/engine/me/absence'
import { ACH_BY_KEY, checkAchievements } from '../src/engine/me/achievements'
import { Rng } from '../src/engine/rng'
import { MeMatch } from '../src/engine/me/matchplay'
import type { GameState } from '../src/engine/types'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string,v: string) => mem.set(k,v), removeItem: (k: string) => mem.delete(k) }, fetch: () => Promise.reject(Error('offline')) })
const fresh = (start: 'pre'|'t1' = 'pre') => createCareer({ name: '双位置验收', region: 'EMEA', role: '决斗者', year: 2026, start, originKey: 'netcafe', talents: emptyTalents(), seed: 7133 })
const ready = (s: GameState) => { const me=s.me!; me.weekDay=0; me.ap=me.apMax; me.weekDone=[]; me.plan={}; me.trainWeek=undefined; me.pending=[]; me.duelLive=undefined; me.pendingFixture=undefined; me.dueFixture=undefined; me.tryout=undefined; me.trial=undefined; me.deals=[]; me.moveAfter=undefined; if(me.pitch)me.pitch.out=undefined; if(me.pre.cup)me.pre.cup.alive=false; s.players[me.id].injuredUntil=0; s.players[me.id].fatigue=0 }
const s=fresh(),me=s.me!,p=s.players[me.id]
const npcs=JSON.stringify(Object.fromEntries(Object.entries(s.players).filter(([id])=>id!==me.id)))
assert.ok(chooseSecondary(s,'先锋'))
me.week=26;ready(s)
assert.ok(chooseSecondary(s,'自由人'))
assert.ok(chooseSecondary(s,'决斗者'))
assert.equal(chooseSecondary(s,'先锋'),null)
assert.equal(chooseSecondary(s,'控场'),null,'can change before paying for any training')
assert.equal(chooseSecondary(s,'先锋'),null)
assert.equal(doAction(s,'aim'),null)
const earlier=readGrowthWeek(s),attrs=JSON.stringify({attrs:p.attrs,caps:p.caps,xp:p.xp,overall:p.overall,potential:p.potential})
const ap=me.ap, fatigue=p.fatigue
assert.equal(trainSecondary(s),null)
assert.ok(chooseSecondary(s,'控场'),'cannot abandon paid progress')
assert.equal(me.ap,ap-2);assert.equal(p.fatigue,fatigue+4);assert.equal(secondaryMastery(s),2)
assert.deepEqual(readGrowthWeek(s),earlier)
assert.equal(JSON.stringify({attrs:p.attrs,caps:p.caps,xp:p.xp,overall:p.overall,potential:p.potential}),attrs)
assert.ok(undoAction(s,'aim'),'previous actions sealed')
assert.ok(trainSecondary(s),'once a week')
assert.equal(doAction(s,'vod'),null);assert.equal(undoAction(s,'vod'),null);assert.equal(secondaryMastery(s),2)
assert.equal(p.role,'决斗者');assert.deepEqual(p.roles,['决斗者'])
assert.ok(agentFit(p,'Sova')>0 && agentFit(p,'Sova')<1)
for(let i=1;i<50;i++){me.week++;ready(s);assert.equal(trainSecondary(s),null)}
assert.equal(secondaryMastery(s),100);assert.deepEqual(p.roles,['决斗者','先锋']);assert.equal(agentFit(p,'Sova'),1)
assert.ok(trainSecondary(s));assert.equal(JSON.stringify(Object.fromEntries(Object.entries(s.players).filter(([id])=>id!==me.id))),npcs)
assert.equal(ACH_BY_KEY.secondary_certified.cond(s),true)
assert.deepEqual(ACH_BY_KEY.secondary_certified.reward,{title:'双位置选手'})
const reload=migratePlayerSave(unpackState(packState(s)))
assert.deepEqual(reload.me!.positionTraining,me.positionTraining);assert.equal(secondaryMastery(reload),100)
console.log('PASS 50-week paid mastery, no stat/XP/cap freebies, no NPC mutation, sealed undo, qualification and save')

me.week++;ready(s)
p.attrs.aim=92;p.attrs.reaction=90;p.attrs.awareness=60;p.attrs.utility=50
recomputeOverall(p)
const coreBefore=structuredClone({attrs:p.attrs,caps:p.caps,xp:p.xp}),ovr=p.overall, skill=tryoutSkill(s)
const team=Object.values(s.teams).find(t=>t.tier===2&&t.region===me.region&&!t.dormant)!
const deal=makeDeal(s,team.id,'sign','B',new Rng(39)),odds=pitchOdds(s,team)
me.edge=2.5
const careerId=careerIdOf(s)
assert.equal(switchSecondaryRole(s,'先锋'),null)
assert.equal(me.edge,0);assert.equal(p.role,'先锋');assert.notEqual(p.overall,ovr)
assert.equal(p.potential,ceilingPotential(p));assert.equal(p.value,marketValue(p))
assert.deepEqual({attrs:p.attrs,caps:p.caps,xp:p.xp},coreBefore)
assert.equal(tryoutSkill(s)-skill,p.overall-ovr)
assert.notEqual(makeDeal(s,team.id,'sign','B',new Rng(39)).salary,deal.salary)
assert.notEqual(pitchOdds(s,team).skill,odds.skill)
assert.equal(tryoutDays(s)[0].opts[0].dim,roleCoreDims('先锋')[0])
assert.match(tryoutDays(s)[0].name,/先锋/)
assert.equal(buildSaveMeta(s)!.role,'先锋')
assert.equal(careerIdOf(s),careerId,'role switch must not create another Hall career')
assert.ok(switchSecondaryRole(s,'决斗者'),'cannot switch twice')
me.week++;ready(s)
assert.equal(switchSecondaryRole(s,'决斗者'),null,'home has no rolePro100 requirement')
assert.equal(p.overall,ovr)
console.log('PASS actual switch reweights coach/tryout/scouting/contract inputs, preserves raw ability, active save label and return home')

const gates:[string,(s:GameState)=>void][]=[
 ['cached zero gain',x=>{x.me!.trainWeek={week:x.me!.week,g:0}}],
 ['day underway',x=>{x.me!.weekDay=1}],['spent AP',x=>{x.me!.ap--}],
 ['done action',x=>{x.me!.weekDone=['rest']}],['planned action',x=>{x.me!.plan.rest=1}],
 ['pending fixture',x=>{x.me!.pendingFixture='now'}],['due fixture',x=>{x.me!.dueFixture='now'}],
 ['trial',x=>{x.me!.trial={left:2,displaced:'npc',forgiven:false}}],
 ['active cup',x=>{x.me!.pre.cup={key:'cup',round:0,alive:true,mates:[],results:[]}}],
 ['retired',x=>{x.me!.phase='retired'}],['injured',x=>{x.players[x.me!.id].injuredUntil=x.day+3}],
 ['live offer',x=>{x.me!.deals=[makeDeal(x,team.id,'sign','B',new Rng(1))]}],
 ['absence',x=>{beginAbsence(x,'family',30,'家中事务')}],
]
for(const[name,edit]of gates){const x=structuredClone(s);x.me!.week++;ready(x);edit(x);const before=JSON.stringify(x);assert.ok(secondarySwitchBlock(x,'先锋'),name);assert.ok(switchSecondaryRole(x,'先锋'),name);assert.equal(JSON.stringify(x),before,name+' must not mutate')}
const old=structuredClone(s);delete old.me!.positionTraining; const np=JSON.stringify(Object.entries(old.players).filter(([id])=>id!==old.me!.id));normalizePositionTraining(old);assert.equal(old.me!.positionTraining!.home,'决斗者');assert.equal(old.me!.positionTraining!.secondary,'先锋');assert.equal(JSON.stringify(Object.entries(old.players).filter(([id])=>id!==old.me!.id)),np)
console.log('PASS fresh-week/cache/AP/action, immediate-match/trial/cup/offer, injury/retirement guards and old role coverage')

const expired=structuredClone(s);expired.me!.week++;ready(expired);const expiredDeal=makeDeal(expired,team.id,'sign','B',new Rng(2));expiredDeal.expires=expired.day-1;expired.me!.deals=[expiredDeal];assert.equal(switchSecondaryRole(expired,'先锋'),null,'expired offer must not permanently lock switch')
const bot=fresh();bot.me!.week=26;ready(bot);chooseSecondary(bot,'先锋');autoPlan(bot);assert.equal(secondaryMastery(bot),0);assert.equal(bot.me!.positionTraining!.trainedWeek,undefined,'autoplan never spends on secondary')
const free=createCareer({name:'自由人',region:'EMEA',role:'自由人',year:2026,start:'pre',originKey:'netcafe',talents:emptyTalents(),seed:13});free.me!.week=26;ready(free);chooseSecondary(free,'先锋');free.players[free.me!.id].rolePro={先锋:100};assert.equal(switchSecondaryRole(free,'先锋'),null);free.me!.week++;ready(free);assert.equal(switchSecondaryRole(free,'自由人'),null)
console.log('PASS expired-offer recovery, no auto-training, original free-role return, stable Hall identity')

const pro=fresh('t1'),pm=pro.me!,pp=pro.players[pm.id],club=pro.teams[pro.myTeam]
pm.week=80;ready(pro);assert.equal(chooseSecondary(pro,'先锋'),null);pp.rolePro={先锋:100};pp.roles=['决斗者','先锋']
assert.equal(switchSecondaryRole(pro,'先锋'),null)
assert.deepEqual(club.starters,coachStarters(pro),'switch immediately re-runs actual promise-aware lineup selection')
club.starters=club.roster.filter(id=>id!==pm.id).slice(0,5)
club.starters.forEach((id,i)=>{pro.players[id].role=i===0?'先锋':'决斗者';pro.players[id].roles=[pro.players[id].role];pro.players[id].isIgl=false})
assert.equal(duelTarget(pro)!.id,club.starters[0])
assert.equal(needOf(pro,club).mate!.id,club.starters[0],'selfpitch needs current role competitor')
assert.deepEqual(runDuel(pro,new Rng(11))!.rounds.map(r=>r.dim),roleCoreDims('先锋').map(k=>ATTR_CN[k]))
club.starters=[pp.id,...club.roster.filter(id=>id!==pp.id).slice(0,4)]
const opp=Object.values(pro.teams).find(t=>t.id!==club.id&&t.roster.length>=5)!
const match=new MeMatch(pro,{aId:club.id,bId:opp.id,bo:1,comp:'双位置验收',label:'友谊赛'})
assert.equal(match.me.role,'先锋');const rec=match.runOut();assert.ok(rec.started&&rec.rounds>0);assert.ok(rec.box?.some(row=>row.id===pp.id&&row.role==='先锋'))
assert.equal(rec.role,'先锋')
assert.equal(pp.role,'先锋')
console.log('PASS switched role actual duel target/dimensions and completed live match box role')
// The only new achievement reward is a title; normal achievement settlement performs standard delivery.
const awards=structuredClone(s);checkAchievements(awards);assert.ok(awards.me!.achievements.includes('secondary_certified'))
assert.equal(ATTR_KEYS.length,8);assert.equal(growthNet({points:0,progress:0,capped:false}),0)
