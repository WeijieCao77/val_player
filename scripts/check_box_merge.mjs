/** Merge receipts: isolated temporary JSONL and loopback HTTP; never production or user data. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { initBox, handleBoxApi, handleBoxAdmin, _boxState, boxHtml, counts } from '../box.js'

const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'valbox-merge-'))
const append=fs.appendFileSync, write=fs.writeFileSync, rename=fs.renameSync
const server=http.createServer((req,res)=>{
  if(req.url==='/dash/box')void handleBoxAdmin(req,res,'/dash/box')
  else if(!handleBoxApi(req,res,req.url,'merge-test')){res.writeHead(404);res.end()}
})
server.listen(0,'127.0.0.1');await once(server,'listening')
const base=`http://127.0.0.1:${server.address().port}`
const rec=(id,dev,text,s='shown',v=[dev])=>({o:'set',id,dev,text,s,t:123,p:1,v})
let serial=0
function setup(records){
  const dir=path.join(tmp,String(serial++));fs.mkdirSync(dir)
  const file=path.join(dir,'box.jsonl');fs.writeFileSync(file,records.map(o=>JSON.stringify(o)).join('\n')+'\n')
  initBox({dir,volatile:false});return {dir,file}
}
async function api(action,body){
  const r=await fetch(base+'/api/box/'+action,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({v:1,...body})})
  return r.json()
}
async function admin(act,id,extra={}){
  const r=await fetch(base+'/dash/box',{method:'POST',redirect:'manual',headers:{'content-type':'application/x-www-form-urlencoded','sec-fetch-site':'same-origin'},body:new URLSearchParams({act,id,...extra})})
  return {status:r.status,text:await r.text()}
}
const state=id=>_boxState().find(i=>i.id===id)
const receipt=async(vid,id)=>(await api('list',{vid})).mine.find(i=>i.id===id)
const restart=({dir})=>{const before=_boxState();initBox({dir,volatile:false});assert.deepEqual(_boxState(),before)}
const A='aaaaaaaa',B='bbbbbbbb',C='cccccccc',D='dddddddd'
try{
  const fixture=setup([rec(A,'author-a','来源私文 <script>原文</script>','pending',['author-a','same-reader']),rec(B,'author-b','公开目标','shown',['author-b','same-reader']),rec(C,'author-c','最终公开目标','taken',['author-c']),rec(D,'author-d','另一来源')])
  assert.equal((await admin('merge',A,{to:B})).status,303)
  assert.equal(counts().total,4)
  assert.equal(state(A).text,'来源私文 <script>原文</script>');assert.equal(state(A).t,123)
  assert.equal(state(A).state,'merged');assert.equal(state(A).mergedTo,B);assert.ok(state(A).mergedAt>123)
  assert.deepEqual(state(A).votes,[]);assert.equal(state(A).pin,0)
  assert.deepEqual(new Set(state(B).votes),new Set(['author-a','author-b','same-reader']))
  let mine=await receipt('author-a',A)
  assert.equal(mine.state,'merged');assert.equal(mine.votes,0)
  assert.deepEqual(mine.merge,{availability:'public',target:{id:B,text:'公开目标',state:'shown',votes:3}})
  assert.ok(!('dev' in mine)&&!('mergedTo' in mine)&&!('mergedAt' in mine))
  const other=await api('list',{vid:'stranger'})
  assert.ok(!JSON.stringify(other).includes('来源私文'));assert.ok(!other.items.some(i=>i.id===A))
  for(const action of [{act:'merge',to:C},{act:'show'},{act:'hide'},{act:'state',s:'taken'},{act:'state',s:'fixed'},{act:'pin'}]){
    const before=_boxState();const {act,...extra}=action
    assert.equal((await admin(act,A,extra)).status,409);assert.deepEqual(_boxState(),before)
  }
  assert.equal((await api('vote',{vid:'stranger',id:A,on:true})).ok,false)
  assert.equal((await api('vote',{vid:'author-a',id:A,on:false})).ok,false)
  for(const to of [B,'eeeeeeee','not-an-id']){
    const before=_boxState();assert.equal((await admin('merge',B,{to})).status,409);assert.deepEqual(_boxState(),before)
  }
  assert.equal((await admin('state',B,{s:'merged'})).status,409)
  // Follow the final endpoint dynamically; merging into an already merged target resolves once, too.
  assert.equal((await admin('merge',B,{to:C})).status,303)
  assert.equal((await receipt('author-a',A)).merge.target.id,C)
  assert.equal(state(A).mergedTo,C,'新合并原子扁平所有上游回执')
  assert.equal((await admin('merge',D,{to:A})).status,303)
  assert.equal(state(D).mergedTo,C)
  assert.equal(state(C).votes.length,5)
  const outsider=await api('list',{vid:'author-c'})
  assert.ok(outsider.items.every(i=>![A,B,D].includes(i.id)),'公开榜绝不显示已合并来源')
  assert.ok(outsider.mine.every(i=>![A,B,D].includes(i.id)),'别人的我的页不显示来源')
  assert.equal((await admin('del',B)).status,303)
  assert.equal((await receipt('author-a',A)).merge.target.id,C,'删中间回执不能让原作者丢失终点')
  restart(fixture)
  assert.equal((await receipt('author-a',A)).merge.target.id,C,'删中间回执后重启仍跟随终点')
  assert.equal((await admin('state',C,{s:'fixed'})).status,303)
  assert.equal((await receipt('author-a',A)).merge.target.state,'fixed')
  assert.equal((await admin('hide',C)).status,303)
  mine=await receipt('author-a',A)
  assert.deepEqual(mine.merge,{availability:'private'})
  assert.ok(!JSON.stringify((await api('list',{vid:'author-a'}))).includes('最终公开目标'))
  assert.equal((await admin('state',C,{s:'pending'})).status,303)
  assert.deepEqual((await receipt('author-a',A)).merge,{availability:'private'})
  const html=boxHtml(), mergedRow=html.match(/<tr class="s-merged">[\s\S]*?<\/tr>/)?.[0]
  assert.ok(html.includes('合并回执'));assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(mergedRow.includes('终点 #cccccccc'));assert.ok(!mergedRow.includes('value="merge"')&&!mergedRow.includes('value="show"'))
  assert.ok(mergedRow.includes('value="del"'))
  restart(fixture)
  const snapshots=fs.readFileSync(fixture.file,'utf8').trim().split('\n').filter(Boolean).map(x=>JSON.parse(x))
  assert.ok(snapshots.some(o=>o.o==='set'&&o.s==='merged'&&o.mergedTo&&o.mergedAt))
  assert.equal((await admin('del',C)).status,303)
  assert.deepEqual((await receipt('author-a',A)).merge,{availability:'missing'})
  restart(fixture);assert.deepEqual((await receipt('author-a',A)).merge,{availability:'missing'})
  assert.equal((await admin('del',A)).status,303);restart(fixture)
  assert.equal(await receipt('author-a',A),undefined)
  console.log('PASS retained private receipt, exact original/time, deduped votes, chains, real-time status, privacy, terminal deletion, dashboard, snapshot restart')

  const bad=setup([rec(A,'cycle-a','环A','merged'),rec(B,'cycle-b','环B','merged'),rec(C,'cycle-c','有效来源'),
    {...rec(A,'cycle-a','环A','merged'),mergedTo:B,mergedAt:9}, {...rec(B,'cycle-b','环B','merged'),mergedTo:A,mergedAt:9}])
  assert.deepEqual((await receipt('cycle-a',A)).merge,{availability:'missing'})
  const beforeBad=_boxState();assert.equal((await admin('merge',C,{to:A})).status,409);assert.deepEqual(_boxState(),beforeBad)
  restart(bad)
  const old=setup([rec(A,'old-a','旧合并来源'),rec(B,'old-b','旧目标'),{o:'merge',id:A,to:B},{o:'del',id:B}])
  assert.deepEqual(_boxState(),[]);restart(old);assert.deepEqual(_boxState(),[])
  const journal=setup([rec(A,'journal-a','新格式来源'),rec(B,'journal-b','新格式目标'),{o:'merge',id:A,to:B,t:456,keep:true},
    {o:'vote',id:A,dev:'residual',on:1},{o:'st',id:A,s:'shown'},{o:'pin',id:A,v:1}])
  assert.equal(state(A).state,'merged');assert.equal(state(A).mergedAt,456);assert.deepEqual(state(A).votes,[]);assert.equal(state(A).pin,0)
  restart(journal)
  console.log('PASS corrupt cycles rejected; old deletion logs stay deleted; new keep logs replay and reject stale source operations')

  setup([rec(A,'rank-author','榜外目标来源'),rec(B,'rank-target','排名二百以外仍能查看的公开目标','fixed',[]),
    ...Array.from({length:205},(_,i)=>rec((0x1000+i).toString(16).padStart(8,'0'),'rank-'+i,'靠前记录 '+i,'shown',['v1','v2','v3']))])
  assert.equal((await admin('merge',A,{to:B})).status,303)
  const below=await api('list',{vid:'rank-author'})
  assert.equal(below.items.length,200);assert.ok(!below.items.some(i=>i.id===A||i.id===B))
  assert.equal(below.mine.find(i=>i.id===A).merge.target.id,B)
  assert.equal(below.mine.find(i=>i.id===A).merge.target.state,'fixed')
  console.log('PASS public target outside top 200 still follows in private receipt; merged sources never enter public/mismatched mine')

  setup([{...rec(A,'long-author','最早的本人回执','merged'),t:1,mergedTo:B,mergedAt:2},rec(B,'long-target','可跟随的终点'),
    ...Array.from({length:75},(_,i)=>({...rec((0x5000+i).toString(16).padStart(8,'0'),'long-author','较新的本人建议 '+i,'pending'),t:100+i}))])
  const longMine=await api('list',{vid:'long-author'})
  assert.equal(longMine.mine.length,76,'我的不能把五十条之前的建议和回执挤掉')
  assert.equal(longMine.mine.find(i=>i.id===A).merge.target.id,B)
  console.log('PASS more than 50 personal records retain the oldest merged receipt')

  for(const fault of ['write','rename']){
    const f=setup([{...rec(D,'fault-d','中间上游回执','merged'),mergedTo:B,mergedAt:1},
      {...rec(A,'fault-a','既有上游回执','merged'),mergedTo:D,mergedAt:1},rec(B,'fault-b','原来源'),rec(C,'fault-c','原目标')]), disk=fs.readFileSync(f.file), before=_boxState()
    if(fault==='write')fs.writeFileSync=(target,data,...args)=>{if(String(target).startsWith(f.file+'.')){write.call(fs,target,String(data).slice(0,30),...args);throw Error('injected partial snapshot failure')}return write.call(fs,target,data,...args)}
    else fs.renameSync=(from,to)=>{if(to===f.file)throw Error('injected rename failure');return rename.call(fs,from,to)}
    assert.equal((await admin('merge',B,{to:C})).status,503)
    fs.writeFileSync=write;fs.renameSync=rename
    assert.deepEqual(fs.readFileSync(f.file),disk);assert.deepEqual(_boxState(),before);assert.deepEqual(fs.readdirSync(f.dir),['box.jsonl'])
    restart(f);assert.equal((await admin('merge',B,{to:C})).status,303);assert.equal(state(A).mergedTo,C);assert.equal(state(D).mergedTo,C);restart(f)
  }
  const many=Array.from({length:5000},(_,i)=>'voter-'+i)
  setup([rec(A,'extra','满票来源','shown',['extra']),rec(B,'full','满票目标','shown',many)])
  const beforeOverflow=_boxState();assert.equal((await admin('merge',A,{to:B})).status,409);assert.deepEqual(_boxState(),beforeOverflow)
  const full=setup(Array.from({length:600},(_,i)=>rec(i.toString(16).padStart(8,'0'),'owner-'+i,'容量记录'+i)))
  assert.equal((await admin('merge','00000000',{to:'00000001'})).status,303)
  assert.equal(counts().total,600);assert.equal((await api('list',{vid:'owner-0'})).full,true)
  assert.equal((await api('new',{vid:'new-capacity',text:'合并后仍是六百条不能再加'})).ok,false)
  assert.equal((await admin('del','00000000')).status,303)
  assert.equal((await api('new',{vid:'new-capacity',text:'删除回执后才恢复一个名额'})).ok,true)
  restart(full)
  console.log('PASS atomic write/rename failures preserve both sides and disk; voter overflow loses nothing; receipts count toward 600, explicit deletion frees capacity')
}finally{
  fs.appendFileSync=append;fs.writeFileSync=write;fs.renameSync=rename
  server.closeAllConnections();await new Promise(r=>server.close(r))
  const cleanup=path.resolve(tmp)
  assert.equal(path.dirname(cleanup),path.resolve(os.tmpdir()));assert.ok(path.basename(cleanup).startsWith('valbox-merge-'))
  fs.rmSync(cleanup,{recursive:true,force:true})
}
