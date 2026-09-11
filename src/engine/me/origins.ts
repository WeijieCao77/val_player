import type { Attrs } from '../types'

/**
 * Where I come from. Twelve cards, deliberately unequal in total — the
 * difference is the shape: 破晓's rule of thumb is $6k ≈ 1 point, 10 fans ≈
 * 1 point, an attribute point is a point.
 */
export interface Origin {
  key: string
  name: string
  blurb: string
  /** a background that belongs to a club: only for a career that starts at one (新生涯页 greys it out for 天梯开局) */
  needsClub?: boolean
  attrs?: Partial<Record<keyof Attrs, number>>
  money?: number
  fans?: number
  mental?: number
  body?: number
  /** weekly outgoing, forever */
  upkeep?: number
  /** training multiplier */
  trainMul?: number
  ladder?: number
  tac?: number
  /** starts with a foot in the door */
  scoutSeen?: number
  flags?: Record<string, number>
}

export const ORIGINS: Origin[] = [
  { key: 'netcafe', name: '网吧长大的', blurb: '从小在网吧里打，枪硬，身体一般。', attrs: { aim: 5, reaction: 3 }, body: -6, money: 1500 },
  { key: 'cs', name: 'CS 转型', blurb: '打了几年 CS 二线，枪法和意识都在，道具要从头学。', attrs: { aim: 4, awareness: 3, utility: -5 }, tac: 8, money: 4000 },
  { key: 'streamer', name: '小主播', blurb: '直播间已经有一批固定观众，比赛打得少。', fans: 90, attrs: { teamwork: -3 }, money: 6000, flags: { streamer: 1 } },
  { key: 'radiant', name: '国服榜一路人王', blurb: '天梯上的名字，队伍里的新人。', attrs: { aim: 6, reaction: 2, teamwork: -4, communication: -3 }, ladder: 28, fans: 40 },
  { key: 'rich', name: '富裕家庭', blurb: '家里全力支持，也没什么人当回事。', money: 40000, fans: -10, mental: -4 },
  { key: 'academy', name: '青训营出身', blurb: '在这家俱乐部的青训营待过一年，被教练提了上来。', needsClub: true, attrs: { utility: 3, teamwork: 3, communication: 2 }, tac: 14, scoutSeen: 3, money: 1000 },
  { key: 'campus', name: '高校战队', blurb: '校队打了两年联赛，指挥过。', attrs: { communication: 3, igl: 5, aim: -2 }, tac: 10, money: 2000 },
  { key: 'town', name: '小镇做题家', blurb: '家里不宽裕，寄钱回家是每周的事；但坐得住。', mental: 6, trainMul: 1.12, upkeep: 120, money: 500 },
  // the key is what saves hold: until 2026-09-11 this card was 「韩服天梯」, a League of Legends story rather than a VALORANT one
  { key: 'korea', name: '留学生', blurb: '在国外读书时一直在当地服务器打排位，英语语音交流没问题。', attrs: { awareness: 3, reaction: 2 }, ladder: 12, flags: { lang: 1 }, money: 2500 },
  { key: 'late', name: '大龄新人', blurb: '20 岁才决定试一次，上限低一点，但心态稳。', mental: 10, body: 4, attrs: { clutch: 3 }, flags: { late: 1 }, money: 5000 },
  { key: 'exchild', name: '退役选手之子', blurb: '父亲打过职业，圈里人都认识，也都盯着看。', scoutSeen: 5, fans: 30, mental: -3, attrs: { igl: 2 }, money: 8000 },
  { key: 'grinder', name: '死练型', blurb: '天赋一般，但每天十二小时。', attrs: { aim: -2, awareness: -2 }, trainMul: 1.2, body: 8, money: 1500 },
]

/**
 * Two more, opened by the 成就殿堂 — me/hall.ts HALL_ORIGIN_NEEDS says by what.
 * Sized like the twelve: a different shape, not a bigger total.
 */
export const HALL_ORIGINS: Origin[] = [
  { key: 'vodkid', name: '看录像长大的', blurb: '冠军赛决赛的录像看了几百遍，每一轮技能怎么交都背得出来。', attrs: { awareness: 3, utility: 2 }, mental: 3, money: 1500 },
  { key: 'notebook', name: '老将的笔记本', blurb: '一位退役老将把十年的对位笔记留给了你。字很乱，内容很硬。', attrs: { clutch: 2, communication: 2 }, tac: 10, body: -3, money: 1000 },
]

export const originOf = (key: string): Origin => ORIGINS.find((o) => o.key === key) ?? HALL_ORIGINS.find((o) => o.key === key) ?? ORIGINS[0]
