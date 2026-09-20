/** Read-only, serial paired career-access probe.
 * node scripts/probe_career_access.mjs [plan]
 * node --expose-gc scripts/probe_career_access.mjs smoke
 * node --expose-gc scripts/probe_career_access.mjs run <new-output.jsonl>
 * Baseline is ../review-batch at 3addd0f; candidate is this worktree.
 * Run requires committed clean src in BOTH trees. Smoke can inspect a dirty
 * candidate, explicitly fingerprinted and ineligible as release evidence.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs'
import { freemem } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const self = fileURLToPath(import.meta.url)
const root = resolve(dirname(self), '..')
const roots = { baseline: resolve(root, '../review-batch'), candidate: root }
const BASE = '3addd0f0581590a6ca7bb22f8013058a94f2d56b'
const command = process.argv[2] ?? 'plan'
assert.ok(['plan', 'smoke', 'run'].includes(command), 'Expected plan, smoke, or run')
assert.ok(command === 'run' ? process.argv.length === 4 : process.argv.length <= 3, 'run requires exactly one new JSONL path; plan/smoke take none')
const output = command === 'run' ? resolve(process.argv[3]) : null
if (output) assert.ok(!existsSync(output), `Refusing to overwrite ${output}`)
const sha = x => createHash('sha256').update(x).digest('hex')
const git = (dir, ...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
function fingerprint(dir) {
  const paths = git(dir, 'ls-files', '--', 'src').split('\n').filter(Boolean).sort()
  assert.ok(paths.length)
  const sourceFiles = paths.map(path => ({ path, sha256: sha(readFileSync(resolve(dir, path))) }))
  return { root: dir, headSha: git(dir, 'rev-parse', 'HEAD'), sourceTree: git(dir, 'rev-parse', 'HEAD:src'),
    sourceStatus: git(dir, 'status', '--porcelain', '--untracked-files=all', '--', 'src'),
    sourceSha256: sha(JSON.stringify(sourceFiles)), sourceFiles }
}
const sources = Object.fromEntries(Object.entries(roots).map(([v, dir]) => [v, fingerprint(dir)]))
assert.equal(sources.baseline.headSha, BASE, 'Baseline must be the specified live baseline commit')
assert.equal(sources.baseline.sourceStatus, '', 'Baseline src must be clean')
if (command === 'run') assert.equal(sources.candidate.sourceStatus, '', 'Commit candidate src before formal run')
const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const talents = {
  even: { aim: 3, reaction: 3, awareness: 3, utility: 3, clutch: 2, teamwork: 2, communication: 2, igl: 2 },
  gun: { aim: 7, reaction: 6, awareness: 2, utility: 1, clutch: 3, teamwork: 1, communication: 0, igl: 0 },
}
const cases = []
for (const year of [2021, 2026]) for (const region of ['China', 'EMEA']) for (const seed of [8301, 8512]) {
  const i = cases.length
  cases.push({ caseIndex: i, year, endYear: year + 8, region, seed, role: roles[i % roles.length],
    talent: i % 2 ? 'gun' : 'even', start: 'pre', originKey: 'netcafe' })
}
const cells = cases.flatMap(c => ['baseline', 'candidate'].map(variant => ({ ...c, variant })))
const metadata = { schema: 'career-access-jsonl-v1', createdAt: new Date().toISOString(), command,
  scriptSha256: sha(readFileSync(self)), node: process.version, sources, talents, cases,
  design: { careers: 16, years: 8, policy: 'autoWeek', minFreeMiB: 1500, serial: true,
    caveat: 'Paired diagnostic: role/talent/seed are confounded by case design, not independent factor estimates. First tier1 membership is neither sustained starting nor a title. Tier1 in 2021 is not the later closed VCT league.',
    region: 'Requested China/EMEA; actual startRegion is recorded (2021 EMEA may resolve to a historical subregion).',
    censoring: 'Retirement/game-over before endYear is explicitly censored; 480-call guard is a failure.',
    measurement: 'Weekly boundary snapshots. Weeks classified at START of each autoWeek call; bench is an overlapping pro subset. Bond/coach averages use only pro weeks with a real club.',
    news: 'NewsItem has day/kind/text, no year/id: identify new objects weekly. Arguments also appear in weekNotes; unresolved-feud reminders may exist ONLY in weekNotes. Same-week copies merged with source provenance.',
    milestones: 'Signings use sign moments with exact year/day when available; membership fallback is weekly observed. First tier1 start requires an actual non-friendly started match with resolved historical club tier.',
    thresholds: '80/85/90 first observed at creation or a weekly endpoint, not exact intraweek crossings.',
  } }
if (command === 'plan') {
  console.log(JSON.stringify({ ...metadata, sources: Object.fromEntries(Object.entries(sources).map(([v, s]) => [v, { ...s, sourceFiles: `${s.sourceFiles.length} files hashed` }])),
    candidateReadyForRun: sources.candidate.sourceStatus === '', cells, simulations: 0 }, null, 2))
  process.exit(0)
}
const memoryGuard = () => { const freeMiB = Math.floor(freemem() / 1024 ** 2); assert.ok(freeMiB >= 1500, `Memory safety stop: ${freeMiB} MiB`); return freeMiB }
const clone = x => JSON.parse(JSON.stringify(x))
function verify(v) {
  const now = fingerprint(roots[v])
  for (const field of ['headSha', 'sourceStatus', 'sourceSha256']) assert.equal(now[field], sources[v][field], `${v} ${field} changed during measurement`)
}
function offline() {
  const mem = new Map()
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k),
    clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
  globalThis.fetch = () => Promise.reject(Error('offline career access probe'))
  globalThis.XMLHttpRequest = class { constructor() { throw Error('Network disabled') } }
  globalThis.WebSocket = class { constructor() { throw Error('Network disabled') } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })
}
async function engine(v) {
  memoryGuard(); verify(v)
  const dir = roots[v]
  const built = await build({ absWorkingDir: dir, stdin: { contents:
    "export {createCareer,emptyTalents,startRegion} from './src/engine/me/career'; export {TALENT_PRESETS} from './src/engine/me/talent'; export {autoWeek} from './src/engine/me/auto'; export {ORIGINS} from './src/engine/me/origins'; export {roomView} from './src/engine/me/room'; export {careerStarts} from './src/engine/me/detail'; export {compClass,isQualifier,isFinal} from './src/engine/me/compclass';",
    loader: 'ts', resolveDir: dir }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20',
    define: { 'import.meta.env': 'undefined' }, plugins: [{ name: 'offline-only', setup(b) {
      b.onResolve({ filter: /^(node:)?(https?|http2|net|tls|dns|dgram|undici)(\/|$)/ }, () => { throw Error('Network module forbidden') })
    } }] })
  verify(v); offline()
  const code = built.outputFiles[0].text
  // Separate module identities even when sources coincide: caches cannot leak between variants.
  const api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${v}`)
  assert.ok(api.ORIGINS.some(o => o.key === 'netcafe'))
  assert.deepEqual(api.emptyTalents(), talents.even)
  assert.deepEqual(api.TALENT_PRESETS.find(p => p.key === 'gun')?.t, talents.gun)
  return { api, bundleSha256: sha(code) }
}
const stamp = s => ({ year: s.year, day: s.day, week: s.me.week })
const dateValue = x => x.year * 400 + x.day
function status(s) {
  const p = s.players[s.me.id], team = p.teamId ? s.teams[p.teamId] : null
  const pro = s.me.phase === 'pro' && !!team
  return { ...stamp(s), phase: s.me.phase, teamId: pro ? team.id : null, teamName: pro ? team.name : null,
    tier: pro ? team.tier : null, selectedStarter: pro ? team.starters.includes(s.me.id) : false,
    overall: p.overall, potential: p.potential }
}
function snap(s, row, api) {
  const p = s.players[s.me.id], room = api.roomView(s)
  return { ...status(s), attrs: { ...p.attrs }, caps: { ...p.caps }, xp: { ...p.xp }, age: p.age,
    actualRegion: s.me.region, coachTrust: s.me.coachTrust, roomBond: room?.mine ?? null,
    weekly: clone(row.weekly), officialStarts: api.careerStarts(s.me), titles: clone(row.titles) }
}
function classify(text) { return text.includes('赛后起了争执') ? 'argue' : text.includes('关系还没缓和') ? 'unresolved' : null }
let fd = null, completed = 0
const began = Date.now()
const append = x => { if (fd !== null) { writeSync(fd, `${JSON.stringify(x)}\n`); fsyncSync(fd) } }
try {
  memoryGuard()
  if (output) fd = openSync(output, 'wx')
  append({ type: 'metadata', ...metadata })
  const engines = {}
  for (const v of ['baseline', 'candidate']) { engines[v] = await engine(v); append({ type: 'bundle', variant: v, bundleSha256: engines[v].bundleSha256 }) }
  for (const cell of command === 'smoke' ? cells.slice(0, 2) : cells) {
    globalThis.gc?.(); offline()
    const { api, bundleSha256 } = engines[cell.variant]
    const row = { ...cell, sourceSha256: sources[cell.variant].sourceSha256, sourceHead: sources[cell.variant].headSha, bundleSha256,
      firstSigned: null, firstTier1: null, firstTier1Start: null, firstReached: { 80: null, 85: null, 90: null },
      weekly: { pre: 0, tier2: 0, tier1: 0, other: 0, bench: 0, proSamples: 0, bondSum: 0, coachTrustSum: 0 },
      signings: [], roomEvents: [], titles: [], yearly: [], officialMatches: [], unresolvedMatchTier: 0,
      calls: 0, settledWeeks: 0, reason: 'create-failed', censored: true, error: null }
    const seenNews = new WeakSet(), seenSigns = new Set(), seenMatches = new Set(), seenTitles = new Set()
    let s
    const started = Date.now()
    const observe = () => {
      const now = status(s)
      if (now.phase === 'pro' && now.teamId && !row.firstSigned) row.firstSigned = { ...now, evidence: 'weekly-membership-observation' }
      if (now.tier === 1 && !row.firstTier1) row.firstTier1 = { ...now, evidence: 'weekly-membership-observation' }
      for (const n of [80, 85, 90]) if (!row.firstReached[n] && now.overall >= n) row.firstReached[n] = now
    }
    try {
      row.freeMiBAtStart = memoryGuard()
      row.actualStartRegion = api.startRegion(cell.region, cell.year, 'pre')
      assert.ok(row.actualStartRegion, 'No valid historical start region')
      s = api.createCareer({ name: 'AccessProbe', region: cell.region, year: cell.year, start: 'pre', originKey: 'netcafe',
        role: cell.role, seed: cell.seed, talents: { ...talents[cell.talent] } })
      assert.equal(s.me.originKey, 'netcafe'); assert.equal(s.me.region, row.actualStartRegion)
      assert.deepEqual(s.me.talents, talents[cell.talent])
      for (const n of s.news) seenNews.add(n)
      row.initial = snap(s, row, api); observe()
      while (s.year < cell.endYear && !s.gameOver && s.me.phase !== 'retired') {
        memoryGuard(); assert.ok(row.calls < 480, '480-call guard exhausted')
        const before = status(s), oldFixtures = s.fixtures
        const oldTeams = new Map(Object.values(s.teams).map(t => [t.id, { tier: t.tier, name: t.name }]))
        const room = api.roomView(s)
        if (before.phase === 'pre') row.weekly.pre++
        else if (before.tier === 1) row.weekly.tier1++
        else if (before.tier === 2) row.weekly.tier2++
        else row.weekly.other++
        if (before.teamId) {
          if (!before.selectedStarter) row.weekly.bench++
          assert.ok(room && Number.isFinite(room.mine) && Number.isFinite(s.me.coachTrust))
          row.weekly.proSamples++; row.weekly.bondSum += room.mine; row.weekly.coachTrustSum += s.me.coachTrust
        }
        const stop = api.autoWeek(s); row.calls++
        assert.ok(['week-end', 'game-over'].includes(stop.kind), `Stuck at ${stop.kind}`)
        const delta = s.me.week - before.week
        assert.ok(delta === 1 || (delta === 0 && stop.kind === 'game-over'), 'Unexpected week settlement')
        row.settledWeeks += delta
        for (const m of s.me.moments ?? []) if (m.kind === 'sign' && !seenSigns.has(m.key)) {
          seenSigns.add(m.key)
          const team = m.year === before.year && s.year !== before.year ? oldTeams.get(m.teamId) : s.teams[m.teamId]
          const signed = { year: m.year, day: m.day, observedWeek: s.me.week, teamId: m.teamId, teamName: team?.name ?? null, tier: team?.tier ?? null,
            first: m.first ?? false, role: m.role ?? null, evidence: 'sign-moment' }
          row.signings.push(signed)
          if (!row.firstSigned || dateValue(signed) < dateValue(row.firstSigned)) row.firstSigned = signed
          if (signed.tier === 1 && (!row.firstTier1 || dateValue(signed) < dateValue(row.firstTier1))) row.firstTier1 = signed
        }
        observe()
        // News objects persist across weekly reads; only new objects are events.
        const events = new Map()
        for (const n of s.news) {
          if (seenNews.has(n)) continue
          seenNews.add(n)
          const kind = classify(n.text)
          if (!kind) continue
          const event = { observed: stamp(s), year: s.year !== before.year && n.day > s.day ? before.year : s.year,
            day: n.day, kind, text: n.text, involvesPlayer: n.text.includes(s.players[s.me.id].ign), sources: ['state.news'], rawNews: clone(n) }
          events.set(`${event.year}:${event.day}:${event.text}`, event)
        }
        for (const text of new Set(s.me.weekNotes)) {
          const kind = classify(text)
          if (!kind) continue
          const copies = [...events.values()].filter(e => e.text === text)
          if (copies.length) { for (const e of copies) e.sources.push('me.weekNotes'); continue }
          events.set(`note:${s.me.week}:${text}`, { observed: stamp(s), year: null, day: null, kind, text,
            involvesPlayer: text.includes(s.players[s.me.id].ign), sources: ['me.weekNotes'] })
        }
        row.roomEvents.push(...events.values())
        for (const rec of s.me.matches) {
          const key = `${rec.year}:${rec.fixtureId}`
          if (seenMatches.has(key)) continue
          seenMatches.add(key)
          if (rec.friendly) continue
          const fixtures = rec.year === before.year && s.year !== before.year ? oldFixtures : s.fixtures
          const f = fixtures.find(x => x.id === rec.fixtureId)
          let teamId = f?.result?.lineups?.a?.includes(s.me.id) ? f.teamA : f?.result?.lineups?.b?.includes(s.me.id) ? f.teamB : null
          let evidence = teamId ? 'fixture-result-lineup' : null
          if (!teamId) {
            const signing = row.signings.filter(x => dateValue(x) <= dateValue(rec)).sort((a, b) => dateValue(b) - dateValue(a))[0]
            if (signing && f && [f.teamA, f.teamB].includes(signing.teamId)) { teamId = signing.teamId; evidence = 'sign-moment-and-fixture' }
          }
          const team = rec.year === before.year && s.year !== before.year ? oldTeams.get(teamId) : s.teams[teamId]
          const match = { year: rec.year, day: rec.day, fixtureId: rec.fixtureId, comp: rec.comp, cls: api.compClass(rec.comp),
            started: rec.started, won: rec.won, maps: rec.maps, final: api.isFinal(rec.label), teamId, tier: team?.tier ?? null, evidence }
          row.officialMatches.push(match)
          if (rec.started && match.tier == null) row.unresolvedMatchTier++
          if (rec.started && match.tier === 1 && (!row.firstTier1Start || dateValue(match) < dateValue(row.firstTier1Start))) row.firstTier1Start = { ...match, observedWeek: s.me.week }
        }
        for (const title of s.me.titles) {
          const key = `${title.year}:${title.title}`
          if (seenTitles.has(key)) continue
          seenTitles.add(key)
          const matches = row.officialMatches.filter(m => m.year === title.year && m.comp === title.title)
          row.titles.push({ ...title, cls: api.compClass(title.title), qualifier: api.isQualifier(title.title),
            observed: stamp(s), officialStartsInEvent: matches.filter(m => m.started).length,
            finalStarted: matches.some(m => m.final && m.started),
            startedMeaning: 'Stored title.started means at least one event start, not necessarily the final.' })
        }
        if (s.year !== before.year) row.yearly.push(snap(s, row, api))
        if (stop.kind === 'game-over') { row.reason = 'game-over'; break }
        if (command === 'smoke') { row.reason = 'smoke-one-week'; break }
      }
      if (s.year >= cell.endYear) { row.reason = 'target-year'; row.censored = false }
      else if (s.me.phase === 'retired') row.reason = 'retired'
      assert.equal(row.officialMatches.filter(m => m.started).length, api.careerStarts(s.me), 'Missed/double-counted official starts')
      verify(cell.variant)
    } catch (error) { row.reason = 'exception'; row.error = String(error?.stack ?? error) }
    row.final = s ? snap(s, row, api) : null
    row.meanBond = row.weekly.proSamples ? row.weekly.bondSum / row.weekly.proSamples : null
    row.meanCoachTrust = row.weekly.proSamples ? row.weekly.coachTrustSum / row.weekly.proSamples : null
    row.roomCounts = Object.fromEntries(['argue', 'unresolved'].map(k => [k, { all: row.roomEvents.filter(e => e.kind === k).length,
      player: row.roomEvents.filter(e => e.kind === k && e.involvesPlayer).length }]))
    row.seconds = (Date.now() - started) / 1000
    append({ type: 'career', ...row }); completed++
    console.log(`${completed}/${command === 'smoke' ? 2 : 16} ${cell.variant} ${cell.year}/${cell.region}/${cell.seed}/${cell.role}/${cell.talent}: ${row.reason}, ${row.settledWeeks} weeks, ${row.final?.overall ?? '?'}`)
    if (command === 'smoke') console.log(JSON.stringify(row))
    if (row.error) throw Error(row.error)
  }
  verify('baseline'); verify('candidate')
  append({ type: 'summary', completed, planned: 16, complete: completed === 16, sourcesUnchanged: true, seconds: (Date.now() - began) / 1000 })
  console.log(command === 'smoke' ? 'PASS smoke: both engines one week; not balance evidence.' : `Saved ${completed}/16 paired careers: ${output}`)
} catch (error) {
  append({ type: 'failure', error: String(error?.stack ?? error), completed, seconds: (Date.now() - began) / 1000 })
  console.error(String(error?.stack ?? error)); process.exitCode = 1
} finally { if (fd !== null) closeSync(fd) }
