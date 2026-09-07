import { clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import { pushLog } from './log'
import { push, pop } from './pending'

/** the platform's share climbs with the following; each step is announced */
export const STREAM_CUTS: { at: number; cut: number }[] = [
  { at: 0, cut: 0.50 }, { at: 55, cut: 0.62 }, { at: 160, cut: 0.75 }, { at: 260, cut: 0.88 },
]
export const STREAM_TIERS = {
  B: { minFans: 95, sign: 8000, guarantee: 1500 },
  S: { minFans: 260, sign: 30000, guarantee: 4000 },
}
export const MIN_STREAMS_PER_STAGE = 2
export const CLAUSE_FINE = 2000
const PLATFORMS = ['虎牙', '斗鱼', 'B 站', '快手', 'Twitch']

export const clubPlatform = (team: Team | undefined): string =>
  team ? PLATFORMS[hashStr(team.id) % PLATFORMS.length] : PLATFORMS[0]

export function streamCut(fans: number): number {
  let c = STREAM_CUTS[0].cut
  for (const t of STREAM_CUTS) if (fans >= t.at) c = t.cut
  return c
}

/** One session's money: a floor from the following, gifts from following × heat. */
export function streamIncome(state: GameState): number {
  const me = state.me!
  const f = Math.min(me.fans, 600)
  const heatMul = clamp(0.45 + me.heat / 730, 0.45, 1.7)
  const gift = Math.pow(f / 40, 1.22) * 220 * streamCut(me.fans) * heatMul
  const base = 200 + f * 2.5
  const streamer = me.originKey === 'streamer' ? 1.5 : 1
  if (me.stream.deal) {
    const d = me.stream.deal
    return Math.round(Math.max(d.guarantee, (base + gift) * (1 - d.clubCut)) * streamer)
  }
  return Math.round((base + gift) * streamer)
}

/** Weekly: the share moving up, and a platform deciding I am worth a contract. */
export function streamTick(state: GameState): void {
  const me = state.me!
  const cutNow = STREAM_CUTS.findIndex((t) => t.cut === streamCut(me.fans))
  if (cutNow > me.stream.cut) {
    me.stream.cut = cutNow
    pushLog(state, 'money', `直播平台把你的礼物分成上调到 ${Math.round(STREAM_CUTS[cutNow].cut * 100)}%。`)
  }
  if (me.stream.deal || me.stream.offer) return
  if (me.stream.total < 3) return
  const tier = me.fans >= STREAM_TIERS.S.minFans ? 'S' : me.fans >= STREAM_TIERS.B.minFans ? 'B' : null
  if (!tier) return
  if ((me.flags.streamOfferYear ?? 0) === state.year) return
  const t = STREAM_TIERS[tier]
  const team = me.phase === 'pro' ? state.teams[state.myTeam] : undefined
  const club = clubPlatform(team)
  const rival = PLATFORMS.filter((p) => p !== club)[hashStr(`${state.seed}:${state.year}`) % (PLATFORMS.length - 1)]
  me.stream.offer = { id: `stream:${state.year}`, tier, platform: rival, clubPlatform: club, sign: t.sign, guarantee: t.guarantee, day: state.day, expires: state.day + 14 }
  me.flags.streamOfferYear = state.year
  push(state, { kind: 'stream', id: me.stream.offer.id })
  pushLog(state, 'money', `${rival} 的人来谈独家（${tier} 级）。${team ? `俱乐部的合作平台是 ${club}。` : ''}`)
}

/**
 * Three ways to answer: the club's partner (cheaper, friendlier), the rival
 * (richer, the manager remembers), or nobody (income floats with the heat).
 */
export function answerStreamOffer(state: GameState, choice: 'club' | 'rival' | 'none'): string {
  const me = state.me!
  const o = me.stream.offer
  if (!o) return '没有待答复的直播合同。'
  me.stream.offer = undefined
  pop(state, 'stream', o.id)
  const pro = me.phase === 'pro'
  if (choice === 'none') {
    pushLog(state, 'info', '你没有签独家：收入随粉丝和热度浮动，上限最高，下限也最低。')
    return '没签。'
  }
  const club = choice === 'club'
  const sign = Math.round(o.sign * (club ? 0.8 : 1.4))
  const guarantee = Math.round(o.guarantee * (club ? 1.0 : 1.15))
  me.stream.deal = {
    platform: club ? o.clubPlatform : o.platform, club, guarantee,
    clubCut: pro ? (club ? 0.2 : 0.4) : 0, minPerStage: MIN_STREAMS_PER_STAGE, untilYear: state.year + 2,
  }
  me.money += sign
  if (pro) me.gmTrust = clamp(me.gmTrust + (club ? 6 : -12), 0, 100)
  pushLog(state, 'money', `签了 ${me.stream.deal.platform} 的独家：签字费 $${sign.toLocaleString()}，每场保底 $${guarantee.toLocaleString()}${pro ? `，俱乐部抽 ${Math.round(me.stream.deal.clubCut * 100)}%` : ''}。每个赛段至少播 ${MIN_STREAMS_PER_STAGE} 次。`)
  return '签了。'
}

/** At a stage's end: the clause. */
export function streamClauseCheck(state: GameState): void {
  const me = state.me!
  const d = me.stream.deal
  if (d && me.phase === 'pro' && me.stream.thisStage < d.minPerStage) {
    me.money -= CLAUSE_FINE
    pushLog(state, 'bad', `这个赛段只播了 ${me.stream.thisStage} 次，不到合同要求的 ${d.minPerStage} 次，平台扣了 $${CLAUSE_FINE}。`)
  }
  me.stream.thisStage = 0
  if (d && state.year > d.untilYear) {
    me.stream.deal = undefined
    pushLog(state, 'info', '直播独家合同到期了。')
  }
}
