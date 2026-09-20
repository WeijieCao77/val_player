/** Offline, training-only paired diagnostic. Other candidate mechanisms are
 * frozen identically; baseline replaces only auto.ts/growth.ts with release 57a4e6b.
 * node --expose-gc scripts/probe_role_training.mjs [years=2] [role]
 * Prints JSONL, never writes source or saves. Not a final release attestation. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const baselineRef = '57a4e6b34be4c3cfc2fbcf000b59d07ef5be27bf'
const years = Number(process.argv[2] ?? 2)
assert.ok(Number.isInteger(years) && years >= 1 && years <= 4)
const sha = x => createHash('sha256').update(x).digest('hex')
const frozen = new Map()
const overrides = new Map(['src/engine/me/auto.ts', 'src/engine/me/growth.ts'].map(p =>
  [resolve(root, p), execFileSync('git', ['show', `${baselineRef}:${p}`], { cwd: root, encoding: 'utf8' })]))
const offline = () => {
  const mem = new Map()
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k), clear: () => mem.clear() }
  globalThis.fetch = () => Promise.reject(Error('offline training probe'))
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { sendBeacon: () => false } })
}
const engines = {}
for (const variant of ['candidate', 'baseline']) {
  const out = await build({ stdin: { contents: "export {createCareer,emptyTalents} from './src/engine/me/career'; export {ROLE_TALENT_PRESETS} from './src/engine/me/talent'; export {autoWeek} from './src/engine/me/auto';", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', define: { 'import.meta.env': 'undefined' },
    plugins: [{ name: 'freeze-and-replace-training-only', setup(b) {
      b.onLoad({ filter: /[/\\]src[/\\].*\.(ts|json)$/ }, ({ path }) => {
        if (!frozen.has(path)) frozen.set(path, readFileSync(path, 'utf8'))
        return { contents: variant === 'baseline' && overrides.has(path) ? overrides.get(path) : frozen.get(path), loader: path.endsWith('.json') ? 'json' : 'ts' }
      })
    } }] })
  offline()
  const code = out.outputFiles[0].text
  engines[variant] = { api: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${variant}`), sha: sha(code) }
}
const selectedRoles = process.argv[3] ? [process.argv[3]] : Object.keys(engines.candidate.api.ROLE_TALENT_PRESETS)
assert.ok(selectedRoles.every(role => role in engines.candidate.api.ROLE_TALENT_PRESETS), 'Unknown role filter')
console.log(JSON.stringify({ type: 'metadata', years, baselineHead: baselineRef, candidateHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  bundles: Object.fromEntries(Object.entries(engines).map(([k, v]) => [k, v.sha])), frozenSourceSha: sha(JSON.stringify([...frozen].sort())),
  selectedRoles, note: 'Selected roles x 1 seed, matched role presets, EMEA/chal/netcafe, only auto+growth differ; work-in-progress diagnostic, not population estimate.' }))
const rows = []
for (const role of selectedRoles) {
  for (const variant of ['baseline', 'candidate']) {
    globalThis.gc?.(); offline()
    const api = engines[variant].api
    const s = api.createCareer({ name: 'RoleTraining', region: 'EMEA', year: 2026, start: 'chal', originKey: 'netcafe',
      role, seed: 9107, talents: { ...api.ROLE_TALENT_PRESETS[role].t } })
    const p = s.players[s.me.id]
    const snap = () => ({ year: s.year, day: s.day, ovr: p.overall, attrs: { ...p.attrs }, caps: { ...p.caps } })
    const row = { role, variant, initial: snap(), yearly: [], calls: 0 }
    while (s.year < 2026 + years && !s.gameOver && s.me.phase !== 'retired') {
      const year = s.year
      assert.ok(row.calls++ < years * 65)
      const stop = api.autoWeek(s)
      assert.ok(['week-end', 'game-over'].includes(stop.kind))
      if (s.year !== year) row.yearly.push(snap())
    }
    row.final = snap(); row.censored = s.year < 2026 + years
    rows.push(row); console.log(JSON.stringify({ type: 'career', ...row }))
  }
}
for (const role of selectedRoles) {
  const [a, b] = rows.filter(x => x.role === role)
  assert.deepEqual(a.initial, b.initial)
  assert.equal(a.censored, false); assert.equal(b.censored, false)
}
console.log(JSON.stringify({ type: 'complete', careers: rows.length, allCompleted: true }))
