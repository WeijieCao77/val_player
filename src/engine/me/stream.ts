import { clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import { pushLog } from './log'
import { push, pop } from './pending'
import { addMoney } from './money'

/** the platform's share climbs with the following; each step is announced */
export const STREAM_CUTS: { at: number; cut: number }[] = [
  { at: 0, cut: 0.50 }, { at: 55, cut: 0.62 }, { at: 160, cut: 0.75 }, { at: 260, cut: 0.88 },
]
/** a contract's guarantee sits a little above what a free channel of that size makes (streamIncome) */
export const STREAM_TIERS = {
  B: { minFans: 95, sign: 2000, guarantee: 160 },
  S: { minFans: 260, sign: 12000, guarantee: 700 },
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

/**
 * One session's money: a little from the following itself, gifts from
 * following × heat. `mul` is what this session is worth after the week's
 * earlier ones (STREAM_WEEK_MUL).
 *
 * Until 2026-09-11 every session paid a $200 floor and the gifts rose gently,
 * so a channel of a few thousand followers made $400–750 a stream: measured on
 * the autopilot, an amateur banked about $35k a season from streams — some
 * seventeen times what the cups paid him — and a Challengers starter made more
 * from streams than from his wage. Now a channel
 * nobody watches earns pocket money and the gifts climb steeply with the
 * following, so a star's stream is still real money. A signed guarantee is a
 * guarantee: it is paid in full, whatever the week.
 */
export function streamIncome(state: GameState, mul = 1): number {
  const me = state.me!
  const f = Math.min(me.fans, 600)
  const heatMul = clamp(0.45 + me.heat / 730, 0.45, 1.7)
  const gift = Math.pow(f / 40, 1.5) * 60 * streamCut(me.fans) * heatMul
  const base = f * 0.4
  const free = (base + gift) * mul
  const streamer = me.originKey === 'streamer' ? 1.5 : 1
  if (me.stream.deal) {
    const d = me.stream.deal
    return Math.round(Math.max(d.guarantee, free * (1 - d.clubCut)) * streamer)
  }
  return Math.round(free * streamer)
}

/** the same people watch every stream in a week: the second is worth less than the first */
export const STREAM_WEEK_MUL = [1, 0.75, 0.5, 0.3]
export const streamWeekMul = (i: number): number => STREAM_WEEK_MUL[Math.min(i, STREAM_WEEK_MUL.length - 1)]

/** A week of `n` streams. */
export function streamWeek(state: GameState, n: number): number {
  let sum = 0
  for (let i = 0; i < n; i++) sum += streamIncome(state, streamWeekMul(i))
  return sum
}

/** 做内容: paid by the following, which stops adding views past a point. It used to pay $80 a video to a channel of nobody. */
export const contentGross = (state: GameState, n: number): number => Math.round(Math.min(state.me!.fans, 1200) * n)

/**
 * The platform settles side income against the job. In one week, stream and
 * content money past the larger of a floor and a share of the week's wage pays
 * only MEDIA_OVER of itself — side income is real income, but it does not
 * outgrow the salary, the way 破晓's split cap keeps it. A player without a
 * wage is settled against the floor.
 *
 * Measured before (2026-09-11): a player who streamed twice a week took
 * $400k a season from streams whether his wage was $29k or $132k, and sat on
 * $3–4M by his eighth season. The target is side income worth about one and a
 * half Challengers wages, or two thirds of a VCT one, for the same habit.
 */
export const MEDIA_FLOOR = 500
export const MEDIA_WAGE_SHARE = 0.6
export const MEDIA_OVER = 0.1

export function mediaCapWeek(state: GameState): number {
  const me = state.me!
  const wage = me.phase === 'pro' ? (state.players[me.id]?.salary ?? 0) / 52 : 0
  return Math.max(MEDIA_FLOOR, wage * MEDIA_WAGE_SHARE)
}

/** What `gross` of side income actually pays, with `before` already earned this week. */
export function mediaAfterCap(state: GameState, before: number, gross: number): number {
  const room = Math.max(0, mediaCapWeek(state) - before)
  const under = Math.min(gross, room)
  return Math.round(under + (gross - under) * MEDIA_OVER)
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
  // remembered after the deal ends: 「签了独家」 asked for it and nothing ever wrote it
  me.flags.hadStreamDeal = 1
  me.stream.deal = {
    platform: club ? o.clubPlatform : o.platform, club, guarantee,
    clubCut: pro ? (club ? 0.2 : 0.4) : 0, minPerStage: MIN_STREAMS_PER_STAGE, untilYear: state.year + 2,
  }
  addMoney(state, 'sign', sign)
  if (pro) me.gmTrust = clamp(me.gmTrust + (club ? 6 : -12), 0, 100)
  pushLog(state, 'money', `签了 ${me.stream.deal.platform} 的独家：签字费 $${sign.toLocaleString()}，每场保底 $${guarantee.toLocaleString()}${pro ? `，俱乐部抽 ${Math.round(me.stream.deal.clubCut * 100)}%` : ''}。每个赛段至少播 ${MIN_STREAMS_PER_STAGE} 次。`)
  return '签了。'
}

/** At a stage's end: the clause. */
export function streamClauseCheck(state: GameState): void {
  const me = state.me!
  const d = me.stream.deal
  if (d && me.phase === 'pro' && me.stream.thisStage < d.minPerStage) {
    addMoney(state, 'fine', -CLAUSE_FINE)
    pushLog(state, 'bad', `这个赛段只播了 ${me.stream.thisStage} 次，不到合同要求的 ${d.minPerStage} 次，平台扣了 $${CLAUSE_FINE}。`)
  }
  me.stream.thisStage = 0
  if (d && state.year > d.untilYear) {
    me.stream.deal = undefined
    pushLog(state, 'info', '直播独家合同到期了。')
  }
}
