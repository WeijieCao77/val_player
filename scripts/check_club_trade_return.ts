import assert from 'node:assert/strict'
import {createCareer,emptyTalents} from '../src/engine/me/career'
import {leaveRoster,joinRoster} from '../src/engine/me/club'
import {isRecentClubDeparture,markClubDeparture} from '../src/engine/me/clubDepartures'
import {marketWindow,simulatedYear} from '../src/engine/me/market'
import {hasPlace} from '../src/engine/timeline'
import {Rng} from '../src/engine/rng'
function fixture(crossyear: boolean, wintertrade: boolean) {
const s=createCareer({name:'换队冷却核查',region:'Europe',role:'决斗者',talents:emptyTalents(),originKey:'netcafe',start:'t1',year:2026,seed:741})
s.day=350
const me=s.me!,to=s.teams[s.myTeam]
const from=Object.values(s.teams).find(t=>t.id!==to.id&&t.region===to.region&&t.tier===2&&t.roster.length>=5&&hasPlace(s,t))!
assert.ok(from);assert.ok(simulatedYear(s))
const p=s.players[from.roster[0]],q=to.roster.map(id=>s.players[id]).find(p=>p.id!==me.id)!
// A real departure followed by a legal signing elsewhere; last-book-year movable logic permits the later swap.
joinRoster(s,p,to,new Rng(1));leaveRoster(s,p,true);joinRoster(s,p,from,new Rng(2))
assert.ok(isRecentClubDeparture(s,to.id,p.id));assert.equal(p.joinedYear,s.year)
for(const player of Object.values(s.players))player.retiring=true
for(const t of Object.values(s.teams))t.dormant=t.id!==to.id&&t.id!==from.id
p.retiring=false;p.role='先锋';p.roles=['先锋'];p.overall=99;p.potential=99;p.loyalty=0;p.nat='de';p.region='Europe';p.age=22
q.retiring=false;q.role='先锋';q.roles=['先锋'];q.overall=40;q.potential=40;q.nat='de';q.region='Europe'
s.players[me.id].retiring=false
me.flags.clubSigned=s.year;delete me.flags.marketMoved
to.budget=1e10;from.budget=1e10
if(crossyear){s.year++;s.day=0;me.flags.clubSigned=s.year;assert.ok(isRecentClubDeparture(s,to.id,p.id));assert.equal(p.joinedYear,s.year-1)}
if(wintertrade){
 from.tier=1;from.rating=50;to.rating=95
 const fillers=Object.values(s.teams).filter(t=>t.id!==from.id&&t.id!==to.id&&t.region===to.region&&t.roster.length>=5).slice(0,2)
 assert.equal(fillers.length,2)
 fillers.forEach((t,i)=>{t.dormant=false;t.tier=1;t.rating=i?30:90})
}
return {s,pid:p.id,qid:q.id,fromId:from.id,toId:to.id}
}

const expectBug = process.argv.includes('--expect-bug')
for (const crossyear of [false,true]) for (const wintertrade of [false,true]) {
 const {s,pid,qid,fromId,toId}=fixture(crossyear,wintertrade)
 const label=`${crossyear?'2027 crossover':'2026 last book'} ${wintertrade?'winter exchange':'tier promotion'}`
 const control=structuredClone(s);delete control.me!.clubDepartures;marketWindow(control,new Rng(1),true)
 assert.equal(control.players[pid].teamId,toId,label+' positive control must really trade')
 const manual=structuredClone(s);joinRoster(manual,manual.players[pid],manual.teams[toId],new Rng(1))
 assert.equal(manual.players[pid].teamId,toId,label+' explicit manual signing is not prohibited')
 assert.ok(isRecentClubDeparture(manual,toId,pid),label+' manual override does not need to erase cooldown')
 const unrelated=structuredClone(s);delete unrelated.me!.clubDepartures;markClubDeparture(unrelated,'unrelated-club',pid)
 marketWindow(unrelated,new Rng(1),true)
 assert.equal(unrelated.players[pid].teamId,toId,label+' other-club cooldown cannot deny this move')
 const expired=structuredClone(s),until=expired.me!.clubDepartures![0].until
 expired.year=Math.floor(until/364);expired.day=until%364;expired.me!.flags.clubSigned=expired.year
 marketWindow(expired,new Rng(1),true)
 assert.equal(expired.players[pid].teamId,toId,label+' expiry must restore automatic eligibility')
 for (const side of ['incoming-up','incoming-down']) {
  const base=structuredClone(s)
  if(side==='incoming-down'){delete base.me!.clubDepartures;markClubDeparture(base,fromId,qid)}
  let returns=0
  for(let seed=1;seed<=100;seed++){
   const copy=structuredClone(base);marketWindow(copy,new Rng(seed),true)
   if(copy.players[pid].teamId===toId)returns++
   if(!expectBug){
    assert.equal(copy.players[pid].teamId,fromId,`${label} ${side} seed ${seed}: blocked swap cannot move either player`)
    assert.equal(copy.players[qid].teamId,toId,`${label} ${side} seed ${seed}: blocked swap cannot move either player`)
    assert.equal(copy.me!.flags.marketMoved,undefined,label+' blocked trade cannot consume my club move budget')
   }
  }
  if(expectBug)assert.ok(returns>0,label+' '+side+' bug must be observable')
  else assert.equal(returns,0)
  console.log(expectBug?'REPRODUCED':'PASS',label,side,'100 seeds',returns,'returns')
 }
}
console.log(expectBug?'Historical bug observed for both mechanisms, both incoming directions and calendar states':'PASS trade return: both directions/mechanisms, 100 seeds each, same-year and 364-day crossover, manual/other-club/expiry controls')
