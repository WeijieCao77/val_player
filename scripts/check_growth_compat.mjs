/** Production 3addd0f -> working candidate compatibility. No matches/career loops.
 * node scripts/check_growth_compat.mjs [read-only-baseline-root]
 * Bundles both actual source trees in memory, then uses production autosave/load.
 */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const baselineRoot = resolve(process.argv[2] ?? resolve(root, '../review-batch'))
const production = '3addd0f0581590a6ca7bb22f8013058a94f2d56b'
const git = (at, ...args) => execFileSync('git', args, { cwd: at, encoding: 'utf8' }).trim()
const hash = text => createHash('sha256').update(text).digest('hex')
assert.equal(git(baselineRoot, 'rev-parse', 'HEAD'), production, 'Baseline must be actual production 3addd0f')
assert.equal(git(baselineRoot, 'status', '--porcelain', '--untracked-files=all', '--', 'src'), '', 'Baseline source must be clean')
const manifest = at => git(at, 'ls-files', '--', 'src').split('\n').filter(Boolean).sort().map(path => [path, hash(readFileSync(resolve(at, path)))])
const sources = [baselineRoot, root].map(at => hash(JSON.stringify(manifest(at))))
const mem = new Map()
Object.assign(globalThis, {
  localStorage: { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k), clear: () => mem.clear(), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size } },
  fetch: () => Promise.reject(new Error('offline compatibility test')),
})
const entry = `
export { createCareer, emptyTalents } from './src/engine/me/career';
export { doAction, undoAction } from './src/engine/me/week';
export { weekGain, roomMul } from './src/engine/me/growth';
export { injuryTrainMul } from './src/engine/me/injury';
export { ACTION_BY_KEY } from './src/engine/me/actions';
export { packState } from './src/engine/save';
export { autosave, flushAutosave, loadAutosave, claimAutosave, SAVE_KEYS } from './src/engine/me/save';
export { createNewGame, createWorld } from './src/engine/world';
export { createManager } from './src/engine/manager';
export { mountManagerDesk } from './src/engine/managerDesk';
export { weeklyTick } from './src/engine/training';
export { Rng } from './src/engine/rng';
`
async function bundle(at) {
  const out = await build({ absWorkingDir: at, stdin: { contents: entry, resolveDir: at, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node20', define: { 'import.meta.env': 'undefined' } })
  const code = out.outputFiles[0].text
  console.log(JSON.stringify({ root: at, head: git(at, 'rev-parse', 'HEAD'), bundleSha256: hash(code) }))
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
}
const baseline = await bundle(baselineRoot)
const candidate = await bundle(root)
const copy = x => structuredClone(x)
const player = s => s.players[s.me.id]
const marks = s => ({ attrs: player(s).attrs, xp: player(s).xp, caps: player(s).caps, age: player(s).age, overall: player(s).overall, potential: player(s).potential, ap: s.me.ap, apMax: s.me.apMax, year: s.year, day: s.day, week: s.me.week, trainWeek: s.me.trainWeek })
const near = (got, want, label) => assert.ok(Math.abs(got - want) < 1e-9, `${label}: ${got} != ${want}`)
let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.error(`FAIL ${label}: ${e.message}`) }
}
// Late origin naturally starts closer to its ceilings: no hand-edited growth/AP fixture.
const old = baseline.createCareer({ name: '生产旧档兼容', region: 'China', role: '决斗者', talents: baseline.emptyTalents(), originKey: 'late', start: 't1', seed: 701, year: 2026 })
const beforeOldAction = copy(marks(old))
assert.equal(baseline.doAction(old, 'aim'), null, 'Production action must create actual nonzero saved XP')
assert.ok(Object.values(player(old).xp).some(x => x > 0))
baseline.claimAutosave(old)
baseline.autosave(old)
assert.equal(await baseline.flushAutosave(), true)
assert.ok(mem.get(baseline.SAVE_KEYS.autosave), 'Production wrote a real autosave body')
const original = copy(marks(old))
const oldRead = await baseline.loadAutosave()
const upgraded = await candidate.loadAutosave()
assert.ok(oldRead && upgraded, 'Both actual loaders must read the production save')
// Production 3add has a separate stale-plan refund bug: its loader can refund an
// already-executed action. Record that fact; do not excuse it in the candidate.
console.log(`Production control load AP: ${original.ap} -> ${oldRead.me.ap}`)
check('real production autosave -> candidate loader preserves attributes/XP/caps/age/AP', () => {
  assert.deepEqual(marks(upgraded), original)
})
check('production action remains exactly undoable after cross-version loading', () => {
  const undoCopy = copy(upgraded)
  assert.equal(candidate.undoAction(undoCopy, 'aim'), null)
  assert.deepEqual(marks(undoCopy), beforeOldAction)
  assert.equal(undoCopy.me.plan.aim, undefined)
})

// The next real action uses each build\'s own curve, including cached weekly base.
const before = copy(marks(upgraded))
const gain = candidate.weekGain(upgraded)
const expected = {}
let changedCurve = false
for (const [attr, share] of [['aim', 0.65], ['reaction', 0.35]]) {
  const gap = player(upgraded).caps[attr] - player(upgraded).attrs[attr]
  const room = Math.max(0.25, Math.min(1.3, gap / 8))
  const oldRoom = Math.max(0.25, Math.min(1.3, gap / 10))
  near(candidate.roomMul(player(upgraded), attr), room, `${attr} new room`)
  near(baseline.roomMul(player(oldRead), attr), oldRoom, `${attr} old room`)
  changedCurve ||= room > oldRoom
  expected[attr] = gain * 0.55 * share * candidate.injuryTrainMul(upgraded, attr) * room
}
assert.ok(changedCurve, 'Natural production fixture must exercise changed part of room curve')
assert.equal(candidate.doAction(upgraded, 'aim'), null)
for (const attr of ['aim', 'reaction']) {
  const gained = (player(upgraded).attrs[attr] - before.attrs[attr]) * 100 + (player(upgraded).xp[attr] ?? 0) - (before.xp[attr] ?? 0)
  near(gained, expected[attr], `${attr} next action exact XP`)
}
assert.equal(upgraded.me.ap, before.ap - candidate.ACTION_BY_KEY.aim.cost)
assert.deepEqual(player(upgraded).caps, before.caps)
assert.equal(player(upgraded).age, before.age)
candidate.claimAutosave(upgraded)
candidate.autosave(upgraded)
assert.equal(await candidate.flushAutosave(), true)
const roundtrip = await candidate.loadAutosave()
assert.ok(roundtrip)
check('new action save/reload is full-state byte-idempotent', () => {
  assert.equal(candidate.packState(roundtrip) === candidate.packState(upgraded), true)
})
candidate.autosave(roundtrip)
assert.equal(await candidate.flushAutosave(), true)
const again = await candidate.loadAutosave()
assert.ok(again)
check('second save/reload is full-state byte-idempotent', () => {
  assert.equal(candidate.packState(again) === candidate.packState(roundtrip), true)
})
console.log('PASS next action uses ROOM_SCALE 8 with exact XP/AP accounting')

baseline.mountManagerDesk(); candidate.mountManagerDesk()
const managerTeam = Object.values(baseline.createWorld('', 701, 2026).teams).find(t => t.tier === 1 && t.roster.length >= 5)?.id
assert.ok(managerTeam, 'Manager world must supply its own valid club ID')
for (const seed of [701, 7212]) {
  const control = baseline.createNewGame(managerTeam, '经理兼容', seed, baseline.createManager('经理兼容', 30, 'analyst'), 2026)
  const next = copy(control)
  assert.ok(!control.me && control.manager, 'Real manager desk must be mounted')
  const roster = control.teams[control.myTeam].roster
  // Explicit manager plan, plus all other clubs\' normal NPC plans.
  for (const s of [control, next]) for (const [i, id] of roster.entries()) s.training[id] = i % 2 ? 'aim' : 'rest'
  const beforeWorld = baseline.packState(control)
  const a = baseline.weeklyTick(control, new baseline.Rng(seed))
  const b = candidate.weeklyTick(next, new candidate.Rng(seed))
  assert.deepEqual(b, a, 'Manager/NPC training messages stay identical')
  assert.notEqual(baseline.packState(control), beforeWorld, 'Weekly tick must actually change the fixture')
  assert.equal(candidate.packState(next), baseline.packState(control), 'Manager club and every NPC: full state byte-identical')
  console.log(`PASS manager club + all NPC weekly training, seed ${seed}: byte-identical`)
}
assert.deepEqual([baselineRoot, root].map(at => hash(JSON.stringify(manifest(at)))), sources, 'Neither source tree may change during verification')
console.log(`${failures ? 'FAIL' : 'PASS'} production growth compatibility: ${failures} failures (no source edits, no matches simulated)`)
process.exitCode = failures ? 1 : 0
