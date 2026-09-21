/** Real f80fc11 autosave -> fully frozen current candidate. Local synthetic data
 * only; source bundles stay in memory. node scripts/check_maintenance_compat.mjs */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineRef = 'f80fc11118328306590cb578ebdcf5b7363c3f27'
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const hash = x => createHash('sha256').update(x).digest('hex')
const digest = x => hash(JSON.stringify(x))
const copy = x => structuredClone(x)
const lines = text => text.trim().split('\n').filter(Boolean)
const candidatePaths = () => [...new Set(lines(git('ls-files', '-co', '--exclude-standard', '--', 'src')))].sort()
const captureCandidate = () => new Map(candidatePaths().map(p => [p, readFileSync(resolve(root, p), 'utf8')]))
const manifest = sources => digest([...sources].sort(([a], [b]) => a.localeCompare(b)).map(([p, text]) => [p, hash(text)]))
const entry = `
export { createCareer, emptyTalents, talentsOf } from './src/engine/me/career';
export { doAction, undoAction, settleWeek } from './src/engine/me/week';
export { weekGain, gainBase } from './src/engine/me/growth';
export { packState } from './src/engine/save';
export { autosave, flushAutosave, loadAutosave, claimAutosave, SAVE_KEYS } from './src/engine/me/save';
export { createNewGame, createWorld } from './src/engine/world';
export { createManager } from './src/engine/manager';
export { mountManagerDesk } from './src/engine/managerDesk';
export { weeklyTick } from './src/engine/training';
export { shiftPlayer } from './src/engine/ruler';
export { Rng } from './src/engine/rng';
`
async function bundle(label, sources) {
  const extra = label === 'candidate' ? `export {lastRegionalRulerShift,REGIONAL_RULER} from './src/engine/ruler';` : ''
  const out = await build({ absWorkingDir: root, stdin: { contents: entry + extra, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20',
    define: { 'import.meta.env': 'undefined' }, plugins: [{ name: 'frozen-source', setup(b) {
      b.onLoad({ filter: /[\\/]src[\\/]/ }, args => {
        const p = relative(root, args.path).replaceAll('\\', '/')
        assert.ok(sources.has(p), `Unfrozen source dependency: ${p}`)
        return { contents: sources.get(p), loader: p.endsWith('.json') ? 'json' : p.endsWith('.tsx') ? 'tsx' : 'ts' }
      })
    } }] })
  const code = out.outputFiles[0].text
  console.log(JSON.stringify({ label, baselineRef: label === 'baseline' ? baselineRef : undefined, sourceSha256: manifest(sources), bundleSha256: hash(code) }))
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const mem = new Map()
Object.assign(globalThis, {
  localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } },
  fetch: () => Promise.reject(new Error('offline maintenance compatibility')),
})
const player = s => s.players[s.me.id]
const marks = s => ({ attrs: player(s).attrs, xp: player(s).xp, caps: player(s).caps, age: player(s).age,
  overall: player(s).overall, potential: player(s).potential, talents: s.me.talents,
  ap: s.me.ap, apMax: s.me.apMax, year: s.year, day: s.day, week: s.me.week, trainWeek: s.me.trainWeek })
const numericPlayer = p => ({ attrs: p.attrs, xp: p.xp, caps: p.caps, overall: p.overall, potential: p.potential })
const near = (got, want, label) => assert.ok(Math.abs(got - want) < 1e-9, `${label}: ${got} != ${want}`)
async function save(api, state) {
  api.claimAutosave(state); api.autosave(state)
  assert.equal(await api.flushAutosave(), true, 'actual autosave flush succeeds')
  assert.ok(mem.get(api.SAVE_KEYS.autosave), 'real autosave body exists')
}
async function main() {
  assert.equal(git('rev-parse', baselineRef).trim(), baselineRef)
  console.log('Capturing immutable baseline with git show and current full candidate sources…')
  const baselineSources = new Map(lines(git('ls-tree', '-r', '--name-only', baselineRef, '--', 'src')).map(p => [p, git('show', `${baselineRef}:${p}`)]))
  const candidateSources = captureCandidate(), candidateStamp = manifest(candidateSources)
  const baseline = await bundle('baseline', baselineSources)
  const candidate = await bundle('candidate', candidateSources)
  const old = baseline.createCareer({ name: '旧档兼容验收', region: 'China', role: '先锋', talents: baseline.emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 2701, year: 2026 })
  assert.ok(player(old).overall <= 80, 'natural developing-player fixture exercises +40% zone')
  // Histories use the old persisted format; only the loader may add FMVP fields.
  old.me.titles = [{ year: 2026, title: '兼容测试冠军赛', started: true }, { year: 2025, title: '未留决赛旧冠军', started: true }]
  old.me.matches = [{ fixtureId: 'compat-final', year: 2026, day: old.day, comp: old.me.titles[0].title, label: '总决赛', opp: 'OP', oppTag: 'OP', started: true, won: true, score: '3-1', maps: 4, rounds: 80, kills: 80, deaths: 40, assists: 30, firstKills: 10, clutches: 2, acs: 280, rating: 1.35, mvp: true, carried: false, nodes: [], rank: 1 }]
  const beforeAction = copy(marks(old))
  assert.equal(baseline.doAction(old, 'aim'), null)
  assert.ok(Object.values(player(old).xp).some(x => x > 0), 'baseline action really earned fractional XP')
  const beforeSave = copy(marks(old))
  await save(baseline, old)
  const oldRead = await baseline.loadAutosave(), upgraded = await candidate.loadAutosave()
  assert.ok(oldRead && upgraded)
  assert.deepEqual(marks(oldRead), beforeSave, 'baseline control itself preserves the real save')
  assert.deepEqual(marks(upgraded), beforeSave, 'candidate preserves all spent AP and player growth fields')
  assert.deepEqual(candidate.talentsOf(upgraded), baseline.talentsOf(oldRead))
  near(candidate.weekGain(upgraded), old.me.trainWeek.g, 'old cached weekly base does not get repriced')
  console.log('PASS real f80fc11 autosave -> candidate: AP/attrs/XP/caps/talents/trainWeek preserved, cached base unchanged')

  let moved = 0
  for (const [id, p] of Object.entries(oldRead.players)) {
    const expected = copy(p)
    const delta = id !== oldRead.me.id && /^V\d+$/.test(id) ? candidate.lastRegionalRulerShift(oldRead.year, id.slice(1)) : 0
    if (delta) { baseline.shiftPlayer(expected, delta); moved++ }
    assert.equal(digest(numericPlayer(upgraded.players[id])), digest(numericPlayer(expected)), `NPC ${id}: only added regional delta, not a whole ruler replay`)
  }
  assert.ok(moved > 0, 'actual old 2026 NPC cohort exercises regional calibration')
  assert.equal(upgraded.regionalRuler, candidate.REGIONAL_RULER)
  assert.deepEqual(marks(upgraded), beforeSave, 'regional migration leaves protagonist untouched')
  assert.equal(upgraded.me.titles[0].fmvp, true)
  assert.equal(upgraded.me.titles[1].fmvp, undefined, 'missing old final evidence stays unknown')
  console.log(`PASS ${moved} old NPCs receive only their added CN-source delta; protagonist untouched; old FMVP evidence recovers`)

  // An action that remains in the same saved week still consumes the old base.
  const sameOld = copy(oldRead), sameNew = copy(upgraded)
  assert.equal(baseline.doAction(sameOld, 'aim'), null)
  assert.equal(candidate.doAction(sameNew, 'aim'), null)
  assert.deepEqual(marks(sameNew), marks(sameOld), 'same-week continuation retains exact old XP/AP accounting')

  const undoOld = copy(oldRead), undoNew = copy(upgraded)
  assert.equal(baseline.undoAction(undoOld, 'aim'), null)
  assert.equal(candidate.undoAction(undoNew, 'aim'), null)
  assert.deepEqual(marks(undoNew), beforeAction, 'old action exactly undoable after loading')
  const regionalAfterUndo = digest(Object.entries(undoNew.players).filter(([id]) => id !== undoNew.me.id).map(([id, p]) => [id, numericPlayer(p)]))
  assert.equal(regionalAfterUndo, digest(Object.entries(upgraded.players).filter(([id]) => id !== upgraded.me.id).map(([id, p]) => [id, numericPlayer(p)])), 'undo cannot undo already-applied NPC migration')
  const gOld = baseline.weekGain(undoOld), gNew = candidate.weekGain(undoNew)
  near(gNew, gOld * 1.4, 'fully withdrawn first action gets new +40% base')
  console.log('PASS same-week cached continuation identical; undo restores old attributes/AP, rebooked first base is +40%')

  const next = copy(upgraded), currentWeek = next.me.week
  next.day += 7; next.me.weekDay = 7
  candidate.settleWeek(next)
  assert.equal(next.me.week, currentWeek + 1)
  assert.equal(next.me.trainWeek, undefined, 'actual settlement clears weekly cache')
  const nextControl = copy(next)
  const nextBaselineGain = baseline.weekGain(nextControl)
  near(candidate.weekGain(next), nextBaselineGain * 1.4, 'next real week uses +40% base on identical settled body')
  assert.equal(candidate.doAction(next, 'aim'), null)
  console.log('PASS real weekly settlement clears old cache; next-week new base +40%; next action succeeds')

  // First migrate + save, then verify complete persistence twice. Drop final
  // detail to prove FMVP is now a permanent record, not recalculated history.
  const persisted = copy(upgraded)
  persisted.me.matches = []
  await save(candidate, persisted)
  let previous = persisted
  for (let pass = 1; pass <= 2; pass++) {
    const loaded = await candidate.loadAutosave()
    assert.ok(loaded)
    assert.equal(hash(candidate.packState(loaded)), hash(candidate.packState(previous)), `roundtrip ${pass}: full saved state idempotent`)
    assert.equal(loaded.me.titles[0].fmvp, true)
    assert.equal(loaded.me.titles[1].fmvp, undefined)
    assert.equal(loaded.regionalRuler, candidate.REGIONAL_RULER)
    assert.deepEqual(marks(loaded), beforeSave)
    await save(candidate, loaded)
    previous = loaded
  }
  console.log('PASS repeated save/load byte-idempotent; regional delta never repeats; FMVP survives removed match detail')

  baseline.mountManagerDesk(); candidate.mountManagerDesk()
  const managerTeam = Object.values(baseline.createWorld('', 701, 2026).teams).find(t => t.tier === 1 && t.roster.length >= 5)?.id
  assert.ok(managerTeam)
  for (const seed of [701, 7212]) {
    const control = baseline.createNewGame(managerTeam, '经理兼容验收', seed, baseline.createManager('经理兼容验收', 30, 'analyst'), 2026)
    assert.ok(!control.me && control.manager)
    for (const [i, id] of control.teams[control.myTeam].roster.entries()) control.training[id] = i % 2 ? 'aim' : 'rest'
    const checked = copy(control), before = digest(control.players)
    const a = baseline.weeklyTick(control, new baseline.Rng(seed))
    const b = candidate.weeklyTick(checked, new candidate.Rng(seed))
    assert.deepEqual(b, a, 'training messages remain unchanged')
    assert.notEqual(digest(control.players), before, 'real manager/NPC tick changed player values')
    assert.equal(digest(checked.players), digest(control.players), 'all manager/NPC player fields exactly unchanged by personal-growth update')
    // New metadata on news is intentionally excluded; everything else stays
    // identical on the same input world, not two independently rerated worlds.
    const withoutNewsYear = state => { const s = copy(state); for (const n of s.news) delete n.year; return s }
    assert.equal(digest(withoutNewsYear(checked)), digest(withoutNewsYear(control)), 'world identical except permitted news year metadata')
    console.log(`PASS fixed same-input manager world + all NPC training, seed ${seed}: player stats and world unchanged`)
  }
  assert.equal(manifest(captureCandidate()), candidateStamp, 'candidate source changed during run: re-run frozen full candidate')
  console.log('PASS maintenance compatibility: frozen f80fc11 -> full candidate, all checks passed')
}
main().catch(error => {
  // Data-URL bundle stacks contain megabytes of code; never print them.
  const message = String(error?.message ?? error).replace(/data:[^\s)]+/g, '[in-memory bundle]').slice(0, 3000)
  console.error(`FAIL maintenance compatibility: ${message}`)
  process.exitCode = 1
})
