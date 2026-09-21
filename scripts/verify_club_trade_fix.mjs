/** Supplement an immutable first-four full suite with only the audited trade guard. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url)
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
const baseline=git('rev-parse','bc4a97f')
const parentPath=resolve(root,'.cache/feedback-check-2026-09-21T15-53-29-173Z/report.json')
const parent=JSON.parse(readFileSync(parentPath,'utf8'))
assert.ok(parent.complete&&parent.sourceUnchanged)
assert.equal(parent.results.length,105)
assert.deepEqual(parent.results.filter(x=>x.code!==0).map(x=>x.command),['npx tsx scripts/check_standings.ts'])
assert.deepEqual(git('diff','--name-only',baseline,'--','src').split('\n').filter(Boolean),['src/engine/me/market.ts','src/me.css','src/ui/me/TeamPeek.tsx'])
assert.equal(git('ls-files','--others','--exclude-standard','--','src'),'')
const sourceFiles=[...new Set(git('ls-files','-co','--exclude-standard','--','src','scripts','package.json','package-lock.json').split('\n'))].sort()
const hash=b=>createHash('sha256').update(b).digest('hex')
const fingerprint=()=>hash(JSON.stringify(sourceFiles.map(p=>[p,hash(readFileSync(resolve(root,p)))])))
const sourceSha=fingerprint(),runtime=(pkg,path)=>resolve(dirname(require.resolve(`${pkg}/package.json`)),path)
const checks=['check_club_trade_return.ts','check_club_return.ts','check_window.ts','check_starts.ts','check_seats.ts',
 'check_clout.ts 3 7','check_auto_upgrade_invite.ts','check_role_selection.ts','check_reload.ts','check_save_action_ap.ts',
 'check_worldline.ts','check_boundary.ts','check_growth_week.ts','check_player_identity_integration.ts',
 'check_standings.ts','check_transfer_roster_ui.mjs','check_bracket_mobile.mjs']
const out=resolve(root,'.cache',`club-trade-fix-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`);mkdirSync(out,{recursive:true})
const report={baseline,inheritedReport:parentPath,inheritedPassedChecks:104,retestedFailure:'check_standings.ts',sourceSha,started:new Date().toISOString(),results:[],complete:false,allPassed:false}
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));let serial=0
async function run(label,args){
 const id=++serial,log=`${id}.log`,start=Date.now(),sink=createWriteStream(resolve(out,log),{flags:'wx'})
 const p=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
 p.stdout.pipe(sink,{end:false});p.stderr.pipe(sink,{end:false});const timer=setTimeout(()=>p.kill(),20*60*1000)
 const code=await new Promise(r=>{p.on('error',()=>r(-1));p.on('close',r)});clearTimeout(timer);sink.end()
 report.results.push({id,label,log,code,seconds:(Date.now()-start)/1000});save();console.log(`${code===0?'PASS':'FAIL'} ${label}`);return code===0
}
console.log(`Report: ${out}`);save()
try{
 assert.ok(await run('typecheck',[runtime('typescript','bin/tsc'),'-b','--noEmit']))
 let index=0;const worker=async()=>{while(index<checks.length){const label=checks[index++],[file,...args]=label.split(' ');await run(label,[...(file.endsWith('.ts')?[runtime('tsx','dist/cli.mjs')]:[]),`scripts/${file}`,...args])}}
 await Promise.all([worker(),worker()]);await run('build-tsc',[runtime('typescript','bin/tsc'),'-b']);await run('build-vite',[runtime('vite','bin/vite.js'),'build'])
 report.complete=report.results.length===checks.length+3;report.sourceUnchanged=fingerprint()===sourceSha
 report.allPassed=report.complete&&report.sourceUnchanged&&report.results.every(r=>r.code===0);report.finished=new Date().toISOString();save()
 console.log(JSON.stringify({complete:report.complete,allPassed:report.allPassed,sourceUnchanged:report.sourceUnchanged}));process.exitCode=report.allPassed?0:1
}catch(e){report.error=String(e.message??e);save();console.error(report.error);process.exitCode=1}
