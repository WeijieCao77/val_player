/** DeepSeek V4 Pro reproduction draft, corrected to the real doList/clout API. */
import assert from 'node:assert/strict'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { canList, doList } from '../src/engine/me/clout'
import { clubWeek, joinRoster, leaveRoster } from '../src/engine/me/club'
import { Rng } from '../src/engine/rng'
import { packState, unpackState } from '../src/engine/save'
import { ATTR_KEYS, type GameState } from '../src/engine/types'

Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline')) })
const clone = <T>(x:T):T => structuredClone(x)
function fixture(size=6) {
  const s=createCareer({name:'回队核查',region:'China',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'pre',seed:9021,year:2021})
  const me=s.me!, mine=s.players[me.id]
  const team=Object.values(s.teams).find(t=>!t.dormant&&t.region==='China'&&t.roster.length>=5)!
  assert.ok(team)
  const template=s.players[team.roster[0]]
  for(const p of Object.values(s.players))if(p.id!==me.id&&p.teamId===null)p.retiring=true
  for(const id of team.roster){s.players[id].teamId=null;s.players[id].retiring=true}
  const mates=Array.from({length:size-1},(_,i)=>{
    const p=clone(template);p.id=`RETURN_TEST_${i}`;p.ign=`队友${i}`;p.teamId=team.id;p.retiring=false
    p.nat='cn';p.region='China';p.age=25;p.role='先锋';p.roles=['先锋'];p.overall=i===0?99:65
    for(const k of ATTR_KEYS)p.attrs[k]=60
    s.players[p.id]=p;return p.id
  })
  s.myTeam=team.id;mine.teamId=team.id;mine.nat='cn';mine.region='China'
  for(const k of ATTR_KEYS)mine.attrs[k]=99
  me.phase='pro';me.coachTrust=100;me.gmTrust=100;me.fans=20000
  me.titles=Array.from({length:8},()=>({year:s.year,title:'Champions',started:true}))
  team.roster=[me.id,...mates];team.starters=team.roster.slice(0,5)
  assert.ok(canList(s).ok)
  return {s,target:mates[0],second:mates[1]}
}
function dismiss(s:GameState,id:string) {
  for(let n=0;n<100;n++){
    const c=clone(s);c.seed+=n;c.me!.cloutCd={list:0,sign:0};c.me!.coachTrust=100
    const line=doList(c,id)
    if(c.players[id].teamId===null){assert.match(line,/被放走了/);return c}
  }
  throw Error('No deterministic successful doList fixture')
}
const bug=process.argv.includes('--expect-bug')
for(const size of [6,7]){
  const f=fixture(size);let s=dismiss(f.s,f.target)
  if(size===7){clubWeek(s,new Rng(1));assert.ok(!s.teams[s.myTeam].roster.includes(f.target));s=dismiss(s,f.second)}
  clubWeek(s,new Rng(2))
  assert.equal(s.teams[s.myTeam].roster.includes(f.target),bug,`${size}-person automatic return`)
  assert.ok(s.teams[s.myTeam].roster.length>=5)
}
if(bug){console.log('REPRODUCED: real doList followed by clubWeek rehires dismissed player for both six/seven-person cases');process.exit(0)}

// A healthy alternative is signed rather than the dismissed strongest candidate.
{
  const f=fixture();const s=dismiss(f.s,f.target),alt=clone(s.players[f.target])
  alt.id='RETURN_ALTERNATIVE';alt.ign='替代人选';alt.overall=50;s.players[alt.id]=alt
  clubWeek(s,new Rng(3));assert.ok(s.teams[s.myTeam].roster.includes(alt.id));assert.equal(s.players[f.target].teamId,null)
}
// Keep a legal five and log the waiting reason once, not every week.
{
  const f=fixture();const s=dismiss(f.s,f.target);clubWeek(s,new Rng(4));const logs=s.me!.log.length
  s.day+=7;clubWeek(s,new Rng(5));assert.equal(s.me!.log.length,logs)
  const loaded=unpackState(packState(s));assert.ok(loaded.me!.clubDepartures?.length)
  clubWeek(loaded,new Rng(6));assert.equal(loaded.players[f.target].teamId,null)
  const expiry=loaded.me!.clubDepartures![0].until;loaded.year=Math.floor(expiry/364);loaded.day=expiry%364
  clubWeek(loaded,new Rng(7));assert.equal(loaded.players[f.target].teamId,loaded.myTeam)
}
// Scope is same club only; explicit signing elsewhere remains possible.
{
  const f=fixture();const s=dismiss(f.s,f.target),other=Object.values(s.teams).find(t=>t.id!==s.myTeam)!
  joinRoster(s,s.players[f.target],other,new Rng(8));assert.equal(s.players[f.target].teamId,other.id)
}
// At fewer than five with no alternative, emergency return is explicit, not silent.
{
  const f=fixture();const s=dismiss(f.s,f.target),p=s.players[f.second]
  leaveRoster(s,p);p.retiring=true
  clubWeek(s,new Rng(9));assert.equal(s.teams[s.myTeam].roster.length,5)
  assert.ok(s.me!.log.some(l=>l.text.includes('紧急')&&l.text.includes(s.players[f.target].ign)))
}
// Across a 364-day rollover, exclusion remains 56 days; not a calendar-year wipe.
{
  const f=fixture();f.s.day=350;const s=dismiss(f.s,f.target)
  s.year++;s.day=0;clubWeek(s,new Rng(10));assert.equal(s.players[f.target].teamId,null)
}
// Legacy saves have no inferred departure history and preserve their old free-agent behaviour.
{
  const f=fixture(),s=f.s;leaveRoster(s,s.players[f.target]);delete s.me!.clubDepartures
  clubWeek(s,new Rng(11));assert.equal(s.players[f.target].teamId,s.myTeam)
}
console.log('PASS club return: six/seven, alternatives, wait-once, persistence, expiry, other clubs, emergency, rollover and legacy')
