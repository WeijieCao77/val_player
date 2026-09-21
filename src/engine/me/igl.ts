import { clamp } from '../rng'
import type { GameState, Player } from '../types'
import { callerOf, squadOf } from '../roster'
import { duoBonded } from '../bonds'
import { ensureCaller } from '../world'
import { addXp } from '../training'
import { IGL_EDGE, NO_CALLER_EDGE } from '../match'
import { pushLog } from './log'
import { pop, push } from './pending'
import type { IglBook, MeMatchRecord } from './types'

/**
 * 指挥: the coach hands me the calls (decided 2026-09-14, 「让主角能当上指挥」).
 *
 * Until now the career player could never call. The career was created without
 * the flag, the club's stand-in rule skipped him (engine/world.ts ensureCaller)
 * and appointing a caller existed only on the manager's squad screen. A point
 * of 指挥 talent was worth 0.06 综合 and nothing on the server, so a build that
 * spent on 指挥, 沟通 and 协同 was a trap: −5 to −10 on the peak, VCT one to
 * three years later or never.
 *
 * Now the coach names me main caller (主指挥) when three things hold:
 *
 *  - I have been here a while and I start: IGL_WEEKS at the club — about a
 *    stage — in the five, not on trial or benched, not hurt;
 *  - he trusts my judgement: coachTrust IGL_TRUST;
 *  - I can call at least as well as the man calling now (iglBar): 指挥 and 沟通
 *    within IGL_MARGIN / COMM_MARGIN of the club's caller, and never under the
 *    floor. A stand-in the club made do with (iglSource 'inferred') is not a
 *    caller to measure against: only the floor, and his own numbers, count.
 *
 * No position is barred: controllers and initiators call most often, and a
 * duelist who calls is rarer, not impossible.
 *
 * He asks on a card (me/types.ts PendingItem 'igl'). A yes makes me the club's
 * named caller: the flag, iglSource 'appointed', team.igl — so the match engine
 * reads my 指挥 exactly as it reads every AI club's caller (engine/match.ts
 * buildLineup, IGL_EDGE a point over 60, NO_CALLER_EDGE with nobody). The man I
 * take it from stays a deputy (副指挥), as the manager game's appointIgl had
 * it: a healthy starter loses morale and gains a grievance, and our bond drops
 * DISPLACED_BOND. A no keeps him; he remembers it (DECLINE_BOND), and the coach
 * waits OFFER_GAP weeks before he asks again, OFFERS_PER_CLUB times at a club.
 *
 * While I call: 复盘 and every map I call grow 指挥 (me/growth.ts IGL_CALL_STUDY,
 * CALL_XP here), the team-play options of a key round lean on it
 * (me/nodes.ts NODE_CALL), the coach keeps the caller in his five
 * (me/coach.ts coachStarters), and a club reads a caller's 指挥 when it signs
 * him (callerRead, me/prepro.ts tryoutSkill). He takes it back after a run of
 * defeats since I took it (SKID_OF / SKID_WINS), when his trust falls under
 * IGL_TRUST_LOST, or when he benches me; leaving the club leaves it behind.
 */

/** weeks at the club before the coach thinks of me as his caller: about a stage */
export const IGL_WEEKS = 10
/**
 * the coach's trust he wants first (words.ts trustLabel: 有保留 from 30, 中立 from 48). Not higher: his trust
 * reads where a player's line sits in the five, and a 指挥型 rookie is often the lowest fragger — over three
 * seasons of a 2026 Challengers start his trust averaged 39 and passed 58 one week in a hundred
 */
export const IGL_TRUST = 45
/** and under which he takes the calls back — a caller's trust reads the results, not his line (me/coach.ts afterMyMatch) */
export const IGL_TRUST_LOST = 30
/** 指挥 and 沟通 a caller needs, whoever calls now: a Challengers caller is 72–81 指挥 (2026, p10–p90) */
export const IGL_FLOOR = 68
export const COMM_FLOOR = 68
/** how far under the club's own caller I may be and still be asked: a Challengers caller is 77 指挥 and 78 沟通 at the median (2026) */
export const IGL_MARGIN = 4
export const COMM_MARGIN = 8
/** weeks the coach waits after a no, and after taking the calls back */
export const OFFER_GAP = 12
export const REVOKE_GAP = 26
/** offers at one club, at most */
export const OFFERS_PER_CLUB = 3
/** the run that costs the calls: this many starts since I took them with this many wins or fewer */
export const SKID_OF = 8
export const SKID_WINS = 2
/** 指挥 xp for each map I call, against the room under its ceiling as training is */
export const CALL_XP = 4
/** my bond with the man I took the calls from, and with the man I left them to */
export const DISPLACED_BOND = -8
export const DECLINE_BOND = 3
/** what a club reads into a caller's 指挥 when it signs him: this much a point over CALLER_READ_FROM, up to CALLER_READ_MAX */
export const CALLER_READ = 0.25
export const CALLER_READ_FROM = 70
export const CALLER_READ_MAX = 4
/** weeks of calling before a club counts it, and years after the last it still does */
export const CALLER_READ_WEEKS = 8
export const CALLER_READ_YEARS = 1

/** The book, kept at the club I am at: the clock and the offers start again at a new one. */
export function iglBook(state: GameState): IglBook {
  const me = state.me!
  const club = me.phase === 'pro' ? state.myTeam : ''
  const b = (me.igl ??= { club, weeks: 0, asked: 0, offers: 0, declines: 0, revokes: 0, calledWeeks: 0 })
  if (b.club !== club) {
    b.club = club
    b.weeks = 0
    b.asked = 0
    b.lastOffer = undefined
    b.lastRevoke = undefined
    b.since = undefined
  }
  return b
}

/** I call for my club: the coach's flag on me, at the club I am at. */
export function myCall(state: GameState): boolean {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return false
  const p = state.players[me.id]
  return !!p?.isIgl && p.iglSource === 'appointed' && p.teamId === state.myTeam
}

/** The club's caller besides me: its named main caller, else its loudest flagged man. */
export function clubCaller(state: GameState): Player | undefined {
  const me = state.me
  const team = state.teams[state.myTeam]
  if (!me || !team) return undefined
  const squad = squadOf(state, team.id).filter((p) => p.id !== me.id)
  return squad.find((p) => p.id === team.igl && p.isIgl) ?? squad.filter((p) => p.isIgl).sort((a, b) => b.attrs.igl - a.attrs.igl)[0]
}

export interface IglBar {
  igl: number
  comm: number
  caller?: Player
  /** a caller by trade, not a stand-in the club made do with */
  real: boolean
}

/** What the coach wants to see before he hands me the calls: the floor, and around the man calling now. */
export function iglBar(state: GameState): IglBar {
  const caller = clubCaller(state)
  const real = !!caller && caller.iglSource !== 'inferred'
  return {
    igl: Math.max(IGL_FLOOR, caller ? caller.attrs.igl - (real ? IGL_MARGIN : 0) : 0),
    comm: Math.max(COMM_FLOOR, caller ? caller.attrs.communication - (real ? COMM_MARGIN : 0) : 0),
    caller,
    real,
  }
}

export interface IglGate {
  key: 'starter' | 'weeks' | 'trust' | 'igl' | 'comm'
  label: string
  ok: boolean
  have: number
  need: number
}

/** Each thing the coach waits for, met or not — a grey line says what the lock is. */
export function iglGates(state: GameState): IglGate[] {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  const b = me.igl?.club === state.myTeam ? me.igl : undefined
  const bar = iglBar(state)
  const starting = !!team?.starters.includes(me.id) && !me.trial && !(me.benchLock && me.benchLock > state.day) && p.injuredUntil <= state.day
  return [
    { key: 'starter', label: '首发', ok: starting, have: starting ? 1 : 0, need: 1 },
    { key: 'weeks', label: '在队里', ok: (b?.weeks ?? 0) >= IGL_WEEKS, have: b?.weeks ?? 0, need: IGL_WEEKS },
    { key: 'trust', label: '教练信任', ok: me.coachTrust >= IGL_TRUST, have: Math.round(me.coachTrust), need: IGL_TRUST },
    { key: 'igl', label: '指挥', ok: p.attrs.igl >= bar.igl, have: p.attrs.igl, need: bar.igl },
    { key: 'comm', label: '沟通', ok: p.attrs.communication >= bar.comm, have: p.attrs.communication, need: bar.comm },
  ]
}

/** Why the coach would not ask me this week, in words; null when he would. */
export function iglBlock(state: GameState): string | null {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return '没有队伍'
  if (myCall(state)) return '你已经是主指挥了'
  const b = me.igl?.club === state.myTeam ? me.igl : undefined
  const gate = iglGates(state).find((g) => !g.ok)
  if (gate) {
    if (gate.key === 'starter') return '先站稳首发，喊的人要在场上'
    if (gate.key === 'weeks') return `在队里还要待 ${gate.need - gate.have} 周`
    if (gate.key === 'trust') return '教练对你的信任还不够'
    // what trains it, so a grey gate is a way forward (me/growth.ts): 复盘 for 指挥; 道具与跑图, 双排 and 训练赛 for 沟通
    return gate.key === 'igl' ? '你的指挥还不够（复盘会练指挥）' : '你的沟通还不够（道具与跑图、双排、跟队训练赛会练沟通）'
  }
  if (b?.lastRevoke != null && me.week - b.lastRevoke < REVOKE_GAP) return '指挥刚被收回，教练要先看一阵'
  if ((b?.asked ?? 0) >= OFFERS_PER_CLUB) return '教练已经问过你几次，这里不会再问了'
  if (b?.lastOffer != null && me.week - b.lastOffer < OFFER_GAP) return '教练刚问过你，过一阵子才会再问'
  return null
}

/** The week screen's line: who calls, and what stands between me and the calls. */
export function iglLine(state: GameState): string {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return ''
  if (myCall(state)) return '你是队里的主指挥：比赛里全队按你的指挥来打。'
  if (me.pending.some((x) => x.kind === 'igl')) return '教练想让你来喊，等你答复。'
  const caller = clubCaller(state)
  const block = iglBlock(state)
  const who = caller ? `队里的指挥是 ${caller.ign}` : '队里现在没人真正在喊'
  return block ? `${who}；想接指挥：${block}。` : `${who}；教练在考虑让你来喊。`
}

/** Why the coach would take the calls back now; null while he is happy with them. */
export function revokeWhy(state: GameState): string | null {
  const me = state.me!
  if (me.benchLock && me.benchLock > state.day) return '你被换下了场，喊的人得在场上'
  if (me.coachTrust < IGL_TRUST_LOST) return '他不再信你的判断'
  const since = me.igl?.since
  if (!since) return null
  const runs = me.matches
    .filter((m) => !m.friendly && m.started && (m.year > since.year || (m.year === since.year && m.day >= since.day)))
    .slice(-SKID_OF)
  const wins = runs.filter((m) => m.won).length
  if (runs.length >= SKID_OF && wins <= SKID_WINS) return `你接指挥以来最近 ${SKID_OF} 场只赢了 ${wins} 场`
  return null
}

/**
 * The week at my club, for the calls: the clock runs, a caller who has lost the
 * coach loses the calls, and a player who has earned them is asked.
 */
export function iglWeek(state: GameState, notes: string[]): void {
  const me = state.me
  if (!me || me.phase !== 'pro' || !state.myTeam) return
  const b = iglBook(state)
  b.weeks++
  if (myCall(state)) {
    b.calledWeeks++
    b.lastYear = state.year
    const why = revokeWhy(state)
    if (why) revokeIgl(state, why, notes)
    return
  }
  if (me.pending.some((x) => x.kind === 'igl')) return
  if (iglBlock(state)) return
  b.lastOffer = me.week
  b.asked++
  b.offers++
  push(state, { kind: 'igl', id: `${state.year}:${state.day}` })
}

export interface IglOffer {
  q: string
  ctx: string
  /** what changes if I take it, one line each */
  changes: string[]
  take: string
  decline: string
  declineNote: string
}

const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}`

/**
 * The card: what the coach says, where I stand against the man calling now, and
 * what changes if I say yes. `word` puts the attributes in words (the default
 * screen); without it they are figures, as under the 数值 switch.
 */
export function iglOffer(state: GameState, word?: (v: number) => string): IglOffer | null {
  const me = state.me
  const team = state.teams[state.myTeam]
  if (!me || me.phase !== 'pro' || !team) return null
  const p = state.players[me.id]
  const prev = clubCaller(state)
  const w = (v: number) => (word ? word(v) : String(v))
  // the match engine's own sum (engine/match.ts buildLineup): a point over 60 is IGL_EDGE a round, nobody calling is NO_CALLER_EDGE
  const now = prev ? (prev.attrs.igl - 60) * IGL_EDGE : NO_CALLER_EDGE
  const then = (p.attrs.igl - 60) * IGL_EDGE
  const edge = then - now
  const edgeWords = word ? (edge >= 0.5 ? '更强' : edge <= -0.5 ? '更弱' : '差不多') : `${signed(edge)} 回合强度`
  const coach = team.coach?.name
  return {
    q: `主教练${coach ? ` ${coach} ` : ''}把你叫到战术板前：「下一场开始，你来喊。」`,
    ctx: prev
      ? `现在喊的是 ${prev.ign}（指挥${w(prev.attrs.igl)} · 沟通${w(prev.attrs.communication)}）；你是指挥${w(p.attrs.igl)} · 沟通${w(p.attrs.communication)}。`
      : `队里现在没人真正在喊；你是指挥${w(p.attrs.igl)} · 沟通${w(p.attrs.communication)}。`,
    changes: [
      `全队按你的指挥来打：每个回合比${prev ? `${prev.ign} 喊的时候` : '没人喊的时候'}${edgeWords}。`,
      '复盘和每一张你喊过的图都会涨指挥。',
      '关键回合里，看协同、沟通的选项会加上你的指挥。',
      '喊的人要在场上：只要状态在，教练就把你放在首发里。',
      `俱乐部谈合同时，会把一个真正在喊的人的指挥算进去。`,
      `但接指挥以来 ${SKID_OF} 场只赢 ${SKID_WINS} 场以下、教练不再信你，或者你被换下场，他会把指挥收回去。`,
    ],
    take: prev ? `${prev.ign} 转为副指挥：你们的关系会掉，他心里未必服气。` : '队里没人要让位。',
    decline: prev ? `还是让 ${prev.ign} 喊` : '先不接',
    declineNote: prev ? `他会记得你让了一步；教练过 ${OFFER_GAP} 周才会再问。` : `教练过 ${OFFER_GAP} 周才会再问。`,
  }
}

/** Yes: I call from the next match, and the man calling now becomes my deputy. */
export function takeIgl(state: GameState): string[] {
  const me = state.me!
  pop(state, 'igl')
  const team = state.teams[state.myTeam]
  if (me.phase !== 'pro' || !team) return []
  const p = state.players[me.id]
  const b = iglBook(state)
  const prev = clubCaller(state)
  const lines: string[] = ['你是队里的主指挥了']
  if (prev) {
    // the manager game's appointIgl: a healthy starter stripped of the calling takes it personally
    if (prev.injuredUntil <= state.day && team.starters.includes(prev.id)) {
      prev.morale = clamp(prev.morale - 5, 0, 100)
      prev.grievance = clamp((prev.grievance ?? 0) + 6, 0, 100)
    }
    duoBonded(state, me.id, prev.id, DISPLACED_BOND)
    lines.push(`${prev.ign} 转为副指挥，和你的关系 ${DISPLACED_BOND}`)
  }
  p.isIgl = true
  p.iglSource = 'appointed'
  team.igl = me.id
  b.since = {
    year: state.year, day: state.day, week: me.week, prev: prev?.id,
    igl: p.attrs.igl, comm: p.attrs.communication, trust: Math.round(me.coachTrust), weeks: b.weeks,
    n: 0, w: 0,
  }
  b.lastYear = state.year
  state.news.push({ year: state.year, day: state.day, kind: 'club', important: true, text: `${p.ign} 出任 ${team.name} 主指挥${prev ? `，${prev.ign} 转为副指挥` : ''}。` })
  pushLog(state, 'good', `教练把指挥交给了你${prev ? `，${prev.ign} 转为副指挥` : ''}。从下一场起，全队按你的指挥来打。`)
  return lines
}

/** No: the man calling now keeps it, and remembers that I stepped back. */
export function declineIgl(state: GameState): string[] {
  const me = state.me!
  pop(state, 'igl')
  if (me.phase !== 'pro' || !state.myTeam) return []
  const b = iglBook(state)
  b.declines++
  const prev = clubCaller(state)
  if (prev) duoBonded(state, me.id, prev.id, DECLINE_BOND)
  pushLog(state, 'info', prev ? `你把指挥留给了 ${prev.ign}。教练说，想喊的时候他会再来问你。` : '你没接指挥。教练说，过一阵子再问你。')
  return prev ? [`指挥还是 ${prev.ign}`, `和 ${prev.ign} 的关系 +${DECLINE_BOND}`] : ['你没接指挥']
}

/** The coach takes the calls back: to the man I took them from if he is still here, else to whoever the club names. */
export function revokeIgl(state: GameState, why: string, notes?: string[]): void {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  const b = iglBook(state)
  p.isIgl = false
  p.iglSource = 'inferred'
  if (team) {
    const prev = b.since?.prev ? state.players[b.since.prev] : undefined
    team.igl = prev && prev.teamId === team.id && prev.isIgl ? prev.id : null
    ensureCaller(state, team.id)
  }
  b.since = undefined
  b.lastRevoke = me.week
  b.revokes++
  const next = team ? callerOf(state, team.id) : undefined
  const line = `教练把指挥收了回去：${why}。${next ? `${next.ign} 重新来喊。` : ''}`
  pushLog(state, 'bad', line)
  notes?.push(line)
}

/** Leaving a club leaves its calls behind; the club settles its own caller once I am off its roster. */
export function iglDrop(state: GameState, clubId: string | null | undefined): void {
  const me = state.me
  if (!me) return
  const p = state.players[me.id]
  if (!p?.isIgl || p.iglSource !== 'appointed') return
  p.isIgl = false
  p.iglSource = 'inferred'
  const team = clubId ? state.teams[clubId] : undefined
  if (team?.igl === me.id) team.igl = null
  if (me.igl) {
    me.igl.lastYear = state.year
    me.igl.since = undefined
  }
}

/** Every map I call teaches me to call. */
export function iglAfterMatch(state: GameState, rec: MeMatchRecord): void {
  if (!rec.started || rec.friendly || !myCall(state)) return
  // starts and wins since I took the calls, counted as they happen: a man can call for
  // longer than the detail reaches back (me/detail.ts)
  const since = state.me!.igl?.since
  if (since) {
    since.n = (since.n ?? 0) + 1
    if (rec.won) since.w = (since.w ?? 0) + 1
  }
  const p = state.players[state.me!.id]
  const room = clamp(((p.caps?.igl ?? 99) - p.attrs.igl) / 10, 0.25, 1.3)
  addXp(p, 'igl', CALL_XP * rec.maps * room)
}

/**
 * What a club reads into a caller when it signs him: a man who calls, or has
 * within CALLER_READ_YEARS, for at least CALLER_READ_WEEKS, is worth his 指挥
 * over CALLER_READ_FROM at CALLER_READ a point, up to CALLER_READ_MAX. On the
 * scale a signing is judged on (me/prepro.ts tryoutSkill), beside 综合.
 */
export function callerRead(state: GameState): number {
  const me = state.me
  if (!me?.igl || me.igl.calledWeeks < CALLER_READ_WEEKS) return 0
  const recent = myCall(state) || (me.igl.lastYear != null && state.year - me.igl.lastYear <= CALLER_READ_YEARS)
  if (!recent) return 0
  const p = state.players[me.id]
  return p ? clamp((p.attrs.igl - CALLER_READ_FROM) * CALLER_READ, 0, CALLER_READ_MAX) : 0
}
