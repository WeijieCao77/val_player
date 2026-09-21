// DeepSeek V4 Pro test draft, corrected against the real action API. No conditional test skips.
import assert from 'node:assert/strict'
import { ATTR_KEYS } from '../src/engine/types'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ensureGrowthWeek, readGrowthWeek, finishGrowthWeek, growthNet } from '../src/engine/me/growthWeek'
import { doAction, undoAction, settleWeek, beginWeek } from '../src/engine/me/week'
import { sealWeek } from '../src/engine/me/undo'
import { packState, unpackState } from '../src/engine/save'
import { migratePlayerSave } from '../src/engine/me/save'
import { addXp } from '../src/engine/me/growth'

const mem = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v), removeItem: (k: string) => mem.delete(k) }, fetch: () => Promise.reject(new Error('offline test')) })
const career = () => createCareer({ name: '成长验收', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'pre', seed: 7, year: 2026 })
const s = career(), me = s.me!, p = s.players[me.id]
assert.equal(me.growthWeek?.complete, true)
assert.deepEqual(me.growthWeek?.attrs, p.attrs)
const zero = () => ATTR_KEYS.forEach(k => assert.equal(growthNet(readGrowthWeek(s)!.changes[k]), 0, k))
zero()
const initial = JSON.stringify(s)
readGrowthWeek(s)
assert.equal(JSON.stringify(s), initial, 'reader must not mutate')
assert.equal(doAction(s, 'aim'), null)
assert.ok(ATTR_KEYS.some(k => growthNet(readGrowthWeek(s)!.changes[k]) > 0), 'real action is observed')
assert.equal(undoAction(s, 'aim'), null)
zero()
assert.equal(doAction(s, 'aim'), null)
const first = readGrowthWeek(s), base = structuredClone(me.growthWeek)
sealWeek(s)
assert.equal(doAction(s, 'vod'), null)
assert.equal(undoAction(s, 'vod'), null)
assert.deepEqual(readGrowthWeek(s), first, 'seal + later undo preserves earlier growth')
assert.deepEqual(me.growthWeek, base, 'seal must not reset independent baseline')
const loaded = migratePlayerSave(unpackState(packState(s)))
assert.deepEqual(loaded.me!.growthWeek, me.growthWeek)
assert.deepEqual(readGrowthWeek(loaded), first)
assert.notEqual(undoAction(loaded, 'aim'), null, 'sealed earlier action cannot be undone')
assert.deepEqual(readGrowthWeek(loaded), first)
console.log('PASS real action/undo, seal boundary, saved baseline and pure reader')

const crossed = career(), cp = crossed.players[crossed.me!.id], cm = crossed.me!
cp.attrs.aim = 60; cp.caps!.aim = 90; cp.xp.aim = 90
delete cm.growthWeek; ensureGrowthWeek(crossed, true)
addXp(cp, 'aim', 25)
assert.equal(cp.attrs.aim, 61); assert.equal(cp.xp.aim, 15)
assert.equal(growthNet(readGrowthWeek(crossed)!.changes.aim), 0.25)
cp.attrs.aim = 90; cp.xp.aim = 90; delete cm.growthWeek; ensureGrowthWeek(crossed, true)
addXp(cp, 'aim', 1)
assert.equal(cp.xp.aim, 0)
assert.equal(growthNet(readGrowthWeek(crossed)!.changes.aim), 0, 'cap-cleared XP is not decline')
cp.attrs.aim = 89; cp.xp.aim = 90; delete cm.growthWeek; ensureGrowthWeek(crossed, true)
addXp(cp, 'aim', 25)
assert.equal(cp.attrs.aim, 90)
assert.equal(growthNet(readGrowthWeek(crossed)!.changes.aim), 0.1)
cp.attrs.aim = 85
assert.equal(readGrowthWeek(crossed)!.changes.aim.points, -4, 'real decline remains visible')
console.log('PASS real XP carry, capped clearing, capped carry and genuine decline')

const old = career(); delete old.me!.growthWeek
migratePlayerSave(old)
assert.equal(old.me!.growthWeek!.complete, false, 'legacy partial baseline is explicit')
const oldBaseline = old.me!.growthWeek
old.year++
ensureGrowthWeek(old, true)
assert.equal(old.me!.growthWeek, oldBaseline, 'calendar-year crossing alone must not reset week')
finishGrowthWeek(old)
assert.equal(old.me!.lastGrowthWeek!.complete, false, 'partial remains partial at settlement')
old.me!.week++
beginWeek(old)
assert.equal(old.me!.growthWeek!.complete, true)
assert.notEqual(old.me!.growthWeek, oldBaseline)
assert.equal(old.me!.growthWeek!.year, old.year)
const settled = career(), week = settled.me!.week
assert.equal(doAction(settled, 'aim'), null)
settleWeek(settled)
assert.equal(settled.me!.week, week + 1)
assert.equal(settled.me!.lastGrowthWeek!.week, week)
assert.ok(ATTR_KEYS.some(k => growthNet(settled.me!.lastGrowthWeek!.changes[k]) > 0))
assert.equal(settled.me!.growthWeek!.week, week + 1)
ATTR_KEYS.forEach(k => assert.equal(growthNet(readGrowthWeek(settled)!.changes[k]), 0))
assert.deepEqual(unpackState(packState(settled)).me!.lastGrowthWeek, settled.me!.lastGrowthWeek)
console.log('PASS legacy partial report, calendar crossing, actual settleWeek + retained report, new baseline')

const malformed = career()
Object.assign(malformed.me!, { lastGrowthWeek: { week: 1, changes: {} }, growthWeek: { week: malformed.me!.week, attrs: {} } })
migratePlayerSave(malformed)
assert.equal(malformed.me!.lastGrowthWeek, undefined)
assert.equal(malformed.me!.growthWeek!.complete, false)
assert.ok(readGrowthWeek(malformed))
console.log('PASS malformed imported growth metadata safely repaired')
