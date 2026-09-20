/** Controlled local growth experiment; no engine files are written.
 * node scripts/probe_growth_current.mjs                 # plan, zero simulations
 * node --expose-gc scripts/probe_growth_current.mjs smoke # two careers, one week each
 * node --expose-gc scripts/probe_growth_current.mjs run <new-output.jsonl> [years=4]
 * JSONL is exclusive-created and appended after each career, preserving partial evidence.
 * ROOM_SCALE 10 -> 8 only tests near-ceiling slowdown; this is not approval to ship it.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { freemem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const root = resolve(dirname(scriptPath), '..')
const command = process.argv[2] ?? 'plan'
assert.ok(['plan', 'smoke', 'run'].includes(command), 'Expected plan, smoke, or run')
assert.ok(command === 'run' || process.argv.length <= 3, 'plan/smoke take no extra arguments')
assert.ok(command !== 'run' || (process.argv[3] && process.argv.length <= 5), 'run <new-output.jsonl> [years=4]')
const years = Number(command === 'run' ? process.argv[4] ?? 4 : 4)
assert.ok(Number.isInteger(years) && years >= 1 && years <= 8, 'years must be an integer in 1..8 (2026-2034)')
const output = command === 'run' ? resolve(process.argv[3]) : null
if (output) assert.ok(!existsSync(output), `Refusing to overwrite evidence: ${output}`)
const sha = value => createHash('sha256').update(value).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const sourcePaths = git('ls-files', '--', 'src').split('\n').filter(Boolean).sort()
assert.ok(sourcePaths.length, 'No tracked game sources')
assert.equal(git('status', '--porcelain', '--untracked-files=all', '--', 'src'), '', 'Commit/isolate game-source changes before measuring')
const sourceManifest = () => sourcePaths.map(path => ({ path, sha256: sha(readFileSync(resolve(root, path))) }))
const sourceFiles = sourceManifest()
const sourceSha256 = sha(JSON.stringify(sourceFiles))
const growthPath = resolve(root, 'src/engine/me/growth.ts')
const baselineSource = readFileSync(growthPath, 'utf8')
const pattern = /^const ROOM_SCALE = 10\r?$/gm
assert.equal([...baselineSource.matchAll(pattern)].length, 1, 'Expected exactly one ROOM_SCALE = 10 declaration')
const candidateSource = baselineSource.replace(pattern, match => match.replace('10', '8'))
assert.equal(candidateSource.replace(/^const ROOM_SCALE = 8(?=\r?$)/m, 'const ROOM_SCALE = 10'), baselineSource, 'Only one exact knob replacement is allowed')
const roomTop = baselineSource.match(/^const ROOM_TOP = ([0-9.]+)\r?$/m)
assert.ok(roomTop, 'Cannot fingerprint unchanged ROOM_TOP')
const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const seeds = [7001, 7212]
const variants = ['baseline', 'candidate']
const cells = roles.flatMap(role => seeds.flatMap(seed => variants.map(variant => ({
  pairKey: `2026:EMEA:chal:netcafe:${role}:${seed}`, role, seed, variant,
}))))
const expectedTalents = { aim: 3, reaction: 3, awareness: 3, utility: 3, clutch: 2, teamwork: 2, communication: 2, igl: 2 }
const metadata = {
  schema: 'growth-current-jsonl-v1', createdAt: new Date().toISOString(), command,
  headSha: git('rev-parse', 'HEAD'), sourceTree: git('rev-parse', 'HEAD:src'),
  sourceSha256, sourceFiles, scriptSha256: sha(readFileSync(scriptPath)), node: process.version,
  growthSourceSha256: { baseline: sha(baselineSource), candidate: sha(candidateSource) },
  parameters: { baseline: { ROOM_SCALE: 10, ROOM_TOP: Number(roomTop[1]) }, candidate: { ROOM_SCALE: 8, ROOM_TOP: Number(roomTop[1]) } },
  design: { roles, seeds, variants, region: 'EMEA', start: 'chal', year: 2026, years, originKey: 'netcafe',
    talents: expectedTalents, talentLabel: 'emptyTalents(): 20-point balanced preset, not zero talents',
    policy: 'autoWeek', plannedCareers: cells.length, serial: true, minFreeMiB: 1500,
    endpoint: `first year boundary at ${2026 + years}, or retirement/game-over; fail on ${years * 60}-call guard`,
    purpose: 'Test near-ceiling slowdown only. Candidate is not approved for release.',
    limitations: 'Two seeds per role, one region/start/origin/talent preset and auto policy. Paired diagnostic, not a population estimate, full-career outcome or target-achievement claim.',
  },
  measurements: {
    yearly: 'Snapshot after first weekly call that crosses each calendar year; cumulative action/match counters.',
    training: 'aim/vod/util/duo/scrim sessions and their ACTION_BY_KEY costs; all actions also recorded individually. Club automatic training is not a player AP action.',
    matches: 'Incremental year:fixtureId records, separated official/friendly; maps counted only when started. Bench series maps recorded separately.',
    thresholds: 'First observed overall >=80/85/90 at creation or an autoWeek boundary; intraweek rise-and-fall may be missed.',
    injuryWeeks: 'Weeks whose starting boundary injuryStatus is active; end-boundary observations separately retained. Not exact injured days.',
  },
}
if (command === 'plan') {
  console.log(JSON.stringify({ ...metadata, sourceFiles: `${sourceFiles.length} hashed source files; full manifest in run header`, cells, simulations: 0 }, null, 2))
  process.exit(0)
}

function memoryGuard() {
  const freeMiB = Math.floor(freemem() / 1024 ** 2)
  assert.ok(freeMiB >= 1500, `Memory safety stop: ${freeMiB} MiB available; require 1500`)
  return freeMiB
}
let deniedFetches = 0
function offlineEnvironment() {
  const mem = new Map()
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null,
    get length() { return mem.size } }
  globalThis.fetch = () => { deniedFetches++; return Promise.reject(new Error('offline growth probe')) }
  globalThis.XMLHttpRequest = class { constructor() { throw Error('Network disabled') } }
  globalThis.WebSocket = class { constructor() { throw Error('Network disabled') } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })
}
async function bundle(variant) {
  memoryGuard()
  let hits = 0
  const out = await build({ absWorkingDir: root, stdin: { contents:
    "export {createCareer,emptyTalents} from './src/engine/me/career'; export {autoWeek} from './src/engine/me/auto'; export {ACTION_BY_KEY} from './src/engine/me/actions'; export {ORIGINS} from './src/engine/me/origins'; export {injuryStatus} from './src/engine/me/injury'; export {careerStarts} from './src/engine/me/detail';",
    resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20',
    define: { 'import.meta.env': 'undefined' }, plugins: [{ name: 'only-room-scale', setup(b) {
      b.onResolve({ filter: /^(node:)?(https?|https?2|net|tls|dns|dgram|undici)(\/|$)/ }, () => { throw Error('Network module forbidden in probe engine') })
      b.onLoad({ filter: /[\\/]src[\\/]engine[\\/]me[\\/]growth\.ts$/ }, ({ path }) => {
        assert.equal(resolve(path), growthPath)
        assert.equal(readFileSync(path, 'utf8'), baselineSource, 'growth.ts changed during bundle')
        hits++
        return { contents: variant === 'baseline' ? baselineSource : candidateSource, loader: 'ts' }
      })
    } }] })
  assert.equal(hits, 1, 'Expected one growth module load')
  const code = out.outputFiles[0].text
  offlineEnvironment()
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  assert.ok(api.ORIGINS.some(o => o.key === 'netcafe'), 'Origin must exist, not fall back')
  assert.deepEqual(api.emptyTalents(), expectedTalents)
  assert.equal(Object.values(api.emptyTalents()).reduce((a, b) => a + b, 0), 20)
  return { api, bundleSha256: sha(code) }
}
function verifySources() {
  assert.equal(sha(JSON.stringify(sourceManifest())), sourceSha256, 'Game sources changed; comparison invalid')
  assert.equal(git('status', '--porcelain', '--untracked-files=all', '--', 'src'), '', 'Game sources became dirty')
}
const trainingKeys = new Set(['aim', 'vod', 'util', 'duo', 'scrim'])
const freshTotals = () => ({ actions: {}, actionAP: {}, totalActionSessions: 0, totalActionAP: 0,
  trainingSessions: 0, trainingAP: 0, injuryWeeks: 0, injuredEndBoundaries: 0,
  official: { series: 0, starts: 0, playedMaps: 0, benchSeriesMaps: 0 },
  friendly: { series: 0, starts: 0, playedMaps: 0, benchSeriesMaps: 0 } })
const stamp = s => ({ year: s.year, day: s.day, careerWeek: s.me.week })
const copy = value => JSON.parse(JSON.stringify(value))
function snapshot(s, totals) {
  const p = s.players[s.me.id]
  return { ...stamp(s), phase: s.me.phase, age: p.age, overall: p.overall, potential: p.potential,
    attrs: { ...p.attrs }, xp: { ...p.xp }, caps: { ...p.caps }, fatigue: p.fatigue,
    teamId: p.teamId, role: p.role, originKey: s.me.originKey, talents: { ...s.me.talents },
    titles: copy(s.me.titles ?? []), titleCount: (s.me.titles ?? []).length,
    completedSeasons: s.me.seasons.length, totals: copy(totals) }
}
let fd = null
const began = Date.now()
const rows = []
function append(record) {
  if (fd !== null) { writeSync(fd, `${JSON.stringify(record)}\n`); fsyncSync(fd) }
}
try {
  memoryGuard()
  if (output) fd = openSync(output, 'wx')
  append({ type: 'metadata', ...metadata, cells })
  const engines = {}
  for (const variant of variants) {
    engines[variant] = await bundle(variant)
    append({ type: 'bundle', variant, bundleSha256: engines[variant].bundleSha256, growthSourceSha256: metadata.growthSourceSha256[variant] })
  }
  assert.notEqual(engines.baseline.bundleSha256, engines.candidate.bundleSha256)
  verifySources()
  const selected = command === 'smoke' ? cells.slice(0, 2) : cells
  for (const cell of selected) {
    globalThis.gc?.()
    const { api, bundleSha256 } = engines[cell.variant]
    offlineEnvironment()
    const row = { ...cell, sourceSha256, bundleSha256, parameters: metadata.parameters[cell.variant],
      initial: null, yearly: [], final: null, firstReached: { 80: null, 85: null, 90: null },
      calls: 0, settledWeeks: 0, reason: 'create-failed', error: null }
    const totals = freshTotals(), seenMatches = new Set()
    const started = Date.now(), fetchStart = deniedFetches
    let state
    const observeThresholds = () => { for (const threshold of [80, 85, 90]) {
      const overall = state.players[state.me.id].overall
      if (row.firstReached[threshold] === null && overall >= threshold) row.firstReached[threshold] = { ...stamp(state), overall }
    } }
    try {
      row.freeMiBAtStart = memoryGuard()
      state = api.createCareer({ name: '本地成长对照', region: 'EMEA', start: 'chal', year: 2026,
        originKey: 'netcafe', role: cell.role, seed: cell.seed, talents: api.emptyTalents() })
      assert.equal(state.me.originKey, 'netcafe')
      assert.deepEqual(state.me.talents, expectedTalents)
      row.initial = snapshot(state, totals)
      const initialStarts = api.careerStarts(state.me)
      observeThresholds()
      while (state.year < 2026 + years && !state.gameOver && state.me.phase !== 'retired') {
        memoryGuard()
        assert.ok(row.calls < years * 60, 'Week guard exhausted: censored, not a complete career')
        const priorWeek = state.me.week, priorYear = state.year
        if (api.injuryStatus(state)) totals.injuryWeeks++
        const stop = api.autoWeek(state)
        row.calls++
        assert.ok(['week-end', 'game-over'].includes(stop.kind), `autoWeek stuck at ${stop.kind}`)
        const advanced = state.me.week - priorWeek
        assert.ok(advanced === 0 || advanced === 1, `Unexpected ${advanced} settled weeks`)
        assert.ok(advanced === 1 || stop.kind === 'game-over', 'Week-end without settlement')
        row.settledWeeks += advanced
        const actions = advanced ? state.me.lastWeekDone ?? [] : state.me.weekDone ?? []
        for (const action of actions) {
          const def = api.ACTION_BY_KEY[action]
          assert.ok(def, `Unknown action ${action}`)
          totals.actions[action] = (totals.actions[action] ?? 0) + 1
          totals.actionAP[action] = (totals.actionAP[action] ?? 0) + def.cost
          totals.totalActionSessions++; totals.totalActionAP += def.cost
          if (trainingKeys.has(action)) { totals.trainingSessions++; totals.trainingAP += def.cost }
        }
        for (const match of state.me.matches) {
          const key = `${match.year}:${match.fixtureId}`
          if (seenMatches.has(key)) continue
          seenMatches.add(key)
          const count = match.friendly ? totals.friendly : totals.official
          count.series++
          if (match.started) { count.starts++; count.playedMaps += match.maps }
          else count.benchSeriesMaps += match.maps
        }
        if (api.injuryStatus(state)) totals.injuredEndBoundaries++
        observeThresholds()
        if (state.year !== priorYear) row.yearly.push(snapshot(state, totals))
        if (stop.kind === 'game-over') { row.reason = 'game-over'; break }
        if (command === 'smoke') { row.reason = 'smoke-one-week'; break }
      }
      if (state.year >= 2026 + years) row.reason = 'target-year'
      else if (state.me.phase === 'retired') row.reason = 'retired'
      assert.equal(totals.official.starts, api.careerStarts(state.me) - initialStarts, 'Accumulated starts diverged from persistent career ledger')
      verifySources()
    } catch (error) { row.reason = 'exception'; row.error = String(error?.stack ?? error) }
    row.final = state ? snapshot(state, totals) : null
    row.completedTarget = !!state && state.year >= 2026 + years
    row.seconds = (Date.now() - started) / 1000
    row.deniedFetches = deniedFetches - fetchStart
    rows.push(row)
    append({ type: 'career', ...row })
    console.log(`${rows.length}/${selected.length} ${cell.variant} ${cell.role} ${cell.seed}: ${row.reason}, ${row.settledWeeks} weeks, ${row.initial?.overall ?? '?'} -> ${row.final?.overall ?? '?'}`)
    if (command === 'smoke') console.log(JSON.stringify(row))
    if (row.error) throw Error(`Career failed; partial evidence retained: ${row.error}`)
  }
  verifySources()
  append({ type: 'summary', complete: rows.length === cells.length, recorded: rows.length,
    planned: cells.length, reachedTarget: rows.filter(r => r.completedTarget).length,
    seconds: (Date.now() - began) / 1000, sourceUnchanged: true })
  console.log(command === 'smoke' ? 'PASS smoke: two careers, one week each; no balance conclusion.' : `Evidence: ${output}; ${rows.length} careers recorded; inspect censoring before comparison.`)
} catch (error) {
  append({ type: 'failure', error: String(error?.stack ?? error), recorded: rows.length, seconds: (Date.now() - began) / 1000 })
  console.error(String(error?.stack ?? error))
  process.exitCode = 1
} finally { if (fd !== null) closeSync(fd) }
