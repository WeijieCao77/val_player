/** Supplement the completed immutable f92102e full-suite with a narrowly
 * audited legacy-migration fix. Never describe this as a fresh full-suite run. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { readFileSync, writeFileSync, createWriteStream, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), require = createRequire(import.meta.url)
const git = (...args) => execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim()
const baseline = git('rev-parse','f92102e')
const parentPath = resolve(root,'.cache/feedback-check-2026-09-21T11-12-56-348Z/report.json')
const parent = JSON.parse(readFileSync(parentPath,'utf8'))
assert.ok(parent.complete && parent.allPassed && parent.sourceUnchanged)
assert.equal(parent.results.length,97)
assert.ok(parent.results.every(r => r.code === 0))
const allowed = ['src/engine/me/regionalRulerMigrate.ts','src/engine/ruler.ts']
const changed = git('diff','--name-only',baseline,'--','src').split('\n').filter(Boolean).sort()
assert.deepEqual(changed,allowed)
assert.equal(git('ls-files','--others','--exclude-standard','--','src'),'','No undeclared source modules')
const sourceFiles = git('ls-files','--','src').split('\n').sort()
const hash = b => createHash('sha256').update(b).digest('hex')
const fingerprint = () => hash(JSON.stringify(sourceFiles.map(p=>[p,hash(readFileSync(resolve(root,p)))])))
const sourceSha = fingerprint()
const checks = ['check_regional_source.ts','check_regional_ruler.ts','check_maintenance_compat.mjs',
  'check_ruler_migrate.ts','check_reload.ts','check_save_action_ap.ts','check_backup.ts','check_fmvp.ts',
  'check_growth_room.ts','check_practice_pace.ts','check_week_instant.ts','check_worldline.ts',
  'check_save_size.ts','check_save_room.ts','check_boundary.ts','check_player_identity_integration.ts']
const runtime = (pkg,path) => resolve(dirname(require.resolve(`${pkg}/package.json`)),path)
const out = resolve(root,'.cache',`regional-source-fix-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`)
mkdirSync(out,{recursive:true})
const report = { baseline, inheritedReport:parentPath, inheritedChecks:97, sourceSha, changedSource:changed,
  started:new Date().toISOString(), results:[], complete:false, allPassed:false }
const save = () => writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2))
let serial=0
async function run(label,args) {
  const id=++serial, log=`${String(id).padStart(2,'0')}.log`, start=Date.now()
  const sink=createWriteStream(resolve(out,log),{flags:'wx'})
  const p=spawn(process.execPath,args,{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']})
  p.stdout.pipe(sink,{end:false});p.stderr.pipe(sink,{end:false})
  const timer=setTimeout(()=>p.kill(),20*60*1000)
  const code=await new Promise(res=>{p.on('error',()=>res(-1));p.on('close',res)})
  clearTimeout(timer);sink.end()
  report.results.push({id,label,log,code,seconds:(Date.now()-start)/1000});save()
  console.log(`${code===0?'PASS':'FAIL'} ${label}`)
  return code===0
}
console.log(`Report: ${out}`);save()
try {
  assert.ok(await run('typecheck',[runtime('typescript','bin/tsc'),'-b','--noEmit']))
  let index=0
  const worker=async()=>{while(index<checks.length){const f=checks[index++];await run(f,
    f.endsWith('.ts')?[runtime('tsx','dist/cli.mjs'),`scripts/${f}`]:[`scripts/${f}`])}}
  await Promise.all([worker(),worker()])
  await run('build-tsc',[runtime('typescript','bin/tsc'),'-b'])
  await run('build-vite',[runtime('vite','bin/vite.js'),'build'])
  report.complete=report.results.length===checks.length+3
  report.sourceUnchanged=fingerprint()===sourceSha
  report.allPassed=report.complete&&report.sourceUnchanged&&report.results.every(r=>r.code===0)
  report.finished=new Date().toISOString();save();console.log(JSON.stringify({complete:report.complete,allPassed:report.allPassed,sourceUnchanged:report.sourceUnchanged}))
  process.exitCode=report.allPassed?0:1
}catch(e){report.error=String(e.message??e);save();console.error(report.error);process.exitCode=1}
