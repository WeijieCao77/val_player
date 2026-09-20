/** Offline paired role diagnostic, not a claim that every build has identical difficulty.
 * node --expose-gc scripts/probe_role_ecology.mjs matches|careers <new.jsonl> [--draft]
 * Formal runs require clean committed src, baseline fixed at the preceding release.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, openSync, writeSync, closeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baseline = resolve(root, '../growth-balance')
const mode = process.argv[2], output = resolve(process.argv[3] ?? ''), draft = process.argv.includes('--draft')
assert.ok(['matches', 'careers'].includes(mode) && process.argv[3])
assert.ok(!existsSync(output), 'Refuse to overwrite evidence')
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim()
const sha = x => createHash('sha256').update(x).digest('hex')
const fingerprint = dir => {
  const files = git(dir, 'ls-files', '--cached', '--others', '--exclude-standard', '--', 'src').split('\n').filter(Boolean).sort()
  return { head: git(dir, 'rev-parse', 'HEAD'), status: git(dir, 'status', '--porcelain', '--', 'src'),
    sha: sha(JSON.stringify(files.map(f => [f, sha(readFileSync(resolve(dir, f)))]))) }
}
const sources = { baseline: fingerprint(baseline), candidate: fingerprint(root) }
assert.equal(sources.baseline.head, '57a4e6b34be4c3cfc2fbcf000b59d07ef5be27bf')
assert.equal(sources.baseline.status, '')
if (!draft) assert.equal(sources.candidate.status, '', 'Commit final candidate before formal evidence')
const roles = ['决斗者', '先锋', '控场', '哨卫', '自由人']
const core = [['aim', 'reaction', 'clutch'], ['utility', 'awareness', 'teamwork'],
  ['utility', 'awareness', 'teamwork'], ['awareness', 'utility', 'clutch'], ['aim', 'awareness', 'utility']]
const keys = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl']
function offline() {
  const mem = new Map()
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)),
    removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } }
  globalThis.fetch = () => Promise.reject(Error('offline role probe'))
  globalThis.XMLHttpRequest = class { constructor() { throw Error('offline') } }
  globalThis.WebSocket = class { constructor() { throw Error('offline') } }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })
}
const fd = openSync(output, 'wx')
const append = x => writeSync(fd, JSON.stringify(x) + '\n')
const engines = {}
try {
  append({ type: 'meta', mode, draft, at: new Date().toISOString(), sources,
    scriptSha: sha(readFileSync(fileURLToPath(import.meta.url))),
    caveat: 'Diagnostic samples, not universal difficulty estimates. Equal attributes and equal-budget role-specialised attributes are separate match cohorts. Career builds use identical even talents/rich origin to isolate rule changes, not recommended-build optimization.' })
  for (const [variant, dir] of Object.entries({ baseline, candidate: root })) {
    offline()
    const extra = existsSync(resolve(dir, 'src/engine/performance.ts')) ? "export {performanceRating} from './src/engine/performance';" : ''
    const b = await build({ absWorkingDir: dir, stdin: { resolveDir: dir, loader: 'ts', contents:
      "export {createCareer,emptyTalents} from './src/engine/me/career';export {autoWeek} from './src/engine/me/auto';export {simulateMatch} from './src/engine/match';export {Rng} from './src/engine/rng';export {recomputeOverall,ratingOf} from './src/engine/player';" + extra },
      bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', define: { 'import.meta.env': 'undefined' } })
    const code = b.outputFiles[0].text
    engines[variant] = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${variant}`)
    append({ type: 'bundle', variant, sha: sha(code) })
  }
  if (mode === 'matches') {
    for (const variant of ['baseline', 'candidate']) for (const profile of ['equal80', 'equalBudgetSpecialist']) {
      offline(); const api = engines[variant]
      const s = api.createCareer({ name: 'RoleProbe', role: '自由人', region: 'EMEA', year: 2026, start: 'pre', originKey: 'rich', talents: api.emptyTalents(), seed: 9417 })
      const teams = Object.values(s.teams).filter(t => t.tier === 1 && t.roster.length >= 5).slice(0, 2)
      for (const t of teams) {
        t.roster = t.roster.slice(0, 5); t.starters = [...t.roster]
        for (let i = 0; i < 5; i++) {
          const p = s.players[t.roster[i]]
          p.role = roles[i]; p.roles = [roles[i]]; p.agentPool = []; p.rolePro = {}
          p.attrs = Object.fromEntries(keys.map(k => [k, profile === 'equal80' ? 80 : core[i].includes(k) ? 90 : 74]))
          p.form = 70; p.morale = 70; p.fatigue = 0; p.injuredUntil = 0; p.isIgl = i === 4
          api.recomputeOverall(p)
        }
      }
      const rows = Object.fromEntries(roles.map(role => [role, { role, mvps: 0, exposures: 0, rounds: 0, kills: 0, deaths: 0, assists: 0, firstKills: 0, firstDeaths: 0, clutches: 0, damage: 0 }]))
      let complete = 0
      for (let i = 0; i < 600; i++) {
        const r = api.simulateMatch(s, teams[0].id, teams[1].id, [1, 3, 5][i % 3], new api.Rng(9417000 + i))
        assert.ok(r.maps.length && r.mvp)
        rows[s.players[r.mvp].role].mvps++; complete++
        for (const m of r.maps) for (const [id, l] of Object.entries(m.lines)) {
          const row = rows[s.players[id].role]; row.exposures++
          for (const k of ['rounds', 'kills', 'deaths', 'assists', 'firstKills', 'firstDeaths', 'clutches', 'damage']) row[k] += l[k] ?? 0
        }
      }
      for (const row of Object.values(rows)) row.rating = (api.performanceRating ?? api.ratingOf)(row)
      append({ type: 'matches', variant, profile, complete, rows }); console.log(`${variant}/${profile}: ` + JSON.stringify(rows))
    }
  } else {
    let n = 0
    const baselineInitials = new Map()
    for (const role of roles) for (const seed of [9417, 9563]) for (const start of ['pre', 't1']) for (const variant of ['baseline', 'candidate']) {
      globalThis.gc?.(); offline(); const api = engines[variant]
      const s = api.createCareer({ name: 'RoleCareer', role, region: 'EMEA', year: 2026, start, originKey: 'rich', talents: api.emptyTalents(), seed })
      const p = s.players[s.me.id]
      const row = { type: 'career', variant, role, seed, start, initial: { attrs: { ...p.attrs }, caps: { ...p.caps }, overall: p.overall },
        weeks: 0, preWeeks: 0, tier2Weeks: 0, tier1Weeks: 0, benchWeeks: 0, starts: 0, mvps: 0, ratingSum: 0, firstTier1: null, yearly: [] }
      const pairKey = `${role}:${seed}:${start}`
      if (variant === 'baseline') baselineInitials.set(pairKey, row.initial)
      else assert.deepEqual(row.initial, baselineInitials.get(pairKey), 'Paired starts must match exactly')
      const seen = new Set()
      while (s.year < 2030 && !s.gameOver && s.me.phase !== 'retired') {
        assert.ok(row.weeks < 230, 'weekly guard')
        const team = s.teams[s.myTeam], y = s.year
        if (s.me.phase === 'pre') row.preWeeks++
        else if (team?.tier === 1) row.tier1Weeks++
        else if (team?.tier === 2) row.tier2Weeks++
        if (s.me.phase === 'pro' && team && !team.starters.includes(s.me.id)) row.benchWeeks++
        if (!row.firstTier1 && s.me.phase === 'pro' && team?.tier === 1) row.firstTier1 = { year: s.year, day: s.day, week: row.weeks }
        const stop = api.autoWeek(s); row.weeks++
        assert.ok(['week-end', 'game-over'].includes(stop.kind), `Stuck at ${stop.kind}`)
        for (const m of s.me.matches) {
          const key = `${m.year}:${m.fixtureId}`; if (seen.has(key)) continue; seen.add(key)
          if (m.friendly || !m.started) continue
          row.starts++; row.mvps += Number(m.mvp); row.ratingSum += m.rating
        }
        if (s.year !== y) row.yearly.push({ year: s.year, overall: p.overall, attrs: { ...p.attrs }, caps: { ...p.caps }, starts: row.starts, mvps: row.mvps })
      }
      row.reason = s.year >= 2030 ? 'target-year' : s.me.phase === 'retired' ? 'retired' : 'game-over'
      row.final = { year: s.year, day: s.day, overall: p.overall, attrs: { ...p.attrs }, caps: { ...p.caps }, coachTrust: s.me.coachTrust }
      append(row); console.log(`${++n}/40 ${variant}/${role}/${seed}/${start}: ${row.reason}, OVR ${p.overall}, starts ${row.starts}, MVP ${row.mvps}`)
    }
  }
  if (!draft) {
    assert.deepEqual(fingerprint(baseline), sources.baseline)
    assert.deepEqual(fingerprint(root), sources.candidate)
  }
  append({ type: 'complete', mode, draft, at: new Date().toISOString(), frozen: !draft })
} catch (e) { append({ type: 'failure', message: String(e?.stack ?? e) }); console.error(e); process.exitCode = 1 }
finally { closeSync(fd) }
