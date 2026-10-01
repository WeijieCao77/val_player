import type { Role } from '../types'

export type RealCareerScenarioKey = 'normal' | 'zmjjkk-2024' | 'demon1-2023' | 'boaster-2023'

export interface RealCareerScenario {
  kind: 'real'
  key: RealCareerScenarioKey
  version: 1
  profileVersion?: number
  profileEvidence?: string
  profileCutoff?: string
  /** Verified pre-takeover sample, null when no round count is known. */
  profileRounds?: number | null
  playerId: string
  startYear: number
  startDay: number
  startTeam: string
  historicalHonors: string[]
  historyNote: string
}

export interface RealScenarioCatalogEntry {
  key: Exclude<RealCareerScenarioKey, 'normal'>
  ign: string
  playerId: string
  teamId: string
  team: string
  year: number
  day: number
  birth: string
  role: Role
  description: string
  historicalHonors: string[]
  historyNote: string
}

export const REAL_SCENARIOS: RealScenarioCatalogEntry[] = [
  {
    key: 'zmjjkk-2024',
    ign: 'ZmjjKK',
    playerId: 'V3520',
    teamId: 'V21T1120',
    team: 'EDward Gaming',
    year: 2024,
    day: 0,
    birth: '2004-03-03',
    role: '决斗者',
    description: '从 2024 年元旦的 EDward Gaming 接管 ZmjjKK。',
    historicalHonors: ['2023 中国进化者系列赛第一幕、第二幕、第三幕冠军'],
    historyNote: '仅列已核查的部分接管前荣誉，不计入本局奖杯或成就奖励。',
  },
  {
    key: 'demon1-2023',
    ign: 'Demon1',
    playerId: 'V26171',
    teamId: 'V21T5248',
    team: 'Evil Geniuses',
    year: 2023,
    day: 18,
    birth: '2002-09-07',
    role: '决斗者',
    description: '2023 年 1 月 19 日加入 Evil Geniuses，从轮换名单竞争出场。',
    historicalHonors: [],
    historyNote: '接管前荣誉尚未完整收录，不计入本局奖励。',
  },
  {
    key: 'boaster-2023',
    ign: 'Boaster',
    playerId: 'V438',
    teamId: 'V21T2593',
    team: 'FNATIC',
    year: 2023,
    day: 0,
    birth: '1995-05-25',
    role: '控场',
    description: '从 2023 年元旦的 FNATIC 接管控场兼指挥 Boaster。',
    historicalHonors: ['2022 VCT EMEA 第二阶段挑战者赛冠军'],
    historyNote: '仅列已核查的部分接管前荣誉，不计入本局奖杯或成就奖励。',
  },
]
