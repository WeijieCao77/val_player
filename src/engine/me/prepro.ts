import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import type { CupRun, Invite } from './types'
import { pushLog } from './log'
import { boardWeek, payDownAtTop, standingOf } from './rank'
import { push } from './pending'
import { daysLeft } from './aside'
import { CUPS } from './cups'
import { formatOf, regionIn } from '../era'
import { foldAhead, hasPlace } from '../timeline'
import { clubOpen, inviteBlock } from './window'
import { noteRankPeak } from './moments'
import { callerRead } from './igl'
import { countOffer } from './telemetry'
import { firstPlayBy } from './nextup'

export const AP_PRE = 12
/**
 * The earliest a club will pick up the phone, in weeks of the first year.
 *
 * Twelve until 2026-09-20, when the author asked for the stretch before the first contract to come down:
 * 「天梯签约前 18 周要不要缩短…改一下，最好能缩短到 14-16 周」. Measured the same week
 * (scripts/measure_first_hour.ts, 托管, 30 seeds × China, Europe, North America, Korea × both entry years): the
 * first contract came at a median week 18, and a home club was already within reach of a call on day one in
 * almost every career — the wait was the calls' own rules, not the climb.
 *
 * Nine, not zero: the first cup opens in week 6 and its rounds are played from week 7, so the door opens on a
 * player who has been seen somewhere, and the first two months are still the cups' alone — the 「挑战」 door is
 * the same door, only three weeks less of it. The bar itself has not moved: who may call, and what he must
 * clear to be called, are exactly as they were.
 */
export const PRE_EARLIEST = 9
export const INVITE_DAYS = 21

/** Where a player of this rating settles on the ladder, 0-100. */
export const skillToLadder = (overall: number): number => clamp(45 + (overall - 60) * 1.7, 0, 100)

/** The ladder in words (me/rank.ts ladderLabel, where it lives beside the rest of the ladder's words), said here as well. */
export { ladderLabel } from './rank'

/**
 * One action point of ranked: six games against the ladder's own pull.
 *
 * The pull reads where I stand on today's board (me/rank.ts standingOf), not the bare
 * score: a man back from a break, whose place the board climbed past, is better than
 * his place — he wins more than he loses, and his RR climbs until his place is back
 * where his play puts it. The place comes back as the RR does: playing takes none of the
 * board's climb off (me/rank.ts). With nothing climbed past me the standing is the score,
 * and every game is as it was.
 */
export function playRanked(state: GameState, rng: Rng): { wins: number; losses: number; delta: number } {
  const me = state.me!
  const p = state.players[me.id]
  const target = skillToLadder(p.overall + (p.form - 70) * 0.15 - Math.max(0, p.fatigue - 50) * 0.08)
  let wins = 0
  let losses = 0
  let delta = 0
  const l = standingOf(state)
  for (let g = 0; g < 6; g++) {
    const pw = clamp(0.5 + (target - l) / 60, 0.2, 0.8)
    // the climb slows near the top and losing costs a little less than winning pays
    const step = clamp(2.2 - l * 0.012, 0.9, 2.2)
    if (rng.chance(pw)) { wins++; delta += step } else { losses++; delta -= step * 0.82 }
  }
  const raw = me.pre.ladder + delta
  me.pre.ladder = clamp(raw, 0, 100)
  // what the scale cannot hold past its top goes to catching the board that climbed past me (me/rank.ts payDownAtTop)
  if (raw > 100) payDownAtTop(state, raw - 100)
  notePeak(state)
  return { wins, losses, delta }
}

/**
 * The best place held: where I stand today (me/rank.ts standingOf), once it is over the best. RR won back over a
 * board that climbed past me is no place I had, so the best reads the standing and not the score. The first time
 * it reaches 超凡入圣 / 神话 / 辐能战魂 gets a card (me/moments.ts).
 */
function notePeak(state: GameState): void {
  const pre = state.me!.pre
  const was = pre.ladderPeak
  pre.ladderPeak = Math.max(was, standingOf(state))
  if (pre.ladderPeak > was) noteRankPeak(state, was)
}

/**
 * A week without a club, after its ranked (me/week.ts settleWeek). The author, 2026-09-14:
 * 「不打排位分数也会掉，这不合理，我们的设定是不打会下滑，但是在辐能这个段位下滑的应该是
 * 排名但是分数不变，下滑是因为别人分变高了」. A week without ranked used to take the score
 * itself down — 0.4, and 6% of the way to where the skill would put it — at every tier,
 * 辐能战魂 with the rest, and could lift it too with nothing played.
 *
 * Now no week moves the score or its RR, at any tier: only ranked does. From 神话 up a week
 * without ranked costs the place instead, as the board climbs past me, and every week a little
 * of what climbed settles back (me/rank.ts boardWeek) — which can lift my place over my best,
 * and then that is my best.
 */
export function ladderWeekly(state: GameState, played: boolean): void {
  boardWeek(state, played)
  notePeak(state)
  noteWatched(state)
}

/**
 * What a club's people see when they look at me: the eight, plus what a five taught me, plus the ladder — where I
 * stand on it today (me/rank.ts standingOf), a place the board has climbed past counting for what it reads —
 * and, for a man who calls or has lately, his 指挥 (me/igl.ts callerRead, 2026-09-14): clubs sign callers for the calls.
 */
export function tryoutSkill(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  return p.overall + me.pre.tac * 0.15 + standingOf(state) * 0.05 + callerRead(state)
}

/** 战术素养's ceiling (me/cups.ts raises it a cup run at a time), so a screen can draw it as a bar */
export const TAC_MAX = 60

/**
 * 「他们眼里的你」, taken apart.
 *
 * Reported 2026-09-14: 「我现在数值是 80，它显示我是 90」. The cards and the 转会 page printed tryoutSkill beside a
 * club's bar as 「你现在 N」, and a player read it against the 综合 every other screen shows him. The sum was right
 * — a club reads the eight, what playing with a five taught him (战术素养), the ladder, and a caller's 指挥 — but
 * the label said the number was his own. Every screen that shows the comparison reads it from here, so what is on
 * screen is always this sum and never a second copy of the formula.
 */
export interface SkillRead {
  /** tryoutSkill itself */
  total: number
  /** the figure on screen — and exactly what the four parts below add up to */
  shown: number
  overall: number
  tac: number
  ladder: number
  igl: number
}

export function skillRead(state: GameState): SkillRead {
  const me = state.me!
  const p = state.players[me.id]
  const overall = Math.round(p.overall)
  const raw = [me.pre.tac * 0.15, me.pre.ladder * 0.05, callerRead(state)]
  const total = tryoutSkill(state)
  const shown = Math.round(total)
  // whole numbers that add up to the figure beside them: the floor of each part, then the points rounding
  // left over to the biggest fractions — a make-up that does not add up teaches the player nothing
  const ints = raw.map((v) => Math.floor(v))
  let left = shown - overall - ints.reduce((s, v) => s + v, 0)
  for (const o of raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break
    ints[o.i]++
    left--
  }
  while (left < 0) {
    const j = ints.indexOf(Math.max(...ints))
    if (ints[j] <= 0) break
    ints[j]--
    left++
  }
  return { total, shown, overall, tac: ints[0], ladder: ints[1], igl: ints[2] }
}

/** 「综合 80 · 战术素养 +9 · 天梯 +4 · 指挥 +1」 — the parts worth a point, in the order they are added on */
export function skillReadCn(r: SkillRead): string {
  const out = [`综合 ${r.overall}`]
  if (r.tac) out.push(`战术素养 +${r.tac}`)
  if (r.ladder) out.push(`天梯 +${r.ladder}`)
  if (r.igl) out.push(`指挥 +${r.igl}`)
  return out.join(' · ')
}

/** the same read in words, for the screens with 数值 off */
export const SKILL_READ_CN = '综合、战术素养、天梯和指挥'

/** What this club expects of a signing: a bench place at a VCT side, a starter at a Challengers one. */
/**
 * What a club wants to see before it signs me. A Challengers side asks for a
 * little more than its own level — nobody signs a rookie to be exactly as
 * good as the bench — so a day-one player (about 60) is under every bar and
 * has a season of climbing in front of him.
 */
export function expectOf(team: Team): number {
  return team.tier === 1 ? team.rating - 2 : team.rating + 1
}

export const CLUB_TIER_CN = (team: Team): string =>
  team.tier === 2 ? 'Challengers' : team.rating >= 86 ? '豪门' : team.rating >= 82 ? '中游' : '弱队'

/**
 * The bar at every level, and how far under it you are.
 *
 * Ported from 破晓's 俱乐部门槛 card. Its point is the one the author has
 * made about grey-outs all along: a locked door has to say what the lock is.
 * The pre-pro stretch was 「过于冗长」 in the original partly because you
 * could not see what you were climbing towards — you ground the ladder and
 * hoped. This puts the whole ladder on one screen: what each tier of club
 * expects, where you actually are, and how many points short.
 *
 * The bar is read off the real clubs in the world, not typed in, so it moves
 * when the league does.
 */
export interface ClubBar { key: string; name: string; expect: number; gap: number; ok: boolean; example: string }

export function clubBars(state: GameState): ClubBar[] {
  const skill = tryoutSkill(state)
  const groups: { key: string; name: string; pick: (t: Team) => boolean }[] = [
    { key: 't1top', name: '豪门', pick: (t) => t.tier === 1 && t.rating >= 86 },
    // on a new world's ruler (engine/ruler.ts) a VCT club's best five sit 80–91: the top third, the middle, the rest
    { key: 't1mid', name: '中游', pick: (t) => t.tier === 1 && t.rating >= 82 && t.rating < 86 },
    { key: 't1low', name: '弱队', pick: (t) => t.tier === 1 && t.rating < 82 },
    { key: 't2', name: '挑战者联赛', pick: (t) => t.tier === 2 },
  ]
  // my own 赛区's clubs, as a call reads them (abroadClub): from 2023 the whole league
  const home = Object.values(state.teams).filter((t) => !abroadClub(state, t) && !t.id.startsWith('CUP_') && !t.dormant)
  const pool = home.length ? home : Object.values(state.teams).filter((t) => !t.id.startsWith('CUP_') && !t.dormant)
  const out: ClubBar[] = []
  for (const g of groups) {
    const ts = pool.filter(g.pick)
    if (!ts.length) continue
    // the easiest door of that tier is the one you actually have to clear
    const expect = Math.min(...ts.map(expectOf))
    const example = ts.slice().sort((a, b) => expectOf(a) - expectOf(b))[0]?.name ?? ''
    out.push({ key: g.key, name: g.name, expect: Math.round(expect), gap: Math.round(expect - skill), ok: skill >= expect, example })
  }
  return out
}

/**
 * The clubs that stay away this year: an offer or an invitation I turned down,
 * a renewal I refused, a tryout that ended 「以后再联系」. The screen says
 * 「今年不再来」, and that is what this holds to: an entry keeps the year it
 * was written in and lapses when the year turns, whatever club I am at.
 *
 * It used to be a bare list of clubs, cleared only when I changed clubs: a man
 * who stayed where he was never heard again from a club he had once said no
 * to (the author, 2026-09-13), and one who moved in the summer could be called
 * in the winter by the club he had turned down that summer. A save from before
 * kept no year, and its entries have lapsed (me/save.ts).
 */
export function declinedNow(state: GameState): Set<string> {
  return new Set((state.me!.declined ?? []).filter((d) => d?.year === state.year).map((d) => d.team))
}

/** Turned down today, one way or the other: the club stays away for the rest of this year. */
export function markDeclined(state: GameState, teamId: string): void {
  const me = state.me!
  me.declined = (me.declined ?? []).filter((d) => d?.year === state.year && d.team !== teamId)
  me.declined.push({ team: teamId, year: state.year })
}

/** Clubs whose bar I am within reach of, my own 赛区 first (abroadClub). */
export function reachableClubs(state: GameState, slack = 6): Team[] {
  const skill = tryoutSkill(state)
  const no = declinedNow(state)
  const clubs = Object.values(state.teams)
    // a club with nowhere to play this year is not holding tryouts
    .filter((t) => t.roster.length <= 7 && !no.has(t.id) && !t.dormant && hasPlace(state, t))
    .filter((t) => expectOf(t) <= skill + slack)
  const away = new Set(clubs.filter((t) => abroadClub(state, t)).map((t) => t.id))
  return clubs.sort((a, b) => (Number(away.has(a.id)) - Number(away.has(b.id))) || b.rating - a.rating)
}

/**
 * A club in another league from mine: not my club's league and not my home
 * region's. A 赛区 is a league — VCT EMEA is Europe, Türkiye, CIS and MENA
 * alike, VCT Americas North America, Brazil and LATAM — so a club in the league
 * I play in is never foreign to me, nor one in the league I come from. It used
 * to be read off the club's home country (the author, 2026-09-13: a bug): a
 * Turkish club in a French player's own league weighed 0.015 of a French one,
 * and a man playing outside his home league had every club of it weighed so —
 * 53 of 185 windows at a Challengers club, in sixteen careers, found every VCT
 * club of his league 「foreign」.
 *
 * A round of offers reads it (me/transfer.ts pickBuyer), and from 2023 a call does (abroadClub).
 */
export function foreignLeague(state: GameState, t: Team): boolean {
  const me = state.me!
  const league = regionIn(t.region, state.year)
  const mine = state.teams[state.myTeam]
  if (mine && regionIn(mine.region, state.year) === league) return false
  return regionIn(me.region, state.year) !== league
}

/**
 * 外赛区, for a tryout invitation and the screens that sort clubs for one (the transfer screen's bars and table).
 *
 * From 2023, when the partnered leagues closed, by the VCT league, as an offer reads it (foreignLeague): a club in
 * my league's territory is home whatever country it is based in — a Brazilian or LATAM club for a North American
 * in VCT Americas, a Challengers Brazil club with it, since Challengers Brazil feeds Americas (engine/era.ts
 * regionIn). The author, 2026-09-14: 「统一按联赛算」. Until then a call read the club's own country while an
 * offer read the league, and a North American's Brazilian club was 外赛区 on a call and 本赛区 on an offer.
 * The same 1,400 calls of a 2026 North American of 70 (ABROAD_CAP): Brazil's and LATAM's clubs 44 → 559, his own
 * country's 1,071 → 654, 外赛区 285 → 187; a European's Türkiye, CIS and MENA clubs 15 → 373, 外赛区 96 → 70.
 *
 * 2021–2022 are as they were: sixteen circuits and then eight, no leagues, a club's own region.
 */
export function abroadClub(state: GameState, t: Team): boolean {
  return formatOf(state.year) === 'open' ? t.region !== state.me!.region : foreignLeague(state, t)
}

/**
 * A club of my own VCT league based in another country or region than mine, from 2023: 本赛区 — no 外赛区 on it, nothing
 * of ABROAD_CAP over it — but not my own country's. 「Another country」 is read the way 2021–2022 read 外赛区: the club's
 * own region against mine (`t.region !== me.region`). For a North American in VCT Americas that is a Brazilian or LATAM
 * club, for a European in VCT EMEA a Turkish, CIS or MENA one, and for a man playing in another league than his own
 * (foreignLeague) every club of that league as well. Before 2023 there is none: a club of another region is 外赛区.
 */
export function leagueMate(state: GameState, t: Team): boolean {
  return formatOf(state.year) !== 'open' && t.region !== state.me!.region && !foreignLeague(state, t)
}

/**
 * What a club of my league from another country weighs against one of my own country's (leagueMate): in a call's draw
 * (pickClub), a round of offers (me/transfer.ts pickBuyer) and the VCT clubs that come for a Challengers man
 * (me/transfer.ts vctApproach). The author, 2026-09-14, on 「统一按联赛算」 having weighed them whole: 「给个中间分量」.
 *
 * Whole, the same 840 calls of a 2026 North American of 70 without the language came 400 from his own country's clubs
 * and 334 from Brazil's and LATAM's; a European's 562 from Europe's and 228 from Türkiye's, the CIS's and MENA's. At
 * half: 500 and 214, 648 and 140 — and 外赛区 106 → 126 and 50 → 52, home weighing less in the draw, still well under
 * ABROAD_CAP (15% and 6% of the calls, no draw past 17%). A listed round's 240 picks, from his own country and from the
 * league's others: at G2 131 → 156 and 102 → 70, at a North American Challengers side 116 → 169 and 119 → 65, at Team
 * Heretics 131 → 172 and 102 → 60, at a European Challengers side 151 → 175 and 87 → 60. 2021–2022, and China's league
 * of one country, draw exactly as before. scripts/check_language.ts 八 holds it.
 */
export const MATE_SHARE = 0.5

/** A home club's share of its weight: one of my own country's whole, one of my league from another country MATE_SHARE. */
export const homeShare = (state: GameState, t: Team): number => (leagueMate(state, t) ? MATE_SHARE : 1)

/**
 * The word a card or a table puts on a club (the author, 2026-09-14: 「标签按联赛、出海按国家」): 「外赛区」 for a club
 * of another 赛区 as a call and an offer read it (abroadClub: from 2023 another VCT league), 「国外俱乐部」 for one of my
 * league based in another country (leagueMate), nothing for my own country's. Both of the first two are a move abroad
 * (me/contract.ts joinClub reads `me.abroad` by country): the language, the achievements and the following go by that.
 */
export function awayWord(state: GameState, t: Team): '外赛区' | '国外俱乐部' | '' {
  if (abroadClub(state, t)) return '外赛区'
  return t.region !== state.me!.region ? '国外俱乐部' : ''
}

/** An invitation as a club writes it: it skips the tryout when I clear its bar by ten (me/selfpitch.ts writes one for a 自荐 that came good). */
export function makeInvite(state: GameState, team: Team, via: Invite['via'], rng: Rng): Invite {
  void rng
  const me = state.me!
  const skill = tryoutSkill(state)
  const direct = skill >= expectOf(team) + 10 || (via === 'cup' && me.pre.cups.slice(-1)[0]?.won === true && team.tier === 2)
  return { id: `inv:${state.year}:${state.day}:${team.id}`, teamId: team.id, via, day: state.day, year: state.year, expires: state.day + INVITE_DAYS, direct }
}

/**
 * 外语 — the 语言课, or the 留学生 background — is an advantage, never a door shut (the author, 2026-09-14:
 * 「外语学习只是优势，即使会外语国内的俱乐部也应该要来邀请」). Reported that day: a player who took the
 * language by accident had every tryout invitation from another region since, and no club of his own asked.
 *
 * The language used to raise every foreign club's weight inside the one draw a call is made from — 0.5 to 0.8
 * in 2021–2022, 0.04 to 0.2 from 2023 — and a round of offers' the same way (me/transfer.ts pickBuyer, 0.015 to
 * 0.12). One club a call, so a foreign club drawn was a home club not drawn. The same draws with the language off
 * and on (scripts/probe_lang.ts: a cup run's end, two careers from the ladder over two years): home invitations
 * 246 → 112 for a 2026 North American player, 66 → 19 for a 2026 Chinese one, 143 → 90 for a 2021 European one;
 * a listed round's home offers 3,456 → 2,731 and 1,661 → 804.
 *
 * Now every draw is the same with the language or without it, and the language comes on top: when a club calls,
 * with this chance a club of another region calls as well, drawn among those clubs alone on a stream of its own.
 * The home call is exactly the one a man without the language has, and the extra call holds no place in the
 * queue (waiting). A round of offers that came takes the same chance of one club of another league (rollOffers).
 */
export const LANG_EXTRA = 0.3

/** A club's own call still waiting holds the channel shut; one that came for the language does not. */
const waiting = (state: GameState): boolean => state.me!.pre.invites.some((i) => !i.lang)

/**
 * 外赛区 on a call without the language: the clubs of other 赛区 in a draw, all of them together, weigh at most this
 * much of what the clubs of mine weigh — half, so a third of the calls at most (the author, 2026-09-14:
 * 「控制外赛区邀请，在不会外语的时候外赛区邀请占比不要超过一半」).
 *
 * Each club of another region weighed 0.5 of one of mine in 2021–2022 and 0.04 from 2023, and nothing held them
 * together: the more of them in reach, the more of the calls were theirs, and most of the world is another region.
 * A player of 70 had 10–16 clubs of his own region in reach in 2021 against 181–197 elsewhere, and 3 or 4 in 2026's
 * China against 166–171. The same draws before and after, seven channels of 200 calls each (a cup won, a cup final
 * lost, the ladder, the ladder's top, a following, a large one, a former professional), a player of 70: 外赛区 90.6%
 * → 33.4% of a 2021 Chinese player's calls, 88.1% → 34.7% of a European's, 92.6% → 33.1% of a North American's,
 * 69.7% → 33.0% of a 2026 Chinese player's; home calls 131 → 933, 167 → 914, 104 → 937, 424 → 938 of 1,400, and
 * not one draw that brought a home club brings one from abroad now. Where few clubs abroad are in reach nothing is
 * held back — 2026's North American and European players, 20.4% → 13.4% and 6.9% → 5.0%, lower for the league
 * (abroadClub), not for this. scripts/check_language.ts 五 holds it.
 *
 * Half, and not a hair under it: a career hears from a handful of clubs, and at a third a man with eight calls has
 * five or more from abroad about one career in eleven — at 40% one in six. With the language a call brings a club
 * from abroad LANG_EXTRA of the time on top, and about half of his calls are from abroad: the language's advantage.
 */
export const ABROAD_CAP = 0.5

/**
 * A club with a match of its own within SOON_DAYS, were I on it, pulls SOON_PULL times as hard in a call's draw
 * (me/nextup.ts firstPlayBy: 「下一场」's own reading of the club — a seat or a decider it can enter). A lean, not a
 * gate: a club with nothing soon still calls, and every other part of a club's pull, and every 赛区 rule over it, is
 * as it was.
 *
 * The author approved it 2026-09-18, on scripts/probe_first_match_wait.ts: a call never read when a club next plays,
 * and at the call that brought a ladder start's first contract a quarter of 2026's home clubs in reach played within
 * eight weeks, the club that called in 41 of 120 careers; 42 of the 120 then waited for November's open qualifier.
 * Twice as hard, the same careers (托管, 30 seeds × China, Europe, North America, Korea; the two before this already
 * in): the club that called played within eight weeks in 41 → 55 of 120, the median wait from the contract to the
 * first match 11.2 → 9.1 weeks, 14 → 9 waits over half a year, 42 → 35 to November; 2021, where few clubs play within
 * weeks of a spring call, 9.1 → 9.2. Two contracts of 240 came on another week (another club called first and its
 * tryout ended without a deal). Three times as hard went to 8.3 weeks and 8 over half a year, and moved one contract
 * 26 weeks the same way: the lean is kept mild.
 */
export const SOON_DAYS = 70
export const SOON_PULL = 2

/**
 * A club's pull in a call's draw before any 赛区 rule: how far I clear its bar, the tier the channel asks first, and
 * whether it plays soon (SOON_PULL).
 */
export function inviteWeight(state: GameState, t: Team, prefer: 1 | 2 | 0): number {
  let v = 10 + Math.max(0, tryoutSkill(state) - expectOf(t)) * 2
  if (prefer && t.tier === prefer) v *= 4
  if (!prefer && t.tier === 1) v *= 0.5
  if (firstPlayBy(state, t, state.day + SOON_DAYS) != null) v *= SOON_PULL
  return v
}

/**
 * A draw's 外赛区 clubs, all of them together, held to ABROAD_CAP of what its home clubs weigh — each club pressed
 * down by the same share, so who among them is likelier stays as it was. Under the line, or with no club of my own
 * 赛区 in the draw at all, the weights are left as they are: a man no home club would ask still gets his call.
 */
export function holdAbroad(w: readonly number[], away: readonly boolean[]): number[] {
  let home = 0
  let far = 0
  w.forEach((v, i) => { if (away[i]) far += v; else home += v })
  if (!home || far <= home * ABROAD_CAP) return w.slice()
  const k = (home * ABROAD_CAP) / far
  return w.map((v, i) => (away[i] ? v * k : v))
}

/**
 * A club history lets go within this many days is not holding tryouts (engine/timeline.ts foldAhead): no call comes
 * from it. Clubs still fold as history had them — the player is only no longer called by one about to.
 *
 * The author approved it 2026-09-18, on scripts/probe_first_match_wait.ts: a call never read history's list of clubs
 * it lets go, and 17 of 120 first contracts of a 2021 ladder start (托管, 30 seeds × China, Europe, North America,
 * Korea) were with a club on that year's list — Opportunists signed a man in April and dissolved four weeks later;
 * 13 of the 17 folded under him before his first match. A club goes three to five weeks after its last real event
 * (foldsOf), so sixteen weeks is a club into its last stage: at twelve to sixteen weeks from its day, 79–98% of the
 * clubs history let go in 2022–2025 had at most one real event left. The same 120 careers (with the decider of
 * circuit.ts offerPlayIn already in), eight, sixteen and twenty-six weeks: first contracts with a club on the list
 * 17 → 10, 8 and 0, none of them folding before the first match (3 did); the median wait 9.1 → 8.9, 9.1 and 9.0
 * weeks, and one contract of 120 later (another club called first, and the tryout did not end in a deal). Past
 * sixteen weeks the clubs left on the list still had a stage to play — 95% of those sixteen to twenty weeks out would
 * have given the man a match first — and reading further ahead is hindsight no club had.
 */
export const FOLD_AHEAD = 16 * 7

/** History lets this club go within FOLD_AHEAD days. */
export const foldingSoon = (state: GameState, t: Team): boolean => {
  const d = foldAhead(state, t.id)
  return d != null && d <= FOLD_AHEAD
}

/** The draw a call is made from. `abroad`: the language's own call (callFrom) — clubs of other 赛区 only, weighed among themselves. */
function pickClub(state: GameState, rng: Rng, prefer: 1 | 2 | 0, abroad = false): Team | null {
  const me = state.me!
  // a club whose window is shut or whose roster is locked is not holding tryouts (me/window.ts): with no club of my own, only its window counts;
  // nor is one history is about to let go (FOLD_AHEAD)
  const pool = reachableClubs(state).filter((t) => !me.pre.invites.some((i) => i.teamId === t.id) && clubOpen(state, t.id)
    && !foldingSoon(state, t) && (!abroad || abroadClub(state, t)))
  if (!pool.length) return null
  if (abroad) return rng.weighted(pool, pool.map((t) => inviteWeight(state, t, prefer)))
  const away = pool.map((t) => abroadClub(state, t))
  // 2021–2022: no import limits and no franchise, and the author's rule —
  // every region's clubs can write, each to its own bar. The bar is the
  // club's own level (expectOf), so a Thai side asks less than Sentinels.
  // Each club of another 赛区 weighs less than one of mine, and all of them together no more than ABROAD_CAP of mine;
  // from 2023 a club of my league from another country is mine at MATE_SHARE of one of my own country's (leagueMate).
  // The same with the language or without it: what the language brings comes on top (LANG_EXTRA).
  const per = formatOf(state.year) === 'open' ? 0.5 : 0.04
  const w = pool.map((t, i) => inviteWeight(state, t, prefer) * (away[i] ? per : homeShare(state, t)))
  return rng.weighted(pool, holdAbroad(w, away))
}

const HOW: Record<Invite['via'], string> = { cup: '看了你的杯赛', rank: '在天梯上注意到你', fans: '看了你的直播', free: '知道你在找队', scout: '教练组推荐', self: '看了你的自荐' }

function offerInvite(state: GameState, team: Team, via: Invite['via'], rng: Rng): void {
  const me = state.me!
  const inv = makeInvite(state, team, via, rng)
  me.pre.invites.push(inv)
  push(state, { kind: 'invite', id: inv.id })
  pushLog(state, 'good', `${team.name} 的人${HOW[via]}，${inv.direct ? '直接给了报价' : '邀请你去试训'}。${INVITE_DAYS} 天内答复。`)
}

/** A club calls — and with the language, now and then a club of another region as well (LANG_EXTRA), after it in the queue. */
function callFrom(state: GameState, team: Team, via: Invite['via'], rng: Rng, prefer: 1 | 2 | 0): void {
  offerInvite(state, team, via, rng)
  const me = state.me!
  if (!me.flags.lang) return
  // a stream of its own: whether it comes, and who, moves no roll the call above or anything after it reads
  const lang = new Rng(hashStr(`lang:${via}:${state.seed}:${state.year}:${state.day}`))
  if (!lang.chance(LANG_EXTRA)) return
  const abroad = pickClub(state, lang, prefer, true)
  if (!abroad) return
  const inv: Invite = { ...makeInvite(state, abroad, via, lang), lang: true }
  me.pre.invites.push(inv)
  push(state, { kind: 'invite', id: inv.id })
  pushLog(state, 'good', `${abroad.name} 的人也${HOW[via]}：你会外语，这家外赛区俱乐部也${inv.direct ? '直接给了报价' : '邀请你去试训'}。${INVITE_DAYS} 天内答复。`)
}

/**
 * After a cup: a deep run is what gets a name written down. Called when a run
 * ends — lost, won or given up on (me/cups.ts endRun).
 *
 * Nothing called it until 2026-09-14: the week page's 「怎么被看见」 names the
 * cups first of its three roads, and the help says a first spring's calls come
 * only from cups, and a cup run never brought a single one.
 */
export function cupInvite(state: GameState, run: CupRun, rng: Rng): void {
  const me = state.me!
  const depth = run.rounds ? run.reached / run.rounds : 0
  me.pre.scoutSeen += depth >= 0.5 ? 1 : 0
  // the run is still remembered; a call waits for a transfer period that can bring one (me/window.ts inviteBlock):
  // a run that ended after a signing — agreed under a roster lock, or made that day — used to bring a tryout to a signed man.
  // A club's own call still waiting holds the channel; one that came for the language does not (LANG_EXTRA)
  if (waiting(state) || inviteBlock(state)) return
  const p = clamp(0.08 + depth * 0.45 + (run.won ? 0.30 : 0) + me.pre.scoutSeen * 0.04, 0.05, 0.96)
  if (!rng.chance(p)) return
  const prefer = run.won ? 0 : 2
  const team = pickClub(state, rng, prefer)
  if (team) callFrom(state, team, 'cup', rng, prefer)
}

/**
 * Where the weekly channels open, and where it is a first-tier club that calls.
 * The week and transfer screens word their hints from these, so the two cannot drift apart.
 */
export const INVITE_LADDER = 62
export const INVITE_LADDER_T1 = 88
export const INVITE_FANS = 120
export const INVITE_FANS_T1 = 400

/**
 * 有人盯了你几周 — a scout's notebook, so the ladder's call is not the same coin every week.
 *
 * Until 2026-09-20 the ladder channel rolled 2% a week at its line, and the same 2% in the tenth week over it as
 * in the first: a player who had been standing above the line for two months was no likelier to hear a phone
 * than one who had just got there. Measured that week (scripts/measure_first_hour.ts): a ladder start reached
 * the line at a median week 10–12 and heard his first call at a median week 16–20.
 *
 * Now the weeks over the line count. Every week without a club (ladderWeekly) the notebook fills by one while I
 * stand at or over INVITE_LADDER and empties by one while I am under it — a week's dip costs a week of it, not
 * all of it — up to SCOUT_WEEKS_MAX; the weekly chance takes SCOUT_STEP for every week past the first. The
 * first week over the line is exactly the 2% it always was, and nothing about who may call has moved: the
 * line, the bar every club asks (expectOf), the draw and every 赛区 rule over it are as they were. The
 * notebook fills before PRE_EARLIEST too — a man who climbed there in week 5 is not made to start again when
 * the door opens.
 *
 * Measured over the same 240 ladder careers as the survey (30 seeds × four regions × both entry years): with
 * PRE_EARLIEST at 9 the first contract came at a median week 16.1 (2021) and 16.3 (2026), against 18.0 and 19.0
 * before. The step was tried at 0.03 and 0.05 on the same seeds: the median is the same either way — past the
 * line the wait is a home club with an open window, not the roll — but 0.05 pulls the slow quarter in, q3 26.3
 * and 23.3 weeks → 22.0 and 22.0, so that is the one kept.
 */
export const SCOUT_WEEKS_MAX = 6
export const SCOUT_STEP = 0.05

/** The notebook, a week at a time. Returns what the ladder's call reads this week. */
export function noteWatched(state: GameState): number {
  const pre = state.me!.pre
  // absent in a save from before: nobody has been watching yet
  pre.scoutWeeks = clamp((pre.scoutWeeks ?? 0) + (standingOf(state) >= INVITE_LADDER ? 1 : -1), 0, SCOUT_WEEKS_MAX)
  return pre.scoutWeeks
}

/** How much the weeks already watched add to the ladder's weekly chance (noteWatched): nothing in the first week over the line. */
export const watchedBonus = (state: GameState): number => Math.max(0, (state.me!.pre.scoutWeeks ?? 0) - 1) * SCOUT_STEP

/** The weekly channels: the ladder, the following, and being a known free agent. */
export function rollInvites(state: GameState, rng: Rng): void {
  const me = state.me!
  // a signing already agreed (me/contract.ts settleMove), one made this transfer period, or my window shut: no calls (me/window.ts inviteBlock);
  // a club's own call still waiting holds the channel, one that came for the language does not (LANG_EXTRA)
  if (waiting(state) || inviteBlock(state)) return
  const weeksIn = me.pre.year === 1 ? me.week : 99
  if (weeksIn < PRE_EARLIEST && !me.pre.wasPro) return
  // where I stand today (me/rank.ts standingOf): a place the board has climbed past while I was not playing is
  // the place a club sees, so a 辐能战魂 who stops falls under the line as his place does, with his score where it was
  const l = standingOf(state)
  // Both channels open where the screen already tells the player he is somebody: 辐能战魂前 500 on
  // 国服's ladder (me/rank.ts sets its places on it; a smaller server shows the same score further up the
  // board, and the week's page says the line on his own), 「有固定观众」 on the stream. Measured 2026-09-11 before this: a player in the top 500
  // with 120 fans got no call in a year, in every region — the channels began at ladder 74 and 180 fans.
  // how far over the line, and how long I have been over it (noteWatched)
  if (l >= INVITE_LADDER && rng.chance(0.02 + (l - INVITE_LADDER) * 0.005 + watchedBonus(state))) {
    const prefer = l >= INVITE_LADDER_T1 ? 1 : 2
    const team = pickClub(state, rng, prefer)
    if (team) { callFrom(state, team, 'rank', rng, prefer); return }
  }
  if (me.fans >= INVITE_FANS && rng.chance(0.03 + (Math.min(me.fans, 900) - INVITE_FANS) / 780 * 0.07)) {
    const prefer = me.fans >= INVITE_FANS_T1 ? 1 : 2
    const team = pickClub(state, rng, prefer)
    if (team) { callFrom(state, team, 'fans', rng, prefer); return }
  }
  if (me.pre.wasPro && rng.chance(0.12)) {
    const team = pickClub(state, rng, 0)
    if (team) { callFrom(state, team, 'free', rng, 0); return }
  }
}

/**
 * An invitation nobody answered — set aside on the 转会 page (me/aside.ts), or left to run out by 托管 — is gone
 * the morning after its last day. `ahead`: the day it is counted from, 1 as tomorrow begins (me/week.ts runDays).
 */
export function expireInvites(state: GameState, ahead = 0): void {
  const me = state.me!
  for (const inv of me.pre.invites.slice()) {
    if (daysLeft(state, inv) < ahead && !me.tryout) {
      me.pre.invites = me.pre.invites.filter((x) => x.id !== inv.id)
      me.pending = me.pending.filter((x) => !(x.kind === 'invite' && x.id === inv.id))
      countOffer('expire')
      pushLog(state, 'bad', `${state.teams[inv.teamId]?.name ?? '那家俱乐部'} 的邀请过期了，他们没再来电话。`)
    }
  }
}

/** The cup that opens this week, if one does and I have not answered it. */
export function cupThisWeek(state: GameState): typeof CUPS[number] | null {
  const me = state.me!
  const week = Math.floor(state.day / 7)
  for (const c of CUPS) {
    if (c.week !== week) continue
    const key = `${state.year}:${c.key}`
    if (me.pre.seen.includes(key)) continue
    return c
  }
  return null
}

export const preRng = (state: GameState, tag: string) =>
  new Rng(hashStr(`pre:${tag}:${state.seed}:${state.year}:${state.day}`))
