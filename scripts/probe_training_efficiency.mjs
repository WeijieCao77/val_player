/** Local paired pilot, not a population balance claim. Default prints plan.
 * node --expose-gc scripts/probe_training_efficiency.mjs run <new-output.json>
 * Same current sources in both bundles; only auto.ts is replaced by 9a327a3
 * for the baseline. No source mutation, no user saves, no outgoing requests.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { freemem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha = text => createHash('sha256').update(text).digest('hex')
const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const cells = roles.flatMap(role => [3750, 7001].flatMap(seed => ['ordinary', 'capped-aim-stress'].map(scenario => ({ role, seed, scenario }))))
const baseline = execFileSync('git', ['show', '9a327a3:src/engine/me/auto.ts'], { cwd: root, encoding: 'utf8' })
const autoPath = resolve(root, 'src/engine/me/auto.ts')
const candidate = readFileSync(autoPath, 'utf8')
const metadata = { date: new Date().toISOString(), baselineAutoCommit: '9a327a3',
  baselineAutoSha256: sha(baseline), candidateAutoSha256: sha(candidate),
  design: { roles, seeds: [3750, 7001], region: 'China', year: 2026, start: 'pre', origin: 'netcafe', weeks: 26,
    policy: 'autoWeek', variants: ['baseline', 'candidate'], cells: cells.length,
    limitation: '26-week local pilot, one origin/region/start. Synthetic capped state is diagnostic, not a natural career distribution. No retirement, championship-rate or reaching-90 claim.' } }
if (process.argv[2] !== 'run') { console.log(JSON.stringify(metadata, null, 2)); process.exit(0) }
const output = resolve(process.argv[3] ?? '.cache/training-efficiency.json')
assert.ok(!existsSync(output), 'Do not overwrite a previous pilot result')
assert.notEqual(metadata.baselineAutoSha256, metadata.candidateAutoSha256, 'Expected an actual autoplan candidate')
globalThis.fetch = () => Promise.reject(new Error('offline training probe'))
let mem = new Map()
globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v) => mem.set(k,String(v)),
  removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null,
  get length() { return mem.size } }
async function engine(code) {
  let hits = 0
  const out = await build({ absWorkingDir: root, stdin: { contents:
    "export {createCareer,emptyTalents} from './src/engine/me/career'; export {autoWeek} from './src/engine/me/auto'; export {recomputeOverall} from './src/engine/player'; export {ensureCeilings,ceilingPotential} from './src/engine/me/bottleneck';",
    loader: 'ts', resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20',
    define: { 'import.meta.env': 'undefined' }, plugins: [{ name: 'paired-autoplan', setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]engine[\\/]me[\\/]auto\.ts$/ }, () => { hits++; return { contents: code, loader: 'ts' } })
    } }] })
  assert.equal(hits, 1)
  const text = out.outputFiles[0].text
  return { api: await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`), hash: sha(text) }
}
const engines = { baseline: await engine(baseline), candidate: await engine(candidate) }
metadata.bundleHashes = Object.fromEntries(Object.entries(engines).map(([k,v])=>[k,v.hash]))
const snap = s => { const p=s.players[s.me.id]; return { year:s.year, day:s.day, week:s.me.week, phase:s.me.phase,
  overall:p.overall, potential:p.potential, attrs:{...p.attrs}, xp:{...p.xp}, caps:{...p.caps},
  age:p.age, teamId:p.teamId, fatigue:p.fatigue, titles:(s.me.titles??[]).length } }
const rows=[]
const began=Date.now()
for (const cell of cells) for (const [variant,{api}] of Object.entries(engines)) {
  globalThis.gc?.()
  if (freemem()/1024/1024 < 1500) throw Error('Memory safety stop: less than 1500 MB free')
  mem=new Map()
  const state=api.createCareer({ name:'本地成长对照', region:'China', role:cell.role, seed:cell.seed,
    start:'pre', year:2026, originKey:'netcafe', talents:api.emptyTalents() })
  if(cell.scenario==='capped-aim-stress') {
    const p=state.players[state.me.id], bn=api.ensureCeilings(state)
    for(const k of ['aim','reaction']) { p.attrs[k]=p.caps[k]; p.xp[k]=0; bn.mechV[k]=1.2 }
    api.recomputeOverall(p); p.potential=api.ceilingPotential(p)
  }
  const initial=snap(state), yearly=[]
  let weeks=0
  for(;weeks<26;weeks++) {
    if(freemem()/1024/1024<1500) throw Error('Memory safety stop')
    const result=api.autoWeek(state)
    if((weeks+1)%13===0) yearly.push(snap(state))
    if(result.kind==='game-over'||state.gameOver||state.me.phase==='retired') {weeks++;break}
    assert.equal(result.kind,'week-end','No silently censored stuck week')
  }
  rows.push({...cell,variant,weeks,initial,checkpoints:yearly,final:snap(state)})
  writeFileSync(output,JSON.stringify({metadata,seconds:(Date.now()-began)/1000,rows},null,2))
  console.log(`${rows.length}/40 ${variant} ${cell.scenario} ${cell.role} ${cell.seed}: ${initial.overall}→${rows.at(-1).final.overall}, ${weeks} weeks`)
}
assert.equal(sha(readFileSync(autoPath,'utf8')),metadata.candidateAutoSha256,'Candidate changed during the run; do not compare')
console.log(`PASS paired pilot: ${rows.length} runs; ${(Date.now()-began)/1000}s; ${output}`)
