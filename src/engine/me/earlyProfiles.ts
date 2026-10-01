import type { Attrs, Role } from '../types';
import type { RealCareerScenarioKey } from './scenarios';

export const EARLY_PROFILE_VERSION = 1;

/** Frozen, pre-takeover evidence only. No timeline/world ratings are imported here.
 * Same-event primary-role peers (54 duelist rows / 45 controller rows), round weighted.
 * Z scores are clipped to +/-2; the game mapping is 5 points per Z with n/(n+250)
 * confidence, applied once. Role shapes and age headroom below are design priors,
 * not measured personality or promises about future results. Missing stats are neutral.
 */

export interface RawSampleMetric {
  id: number;
  endDate: string;
  rounds: number;
  kd?: number;
  adr?: number;
  kpr?: number;
  fkpr?: number;
  kast?: number;
  apr?: number;
  clp?: number;
}

export interface RawSample {
  source: string;
  knownBy: string;
  endDate?: string;
  metrics: RawSampleMetric[];
}

export const ZM_RAW_SAMPLE: RawSample = {
  source: 'https://www.vlr.gg/event/stats/1188 https://www.vlr.gg/event/stats/1494 https://www.vlr.gg/event/stats/1657',
  knownBy: '2023-08-27',
  endDate: '2023-08-27',
  metrics: [
    { id: 1188, endDate: '2023-03-06', rounds: 71, kd: 1.24, adr: 144.4, kpr: 0.87, fkpr: 0.23, kast: 72, apr: 0.15, clp: 20 },
    { id: 1494, endDate: '2023-06-25', rounds: 341, kd: 1.3, adr: 169.7, kpr: 0.96, fkpr: 0.24, kast: 73, apr: 0.17, clp: 13 },
    { id: 1657, endDate: '2023-08-27', rounds: 358, kd: 1.05, adr: 145.1, kpr: 0.8, fkpr: 0.14, kast: 65, apr: 0.18, clp: 13 },
  ],
};

export const BOASTER_RAW_SAMPLE: RawSample = {
  source: 'https://www.vlr.gg/event/stats/926 https://www.vlr.gg/event/stats/1014 https://www.vlr.gg/event/stats/1015',
  knownBy: '2022-09-18',
  endDate: '2022-09-18',
  metrics: [
    { id: 926, endDate: '2022-04-24', rounds: 85, kd: 0.54, adr: 88.1, kpr: 0.44, fkpr: 0.04, kast: 62, apr: 0.32, clp: 0 },
    { id: 1014, endDate: '2022-07-24', rounds: 234, kd: 0.96, adr: 127.4, kpr: 0.66, fkpr: 0.04, kast: 72, apr: 0.4, clp: 21 },
    { id: 1015, endDate: '2022-09-18', rounds: 319, kd: 0.88, adr: 120.4, kpr: 0.58, fkpr: 0.07, kast: 72, apr: 0.41, clp: 6 },
  ],
};

export const DEMON_RAW_SAMPLE: RawSample = {
  source: 'https://www.vlr.gg/167940/evil-geniuses-add-demon1',
  knownBy: '2023-01-19',
  metrics: [],
};

export const DEMON_EVIDENCE = {
  kd: 1.53,
  kpr: 0.95,
  rating: 1.4,
  description: 'Knight Freezeout little sample, no roundcount verified',
};

interface ReferenceStats {
  mean: number;
  sd: number;
}

interface ReferenceSet {
  kd: ReferenceStats;
  adr: ReferenceStats;
  kpr: ReferenceStats;
  fkpr: ReferenceStats;
  kast: ReferenceStats;
  apr: ReferenceStats;
  clp: ReferenceStats;
}

export const DUELIST_REFERENCE_2023: ReferenceSet = {
  kd: { mean: 1.080059, sd: 0.1409 },
  adr: { mean: 147.871793, sd: 14.552541 },
  kpr: { mean: 0.790769, sd: 0.085733 },
  fkpr: { mean: 0.177254, sd: 0.039044 },
  kast: { mean: 70.368367, sd: 4.211354 },
  apr: { mean: 0.189348, sd: 0.056559 },
  clp: { mean: 14.184911, sd: 11.211317 },
};

export const CONTROLLER_REFERENCE_2022: ReferenceSet = {
  kd: { mean: 0.975037, sd: 0.158821 },
  adr: { mean: 125.2367, sd: 14.157282 },
  kpr: { mean: 0.665684, sd: 0.086583 },
  fkpr: { mean: 0.067533, sd: 0.026286 },
  kast: { mean: 71.305901, sd: 4.43984 },
  apr: { mean: 0.323523, sd: 0.062887 },
  clp: { mean: 15.207483, sd: 7.262999 },
};

export const NEUTRAL_REFERENCE: ReferenceSet = {
  kd: { mean: 1, sd: 0.2 },
  adr: { mean: 140, sd: 20 },
  kpr: { mean: 0.7, sd: 0.1 },
  fkpr: { mean: 0.18, sd: 0.05 },
  kast: { mean: 70, sd: 5 },
  apr: { mean: 0.2, sd: 0.06 },
  clp: { mean: 14, sd: 10 },
};

interface RoleShape {
  aim: number;
  reaction: number;
  awareness: number;
  utility: number;
  clutch: number;
  teamwork: number;
  communication: number;
  igl: number;
}

export const DUELIST_SHAPE: RoleShape = {
  aim: 84,
  reaction: 84,
  awareness: 79,
  utility: 75,
  clutch: 79,
  teamwork: 77,
  communication: 77,
  igl: 65,
};

export const CONTROLLER_SHAPE: RoleShape = {
  aim: 76,
  reaction: 76,
  awareness: 83,
  utility: 84,
  clutch: 78,
  teamwork: 82,
  communication: 82,
  igl: 65,
};

export const EARLY_PROFILE_CUTOFFS: Record<Exclude<RealCareerScenarioKey, 'normal'>, string> = {
  'zmjjkk-2024': '2024-01-01',
  'boaster-2023': '2023-01-01',
  'demon1-2023': '2023-01-19',
};

export function validateRawSample(key: Exclude<RealCareerScenarioKey, 'normal'>, sample: RawSample): void {
  const cutoff = EARLY_PROFILE_CUTOFFS[key];
  if (sample.knownBy > cutoff) {
    throw new Error(`knownBy ${sample.knownBy} exceeds cutoff ${cutoff}`);
  }
  if (sample.endDate && sample.endDate >= cutoff) {
    throw new Error(`sample endDate ${sample.endDate} exceeds cutoff ${cutoff}`);
  }
  for (const m of sample.metrics) {
    if (m.endDate >= cutoff) {
      throw new Error(`sample metric endDate ${m.endDate} exceeds cutoff ${cutoff}`);
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function zScore(value: number, ref: ReferenceStats): number {
  return clamp((value - ref.mean) / ref.sd, -2, 2);
}

function confidenceFromRounds(rounds: number): number {
  return rounds / (rounds + 250);
}

function aggregateMetric(
  metrics: RawSampleMetric[],
  getter: (m: RawSampleMetric) => number | undefined,
): number | undefined {
  const present = metrics.filter((m) => getter(m) !== undefined);
  if (present.length === 0) return undefined;
  const totalRounds = present.reduce((sum, m) => sum + m.rounds, 0);
  if (totalRounds === 0) return undefined;
  return present.reduce((sum, m) => sum + (getter(m) as number) * m.rounds, 0) / totalRounds;
}

interface DerivedStats {
  aim: number;
  reaction: number;
  awareness: number;
  utility: number;
  clutch: number;
  teamwork: number;
  communication: number;
  igl: number;
}

function deriveRawZ(metric: number | undefined, ref: ReferenceStats): number {
  return metric !== undefined ? zScore(metric, ref) : 0;
}

function deriveFromMetrics(metrics: RawSampleMetric[], reference: ReferenceSet): DerivedStats {
  const kd = aggregateMetric(metrics, (m) => m.kd);
  const adr = aggregateMetric(metrics, (m) => m.adr);
  const kpr = aggregateMetric(metrics, (m) => m.kpr);
  const fkpr = aggregateMetric(metrics, (m) => m.fkpr);
  const kast = aggregateMetric(metrics, (m) => m.kast);
  const apr = aggregateMetric(metrics, (m) => m.apr);
  const clp = aggregateMetric(metrics, (m) => m.clp);

  const zKD = deriveRawZ(kd, reference.kd);
  const zADR = deriveRawZ(adr, reference.adr);
  const zKPR = deriveRawZ(kpr, reference.kpr);
  const zFKPR = deriveRawZ(fkpr, reference.fkpr);
  const zKAST = deriveRawZ(kast, reference.kast);
  const zAPR = deriveRawZ(apr, reference.apr);
  const zCLP = deriveRawZ(clp, reference.clp);

  return {
    aim: (zKD + zADR) / 2,
    reaction: (zKPR + zFKPR) / 2,
    awareness: zKAST,
    utility: zAPR,
    clutch: zCLP,
    teamwork: (zAPR + zKAST) / 2,
    communication: zKAST,
    igl: 0,
  };
}

function finalizeAttrs(
  shape: RoleShape,
  derived: DerivedStats,
  confidence: number,
  tier2Shift = 0,
): Attrs {
  const base = {
    aim: shape.aim + tier2Shift,
    reaction: shape.reaction + tier2Shift,
    awareness: shape.awareness + tier2Shift,
    utility: shape.utility + tier2Shift,
    clutch: shape.clutch + tier2Shift,
    teamwork: shape.teamwork + tier2Shift,
    communication: shape.communication + tier2Shift,
    igl: shape.igl,
  };

  return {
    aim: Math.round(clamp(base.aim + 5 * derived.aim * confidence, 40, 95)),
    reaction: Math.round(clamp(base.reaction + 5 * derived.reaction * confidence, 40, 95)),
    awareness: Math.round(clamp(base.awareness + 5 * derived.awareness * confidence, 40, 95)),
    utility: Math.round(clamp(base.utility + 5 * derived.utility * confidence, 40, 95)),
    clutch: Math.round(clamp(base.clutch + 5 * derived.clutch * confidence, 40, 95)),
    teamwork: Math.round(clamp(base.teamwork + 5 * derived.teamwork * confidence, 40, 95)),
    communication: Math.round(clamp(base.communication + 5 * derived.communication * confidence, 40, 95)),
    igl: Math.round(clamp(base.igl, 40, 95)),
  };
}

function headroomForAge(age: number): number {
  if (age <= 21) return 10;
  if (age <= 25) return 6;
  return 3;
}

export interface EarlyProfile {
  attrs: Attrs;
  /** Verified pre-takeover rounds; null means unknown, not a fabricated sample. */
  rounds: number | null;
  headroom: number;
  role: Role;
  roles: Role[];
  agents: string[];
  evidence: string;
  cutoff: string;
}

function computeRounds(metrics: RawSampleMetric[]): number {
  return metrics.reduce((s, m) => s + m.rounds, 0);
}

export function buildEarlyProfile(
  key: Exclude<RealCareerScenarioKey, 'normal'>,
  age: number,
): EarlyProfile {
  const cutoff = EARLY_PROFILE_CUTOFFS[key];
  const headroom = headroomForAge(age);

  if (key === 'zmjjkk-2024') {
    validateRawSample('zmjjkk-2024', ZM_RAW_SAMPLE);
    const metrics = ZM_RAW_SAMPLE.metrics;
    const totalRounds = computeRounds(metrics);
    const confidence = confidenceFromRounds(totalRounds);
    const derived = deriveFromMetrics(metrics, DUELIST_REFERENCE_2023);
    const attrs = finalizeAttrs(DUELIST_SHAPE, derived, confidence);
    return {
      attrs,
      headroom,
      role: '决斗者',
      rounds: totalRounds,
      // A recorded agent is not proof of a fully qualified secondary position.
      roles: ['决斗者'],
      agents: ['Jett', 'Raze', 'Chamber', 'Gekko'],
      evidence: 'ZmjjKK 决斗者 2023 VCT赛事 1188/1494/1657 共770回合，KD 1.24/1.30/1.05，KPR 0.87/0.96/0.80，映射为游戏属性估算（非未来年度评级）。',
      cutoff,
    };
  }

  if (key === 'boaster-2023') {
    validateRawSample('boaster-2023', BOASTER_RAW_SAMPLE);
    const metrics = BOASTER_RAW_SAMPLE.metrics;
    const totalRounds = computeRounds(metrics);
    const confidence = confidenceFromRounds(totalRounds);
    const derived = deriveFromMetrics(metrics, CONTROLLER_REFERENCE_2022);
    const attrs = finalizeAttrs(CONTROLLER_SHAPE, derived, confidence);
    attrs.igl = 85; // Generic established-captain prior, not a measured private trait.
    return {
      attrs,
      headroom,
      role: '控场',
      rounds: totalRounds,
      roles: ['控场'],
      agents: ['Astra', 'Omen', 'Brimstone', 'Breach', 'KAY/O'],
      evidence: 'Boaster 控场 2022 VCT赛事 926/1014/1015 共638回合，KD 0.54/0.96/0.88，KPR 0.44/0.66/0.58，映射为游戏属性估算（非未来年度评级）。',
      cutoff,
    };
  }

  validateRawSample('demon1-2023', DEMON_RAW_SAMPLE);
  const confidence = 0.25;
  // Missing fields are neutral, not a fabricated zero statline or round count.
  const derived: DerivedStats = {
    aim: zScore(DEMON_EVIDENCE.kd, NEUTRAL_REFERENCE.kd) / 2,
    reaction: zScore(DEMON_EVIDENCE.kpr, NEUTRAL_REFERENCE.kpr) / 2,
    awareness: 0, utility: 0, clutch: 0, teamwork: 0, communication: 0, igl: 0,
  };
  const attrs = finalizeAttrs(DUELIST_SHAPE, derived, confidence, -8);
  return {
    attrs,
    headroom,
    role: '决斗者',
    rounds: null,
    roles: ['决斗者'],
    agents: ['Jett'],
    evidence: 'Demon1 决斗者 Knight Freezeout 小样本，KD 1.53，KPR 0.95，无回合数验证，固定置信度0.25，映射为游戏属性估算（非未来年度评级）。',
    cutoff,
  };
}
