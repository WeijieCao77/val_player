import assert from 'node:assert/strict';
import {
  buildEarlyProfile,
  validateRawSample,
  ZM_RAW_SAMPLE,
  BOASTER_RAW_SAMPLE,
  DEMON_RAW_SAMPLE,
  EARLY_PROFILE_VERSION,
} from '../src/engine/me/earlyProfiles';
import { REAL_SCENARIOS } from '../src/engine/me/scenarios';
import { createCareer, emptyTalents } from '../src/engine/me/career';
import { autoWeek } from '../src/engine/me/auto';
import { packState, unpackState } from '../src/engine/save';
import { migratePlayerSave } from '../src/engine/me/save';
import type { GameState } from '../src/engine/types';

function sumRounds(metrics: { rounds: number }[]): number {
  return metrics.reduce((s, m) => s + m.rounds, 0);
}

assert.equal(sumRounds(ZM_RAW_SAMPLE.metrics), 770);
assert.equal(sumRounds(BOASTER_RAW_SAMPLE.metrics), 638);

assert.throws(() => validateRawSample('zmjjkk-2024', {
  ...ZM_RAW_SAMPLE,
  knownBy: '2024-01-02',
}));
assert.throws(() => validateRawSample('zmjjkk-2024', {
  ...ZM_RAW_SAMPLE,
  endDate: '2024-01-01',
}));
assert.throws(() => validateRawSample('zmjjkk-2024', {
  ...ZM_RAW_SAMPLE,
  metrics: ZM_RAW_SAMPLE.metrics.map((m) => ({ ...m, endDate: '2024-01-01' })),
}));

assert.equal(BOASTER_RAW_SAMPLE.metrics[1].apr, 0.4);
assert.equal(BOASTER_RAW_SAMPLE.metrics[1].rounds, 234);

const profile1 = buildEarlyProfile('zmjjkk-2024', 19);
const profile2 = buildEarlyProfile('zmjjkk-2024', 19);
assert.deepEqual(profile1, profile2);

const demonProfile = buildEarlyProfile('demon1-2023', 20);
assert.equal(demonProfile.attrs.aim, 77);
assert.equal(demonProfile.attrs.reaction, 77);
assert.equal(demonProfile.attrs.awareness, 71);
assert.equal(demonProfile.attrs.utility, 67);
assert.equal(demonProfile.headroom, 10);
assert.equal(buildEarlyProfile('zmjjkk-2024', 21).headroom, 10);
assert.equal(buildEarlyProfile('zmjjkk-2024', 22).headroom, 6);
assert.equal(buildEarlyProfile('boaster-2023', 30).headroom, 3);
assert.equal(EARLY_PROFILE_VERSION, 1);
validateRawSample('demon1-2023', DEMON_RAW_SAMPLE);

interface RealScenarioCheck {
  key: 'zmjjkk-2024' | 'demon1-2023' | 'boaster-2023';
  seed: 7 | 11;
}

const CHECKS: RealScenarioCheck[] = [
  { key: 'zmjjkk-2024', seed: 7 },
  { key: 'demon1-2023', seed: 11 },
  { key: 'boaster-2023', seed: 7 },
  { key: 'zmjjkk-2024', seed: 11 },
  { key: 'demon1-2023', seed: 7 },
  { key: 'boaster-2023', seed: 11 },
];

function countRosterOccurrences(state: GameState, meId: string): number {
  let count = 0;
  for (const team of Object.values(state.teams)) {
    count += team.roster.filter(id => id === meId).length;
  }
  return count;
}

function assertFiniteAttrs(state: GameState, meId: string): void {
  const p = state.players[meId];
  assert.ok(p, '球员不存在');
  for (const [k, v] of Object.entries(p.attrs)) {
    assert.ok(Number.isFinite(v), `属性 ${k} 不是有限数字`);
    assert.ok(v >= 40 && v <= 99, `属性 ${k} 超出 40..99: ${v}`);
  }
}

function runCheck(check: RealScenarioCheck): void {
  const catalog = REAL_SCENARIOS.find((s) => s.key === check.key);
  assert.ok(catalog, `找不到场景 ${check.key}`);

  let state: GameState = createCareer({
    scenario: check.key,
    name: 'test',
    region: 'China',
    role: '决斗者',
    talents: emptyTalents(),
    originKey: 'netcafe',
    start: 'pre',
    year: 2026,
    seed: check.seed,
  });
  assert.ok(state.me);
  const p = state.players[state.me.id];
  const initialAge = p.age;
  const initialMeId = state.me.id;
  const expected = buildEarlyProfile(check.key, initialAge);
  let firstStartWeek: number | null = null;
  const startsSeen = new Set<string>();

  assert.equal(p.id, catalog.playerId);
  assert.ok(!state.players.ME);
  assert.deepEqual(p.attrs, expected.attrs);
  assert.deepEqual(p.roles, [expected.role]);
  assert.deepEqual(p.rolePro, { [expected.role]: 100 });
  assert.equal(p.stageBonus, 0);
  assert.equal(p.vlr, undefined);
  assert.equal(state.me.scenario?.profileVersion, 1);

  for (let week = 0; week < 60; week += 1) {
    assert.equal(state.me!.id, initialMeId);
    assertFiniteAttrs(state, initialMeId);
    assert.equal(countRosterOccurrences(state, initialMeId), state.players[initialMeId]?.teamId ? 1 : 0);

    const stop = autoWeek(state);
    for (const match of state.me!.matches) {
      if (!match.started) continue;
      startsSeen.add(`${match.year}:${match.fixtureId}`);
      firstStartWeek ??= week + 1;
    }

    assert.equal(state.me!.id, initialMeId);
    assertFiniteAttrs(state, initialMeId);
    assert.equal(countRosterOccurrences(state, initialMeId), state.players[initialMeId]?.teamId ? 1 : 0);

    if (week === 15 || week === 40) {
      const packed = packState(state);
      const restored = unpackState(packed);
      assert.ok(restored);
      migratePlayerSave(restored);
      assert.ok(state.me);
      assert.equal(state.me.id, initialMeId);
      assert.equal(restored.players[initialMeId]?.teamId, state.players[initialMeId]?.teamId);
      assert.deepEqual(restored.players[initialMeId]?.attrs, state.players[initialMeId]?.attrs);
      assert.equal(restored.me?.scenario?.profileVersion, EARLY_PROFILE_VERSION);
      state = restored;
    }

    assert.notEqual(stop?.kind, 'game-over');
  }

  assert.ok(state.me);
  assert.ok(state.year >= catalog.year + 1, `年份 ${state.year} 应至少 ${catalog.year + 1}`);
  assert.equal(state.players[initialMeId]?.age, initialAge + 1);
  assert.ok(startsSeen.size > 0, '60 周内应获得正式比赛首发机会');
  console.log(JSON.stringify({
    scenario: check.key,
    seed: check.seed,
    firstStartWeek,
    startsSeen: startsSeen.size,
    year: state.year,
    day: state.day,
    overall: state.players[initialMeId]?.overall,
  }));
}

for (const check of CHECKS) {
  runCheck(check);
}

console.log('全部真实开档早期档参数自检通过');
