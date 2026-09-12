import { Rng, clamp, hashStr } from '../rng'
import { mayStillDraw } from '../circuit'
import type { GameState } from '../types'
import { pushLog } from './log'
import { addMoney } from './money'
import { addHeat, fansCn } from './fans'
import type { MeState } from './types'

/**
 * 钱的出口，第二批. Reported 2026-09-12: 「能用钱的地方太少了，导致后来钱都花不完
 * 也没啥作用」. Measured before this: an autopilot career spent about a hundredth
 * of what it earned and a VCT one sat on a million by its eighth season; the
 * shop and the three one-off LIFESTYLE items (me/shop.ts) were bought out
 * inside a season.
 *
 * What 破晓 does with the same problem: 团队投入 refreshes every split and the
 * off-season has a camp and a fan meetup, once a year each. Its camp is the
 * rule taken here — the author's ruling on it was that the camps and their
 * prices must not move the game's difficulty or balance, so it trains nothing
 * and moves no ceiling. 团队投入 is not taken: its tutor, physio and team
 * building sell training speed, recovery and trust, which is strength.
 *
 * So everything below refreshes (weekly, or once a year) or is a standing
 * asset, is priced off the wage or gated by the following so it grows with the
 * career, and pays only in things that are not the match: money, heat and
 * fans, lines in the diary, the retirement recap and the ending. Nothing here
 * touches the eight, a ceiling, form, fatigue, 心态, tilt, a bond (bonds reach
 * the match through squadHarmony), a coach's or manager's trust, or a match.
 */

export type MeetKey = 'small' | 'mid' | 'big'
export type BreakKey = 'home' | 'trip' | 'family'

export interface CafeBook {
  /** the year the one open now (or the last one) opened */
  opened: number
  open: boolean
  /** how many have been opened */
  times: number
  /** dividends over all of them */
  paid: number
  closed?: number
}

export interface OutletBook {
  /** 往家里寄钱: an index into FAMILY_TIERS */
  family: number
  familySent: number
  meets: { year: number; key: MeetKey; ok: boolean }[]
  /** the years a scholarship was paid */
  scholar: number[]
  breaks: { year: number; key: BreakKey }[]
  /** 直播间: an index into STUDIO */
  studio: number
  cafe?: CafeBook
}

const emptyBook = (): OutletBook => ({ family: 0, familySent: 0, meets: [], scholar: [], breaks: [], studio: 0 })

/** For reading: a save from before this reads as nothing done. Never written to. */
export const readOut = (me: MeState | undefined): OutletBook => me?.out ?? emptyBook()

/** For writing: made the first time anything is done. */
function book(state: GameState): OutletBook {
  const me = state.me!
  me.out ??= emptyBook()
  return me.out
}

const wage = (state: GameState): number =>
  (state.me?.phase === 'pro' ? state.players[state.me.id]?.salary ?? 0 : 0)
const round1k = (n: number): number => Math.round(n / 1000) * 1000
const usd = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`
const big = (n: number): string => (n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${Math.round(n / 1000)}K`)
const short = (me: MeState, price: number): string | null => (me.money < price ? `还差 ${usd(price - me.money)}` : null)

/* ------------------------------------------------------------------ */
/*  往家里寄钱 — weekly, a share of the wage                             */
/* ------------------------------------------------------------------ */

export interface FamilyTier { tier: number; name: string; share: number; floor: number }
export const FAMILY_TIERS: FamilyTier[] = [
  { tier: 0, name: '不寄', share: 0, floor: 0 },
  { tier: 1, name: '按月打点钱', share: 0.06, floor: 60 },
  { tier: 2, name: '让家里宽裕些', share: 0.15, floor: 150 },
]

/** What a week of this tier sends home, on the wage I am on now. */
export function familyWeekly(state: GameState, tier = readOut(state.me).family): number {
  const t = FAMILY_TIERS[tier]
  if (!t?.share) return 0
  return Math.max(t.floor, Math.round((wage(state) / 52) * t.share))
}

export function familyLocked(state: GameState, tier: number): string | null {
  const me = state.me!
  if (readOut(me).family === tier) return '现在就是这一档'
  if (tier > 0 && me.phase !== 'pro') return '有了职业合同再说'
  return null
}

export function setFamily(state: GameState, tier: number): string | null {
  const t = FAMILY_TIERS[tier]
  if (!t) return '没有这一档。'
  const why = familyLocked(state, tier)
  if (why) return `${why}。`
  book(state).family = tier
  pushLog(state, 'money', tier ? `以后每周往家里寄 ${usd(familyWeekly(state, tier))}（${t.name}，工资的 ${Math.round(t.share * 100)}%）。` : '不再每周往家里寄钱了。')
  return null
}

/** With the weekly pay slip: sent while there is a wage and the money on hand to send it. Never a debt. */
export function outletWeek(state: GameState): void {
  const me = state.me!
  const o = me.out
  if (!o?.family || me.phase !== 'pro') return
  const n = familyWeekly(state, o.family)
  if (!n || me.money < n) return
  addMoney(state, 'family', -n)
  o.familySent += n
}

/* ------------------------------------------------------------------ */
/*  一年一次：见面会、奖学金、休赛期                                        */
/* ------------------------------------------------------------------ */

export interface Meet { key: MeetKey; name: string; blurb: string; price: number; minFans: number; heat: number; fans: number }
export const MEETS: Meet[] = [
  { key: 'small', name: '网咖包场', blurb: '签名、合影，和粉丝打几把自定义。', price: 2500, minFans: 120, heat: 12, fans: 6 },
  { key: 'mid', name: '小剧场', blurb: '放一段你的比赛集锦，台上答粉丝的提问。', price: 12000, minFans: 900, heat: 30, fans: 15 },
  { key: 'big', name: '粉丝节', blurb: '场馆、舞台、安保、周边，账单都寄给你。', price: 40000, minFans: 2000, heat: 60, fans: 30 },
]
/** fatigue at or over this (体力 30 or under) and half the time it shows on stage */
export const MEET_TIRED = 70

export function meetLocked(state: GameState, m: Meet): string | null {
  const me = state.me!
  if (me.phase === 'retired') return '已经退役了'
  if (readOut(me).meets.some((x) => x.year === state.year)) return '今年办过了'
  if (me.fans < m.minFans) return `粉丝要过 ${fansCn(m.minFans)}`
  return short(me, m.price)
}

export function holdMeet(state: GameState, key: MeetKey): string | null {
  const m = MEETS.find((x) => x.key === key)
  if (!m) return '没有这一档。'
  const why = meetLocked(state, m)
  if (why) return `${why}。`
  const me = state.me!
  addMoney(state, 'public', -m.price)
  const tired = (state.players[me.id]?.fatigue ?? 0) >= MEET_TIRED
  const flop = tired && new Rng(hashStr(`meet:${state.seed}:${state.year}:${key}`)).chance(0.5)
  book(state).meets.push({ year: state.year, key, ok: !flop })
  if (flop) {
    addHeat(state, -12)
    pushLog(state, 'bad', `自己掏钱办的见面会（${m.name}，${usd(m.price)}）办砸了：你在台上困得睁不开眼，被剪成视频传了一圈。`)
  } else {
    me.heat += m.heat
    me.fans += m.fans
    pushLog(state, 'money', `自己掏钱办了一场见面会（${m.name}，${usd(m.price)}）：${m.blurb}`)
  }
  return null
}

/** a year's training camp and travel for a few kids whose families cannot pay: a share of the wage */
export const scholarPrice = (state: GameState): number => clamp(round1k(wage(state) * 0.08), 5000, 40000)

export function scholarLocked(state: GameState): string | null {
  const me = state.me!
  if (me.phase !== 'pro') return '有了职业合同再说'
  if (readOut(me).scholar.includes(state.year)) return '今年资助过了'
  return short(me, scholarPrice(state))
}

export function fundScholar(state: GameState): string | null {
  const why = scholarLocked(state)
  if (why) return `${why}。`
  const price = scholarPrice(state)
  addMoney(state, 'public', -price)
  book(state).scholar.push(state.year)
  pushLog(state, 'money', `出了今年的青训奖学金（${usd(price)}）：几个打得好、家里供不起的孩子，训练营和路费有着落了。`)
  return null
}

export interface Break { key: BreakKey; name: string; blurb: string; share: number; floor: number; cap: number; heat: number; fans: number }
export const BREAKS: Break[] = [
  { key: 'home', name: '回家住三周', blurb: '手机静音，天天吃家里的饭。', share: 0, floor: 0, cap: 0, heat: 2, fans: 0 },
  { key: 'trip', name: '出国走走', blurb: '去一个没人认得你的地方，照片发出来，评论区很热闹。', share: 0.05, floor: 3000, cap: 25000, heat: 10, fans: 4 },
  { key: 'family', name: '带爸妈出去玩', blurb: '他们第一次坐这么久的飞机，一路上拍个不停。', share: 0.1, floor: 6000, cap: 50000, heat: 4, fans: 0 },
]
export const breakPrice = (state: GameState, b: Break): number =>
  (b.share ? clamp(round1k(wage(state) * b.share), b.floor, b.cap) : 0)

/**
 * What still keeps my club this season, if anything: a match of its own to
 * play or an event with it in the field (`playing`), or an event not yet drawn
 * that could still take it (`maybe`) — the November open qualifier it can enter,
 * a Champions place its placings might still earn (engine/circuit.ts
 * mayStillDraw). Null once no event of the season can take it. The break used
 * to wait for the Champions stage, and 2021's Champions opens on day 304: a club
 * that did not qualify sat out months before its players could go home; and an
 * off-season that opened it outright let a Challengers club go home and then
 * play November's qualifier. Read once a day.
 */
const SEASON = new WeakMap<GameState, { key: string; left: 'playing' | 'maybe' | null }>()
function seasonLeft(state: GameState): 'playing' | 'maybe' | null {
  const club = state.myTeam
  if (!club || !state.teams[club]) return 'playing'
  const comps = Object.values(state.comps)
  const key = `${state.year}:${state.day}:${club}:${comps.length}:${comps.filter((c) => c.champion || c.circuit?.done).length}`
  const hit = SEASON.get(state)
  if (hit?.key === key) return hit.left
  let left: 'playing' | 'maybe' | null = null
  if (state.fixtures.some((f) => !f.played && f.comp !== 'scrim' && (f.teamA === club || f.teamB === club))) left = 'playing'
  else {
    for (const c of comps) {
      if (c.champion || c.finished.length || c.circuit?.done) continue
      if (c.teams.includes(club) || !!c.circuit?.seeds.includes(club) || Object.values(c.circuit?.fill ?? {}).includes(club)) { left = 'playing'; break }
      if (!left && mayStillDraw(state, c, club)) left = 'maybe'
    }
  }
  SEASON.set(state, { key, left })
  return left
}

export function breakLocked(state: GameState, b: Break): string | null {
  const me = state.me!
  if (me.phase !== 'pro') return '有了职业合同再说'
  if (readOut(me).breaks.some((x) => x.year === state.year)) return '今年的假已经放过了'
  const left = seasonLeft(state)
  if (left === 'playing') return '队里这个赛季还有比赛'
  if (left === 'maybe') return '这个赛季还可能打进比赛，等抽签定下来'
  return short(me, breakPrice(state, b))
}

export function takeBreak(state: GameState, key: BreakKey): string | null {
  const b = BREAKS.find((x) => x.key === key)
  if (!b) return '没有这一项。'
  const why = breakLocked(state, b)
  if (why) return `${why}。`
  const me = state.me!
  const price = breakPrice(state, b)
  if (price) addMoney(state, key === 'family' ? 'family' : 'relax', -price)
  book(state).breaks.push({ year: state.year, key })
  me.heat += b.heat
  me.fans += b.fans
  pushLog(state, 'money', `休赛期：${b.name}${price ? `（${usd(price)}）` : ''}。${b.blurb}`)
  return null
}

/* ------------------------------------------------------------------ */
/*  置办：直播间、网咖                                                     */
/* ------------------------------------------------------------------ */

export interface StudioTier { tier: number; name: string; price: number; capMul: number }
/** kit streamers really buy; what it does is raise the weekly settlement cap of me/stream.ts, nothing else */
export const STUDIO: StudioTier[] = [
  { tier: 0, name: '卧室里一个摄像头', price: 0, capMul: 1 },
  { tier: 1, name: 'Elgato Wave:3 和补光灯', price: 4000, capMul: 1.15 },
  { tier: 2, name: '独立直播间（Shure SM7B）', price: 20000, capMul: 1.3 },
]
export const studioCapMul = (me: MeState | undefined): number => STUDIO[readOut(me).studio]?.capMul ?? 1

export function studioLocked(state: GameState): string | null {
  const me = state.me!
  const cur = readOut(me).studio
  if (cur >= STUDIO.length - 1) return '已经是最好的了'
  if (me.phase === 'retired') return '已经退役了'
  return short(me, STUDIO[cur + 1].price)
}

export function buyStudio(state: GameState): string | null {
  const why = studioLocked(state)
  if (why) return `${why}。`
  const o = book(state)
  const next = STUDIO[o.studio + 1]
  addMoney(state, 'asset', -next.price)
  o.studio = next.tier
  pushLog(state, 'money', `直播间换成了${next.name}（${usd(next.price)}）：平台按工资结算的直播额度 +${Math.round((next.capMul - 1) * 100)}%。`)
  return null
}

export const CAFE_PRICE = 60000
/** a year's odds, rolled at the winter: it closes, it loses and asks for money, or it pays */
export const CAFE_CLOSE = 0.1
export const CAFE_LOSS = 0.2
export const CAFE_TOPUP = 3000
/** a paying year returns this share of the stake, drawn evenly */
export const CAFE_YIELD: [number, number] = [0.03, 0.12]

export function cafeLocked(state: GameState): string | null {
  const me = state.me!
  if (me.phase !== 'pro') return '有了职业合同再说'
  if (readOut(me).cafe?.open) return '已经开着一家了'
  return short(me, CAFE_PRICE)
}

export function openCafe(state: GameState): string | null {
  const why = cafeLocked(state)
  if (why) return `${why}。`
  addMoney(state, 'asset', -CAFE_PRICE)
  const o = book(state)
  o.cafe = { opened: state.year, open: true, times: (o.cafe?.times ?? 0) + 1, paid: o.cafe?.paid ?? 0 }
  pushLog(state, 'money', `和朋友合伙在老家开了一家网咖（${usd(CAFE_PRICE)}）。每年年底结一次账。`)
  return null
}

/* ------------------------------------------------------------------ */
/*  the winter, the autopilot, and what is said at the end             */
/* ------------------------------------------------------------------ */

const FAMILY_NOTES = [
  '妈在电话里说家里都好，让你别老往家里寄钱，自己留着。',
  '爸把你比赛的截图设成了手机壁纸，逢人就给看。',
  '家里把老房子的窗户换了，视频里特意拍给你看。',
]
const SCHOLAR_NOTES = [
  '奖学金的孩子们发来一段训练营的视频，有个小孩拉枪的样子很像你刚出道的时候。',
  '第一批拿奖学金的孩子里，有一个打进了高校联赛的决赛。',
  '有个拿过你奖学金的孩子，去一家二线队试训了。',
  '训练营的教练说，现在报名的孩子里一半是冲着你的名字来的。',
]

/** At the season's end: the café's year, and a line from home and from the kids — words, never numbers. */
export function outletSeason(state: GameState, year: number): void {
  const me = state.me!
  const o = me.out
  if (!o) return
  const rng = new Rng(hashStr(`outlets:${state.seed}:${year}`))
  const c = o.cafe
  if (c?.open) {
    const r = rng.next()
    const close = (why: string) => { c.open = false; c.closed = year; pushLog(state, 'bad', why) }
    if (r < CAFE_CLOSE) close(`合伙的网咖撑不下去了：房租涨了，对面又开了一家。${year} 年底关门，投进去的钱没回来。`)
    else if (r < CAFE_CLOSE + CAFE_LOSS) {
      if (me.money >= CAFE_TOPUP) {
        addMoney(state, 'asset', -CAFE_TOPUP)
        pushLog(state, 'money', `网咖 ${year} 年亏了，合伙人找你补了 ${usd(CAFE_TOPUP)}。`)
      } else close(`网咖 ${year} 年亏了，你拿不出钱补，只好关门。`)
    } else {
      const n = Math.round(CAFE_PRICE * rng.range(CAFE_YIELD[0], CAFE_YIELD[1]))
      addMoney(state, 'biz', n)
      c.paid += n
      pushLog(state, 'money', `合伙的网咖 ${year} 年分红 ${usd(n)}。`)
    }
  }
  if (o.family && me.phase === 'pro') pushLog(state, 'info', rng.pick(FAMILY_NOTES))
  if (o.scholar.includes(year)) pushLog(state, 'info', SCHOLAR_NOTES[Math.min(o.scholar.length, SCHOLAR_NOTES.length) - 1])
}

/**
 * The steady way, for 托管's shopping (me/auto.ts autoBuy): only out of real
 * savings, the family first, one event of each a year, a studio only for
 * someone who streams, and never the café — the autopilot does not gamble.
 */
export function autoOutlets(state: GameState): string[] {
  const me = state.me!
  const out: string[] = []
  if (me.phase === 'retired') return out
  const pro = me.phase === 'pro'
  if (pro && readOut(me).family < 1 && me.money >= 30000 && !setFamily(state, 1)) out.push('开始每月往家里打钱')
  if (pro && readOut(me).family < 2 && me.money >= 250000 && wage(state) >= 100000 && !setFamily(state, 2)) out.push('往家里寄的钱多了一些')
  // not on legs that would show on stage
  const fresh = (state.players[me.id]?.fatigue ?? 0) < MEET_TIRED
  const meet = fresh ? [...MEETS].reverse().find((m) => !meetLocked(state, m) && me.money >= m.price * 8) : undefined
  if (meet && !holdMeet(state, meet.key)) out.push(`办了一场见面会（${meet.name}）`)
  if (pro && !scholarLocked(state) && me.money >= scholarPrice(state) * 6 && !fundScholar(state)) out.push('出了今年的青训奖学金')
  if (pro && !breakLocked(state, BREAKS[0])) {
    const pick = [...BREAKS].reverse().find((b) => !breakLocked(state, b) && (!b.share || me.money >= breakPrice(state, b) * 8))
    if (pick && !takeBreak(state, pick.key)) out.push(`休赛期：${pick.name}`)
  }
  const cur = readOut(me).studio
  const next = STUDIO[cur + 1]
  if (next && !studioLocked(state) && me.stream.total >= (cur ? 40 : 12) && me.money >= next.price * 5 && !buyStudio(state)) out.push(`直播间换成了${next.name}`)
  return out
}

/** What the money became, as the ending says it — after LIFESTYLE's lines, at most three. */
export function outletLines(state: GameState): string[] {
  const o = readOut(state.me)
  const lines: string[] = []
  if (o.familySent >= 20000) lines.push(`这些年你一共往家里寄了 ${big(o.familySent)}。`)
  const n = o.scholar.length
  if (n >= 3) lines.push(`你出钱的青训奖学金办了 ${n} 年，收到过孩子手写的信。`)
  else if (n) lines.push(`你出过 ${n} 年青训奖学金。`)
  if (o.cafe?.open) lines.push('你合伙开的网咖还开着，墙上挂着你的队服。')
  else if (o.cafe) lines.push('你合伙开过一家网咖，没撑到你退役。')
  const met = o.meets.filter((m) => m.ok).length
  if (met >= 3) lines.push('每年的见面会，台下总有几张看了你好几年的脸。')
  else if (met) lines.push(`你自己掏钱办过 ${met} 场见面会。`)
  const trips = o.breaks.filter((b) => b.key === 'family').length
  if (trips >= 2) lines.push(`休赛期你带爸妈出去走过 ${trips} 次。`)
  return lines.slice(0, 3)
}

/** The retirement night's recap: what the career earned and where some of it went, in one line. */
export function outletRecap(state: GameState): string | null {
  const me = state.me
  if (!me?.ledger) return null
  const o = readOut(me)
  const parts: string[] = []
  if (o.familySent) parts.push(`往家里寄了 ${big(o.familySent)}`)
  if (o.scholar.length) parts.push(`出了 ${o.scholar.length} 年奖学金`)
  const met = o.meets.length
  if (met) parts.push(`办了 ${met} 场见面会`)
  if (o.cafe) parts.push('合伙开过网咖')
  return `生涯挣了 ${big(me.ledger.lifetimeIn)}${parts.length ? `，${parts.join('，')}` : ''}。`
}
