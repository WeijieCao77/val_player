import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import t from '../src/data/timeline.json';
import w from '../src/data/world_2021.json';
import { legacyRulerShift } from '../src/engine/npcLegacyRuler';
import { overlayRating, overlayWorld, NPC_ROLE_CALIBRATION_ARTIFACT } from '../src/engine/npcRoleCalibration';
import { ATTR_KEYS } from '../src/engine/types';
import type { Attrs, Player, Role } from '../src/engine/types';
import { recomputeOverall } from '../src/engine/player';
import { rulerShift, shiftPlayer } from '../src/engine/ruler';
import { createCareer, emptyTalents } from '../src/engine/me/career';
import { migrateNpcRoleCalibration } from '../src/engine/me/npcRoleCalibrationMigrate';
import { migratePlayerSave } from '../src/engine/me/save';
import { ensurePlayer, syncYear } from '../src/engine/timeline';
Object.assign(globalThis, { fetch: () => Promise.reject(Error('offline NPC runtime check')), localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } });

const a: Array<[number, string, number]> = Object.entries(t.years).flatMap(([y, v]) =>
  Object.keys(v.ratings).filter(id => id !== '4710').sort().map(id => [+y, id, legacyRulerShift(+y, id)] as [number, string, number])
);
for (const p of w.players) if (p.id !== 'V4710') a.push([2021, p.id.slice(1), legacyRulerShift(2021, p.id.slice(1))]);
assert.equal(a.length, 11076);
const hash = createHash('sha256').update(JSON.stringify(a)).digest('hex');
assert.equal(hash, 'fd82ff5967d0a0bdda66bdc8c0b286b6f2b5919470492241c06f72abcb7b3771');

let yearCount = 0;
let worldCount = 0;
const beforeTimeline = JSON.stringify(t.years);
for (const [year, entries] of Object.entries(NPC_ROLE_CALIBRATION_ARTIFACT.years)) {
  yearCount++;
  for (const [id, e] of Object.entries(entries)) {
    const r = (t.years as any)[year].ratings[id];
    const result = overlayRating(+year, id, r);
    assert.deepEqual(result.a, e.after.a);
    assert.equal(result.o, e.after.o);
    assert.equal(result.p, e.after.p);
    const bad = { ...r, a: [...r.a] };
    bad.a[0]++;
    assert.deepEqual(overlayRating(+year, id, bad), bad);
    assert.deepEqual(overlayRating(+year, id, overlayRating(+year, id, r)), result);
    for (const mutate of [
      (x: any) => x.o++, (x: any) => x.p++, (x: any) => x.r += '|x', (x: any) => x.n++,
      (x: any) => { x.v[0] = (x.v[0] ?? 0) + 1; },
      (x: any) => { x.v[1] = (x.v[1] ?? 0) + 1; },
    ]) {
      const altered = { ...r, a: [...r.a], v: [...r.v] };
      mutate(altered);
      assert.deepEqual(overlayRating(+year, id, altered), altered);
    }
  }
}
assert.equal(JSON.stringify(t.years), beforeTimeline);

for (const [id, artifact] of Object.entries(NPC_ROLE_CALIBRATION_ARTIFACT.worlds['2021'])) {
  worldCount++;
  const p = w.players.find(p => p.id === 'V' + id)!;
  const beforeWorld = JSON.stringify(p);
  const result = overlayWorld(2021, p);
  assert.deepEqual(ATTR_KEYS.map(k => result.attrs[k]), artifact.after.a);
  assert.equal(result.overall, artifact.after.o);
  assert.equal(result.potential, artifact.after.p);
  assert.equal(JSON.stringify(p), beforeWorld);
  assert.deepEqual(overlayWorld(2021, result), result);
  const badWorld = { ...p, overall: p.overall + 1 };
  assert.deepEqual(overlayWorld(2021, badWorld), badWorld);
}

console.log(`checked ${yearCount} years, ${worldCount} worlds`);

// Integration section adapted from the DeepSeek candidate to actual mutating engine APIs.
const options = { name: 'audit', region: 'China' as const, role: '决斗者' as const,
  talents: emptyTalents(), originKey: 'netcafe', start: 'pre' as const, year: 2021 as const, seed: 17 };
const base = createCareer(options);
const books = t.years as Record<string, { ratings: Record<string, { a: number[]; o: number; p: number; r: string; n: number; v: (number | null)[] }> }>;
const entries = NPC_ROLE_CALIBRATION_ARTIFACT.years['2024'];
const chosen = Object.entries(entries).find(([id, e]) => {
  if (JSON.stringify(e.before) === JSON.stringify(e.after)) return false;
  const probe = { ...base, players: { ...base.players } };
  delete probe.players[`V${id}`];
  if (!ensurePlayer(probe, id, 2024, 'China')) return false;
  const matches = Object.entries(books).filter(([y, b]) => +y <= 2024 && b.ratings[id]?.n === e.n
    && JSON.stringify(b.ratings[id].v) === JSON.stringify(e.v));
  const oldWorld = w.players.find(p => p.id === `V${id}`);
  return matches.length === 1 && !(oldWorld?.vlr?.rounds === e.n && oldWorld.vlr.rating === e.v[0] && oldWorld.vlr.acs === e.v[1]);
});
assert.ok(chosen, 'need one changed, unambiguous real source');
const [id, entry] = chosen;
const raw = books['2024'].ratings[id];
const template = Object.values(base.players).find(p => p.id !== base.me!.id)!;
function makeNpc(corrected = false): Player {
  const r = corrected ? overlayRating(2024, id, raw) : raw;
  const d = corrected ? rulerShift(2024, id) : legacyRulerShift(2024, id);
  const p = structuredClone(template);
  p.id = `V${id}`; p.role = r.r.split('|')[0] as Role; p.roles = [p.role];
  p.attrs = Object.fromEntries(ATTR_KEYS.map((k, i) => [k, Math.min(99, Math.max(20, r.a[i] + d))])) as unknown as Attrs;
  p.stageBonus = 0; delete p.caps; delete p.npcRoleCalibrationVersion;
  p.vlr = { rating: r.v[0], acs: r.v[1], rounds: r.n };
  recomputeOverall(p); p.potential = Math.max(Math.min(99, r.p + d), p.overall);
  return p;
}
const expected = makeNpc(true);
const numbers = (p: Player) => ({ attrs: { ...p.attrs }, overall: p.overall, potential: p.potential });
function isolated(p: Player) {
  const s = structuredClone(base); s.year = 2024; s.myTeam = '';
  s.players = { [s.me!.id]: s.players[s.me!.id], [p.id]: p }; s.teams = {};
  return s;
}
const old = makeNpc();
const s = isolated(old);
const identity = (p: Player) => JSON.stringify({ role: p.role, roles: p.roles, vlr: p.vlr, isIgl: p.isIgl, teamId: p.teamId, season: p.season, career: p.career, titles: p.titles });
const oldIdentity = identity(old);
assert.equal(migrateNpcRoleCalibration(s), 1);
assert.deepEqual(numbers(old), numbers(expected));
assert.equal(identity(old), oldIdentity, 'calibration only changes numeric baseline and derived value, never identity, stats or honors');
assert.equal(old.npcRoleCalibrationVersion, 1);
assert.equal(migrateNpcRoleCalibration(s), 0);
assert.deepEqual(numbers(old), numbers(expected));
for (const mutate of [
  (p: Player) => { p.attrs.aim++; recomputeOverall(p); },
  (p: Player) => { p.potential++; },
  (p: Player) => { delete p.vlr; },
  (p: Player) => { p.vlr!.rounds++; },
  (p: Player) => { p.caps = { ...p.attrs }; },
  (p: Player) => { p.id = 'V999999999'; },
  (p: Player) => { p.fictional = true; },
]) {
  const p = makeNpc(); mutate(p); const before = numbers(p);
  assert.equal(migrateNpcRoleCalibration(isolated(p)), 0);
  assert.deepEqual(numbers(p), before); assert.equal(p.npcRoleCalibrationVersion, 1);
}
const skipped = makeNpc(); skipped.attrs.aim++; recomputeOverall(skipped);
const skippedState = isolated(skipped);
assert.equal(migrateNpcRoleCalibration(skippedState), 0);
Object.assign(skipped, numbers(makeNpc()));
assert.equal(migrateNpcRoleCalibration(skippedState), 0, 'an attempted migration cannot later adopt a coincidental baseline after training');
const protectedNpc = makeNpc(); const protectedState = isolated(protectedNpc);
protectedState.me!.id = protectedNpc.id;
const protectedBefore = structuredClone(protectedNpc);
assert.equal(migrateNpcRoleCalibration(protectedState), 0);
assert.deepEqual(protectedNpc, protectedBefore);

// New debut path: overlay BEFORE shifting, never a second overlay in playerFromRaw.
const debut = structuredClone(base); debut.year = 2024; delete debut.players[`V${id}`];
const debutP = ensurePlayer(debut, id, 2024, 'China');
assert.ok(debutP); assert.deepEqual(numbers(debutP), numbers(expected));
assert.equal(debutP.npcRoleCalibrationVersion, 1);

// Existing NPC annual sync, not just overlayRating in isolation.
const annual = structuredClone(base); annual.year = 2024; annual.myTeam = '';
annual.players[`V${id}`] = makeNpc(); annual.players[`V${id}`].teamId = null;
syncYear(annual, 2024);
assert.deepEqual(numbers(annual.players[`V${id}`]), numbers(expected));
assert.equal(annual.players[`V${id}`].npcRoleCalibrationVersion, 1);

// Actual save-loading chain, twice, with a grown neighbour and main-character protection.
const load = structuredClone(base); load.year = 2024; load.myTeam = '';
load.players[`V${id}`] = makeNpc();
const grown = makeNpc(); grown.id = 'V999999998'; grown.attrs.aim++; recomputeOverall(grown);
load.players[grown.id] = grown;
const meBefore = numbers(load.players[load.me!.id]); const grownBefore = numbers(grown);
migratePlayerSave(load);
assert.deepEqual(numbers(load.players[`V${id}`]), numbers(expected));
assert.deepEqual(numbers(load.players[grown.id]), grownBefore);
assert.deepEqual(numbers(load.players[load.me!.id]), meBefore);
const afterLoad = numbers(load.players[`V${id}`]);
migratePlayerSave(load); assert.deepEqual(numbers(load.players[`V${id}`]), afterLoad);
// A historical VLR id can be the protagonist without importing unrelated career scenarios.
const real = isolated(makeNpc());
real.me!.id = `V${id}`;
delete real.players[real.me!.id].npcRoleCalibrationVersion;
const realBefore = numbers(real.players[real.me!.id]);
migratePlayerSave(real); migratePlayerSave(real);
assert.deepEqual(numbers(real.players[real.me!.id]), realBefore);
assert.equal(real.players[real.me!.id].npcRoleCalibrationVersion, undefined);
console.log(`NPC runtime migration/debut/annual/load checks passed: ${id}, ${entry.before.o} -> ${entry.after.o}`);

// World 2021 migration: legacy shift vs corrected shift, using playerFromRaw-free construction.
let legacyShiftZero = 0;
let legacyShiftNonZero = 0;
for (const row of w.players) {
  const idWithoutV = row.id.slice(1);
  const legacy = {
    ...structuredClone(template),
    ...structuredClone(row),
    attrs: { ...row.attrs },
    stageBonus: 0,
  } as Player;
  delete legacy.caps;
  delete legacy.npcRoleCalibrationVersion;
  const legacyDelta = legacyRulerShift(2021, idWithoutV);
  shiftPlayer(legacy, legacyDelta);

  const correctedRaw = overlayWorld(2021, row);
  const corrected = { ...structuredClone(template), ...structuredClone(correctedRaw), attrs: { ...correctedRaw.attrs }, stageBonus: 0 } as Player;
  delete corrected.caps;
  const correctedDelta = rulerShift(2021, idWithoutV);
  shiftPlayer(corrected, correctedDelta);

  const numbers = (p: Player) => ({ attrs: { ...p.attrs }, overall: p.overall, potential: p.potential });
  if (JSON.stringify(numbers(legacy)) === JSON.stringify(numbers(corrected))) continue;

  const state = {
    ...base,
    year: 2021,
    players: {
      [base.me!.id]: structuredClone(base.players[base.me!.id]),
      [legacy.id]: legacy,
    },
    teams: {},
    myTeam: '',
  };
  const result = migrateNpcRoleCalibration(state);
  if (result === 0) continue;
  assert.deepEqual(numbers(legacy), numbers(corrected));
  if (legacyDelta === 0) legacyShiftZero++;
  else legacyShiftNonZero++;
}
assert.ok(legacyShiftZero > 0, 'should find at least one legacy shift zero case');
assert.ok(legacyShiftNonZero > 0, 'should find at least one legacy shift non-zero case');
console.log(`world 2021 migration checked: ${legacyShiftZero} shift-zero, ${legacyShiftNonZero} shift-nonzero`);

// pack/unpack round-trip preserves migrated NPC numbers via migratePlayerSave.
import { packState, unpackState } from '../src/engine/save';
const packLoad = structuredClone(base); packLoad.year = 2024; packLoad.myTeam = '';
const realGrownLoad = structuredClone(packLoad);
const realGrown = makeNpc(); realGrown.attrs.aim++; recomputeOverall(realGrown);
realGrownLoad.players[realGrown.id] = realGrown;
const realGrownBefore = numbers(realGrown);
migratePlayerSave(realGrownLoad);
assert.deepEqual(numbers(realGrownLoad.players[realGrown.id]), realGrownBefore, 'real fingerprint with simulated growth survives full migration');
packLoad.players[`V${id}`] = makeNpc();
migratePlayerSave(packLoad);
const packedOnce = packState(packLoad);
const unpackedOnce = unpackState(packedOnce);
migratePlayerSave(unpackedOnce);
assert.deepEqual(numbers(unpackedOnce.players[`V${id}`]), numbers(expected));
const packedTwice = packState(unpackedOnce);
const unpackedTwice = unpackState(packedTwice);
migratePlayerSave(unpackedTwice);
assert.deepEqual(numbers(unpackedTwice.players[`V${id}`]), numbers(expected));
assert.equal(unpackedTwice.players[`V${id}`].npcRoleCalibrationVersion, 1);

// Historical-id protagonist pack/unpack + migratePlayerSave twice preserves numbers.
const realPack = isolated(makeNpc());
realPack.me!.id = `V${id}`;
delete realPack.players[realPack.me!.id].npcRoleCalibrationVersion;
const realPackBefore = numbers(realPack.players[realPack.me!.id]);
const realPacked = packState(realPack);
const realUnpacked = unpackState(realPacked);
migratePlayerSave(realUnpacked);
migratePlayerSave(realUnpacked);
assert.deepEqual(numbers(realUnpacked.players[realUnpacked.me!.id]), realPackBefore);
assert.equal(realUnpacked.players[realUnpacked.me!.id].npcRoleCalibrationVersion, undefined);

// Ambiguous legacy source: old year with same id must project to the same 2024 baseline.
const legacyYear = Object.entries(books).find(([y, b]) => +y < 2024 && b.ratings[id]);
assert.ok(legacyYear, 'need an older year with same id for ambiguity test');
const [oldYearStr, oldBook] = legacyYear;
const legacyRaw = oldBook.ratings[id];
const savedClone = structuredClone(legacyRaw);
const shift = legacyRulerShift(+oldYearStr, id);
const currentRaw = books['2024'].ratings[id];
const ambiguousBefore = makeNpc();
try {
  Object.assign(legacyRaw, {
    a: ATTR_KEYS.map(k => ambiguousBefore.attrs[k] - shift),
    o: currentRaw.o - shift,
    p: ambiguousBefore.potential - shift,
    r: currentRaw.r,
    n: currentRaw.n,
    v: [...currentRaw.v],
  });
  const ambiguous = isolated(makeNpc());
  assert.equal(migrateNpcRoleCalibration(ambiguous), 0);
  assert.deepEqual(numbers(ambiguous.players[`V${id}`]), numbers(ambiguousBefore));
  const ambiguousLoad = structuredClone(base); ambiguousLoad.year = 2024; ambiguousLoad.myTeam = '';
  ambiguousLoad.players[`V${id}`] = makeNpc();
  migratePlayerSave(ambiguousLoad);
  assert.deepEqual(numbers(ambiguousLoad.players[`V${id}`]), numbers(ambiguousBefore), 'ambiguous source is protected through the actual save chain');
} finally {
  Object.assign(legacyRaw, savedClone);
}

assert.equal(JSON.stringify(legacyRaw), JSON.stringify(savedClone));
console.log(`pack/unpack and ambiguity checks passed: ${id}`);
