/** Fixed f80fc11 world, baseline versus personal-growth-only candidate.
 * Sources are captured before bundling; concurrent edits cannot change a run.
 * node --expose-gc scripts/probe_practice_pace.mjs <new.jsonl> [years=4]
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { readFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = 'f80fc11118328306590cb578ebdcf5b7363c3f27'
const years = Number(process.argv[3] ?? 4)
const combined = process.argv[4] === 'combined'
assert.ok(process.argv[2] && Number.isInteger(years) && years >= 1 && years <= 8)
const git = (...args) => execFileSync('git', args, { cwd: root, maxBuffer: 64 * 1024 * 1024 })
const paths = git('ls-tree', '-r', '--name-only', baseline, '--', 'src').toString().trim().split('\n')
const sources = new Map(paths.map(p => [p, git('show', `${baseline}:${p}`).toString()]))
const growth = 'src/engine/me/growth.ts'
const candidate = readFileSync(resolve(root, growth), 'utf8')
assert.notEqual(candidate, sources.get(growth))
const candidatePaths = combined ? [...new Set(git('ls-files', '-co', '--exclude-standard', '--', 'src').toString().trim().split('\n'))] : []
const candidateSources = combined ? new Map(candidatePaths.map(p => [p, readFileSync(resolve(root, p), 'utf8')])) : new Map(sources)
candidateSources.set(growth, candidate)
const hash = x => createHash('sha256').update(x).digest('hex')
const fd = openSync(resolve(process.argv[2]), 'wx')
const emit = value => writeSync(fd, JSON.stringify(value) + '\n')
const roles = ['决斗者', '先锋', '控场', '哨卫']
const cells = roles.flatMap((role, i) => ['pre', 'chal'].map((start, j) => ({ role, start,
  region: start === 'chal' || i % 2 ? 'EMEA' : 'China', seed: 8201 + i * 31 + j, year: 2026 })))
let denied = 0
globalThis.fetch = () => { denied++; return Promise.reject(Error('offline probe')) }
globalThis.XMLHttpRequest = class { constructor() { throw Error('offline') } }
globalThis.WebSocket = class { constructor() { throw Error('offline') } }
const resetStorage = () => {
  const mem = new Map()
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k,v) => mem.set(k,String(v)),
    removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size } }
}
async function bundle(variant) {
  const result = await build({ absWorkingDir: root, stdin: { contents:
    "export {createCareer,emptyTalents} from './src/engine/me/career';export {autoWeek} from './src/engine/me/auto';export {careerStarts} from './src/engine/me/detail';",
    loader: 'ts', resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm',
    define: { 'import.meta.env': 'undefined' }, plugins: [{ name: 'frozen-src', setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]/ }, args => {
        const p = relative(root, args.path).replaceAll('\\', '/')
        const selected = variant === 'candidate' ? candidateSources : sources
        assert.ok(selected.has(p), `Source outside frozen input: ${p}`)
        return { contents: selected.get(p),
          loader: p.endsWith('.json') ? 'json' : p.endsWith('.tsx') ? 'tsx' : 'ts' }
      })
    } }] })
  const code = result.outputFiles[0].text
  emit({ type: 'bundle', variant, sha256: hash(code) })
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
function snapshot(s, api) {
  const p = s.players[s.me.id]
  return { year: s.year, day: s.day, week: s.me.week, overall: p.overall, potential: p.potential,
    attrs: {...p.attrs}, caps: {...p.caps}, xp: {...p.xp}, phase: s.me.phase,
    team: p.teamId, tier: s.teams[p.teamId]?.tier ?? null, starts: api.careerStarts(s.me) }
}
try {
  emit({ type: 'metadata', created: new Date().toISOString(), baseline, years, cells,
    candidateGrowthSha: hash(candidate), sourceSha: hash(JSON.stringify([...sources])),
    candidateSourceSha: hash(JSON.stringify([...candidateSources])), combined,
    caveat: combined ? 'Eight paired diagnostic routes, not population estimates. Complete frozen candidate including CN corrections; initial player must match, world opponents may differ.' : 'Eight paired diagnostic routes, not population estimates. Growth-only candidate, excluding concurrent other features/CN corrections.' })
  const engines = { baseline: await bundle('baseline'), candidate: await bundle('candidate') }
  let count = 0
  for (const cell of cells) {
    let initial
    for (const variant of ['baseline', 'candidate']) {
      globalThis.gc?.(); resetStorage()
      const api = engines[variant]
      const s = api.createCareer({ ...cell, name: '成长对照', originKey: 'netcafe', talents: api.emptyTalents() })
      const row = { type: 'career', ...cell, variant, initial: snapshot(s, api), yearly: [],
        first: {80:null,85:null,90:null}, proWeek: null, tier1Week: null, subWeeks: 0, calls: 0 }
      if (variant === 'baseline') initial = row.initial
      else {
        const { team: _a, tier: _b, ...playerInitial } = row.initial
        const { team: _c, tier: _d, ...baselineInitial } = initial
        assert.deepEqual(playerInitial, baselineInitial, 'Paired initial player differs')
      }
      const observe = () => {
        const p = s.players[s.me.id]
        for (const n of [80,85,90]) if (row.first[n] === null && p.overall >= n) row.first[n] = s.me.week
        if (s.me.phase === 'pro' && row.proWeek === null) row.proWeek = s.me.week
        if (s.teams[p.teamId]?.tier === 1 && row.tier1Week === null) row.tier1Week = s.me.week
        for (const [k,v] of Object.entries(p.attrs)) {
          assert.ok(v <= p.caps[k] && p.caps[k] <= 99)
          assert.ok((p.xp[k] ?? 0) >= 0 && (p.xp[k] ?? 0) < 100)
        }
      }
      observe()
      while (s.year < cell.year + years && !s.gameOver && s.me.phase !== 'retired') {
        assert.ok(row.calls++ < years * 60, 'Week guard')
        const oldYear = s.year, oldWeek = s.me.week
        if (s.teams[s.players[s.me.id].teamId]?.tier === 2) row.subWeeks++
        const stop = api.autoWeek(s)
        assert.ok(['week-end','game-over'].includes(stop.kind), stop.kind)
        assert.ok(s.me.week === oldWeek + 1 || stop.kind === 'game-over')
        observe()
        if (s.year !== oldYear) row.yearly.push(snapshot(s, api))
      }
      row.final = snapshot(s, api); row.completed = s.year >= cell.year + years
      emit(row)
      console.log(`${++count}/16 ${variant} ${cell.role}/${cell.start}/${cell.region}: ${row.initial.overall}->${row.final.overall}, 80@${row.first[80]}, target=${row.completed}`)
    }
  }
  assert.equal(denied, 0)
  emit({ type: 'summary', complete: true, count: 16, deniedFetches: denied })
} catch (e) { const error = String(e.message ?? e); emit({ type:'failure', error }); console.error(error); process.exitCode = 1 }
finally { closeSync(fd) }
