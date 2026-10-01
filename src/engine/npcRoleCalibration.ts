import raw from '../data/npc_role_calibration.json';
import { ATTR_KEYS } from './types';
import type { Attrs } from './types';

export const NPC_ROLE_CALIBRATION_VERSION = 1;

export interface CalibrationNumbers {
  a: number[];
  o: number;
  p: number;
}

export interface CalibrationEntry {
  before: CalibrationNumbers;
  after: CalibrationNumbers;
  r: string;
  n: number;
  v: [number | null, number | null];
}

interface CalibrationTables {
  version: number;
  worlds: Record<string, Record<string, CalibrationEntry>>;
  years: Record<string, Record<string, CalibrationEntry>>;
}

const tables = raw as unknown as CalibrationTables;

export const NPC_ROLE_CALIBRATION_ARTIFACT = tables;

function fingerprintMatches<T extends { a: number[]; o: number; p: number; r: string; n: number; v: (number | null)[] }>(
  target: T,
  entry: CalibrationEntry,
): boolean {
  if (target.a.length !== ATTR_KEYS.length || entry.before.a.length !== ATTR_KEYS.length) return false;
  for (let i = 0; i < ATTR_KEYS.length; i++) {
    if (target.a[i] !== entry.before.a[i]) return false;
  }
  return (
    target.o === entry.before.o &&
    target.p === entry.before.p &&
    target.r === entry.r &&
    target.n === entry.n &&
    target.v[0] === entry.v[0] &&
    target.v[1] === entry.v[1]
  );
}

export function overlayRating<T extends { a: number[]; o: number; p: number; r: string; n: number; v: (number | null)[] }>(
  year: number,
  id: string,
  r: T,
): T {
  const yearTable = tables.years[String(year)];
  if (!yearTable) return r;
  const entry = yearTable[id.replace(/^V/, '')];
  if (!entry) return r;
  if (!fingerprintMatches(r, entry)) return r;
  return { ...r, a: [...entry.after.a], o: entry.after.o, p: entry.after.p };
}

export function overlayWorld<
  T extends {
    id: string;
    attrs: Attrs;
    overall: number;
    potential: number;
    role: string;
    roles?: string[];
    rounds?: number;
    vlr?: { rating: number | null; acs: number | null; rounds?: number } | null;
  },
>(year: number, p: T): T {
  const worldTable = tables.worlds[String(year)];
  if (!worldTable) return p;
  const entry = worldTable[p.id.replace(/^V/, '')];
  if (!entry) return p;

  const fingerprint = {
    a: ATTR_KEYS.map((key) => p.attrs[key] ?? 0),
    o: p.overall,
    p: p.potential,
    r: (p.roles ?? [p.role]).join('|'),
    n: p.vlr?.rounds ?? p.rounds ?? 0,
    v: [p.vlr?.rating ?? null, p.vlr?.acs ?? null] as (number | null)[],
  };

  if (!fingerprintMatches(fingerprint, entry)) return p;

  const attrsClone = { ...p.attrs };
  for (let i = 0; i < ATTR_KEYS.length; i++) {
    attrsClone[ATTR_KEYS[i]] = entry.after.a[i];
  }

  return {
    ...p,
    attrs: attrsClone,
    overall: entry.after.o,
    potential: entry.after.p,
  };
}
