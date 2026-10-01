import rawWorld from '../../data/world_2021.json';
import rawTimeline from '../../data/timeline.json';
import { ATTR_KEYS } from '../types';
import type { Player, Attrs, Role } from '../types';
import { recomputeOverall, refreshValue } from '../player';
import { overlayRating, overlayWorld } from '../npcRoleCalibration';
import { legacyRulerShift } from '../npcLegacyRuler';
import { rulerShift } from '../ruler';
import { clamp } from '../rng';
import type { GameState } from '../types';

/** One-time, exact-baseline adoption only. The complete raw source index matters:
 * even an unchanged raw row can receive a different shift when the peer curve changes.
 * Partial growth, custom caps/bonuses, unknown samples and ambiguous source baselines
 * are never reset. No roles, roster membership, awards, experience or main character move.
 */

interface Rating {
  a: number[];
  o: number;
  p: number;
  r: string;
  n: number;
  v: (number | null)[];
}

interface WorldRaw {
  id: string;
  attrs: Attrs;
  overall: number;
  potential: number;
  role: Role;
  roles?: Role[];
  vlr?: { rating: number | null; acs: number | null; rounds: number };
  rounds?: number;
}

const worldRaw = rawWorld as unknown as { players: WorldRaw[] };
const timelineRaw = rawTimeline as unknown as { years: Record<string, { ratings: Record<string, Rating> }> };

type Source =
  | { kind: 'world'; year: 2021; id: string; raw: WorldRaw }
  | { kind: 'timeline'; year: number; id: string; raw: Rating };

const index = new Map<string, Source[]>();
(function buildIndex() {
  for (const raw of worldRaw.players) {
    const id = raw.id.replace(/^V/, '');
    const sources = index.get(id) ?? [];
    sources.push({ kind: 'world', year: 2021, id, raw });
    index.set(id, sources);
  }
  for (const [yearStr, yearData] of Object.entries(timelineRaw.years)) {
    const year = Number(yearStr);
    for (const [id, rating] of Object.entries(yearData.ratings)) {
      const sources = index.get(id) ?? [];
      sources.push({ kind: 'timeline', year, id, raw: rating });
      index.set(id, sources);
    }
  }
})();

function baselineFor(
  p: Player,
  source: Source,
  corrected: boolean,
): { attrs: Attrs; overall: number; potential: number } {
  let raw: { a: number[]; o: number; p: number };
  let rawP: number;
  let rawRole: string;
  if (source.kind === 'world') {
    const r = corrected ? overlayWorld(source.year, source.raw) : source.raw;
    raw = { a: ATTR_KEYS.map((k) => r.attrs[k] ?? 0), o: r.overall, p: r.potential };
    rawP = r.potential;
    rawRole = r.role;
  } else {
    const r = corrected ? overlayRating(source.year, source.id, source.raw) : source.raw;
    raw = { a: r.a, o: r.o, p: r.p };
    rawP = r.p;
    rawRole = r.r.split('|')[0];
  }
  const copy: Player = { ...p, attrs: { ...p.attrs }, role: rawRole as Role, stageBonus: 0 };
  const d = corrected ? rulerShift(source.year, source.id) : legacyRulerShift(source.year, source.id);
  const attrs: Attrs = {} as Attrs;
  const baseAttrs = raw.a.map((v) => clamp(v + d, 20, 99));
  for (let i = 0; i < ATTR_KEYS.length; i++) {
    attrs[ATTR_KEYS[i] as keyof Attrs] = baseAttrs[i];
  }
  let overall: number;
  let potential: number;
  if (source.kind === 'world' && d === 0) {
    overall = raw.o;
    potential = rawP;
  } else if (source.kind === 'world') {
    copy.attrs = attrs;
    copy.role = rawRole as Role;
    copy.stageBonus = 0;
    overall = recomputeOverall(copy);
    const rawO = raw.o;
    const overallDiff = overall - rawO;
    potential = clamp(rawP + overallDiff, overall, 99);
  } else {
    copy.attrs = attrs;
    copy.role = rawRole as Role;
    copy.stageBonus = 0;
    overall = recomputeOverall(copy);
    potential = clamp(Math.min(99, rawP + d), overall, 99);
  }
  return { attrs, overall, potential };
}

export function migrateNpcRoleCalibration(state: GameState): number {
  if (!state.me) return 0;
  if ((state.ruler ?? 0) < 2) return 0;
  if ((state.regionalRuler ?? 0) < 1) return 0;
  let changed = 0;
  for (const id of Object.keys(state.players)) {
    if (id === state.me.id) continue;
    if (!/^V\d+$/.test(id)) continue;
    const p = state.players[id];
    if ((p.npcRoleCalibrationVersion ?? 0) >= 1) continue;
    // Stamp the attempted check too: later training must not accidentally match a baseline.
    p.npcRoleCalibrationVersion = 1;
    if (p.fictional) continue;
    if (p.caps) continue;
    if ((p.stageBonus ?? 0) !== 0) continue;
    const vlr = p.vlr;
    if (!vlr || !(vlr.rating === null || Number.isFinite(vlr.rating)) || !(vlr.acs === null || Number.isFinite(vlr.acs))) continue;
    if (vlr.rounds < 0 || !Number.isFinite(vlr.rounds)) continue;
    const candidates = (index.get(id.replace(/^V/, '')) ?? []).filter(
      (s) => s.year <= state.year && (s.kind === 'world' ? s.raw.role === p.role : s.raw.r.split('|')[0] === p.role),
    );
    if (candidates.length === 0) continue;
    const matches: Source[] = [];
    for (const c of candidates) {
      if (c.kind === 'world') {
        const raw = c.raw;
        const rawVlr = raw.vlr;
        if (!rawVlr || rawVlr.rating !== vlr.rating || rawVlr.acs !== vlr.acs || rawVlr.rounds !== vlr.rounds) continue;
        const base = baselineFor(p, c, false);
        if (base.overall === p.overall && base.potential === p.potential && ATTR_KEYS.every((k) => base.attrs[k as keyof Attrs] === p.attrs[k as keyof Attrs])) {
          matches.push(c);
        }
      } else {
        const raw = c.raw;
        if (raw.v[0] !== vlr.rating || raw.v[1] !== vlr.acs || raw.n !== vlr.rounds) continue;
        const base = baselineFor(p, c, false);
        if (base.overall === p.overall && base.potential === p.potential && ATTR_KEYS.every((k) => base.attrs[k as keyof Attrs] === p.attrs[k as keyof Attrs])) {
          matches.push(c);
        }
      }
    }
    if (matches.length !== 1) continue;
    const source = matches[0];
    const nb = baselineFor(p, source, true);
    const oldChanged =
      ATTR_KEYS.some((k) => nb.attrs[k as keyof Attrs] !== p.attrs[k as keyof Attrs]) ||
      nb.overall !== p.overall ||
      nb.potential !== p.potential;
    if (!oldChanged) continue;
    for (const k of ATTR_KEYS) {
      p.attrs[k as keyof Attrs] = nb.attrs[k as keyof Attrs];
    }
    p.overall = nb.overall;
    p.potential = nb.potential;
    refreshValue(p);
    changed++;
  }
  if (changed > 0) {
    for (const teamId of Object.keys(state.teams ?? {})) {
      const team = state.teams[teamId];
      if (team.dormant) continue;
      const roster = team.roster ?? [];
      const overalls: number[] = [];
      for (const playerId of roster) {
        const player = state.players[playerId];
        if (player) {
          overalls.push(player.overall);
        }
      }
      if (overalls.length > 0) {
        overalls.sort((a, b) => b - a);
        const top5 = overalls.slice(0, 5);
        const sum = top5.reduce((acc, v) => acc + v, 0);
        team.rating = Math.round(sum / top5.length);
      }
    }
  }
  return changed;
}
