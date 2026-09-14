import { Rng, clamp, hashStr } from '../rng'
import type { GameState, Team } from '../types'
import type { CupRun, Invite } from './types'
import { pushLog } from './log'
import { rankAt, rankText } from './rank'
import { push } from './pending'
import { CUPS } from './cups'
import { formatOf, regionIn } from '../era'
import { hasPlace } from '../timeline'
import { clubOpen, inviteBlock } from './window'
import { noteRankPeak } from './moments'
import { callerRead } from './igl'

export const AP_PRE = 12
/** the earliest a club will pick up the phone, in weeks of the first year */
export const PRE_EARLIEST = 12
export const INVITE_DAYS = 21

/** Where a player of this rating settles on the ladder, 0-100. */
export const skillToLadder = (overall: number): number => clamp(45 + (overall - 60) * 1.7, 0, 100)

/**
 * The ladder in words: 「超凡入圣 2」, and from 神话 up the place on my server's
 * board, 「神话 3 · 国服第 2,431 名」 — 辐能战魂 only inside its top 500. What the
 * score is on the ladder is me/rank.ts's to say; everything that decides reads the score.
 *
 * It used to be a table on the score itself, and 52–62 read 「辐能战魂」 with no
 * place: a 辐能战魂 outside the 500 there are (reported 2026-09-14). That band is
 * 神话 3 now, with its place.
 */
export function ladderLabel(state: GameState, l: number = state.me?.pre?.ladder ?? 0): string {
  return rankText(rankAt(state, l))
}

/** One action point of ranked: six games against the ladder's own pull. */
export function playRanked(state: GameState, rng: Rng): { wins: number; losses: number; delta: number } {
  const me = state.me!
  const p = state.players[me.id]
  const target = skillToLadder(p.overall + (p.form - 70) * 0.15 - Math.max(0, p.fatigue - 50) * 0.08)
  let wins = 0
  let losses = 0
  let delta = 0
  for (let g = 0; g < 6; g++) {
    const l = me.pre.ladder
    const pw = clamp(0.5 + (target - l) / 60, 0.2, 0.8)
    // the climb slows near the top and losing costs a little less than winning pays
    const step = clamp(2.2 - l * 0.012, 0.9, 2.2)
    if (rng.chance(pw)) { wins++; delta += step } else { losses++; delta -= step * 0.82 }
  }
  me.pre.ladder = clamp(me.pre.ladder + delta, 0, 100)
  const wasPeak = me.pre.ladderPeak
  me.pre.ladderPeak = Math.max(me.pre.ladderPeak, me.pre.ladder)
  // the first time the best reaches 超凡入圣 / 神话 / 辐能战魂 gets a card (me/moments.ts)
  if (me.pre.ladderPeak > wasPeak) noteRankPeak(state, wasPeak)
  return { wins, losses, delta }
}

/** A week without ranked leaks a little toward where the skill says it should sit. */
export function ladderWeekly(state: GameState, played: boolean): void {
  const me = state.me!
  const p = state.players[me.id]
  const target = skillToLadder(p.overall)
  if (!played) me.pre.ladder = clamp(me.pre.ladder + (target - me.pre.ladder) * 0.06 - 0.4, 0, 100)
}

/**
 * What a club's people see when they look at me: the eight, plus what a five taught me, plus the ladder —
 * and, for a man who calls or has lately, his 指挥 (me/igl.ts callerRead, 2026-09-14): clubs sign callers for the calls.
 */
export function tryoutSkill(state: GameState): number {
  const me = state.me!
  const p = state.players[me.id]
  return p.overall + me.pre.tac * 0.15 + me.pre.ladder * 0.05 + callerRead(state)
}

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

function makeInvite(state: GameState, team: Team, via: Invite['via'], rng: Rng): Invite {
  void rng
  const me = state.me!
  const skill = tryoutSkill(state)
  const direct = skill >= expectOf(team) + 10 || (via === 'cup' && me.pre.cups.slice(-1)[0]?.won === true && team.tier === 2)
  return { id: `inv:${state.year}:${state.day}:${team.id}`, teamId: team.id, via, day: state.day, expires: state.day + INVITE_DAYS, direct }
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

/** A club's pull in a call's draw before any 赛区 rule: how far I clear its bar, and the tier the channel asks first. */
export function inviteWeight(state: GameState, t: Team, prefer: 1 | 2 | 0): number {
  let v = 10 + Math.max(0, tryoutSkill(state) - expectOf(t)) * 2
  if (prefer && t.tier === prefer) v *= 4
  if (!prefer && t.tier === 1) v *= 0.5
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

/** The draw a call is made from. `abroad`: the language's own call (callFrom) — clubs of other 赛区 only, weighed among themselves. */
function pickClub(state: GameState, rng: Rng, prefer: 1 | 2 | 0, abroad = false): Team | null {
  const me = state.me!
  // a club whose window is shut or whose roster is locked is not holding tryouts (me/window.ts): with no club of my own, only its window counts
  const pool = reachableClubs(state).filter((t) => !me.pre.invites.some((i) => i.teamId === t.id) && clubOpen(state, t.id)
    && (!abroad || abroadClub(state, t)))
  if (!pool.length) return null
  if (abroad) return rng.weighted(pool, pool.map((t) => inviteWeight(state, t, prefer)))
  const away = pool.map((t) => abroadClub(state, t))
  // 2021–2022: no import limits and no franchise, and the author's rule —
  // every region's clubs can write, each to its own bar. The bar is the
  // club's own level (expectOf), so a Thai side asks less than Sentinels.
  // Each club of another 赛区 weighs less than one of mine, and all of them together no more than ABROAD_CAP of mine.
  // The same with the language or without it: what the language brings comes on top (LANG_EXTRA).
  const per = formatOf(state.year) === 'open' ? 0.5 : 0.04
  const w = pool.map((t, i) => inviteWeight(state, t, prefer) * (away[i] ? per : 1))
  return rng.weighted(pool, holdAbroad(w, away))
}

const HOW: Record<Invite['via'], string> = { cup: '看了你的杯赛', rank: '在天梯上注意到你', fans: '看了你的直播', free: '知道你在找队', scout: '教练组推荐' }

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

/** The weekly channels: the ladder, the following, and being a known free agent. */
export function rollInvites(state: GameState, rng: Rng): void {
  const me = state.me!
  // a signing already agreed (me/contract.ts settleMove), one made this transfer period, or my window shut: no calls (me/window.ts inviteBlock);
  // a club's own call still waiting holds the channel, one that came for the language does not (LANG_EXTRA)
  if (waiting(state) || inviteBlock(state)) return
  const weeksIn = me.pre.year === 1 ? me.week : 99
  if (weeksIn < PRE_EARLIEST && !me.pre.wasPro) return
  const l = me.pre.ladder
  // Both channels open where the screen already tells the player he is somebody: 辐能战魂前 500 on
  // 国服's ladder (me/rank.ts sets its places on it; a smaller server shows the same score further up the
  // board, and the week's page says the line on his own), 「有固定观众」 on the stream. Measured 2026-09-11 before this: a player in the top 500
  // with 120 fans got no call in a year, in every region — the channels began at ladder 74 and 180 fans.
  if (l >= INVITE_LADDER && rng.chance(0.02 + (l - INVITE_LADDER) * 0.005)) {
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

export function expireInvites(state: GameState): void {
  const me = state.me!
  for (const inv of me.pre.invites.slice()) {
    if (inv.expires < state.day && !me.tryout) {
      me.pre.invites = me.pre.invites.filter((x) => x.id !== inv.id)
      me.pending = me.pending.filter((x) => !(x.kind === 'invite' && x.id === inv.id))
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
