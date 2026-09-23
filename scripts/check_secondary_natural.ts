/** DeepSeek V4 Pro drafted the experiment; corrected APIs, paired arms and real save/auto assertions. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoResolve, autoWeek } from '../src/engine/me/auto'
import { chooseSecondary, secondaryMastery, secondarySwitchBlock, secondaryTrainingBlock, switchSecondaryRole, trainSecondary } from '../src/engine/me/secondaryRole'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import type { GameState, Role } from '../src/engine/types'
import { ATTR_KEYS } from '../src/engine/types'

const mem = new Map<string, string>()
let deniedFetches = 0
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string,v: string) => mem.set(k,v), removeItem: (k: string) => mem.delete(k) }, fetch: () => { deniedFetches++;return Promise.reject(Error('offline natural test')) } })
const roles: Role[] = ['决斗者','先锋','控场','哨卫'], TARGET = 104
const summaries: Record<string, unknown>[] = []
const report = { experiment: '4 fixed-seed role pairs, real autoWeek104, no manual week/AP/health mutation', startedAt: new Date().toISOString(), complete: false, deniedFetches: 0, summaries }
mkdirSync('.cache',{recursive:true})
const write = () => { report.deniedFetches=deniedFetches;writeFileSync('.cache/secondary-natural.json',JSON.stringify(report,null,2)) }

function run(home:Role,secondary:Role,seed:number,enabled:boolean):void {
  let state=createCareer({name:'Natural',region:'EMEA',role:home,year:2026,start:'pre',originKey:'netcafe',talents:emptyTalents(),seed})
  let trainings=0, spentAP=0, certifiedWeek:number|undefined, switchWeek:number|undefined, reloads=0
  const blocked:Record<string,number>={}, trainedWeeks=new Set<number>()
  const note=(why:string)=>{blocked[why]=(blocked[why]??0)+1}
  for(let iteration=0;iteration<150 && state.me!.week<TARGET;iteration++) {
    let me=state.me!,p=state.players[me.id]
    if(me.phase==='retired'||state.gameOver)break
    // Same bounded pending resolver as autoWeek, before the user's optional manual training click.
    for(let guard=0;me.pending.length&&guard<20;guard++)autoResolve(state,me.pending[0])
    if(me.phase==='retired'||state.gameOver)break
    if(me.week>=26&&!me.positionTraining?.secondary){const why=chooseSecondary(state,secondary);if(why)note(why)}
    if(enabled&&me.positionTraining?.secondary){
      if(secondaryMastery(state)<100){
        const why=secondaryTrainingBlock(state)
        if(why)note(why)
        else{
          const ap=me.ap,fatigue=p.fatigue,mastery=secondaryMastery(state)
          const attrs=JSON.stringify({attrs:p.attrs,caps:p.caps,xp:p.xp,overall:p.overall,potential:p.potential})
          assert.ok(!trainedWeeks.has(me.week),'once per actual week');trainedWeeks.add(me.week)
          assert.equal(trainSecondary(state),null)
          assert.equal(me.ap,ap-2);assert.equal(p.fatigue,fatigue+4)
          assert.equal(secondaryMastery(state),Math.min(100,mastery+2))
          assert.equal(JSON.stringify({attrs:p.attrs,caps:p.caps,xp:p.xp,overall:p.overall,potential:p.potential}),attrs,'manual training grants no attributes/XP/caps')
          trainings++;spentAP+=2
          if(secondaryMastery(state)>=100)certifiedWeek??=me.week
          else assert.ok(!p.roles?.includes(secondary),'not certified early')
        }
      }else if(switchWeek===undefined){const why=secondarySwitchBlock(state,secondary);if(why)note(why);else{assert.equal(switchSecondaryRole(state,secondary),null);switchWeek=me.week}}
    }
    const previous=me.week,mastery=secondaryMastery(state),marker=me.positionTraining?.trainedWeek
    const stop=autoWeek(state)
    assert.equal(secondaryMastery(state),mastery,'automatic week never adds secondary proficiency')
    assert.equal(me.positionTraining?.trainedWeek,marker,'automatic week never pays secondary AP')
    if(stop.kind==='game-over'||me.phase==='retired'||state.gameOver)break
    assert.equal(me.week,previous+1,`no stuck clock ${home}/${enabled?'train':'control'} ${previous}`)
    assert.ok(me.ap>=0&&me.ap<=me.apMax)
    for(const k of ATTR_KEYS)assert.ok(Number.isFinite(p.attrs[k])&&p.attrs[k]>=0&&p.attrs[k]<=99)
    if(me.week===20){delete me.positionTraining;state=migratePlayerSave(unpackState(packState(state)));reloads++}
    else if(me.week%13===0){const position=structuredClone(me.positionTraining),mastery=secondaryMastery(state);state=migratePlayerSave(unpackState(packState(state)));assert.deepEqual(state.me!.positionTraining,position);assert.equal(secondaryMastery(state),mastery);reloads++}
    me=state.me!;p=state.players[me.id]
    assert.ok(p,'main player survives')
    if(me.week%26===0)console.log('PROGRESS',home,enabled?'train':'control',me.week,secondaryMastery(state))
  }
  const me=state.me!,p=state.players[me.id]
  const summary={home,secondary,arm:enabled?'train':'control',seed,week:me.week,year:state.year,day:state.day,trainings,spentAP,certifiedWeek,switchWeek,finalActive:p.role,finalMastery:secondaryMastery(state),finalOverall:p.overall,reloads,phase:me.phase,ending:me.ending?.title,blocked}
  summaries.push(summary);write();console.log('RESULT',JSON.stringify(summary))
  assert.equal(me.week,TARGET,'must actually complete104weeks (early endings reported, not silently skipped)')
  if(enabled){assert.equal(trainings,50);assert.equal(spentAP,100);assert.equal(secondaryMastery(state),100);assert.ok(certifiedWeek!==undefined)}
  else{assert.equal(trainings,0);assert.equal(spentAP,0);assert.equal(secondaryMastery(state),0);assert.equal(p.role,home)}
}
try{for(let i=0;i<roles.length;i++){run(roles[i],roles[(i+1)%roles.length],7140+i,false);run(roles[i],roles[(i+1)%roles.length],7140+i,true)}report.complete=true;write();console.log('PASS real natural104weeks ×8careers, fourcertifications, no hidden training or stat freebies')}
catch(error){write();throw error}
