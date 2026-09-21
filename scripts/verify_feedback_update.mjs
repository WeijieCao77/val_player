/** Full existing career suite plus new maintenance checks; bounded two-worker
 * execution, individual exit codes and logs, immutable source fingerprint.
 * Does not deploy. node scripts/verify_feedback_update.mjs
 */
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const runtime = (pkg, path) => resolve(dirname(require.resolve(`${pkg}/package.json`)), path)
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const expand = name => pkg.scripts[name].split(/\s*&&\s*/).flatMap(c => {
  const m = /^npm run (\S+)$/.exec(c)
  return m ? expand(m[1]) : [c]
})
const suite = [...new Set([...expand('check:me'), ...expand('check:events'), ...expand('check:maintenance'), ...(pkg.scripts['check:feedback-next'] ? expand('check:feedback-next') : [])])]
const commands = suite.filter(c => c !== 'tsc -b --noEmit')
const testPaths = [...suite.map(c => c.split(/\s+/).find(p => p.startsWith('scripts/'))).filter(Boolean), 'scripts/verify_feedback_update.mjs']
const paths = () => [...new Set([...execFileSync('git', ['ls-files','-co','--exclude-standard','--','src','package.json','package-lock.json'], { cwd: root, encoding:'utf8' }).trim().split('\n'), ...testPaths])].sort()
const fingerprint = () => createHash('sha256').update(JSON.stringify(paths().map(p => [p, createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')]))).digest('hex')
const sourceSha = fingerprint()
const out = resolve(root, '.cache', `feedback-check-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`)
mkdirSync(out, { recursive:true })
const report = { started: new Date().toISOString(), sourceSha, planned: commands.length + 3, results:[], complete:false, allPassed:false }
const save = () => writeFileSync(resolve(out,'report.json'), JSON.stringify(report,null,2))
function argv(command) {
  const args = command.split(/\s+/)
  if (args[0] === 'npx' && args[1] === 'tsx') return [runtime('tsx','dist/cli.mjs'), ...args.slice(2)]
  if (args[0] === 'node') return args.slice(1)
  if (args[0] === 'tsc') return [runtime('typescript','bin/tsc'), ...args.slice(1)]
  if (args[0] === 'vite') return [runtime('vite','bin/vite.js'), ...args.slice(1)]
  throw Error(`Unexpected command: ${command}`)
}
let serial = 0
async function run(command) {
  const id = ++serial, log = `${String(id).padStart(3,'0')}.log`, begin = Date.now()
  const fd = createWriteStream(resolve(out,log), { flags:'wx' })
  const child = spawn(process.execPath, argv(command), { cwd:root, windowsHide:true, stdio:['ignore','pipe','pipe'] })
  child.stdout.pipe(fd,{end:false}); child.stderr.pipe(fd,{end:false})
  const timer = setTimeout(() => child.kill(), 20 * 60 * 1000)
  const result = await new Promise(resolve => {
    child.on('error', e => resolve({ code:null, error:e.message }))
    child.on('close', (code,signal) => resolve({code,signal}))
  })
  clearTimeout(timer); fd.end()
  report.results.push({ id, command, log, seconds:(Date.now()-begin)/1000, ...result })
  save(); console.log(`${result.code === 0 ? 'PASS' : 'FAIL'} ${id}/${report.planned} ${command}`)
  return result.code === 0
}
console.log(`Report: ${out}`); save()
try {
  assert.ok(await run('tsc -b --noEmit'), 'Typecheck failed')
  let index = 0
  const worker = async () => { while(index < commands.length) await run(commands[index++]) }
  await Promise.all([worker(),worker()])
  await run('tsc -b'); await run('vite build')
  report.sourceUnchanged = fingerprint() === sourceSha
  report.complete = report.results.length === report.planned
  report.allPassed = report.complete && report.sourceUnchanged && report.results.every(r => r.code === 0)
  report.finished = new Date().toISOString(); save()
  console.log(JSON.stringify({complete:report.complete,allPassed:report.allPassed,sourceUnchanged:report.sourceUnchanged,failed:report.results.filter(r=>r.code !== 0).map(r=>r.command)}))
  process.exitCode = report.allPassed ? 0 : 1
} catch(e) { report.error=String(e.message ?? e); save(); console.error(report.error); process.exitCode=1 }
