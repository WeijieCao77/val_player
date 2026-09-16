/**
 * 指挥 and the room (decided 2026-09-14: 「让主角能当上指挥」「加大协同、沟通的影响」).
 *
 * 一 the career player is asked to call when every gate holds, and each gate on its own keeps the coach
 *    from asking; a career left on 快进 with a caller's numbers is appointed, and only in a week every gate
 *    held; the same career with a rookie's numbers is never asked
 * 二 a yes makes him the club's caller in the match engine and in the coach's five, the old caller a deputy
 *    with a worse bond (and a grievance if he was starting); the coach takes the calls back when his trust
 *    goes or after a run of defeats, and leaving the club leaves them. A no keeps the old caller, the lineup's
 *    指挥 term with him, and the coach does not ask again the next week
 * 三 the room: 协同 and 沟通 move a bond, form and the coach's eye inside the ranges reported with
 *    scripts/probe_igl.ts, at the career player's club only; between two players of the same level the coach
 *    starts the easier one, and a clearly better player is not passed over for it; a feud that stays past the
 *    line is said at most once every FEUD_GAP days, and at once again after it has been above the line; the
 *    same two do not argue again inside ARGUE_GAP days, and the defeat still costs their bond; and a pair the
 *    team screen calls 很铁 (engine/bonds.ts bondWord, BOND_TIGHT) neither argues over a defeat nor is who
 *    队内矛盾 comes for, while the row that does come to a head takes the pair under the line first
 * 四 快进 and 托管 stay expectation-neutral: autoChance is what it was, and a caller's call made on autopilot
 *    lands exactly as often as anyone's
 * 五 the new-career screen names the caller path and the room only where they are true
 * 六 托管's training follows the talent: a career keeps its talent and an older save reads it back off its
 *    ceilings; the week's pick follows the lean past 均衡型, 均衡型's plan is the role's to the point, and the
 *    talent's session adds one of its own practice in place of one other — never a session a live break counts
 * 七 how often the balanced duelist is in a 💢 line on 托管 over six seasons, on five seeds: ARGUE_GUARD —
 *    and never one with a team-mate the team screen called 很铁 that week, card of 队内矛盾 included
 *
 *    The band this replaces was 10–20 on the mean of three seeds, written as 「about twice the 7.7 before
 *    the room was live」. It measured one career. Over 16 seeds (scripts/probe_argue.ts) the count per
 *    career is 1 2 3 3 3 4 5 9 10 13 13 17 18 32 34 38: seven at or under 5, three at or over 32, and
 *    nothing at all between 18 and 32 — a heavy right tail with a detached upper cluster, median 9.5,
 *    mean 12.81. The three seeds 7/8/9 rode seed 8's 38 to a mean of 14.67 and passed; the five seeds
 *    below gave 9.00 in the world that wrote the band (28917bc) and 9.20 here.
 *
 *    No location statistic survives. The median is 9.5 here against 2 in that same world, so any band is
 *    calibrated to whichever world wrote it and breaks at the next data or me/auto.ts change. Nor is
 *    leave-one-out stability a property of the distribution: the median moves 2.50 at n=6 and n=8, 2.00
 *    at n=9, 0.50 at n=10, 1.50 at n=11, 0.50 at n=12, 1.50 at n=14, 0.50 at n=16 — stable only where the
 *    middle pair happens to miss a gap, so picking the n that scores well is fitting the sample. And a
 *    six-season career with no arguments at all is a real outcome (that world's seed 11 scored 0), so
 *    nothing here may require every seed to argue.
 *
 *    What is left is the honest limit: arguments have not been switched off, and have not become weekly.
 *    Re-derive with npx tsx scripts/probe_argue.ts before touching ARGUE_GUARD.
 *
 *   npx tsx scripts/check_igl.ts
 */
import { createCareer, emptyTalents, talentCeilings, talentShape, talentsOf, TALENT_PRESETS } from '../src/engine/me/career'
import { AUTO_PENALTY, KEY_FAIL, KEY_OK, NODE_CALL, autoChance, nodeCallEdge, nodeChance } from '../src/engine/me/nodes'
import {
  CALLER_READ_MAX, COMM_FLOOR, IGL_FLOOR, IGL_TRUST, IGL_TRUST_LOST, IGL_WEEKS, OFFER_GAP, SKID_OF,
  callerRead, clubCaller, declineIgl, iglBar, iglBlock, iglWeek, myCall, takeIgl,
} from '../src/engine/me/igl'
import { callerOf, squadOf } from '../src/engine/roster'
import { IGL_EDGE, activePool, buildLineup } from '../src/engine/match'
import { coachStarters, coachView } from '../src/engine/me/coach'
import { ROOM_EDGE_MAX, ROOM_FORM_MAX, roomBond, roomEdge, roomForm } from '../src/engine/me/room'
import { ARGUE_GAP, BOND_TIGHT, FEUD_GAP, applyMatchBonds, argueAt, bondBetween, bondWord, duoBonded, liveEase, lossMul, rateMul, restOf, weeklyBonds, winMul } from '../src/engine/bonds'
import { openChain, storyWeek } from '../src/engine/me/storyweek'
import { resolveEvent } from '../src/engine/me/events'
import { leaveClub } from '../src/engine/me/contract'
import { LEAN_FULL, autoPlan, autoWeek, duoMate, talentLean, talentPick, talentSessions } from '../src/engine/me/auto'
import type { Practice } from '../src/engine/me/auto'
import { chasing } from '../src/engine/me/bottleneck'
import { confidentRating } from '../src/engine/world'
import { Rng } from '../src/engine/rng'
import { recomputeOverall } from '../src/engine/player'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, GameState, MatchResult, Player, Region } from '../src/engine/types'

const mem: Record<string, string> = {}
;(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem[k] ?? null,
  setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] },
  clear: () => { for (const k of Object.keys(mem)) delete mem[k] },
  key: (i: number) => Object.keys(mem)[i] ?? null,
  get length() { return Object.keys(mem).length },
} as Storage
;(globalThis as unknown as { fetch: unknown }).fetch = () => Promise.reject(new Error('offline'))

let fails = 0
const fail = (m: string) => { fails++; console.log(`  ✗ ${m}`) }
const ok = (c: boolean, m: string) => { if (!c) fail(m) }
const t0 = Date.now()
const f2 = (v: number) => v.toFixed(2)

// one world, cloned for every case: building a world is the slow part
const base = createCareer({ name: 'Caller', region: 'EMEA', role: '控场', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7, year: 2026 })
if (base.me!.phase !== 'pro') throw new Error('a Challengers start should open at a club')
const fresh = (): GameState => structuredClone(base)
const pending = (s: GameState) => s.me!.pending.some((x) => x.kind === 'igl')

/** every gate held: in the five, a stage at the club, trusted, and a caller's 指挥 and 沟通 */
function ready(s: GameState): Player {
  const me = s.me!
  const p = s.players[me.id]
  const team = s.teams[s.myTeam]
  me.trial = undefined
  me.benchLock = undefined
  me.pending = []
  p.injuredUntil = 0
  me.coachTrust = 70
  me.igl = { club: s.myTeam, weeks: IGL_WEEKS, asked: 0, offers: 0, declines: 0, revokes: 0, calledWeeks: 0 }
  const bar = iglBar(s)
  p.attrs.igl = Math.max(p.attrs.igl, bar.igl)
  p.attrs.communication = Math.max(p.attrs.communication, bar.comm)
  if (!team.starters.includes(me.id)) {
    const out = team.starters.map((id) => s.players[id]).find((x) => x && !x.isIgl && x.role === p.role)
      ?? team.starters.map((id) => s.players[id]).find((x) => x && !x.isIgl)!
    team.starters = team.starters.map((id) => (id === out.id ? me.id : id))
  }
  return p
}

console.log('一、什么时候教练会让你来喊')
{
  const s = fresh()
  ready(s)
  ok(iglBlock(s) === null, `条件都满足，教练却不问：${iglBlock(s)}`)
  iglWeek(s, [])
  ok(pending(s), '条件都满足，这一周却没有弹出指挥邀请')
  ok(!myCall(s), '只是问了、还没答复，就已经是指挥了')
}
const breaks: [string, (s: GameState) => void][] = [
  ['在队里不满一个赛段', (s) => { s.me!.igl!.weeks = IGL_WEEKS - 2 }],
  ['教练信任不够', (s) => { s.me!.coachTrust = IGL_TRUST - 1 }],
  ['指挥不够', (s) => { s.players[s.me!.id].attrs.igl = iglBar(s).igl - 1 }],
  ['沟通不够', (s) => { s.players[s.me!.id].attrs.communication = iglBar(s).comm - 1 }],
  ['不在首发', (s) => {
    const t = s.teams[s.myTeam]
    const bench = t.roster.find((id) => !t.starters.includes(id) && id !== s.me!.id)
    t.starters = t.starters.map((id) => (id === s.me!.id ? bench ?? '' : id)).filter(Boolean)
  }],
  ['被换下场', (s) => { s.me!.benchLock = s.day + 7 }],
  ['在试用期', (s) => { s.me!.trial = { left: 2, displaced: '', forgiven: false } }],
  ['伤着', (s) => { s.players[s.me!.id].injuredUntil = s.day + 10 }],
  ['教练刚问过', (s) => { s.me!.igl!.lastOffer = s.me!.week }],
  ['指挥刚被收回', (s) => { s.me!.igl!.lastRevoke = s.me!.week }],
  ['这支队已经问满了', (s) => { s.me!.igl!.asked = 99 }],
]
for (const [what, brk] of breaks) {
  const s = fresh()
  ready(s)
  brk(s)
  iglWeek(s, [])
  ok(!pending(s) && !myCall(s), `${what}，教练还是来问了`)
  ok(!!iglBlock(s), `${what}，却说不出为什么不问`)
}
{
  // left on 快进 with a caller's numbers — and the line of the best man on the team, since the coach's trust
  // reads where a player's line sits: appointed, and only in a week every gate held
  const s = fresh()
  const p = s.players[s.me!.id]
  for (const k of Object.keys(p.attrs) as (keyof typeof p.attrs)[]) p.attrs[k] = 84
  p.caps = Object.fromEntries(Object.keys(p.attrs).map((k) => [k, 90])) as typeof p.attrs
  recomputeOverall(p)
  let appointed = 0
  let seen: unknown
  let after = 0
  for (let w = 0; w < 36 && s.me!.phase === 'pro' && after < 6; w++) {
    autoWeek(s)
    const since = s.me!.igl?.since
    if (since && since !== seen) {
      appointed++
      ok(since.weeks >= IGL_WEEKS && since.trust >= IGL_TRUST && since.igl >= IGL_FLOOR && since.comm >= COMM_FLOOR,
        `快进里接下指挥的那一周有条件没满足：${JSON.stringify(since)}`)
    }
    if (appointed) after++
    seen = since
  }
  ok(appointed >= 1, '指挥、沟通都 84，快进三十多周也没当上指挥')
  console.log(`  指挥、沟通 84 的快进生涯：${appointed ? `第 ${s.me!.igl?.since?.weeks ?? '?'} 周接下指挥` : '没当上'}`)
}
{
  // the same career with a rookie's numbers: never asked
  const s = fresh()
  const p = s.players[s.me!.id]
  p.attrs.igl = 55
  p.attrs.communication = 55
  p.caps = { ...p.caps!, igl: 55, communication: 55 }
  for (let w = 0; w < 20 && s.me!.phase === 'pro'; w++) autoWeek(s)
  ok((s.me!.igl?.offers ?? 0) === 0 && !myCall(s), `指挥、沟通只有 55，教练却问了 ${s.me!.igl?.offers} 次`)
}

console.log('二、接下、拒绝、收回')
{
  const s = fresh()
  const p = ready(s)
  p.attrs.igl = Math.max(p.attrs.igl, 80)
  const team = s.teams[s.myTeam]
  const prev = clubCaller(s)
  const bondBefore = prev ? bondBetween(s, s.me!.id, prev.id) : 0
  const grievanceBefore = prev?.grievance ?? 0
  const prevStarting = !!prev && team.starters.includes(prev.id) && prev.injuredUntil <= s.day
  iglWeek(s, [])
  takeIgl(s)
  ok(myCall(s) && callerOf(s, s.myTeam)?.id === s.me!.id && team.igl === s.me!.id, `接下之后喊的是 ${callerOf(s, s.myTeam)?.ign}`)
  ok(!pending(s), '接下之后邀请还挂着')
  if (prev) {
    ok(prev.isIgl, `${prev.ign} 让出指挥以后连副指挥都不是了`)
    ok(bondBetween(s, s.me!.id, prev.id) <= bondBefore - 7.9, `和让出指挥的 ${prev.ign} 关系没掉（${bondBefore} → ${bondBetween(s, s.me!.id, prev.id)}）`)
    if (prevStarting) ok((prev.grievance ?? 0) >= grievanceBefore + 5.9, `${prev.ign} 首发被拿走指挥，却没有怨气`)
  }
  team.starters = coachStarters(s)
  ok(team.starters.includes(s.me!.id), '指挥不在教练的首发名单里')
  const lu = buildLineup(s, s.myTeam, activePool(s.seed)[0])
  const want = (p.attrs.igl - 60) * IGL_EDGE
  ok(lu.players.some((x) => x.id === s.me!.id) && Math.abs(lu.edge.igl - want) < 1e-9, `比赛里指挥一项是 ${f2(lu.edge.igl)}，应是 ${f2(want)}`)
  ok(Math.abs(nodeCallEdge(s, 'teamwork') - (p.attrs.igl - 60) * NODE_CALL) < 1e-9 && Math.abs(nodeCallEdge(s, 'communication') - (p.attrs.igl - 60) * NODE_CALL) < 1e-9,
    '关键回合里协同、沟通选项没有加上指挥')
  ok(nodeCallEdge(s, 'aim') === 0 && nodeCallEdge(s, 'awareness') === 0, '关键回合里枪法、意识选项也加上了指挥')
  ok(callerRead(s) === 0, '刚接指挥，俱乐部就已经把指挥算进评价')
  s.me!.igl!.calledWeeks = 10
  ok(callerRead(s) > 0 && callerRead(s) <= CALLER_READ_MAX, `喊了十周，俱乐部读到的指挥是 ${callerRead(s)}`)

  // a run of defeats since taking the calls
  const t = structuredClone(s)
  const since = t.me!.igl!.since!
  for (let i = 0; i < SKID_OF; i++) t.me!.matches.push({ year: since.year, day: since.day + i, started: true, won: i === 0, friendly: false } as never)
  iglWeek(t, [])
  ok(!myCall(t), `接指挥以来 ${SKID_OF} 场只赢 1 场，指挥还在你手里`)

  // trust gone
  s.me!.coachTrust = IGL_TRUST_LOST - 1
  iglWeek(s, [])
  ok(!myCall(s) && !s.players[s.me!.id].isIgl, '教练信任掉到底，指挥还在你手里')
  if (prev && prev.teamId === s.myTeam) ok(callerOf(s, s.myTeam)?.id === prev.id, `收回指挥以后喊的是 ${callerOf(s, s.myTeam)?.ign}，不是 ${prev.ign}`)
  ok(!!iglBlock(s), '刚被收回指挥，教练马上又能来问')
}
{
  // leaving the club leaves the calls
  const s = fresh()
  ready(s)
  iglWeek(s, [])
  takeIgl(s)
  const club = s.myTeam
  leaveClub(s, '和你解约了')
  ok(!s.players[s.me!.id].isIgl && callerOf(s, club)?.id !== s.me!.id && s.teams[club].igl !== s.me!.id, '离队以后还挂着原来那支队的指挥')
}
{
  // a no keeps the caller
  const s = fresh()
  ready(s)
  const map = activePool(s.seed)[0]
  const callerBefore = callerOf(s, s.myTeam)?.id
  const namedBefore = s.teams[s.myTeam].igl
  const edgeBefore = buildLineup(s, s.myTeam, map).edge.igl
  iglWeek(s, [])
  declineIgl(s)
  ok(!myCall(s) && !s.players[s.me!.id].isIgl, '拒绝以后还是成了指挥')
  ok(callerOf(s, s.myTeam)?.id === callerBefore && s.teams[s.myTeam].igl === namedBefore, '拒绝以后队里换了人喊')
  ok(buildLineup(s, s.myTeam, map).edge.igl === edgeBefore, '拒绝以后比赛里的指挥一项变了')
  ok(!pending(s), '拒绝以后邀请还挂着')
  iglWeek(s, [])
  ok(!pending(s), `拒绝后的下一周教练又来问了（应等 ${OFFER_GAP} 周）`)
}

console.log('三、协同、沟通')
{
  const s = fresh()
  const p = s.players[s.me!.id]
  const mate = squadOf(s, s.myTeam).find((x) => x.id !== p.id)!
  ok(liveEase(s, p, mate) != null, '主角队里，协同、沟通对关系没有额外作用')
  const other = Object.values(s.players).find((x) => x.teamId && x.teamId !== s.myTeam && squadOf(s, x.teamId).length > 1)!
  const otherMate = squadOf(s, other.teamId!).find((x) => x.id !== other.id)!
  ok(liveEase(s, other, otherMate) === null, '别的队也吃到了主角队里的规则')
  ok(liveEase({ ...s, me: undefined } as GameState, p, mate) === null, '没有生涯主角的存档（经理模式）规则也变了')
  ok(winMul(null) === 1 && lossMul(null) === 1 && argueAt(null) === 0 && rateMul(null) === 1 && restOf(null) === 10, '规则之外的队伍，关系的涨落不再是原来的数')
  // a pair of a fresh 2+2 player (ease −10) and a Challengers regular (0), against an 8+8 one (+8)
  const lowPair = -10, highPair = 8
  ok(winMul(lowPair) < 1 && winMul(highPair) > 1, `赢球后的关系：${f2(winMul(lowPair))} / ${f2(winMul(highPair))}`)
  ok(lossMul(lowPair) > 1 && lossMul(highPair) < 1, `输球后的关系：${f2(lossMul(lowPair))} / ${f2(lossMul(highPair))}`)
  ok(argueAt(lowPair) > 0 && argueAt(highPair) < 0, `起争执的线：${f2(argueAt(lowPair))} / ${f2(argueAt(highPair))}`)
  ok(restOf(highPair) > restOf(lowPair) && rateMul(lowPair) > rateMul(highPair), '关系回落的去处和快慢没有跟着协同、沟通走')

  // 2+2 against 8+8 at the start of a career: 协同 and 沟通 58 against 76, half a year of weeks
  const setEase = (x: Player, v: number) => { x.attrs.teamwork = v; x.attrs.communication = v }
  const measure = (v: number) => {
    const t = fresh()
    const q = t.players[t.me!.id]
    setEase(q, v)
    t.bonds = {}
    const start = roomBond(t, q)
    const r = new Rng(20260914)
    for (let w = 0; w < 26; w++) weeklyBonds(t, r, [])
    return { start, after: roomBond(t, q), edge: roomEdge(t, q), form: roomForm(t, q), view: coachView(t, q) - coachView(t, q, false) }
  }
  const lo = measure(58)
  const hi = measure(76)
  const d = { start: hi.start - lo.start, after: hi.after - lo.after, edge: hi.edge - lo.edge, form: hi.form - lo.form }
  console.log(`  协同、沟通 58 → 76：开局关系 ${f2(lo.start)} → ${f2(hi.start)}（${f2(d.start)}），半年后 ${f2(lo.after)} → ${f2(hi.after)}（${f2(d.after)}）；状态 ${f2(lo.form)} → ${f2(hi.form)}（${f2(d.form)}）；教练眼里 ${f2(lo.edge)} → ${f2(hi.edge)}（${f2(d.edge)}）`)
  ok(d.start >= 2 && d.start <= 8, `开局关系差 ${f2(d.start)}，应在 2–8`)
  ok(d.after >= 4 && d.after <= 14, `半年后关系差 ${f2(d.after)}，应在 4–14`)
  ok(d.form >= 1.2 && d.form <= 3, `状态差 ${f2(d.form)}，应在 1.2–3`)
  ok(d.edge >= 1.6 && d.edge <= 3.2, `教练眼里差 ${f2(d.edge)}，应在 1.6–3.2`)
  ok(Math.abs(lo.view - lo.edge) < 1e-9 && Math.abs(hi.view - hi.edge) < 1e-9, '教练眼里的加减和化学反应一项对不上')
  for (const x of [lo, hi]) ok(Math.abs(x.edge) <= ROOM_EDGE_MAX && Math.abs(x.form) <= ROOM_FORM_MAX, '化学反应超出了上限')

  // between two of a level the coach starts the easier one; a clearly better one is not passed over
  const u = fresh()
  const me = u.me!
  const q = u.players[me.id]
  const rival = squadOf(u, u.myTeam).find((x) => x.id !== me.id && x.role === q.role && !x.isIgl)
  if (!rival) fail('这支队里没有同位置的队友可以比首发')
  else {
    me.proven = true
    me.coachTrust = 60
    q.contract = { ...q.contract!, promisedRole: 'rotation' }
    q.form = rival.form
    q.fatigue = rival.fatigue
    q.injuredUntil = 0
    rival.injuredUntil = 0
    const level = confidentRating(rival)
    const pick = (mine: number, his: number, gap: number) => {
      setEase(q, mine)
      setEase(rival, his)
      q.overall = level + gap
      u.bonds = {}
      const five = coachStarters(u)
      return { me: five.includes(me.id), him: five.includes(rival.id), plain: coachStarters(u, false) }
    }
    const a = pick(80, 55, 0)
    ok(a.me, '能力一样、你更好相处，教练却没用你')
    const b = pick(55, 80, 0)
    ok(b.him, `能力一样、${rival.ign} 更好相处，教练却没用他`)
    const c = pick(55, 80, 2 * ROOM_EDGE_MAX + 0.5)
    ok(c.me, `你比 ${rival.ign} 强 ${2 * ROOM_EDGE_MAX + 0.5}，只因为不好相处就被放上替补席`)
  }
}
{
  // 「关系还没缓和」: a pair held far past the line for a year is still said, never twice inside FEUD_GAP days
  const s = fresh()
  const [a, b] = squadOf(s, s.myTeam).filter((x) => x.id !== s.me!.id)
  const r = new Rng(20260915)
  const k = [a.id, b.id].sort().join('|')
  const said: number[] = []
  for (let w = 0; w < 52; w++) {
    duoBonded(s, a.id, b.id, -80 - bondBetween(s, a.id, b.id))
    const notes: string[] = []
    weeklyBonds(s, r, notes)
    if (notes.some((n) => n.includes('关系还没缓和') && n.includes(a.ign) && n.includes(b.ign))) said.push(s.year * 400 + s.day)
    s.day += 7
  }
  const gaps = said.slice(1).map((d, i) => d - said[i])
  console.log(`  一对关系 −80 的队友，一年里「关系还没缓和」说了 ${said.length} 次，间隔 ${gaps.join(' / ') || '-'} 天`)
  ok(said.length >= 2, `关系一直 −80，一年里只说了 ${said.length} 次「关系还没缓和」`)
  ok(gaps.every((g) => g >= FEUD_GAP), `「关系还没缓和」隔了不到 ${FEUD_GAP} 天又说：${gaps.join(' / ')}`)
  // back above the line: out of the book, so the next time it sinks is said at once
  duoBonded(s, a.id, b.id, 40 - bondBetween(s, a.id, b.id))
  weeklyBonds(s, r, [])
  ok(s.feudSaid?.[k] == null, '关系回到线上以后，这对队友还记在「刚说过」里')
  // no career player (the manager game): the old rule, and nothing written
  const m = { ...fresh(), me: undefined, feudSaid: undefined } as GameState
  const [c, d] = squadOf(m, m.myTeam)
  duoBonded(m, c.id, d.id, -80 - bondBetween(m, c.id, d.id))
  for (let w = 0; w < 8; w++) { weeklyBonds(m, r, []); m.day += 7 }
  ok(m.feudSaid === undefined, '没有生涯主角的存档也记下了「刚说过」')
}
{
  // an argument: the same two do not argue again inside ARGUE_GAP days, and the defeat still costs their bond
  const s = fresh()
  const [a, b] = squadOf(s, s.myTeam).filter((x) => x.id !== s.me!.id)
  const line = (kills: number, deaths: number) => ({ rounds: 24, kills, deaths, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0 })
  // a defeat one of them carried (rating about 1.7) and the other did not (about 0.2)
  const loss = { mapsWonA: 0, mapsWonB: 2, lineups: { a: [a.id, b.id], b: [] }, maps: [{ lines: { [a.id]: line(30, 10), [b.id]: line(4, 22) } }] } as unknown as MatchResult
  const r = new Rng(20260916)
  const argue = (t: GameState) => {
    duoBonded(t, a.id, b.id, -60 - bondBetween(t, a.id, b.id))
    const notes: string[] = []
    applyMatchBonds(t, loss, t.myTeam, true, r, notes)
    return { said: notes.some((n) => n.includes('赛后起了争执')), bond: bondBetween(t, a.id, b.id) }
  }
  const first = argue(s)
  const again = argue(s)
  s.day += ARGUE_GAP
  const later = argue(s)
  ok(first.said, '（检查本身）一个人扛着输了、关系 −60，赛后却没起争执')
  ok(!again.said, `同一天同一对队友又吵了一次（应隔 ${ARGUE_GAP} 天）`)
  ok(again.bond < -60, `隔得太近不再吵，这场输球却没伤到关系（${again.bond}）`)
  ok(later.said, `过了 ${ARGUE_GAP} 天，同样的输球却吵不起来了`)
  // no career player (the manager game): the old rule, and nothing written
  const m = { ...fresh(), me: undefined, argueSaid: undefined } as GameState
  ok(argue(m).said && argue(m).said && m.argueSaid === undefined, '没有生涯主角的存档，同一对队友的争执也被隔开了')
}
{
  // 很铁: the word on the team screen is the line the room reads (engine/bonds.ts bondWord)
  const s = fresh()
  const [a, b] = squadOf(s, s.myTeam).filter((x) => x.id !== s.me!.id)
  const line = (kills: number, deaths: number) => ({ rounds: 24, kills, deaths, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0 })
  const loss = { mapsWonA: 0, mapsWonB: 2, lineups: { a: [a.id, b.id], b: [] }, maps: [{ lines: { [a.id]: line(30, 10), [b.id]: line(4, 22) } }] } as unknown as MatchResult
  duoBonded(s, a.id, b.id, BOND_TIGHT + 15 - bondBetween(s, a.id, b.id))
  const before = bondBetween(s, a.id, b.id)
  const notes: string[] = []
  applyMatchBonds(s, loss, s.myTeam, true, new Rng(20260916), notes)
  const after = bondBetween(s, a.id, b.id)
  ok(bondWord(before) === '很铁', `（检查本身）关系 ${f2(before)} 在队伍界面上不写作「很铁」`)
  ok(!notes.some((n) => n.includes('赛后起了争执')), `队伍界面写着「很铁」的一对（${f2(before)}），一场有人扛有人没扛的败仗就吵起来了`)
  ok(after < before - 5, `「很铁」的一对输了这场球，关系只掉了 ${f2(before - after)}`)
  console.log(`  「很铁」的一对（${f2(before)}）输掉一场一个人扛的比赛：没起争执，关系掉到 ${f2(after)}`)

  // 队内矛盾 does not come for a team-mate the screen calls 很铁
  const t = fresh()
  const me = t.me!
  const mates = squadOf(t, t.myTeam).filter((x) => x.id !== me.id)
  for (const x of mates) duoBonded(t, me.id, x.id, BOND_TIGHT + 10 - bondBetween(t, me.id, x.id))
  ok(!openChain(t, 'rift', new Rng(7)), '全队都「很铁」，「队内矛盾」还是找上了其中一个')
  const cold = mates[mates.length - 1]
  duoBonded(t, me.id, cold.id, 5 - bondBetween(t, me.id, cold.id))
  const opened = openChain(t, 'rift', new Rng(7))
  ok(opened && me.chain?.mate === cold.id,
    `「队内矛盾」没有找关系最淡的 ${cold.ign}：${me.chain?.mate ? t.players[me.chain.mate].ign : '一张卡都没开'}`)
  // the weeks between the cards warmed them back up, and the task went undone: the row itself takes them under the line
  resolveEvent(t, 'ch_rift_open', 0)
  duoBonded(t, me.id, cold.id, BOND_TIGHT + 10 - bondBetween(t, me.id, cold.id))
  me.chain!.due = me.week
  me.chain!.got = 0
  me.weekNotes = []
  storyWeek(t)
  const card = me.pendingEvent
  const now = bondBetween(t, me.id, cold.id)
  ok(card === 'ch_rift_boil', `矛盾没解决，弹出来的却是「${card ?? '没有卡'}」`)
  ok(now < BOND_TIGHT, `「队内矛盾」闹大了，和 ${cold.ign} 的关系还写作「${bondWord(now)}」（${f2(now)}）`)
  ok(me.weekNotes.some((n) => n.includes(cold.ign) && n.includes('关系')), '矛盾闹大了，这一周却没有一行说关系掉了')
  console.log(`  矛盾闹大的那一张（${card}）：和 ${cold.ign} 的关系从 ${f2(BOND_TIGHT + 10)} 掉到 ${f2(now)}，写作「${bondWord(now)}」`)
}

console.log('四、快进和托管仍然期望中性')
{
  ok(AUTO_PENALTY === 0.1 && KEY_OK === 2.4 && KEY_FAIL === 1.8, `快进的常数变了：${AUTO_PENALTY} ${KEY_OK} ${KEY_FAIL}`)
  let bad = 0
  for (const decides of [false, true]) {
    for (let m = 0.05; m <= 0.951; m += 0.05) {
      for (let b = 0.2; b <= 0.801; b += 0.1) {
        const neutral = decides ? b : KEY_FAIL / (KEY_OK + KEY_FAIL)
        const want = Math.min(0.97, Math.max(0.03, Math.min(m - AUTO_PENALTY, neutral)))
        if (Math.abs(autoChance(m, b, decides) - want) > 1e-12) bad++
      }
    }
  }
  ok(bad === 0, `autoChance 有 ${bad} 格和原来的规则不一样`)
  const s = fresh()
  const p = ready(s)
  p.attrs.igl = 85
  iglWeek(s, [])
  takeIgl(s)
  const neutral = KEY_FAIL / (KEY_OK + KEY_FAIL)
  for (const dim of ['teamwork', 'communication'] as const) {
    const opt = { t: '', dim, risk: 0.5 } as never
    const called = nodeChance(s, opt)
    p.iglSource = 'inferred'
    const plain = nodeChance(s, opt)
    p.iglSource = 'appointed'
    ok(called > plain, `当上指挥以后，${dim} 选项的成功率没变（${f2(called)} / ${f2(plain)}）`)
    for (const b of [0.3, 0.5, 0.7]) {
      const a = autoChance(called, b, false)
      if (plain - AUTO_PENALTY >= neutral) ok(a === autoChance(plain, b, false), `快进替指挥做的 ${dim} 决定比替别人做的更容易成`)
      ok(a <= neutral + 1e-12 && a * KEY_OK - (1 - a) * KEY_FAIL <= 1e-9, `快进替指挥做的 ${dim} 决定期望为正（成功率 ${f2(a)}）`)
    }
  }
}

console.log('五、天赋页说的话')
{
  const line = (k: string) => talentShape(TALENT_PRESETS.find((x) => x.key === k)!.t)!.line
  ok(line('igl').includes('主指挥'), `指挥型没有说到主指挥：${line('igl')}`)
  for (const k of ['gun', 'util', 'clutch', 'even']) ok(!line(k).includes('主指挥'), `${k} 也说能当主指挥：${line(k)}`)
  const lonely = talentShape({ aim: 8, reaction: 8, awareness: 4, utility: 0, clutch: 0, teamwork: 0, communication: 0, igl: 0 })!.line
  ok(lonely.includes('关系掉得快'), `协同、沟通一点没点，却没说关系的事：${lonely}`)
  const social = talentShape({ aim: 1, reaction: 1, awareness: 1, utility: 1, clutch: 0, teamwork: 8, communication: 8, igl: 0 })!.line
  ok(social.includes('关系稳'), `协同、沟通 8+8，却没说关系的事：${social}`)
  ok(!line('even').includes('关系'), `均衡型也在说关系：${line('even')}`)
}

console.log('六、托管的训练跟着天赋走')
const IGL_T = { ...TALENT_PRESETS.find((x) => x.key === 'igl')!.t }
const same = (x: Record<keyof Attrs, number> | undefined, y: Record<keyof Attrs, number>) => !!x && ATTR_KEYS.every((k) => x[k] === y[k])
/** a clone with room under every ceiling, so each attribute can be picked */
function roomy(t: Record<keyof Attrs, number>): GameState {
  const s = fresh()
  const p = s.players[s.me!.id]
  for (const k of ATTR_KEYS) p.caps![k] = Math.max(p.caps![k], p.attrs[k] + 10)
  s.me!.talents = { ...t }
  return s
}
{
  // a career keeps its talent; a save without it reads it back off ceilings that nothing has opened yet
  const s = fresh()
  ok(same(s.me!.talents, emptyTalents()), `新生涯没有记下天赋：${JSON.stringify(s.me!.talents)}`)
  const p = s.players[s.me!.id]
  const caps = talentCeilings(p.role, IGL_T, s.me!.originKey)
  for (const k of ATTR_KEYS) p.caps![k] = Math.max(caps[k], p.attrs[k])
  s.me!.talents = undefined
  s.me!.bottleneck = { ...s.me!.bottleneck!, mech: {}, mile: {}, exp: 0 }
  const back = talentsOf(s)
  ok(same(back, IGL_T) && same(s.me!.talents, IGL_T), `老存档从上限读回的天赋是 ${JSON.stringify(back)}，应是 ${JSON.stringify(IGL_T)}`)
}
{
  // the pick: 均衡型 never; a preset every week, split as its lean past 均衡型; a point off 均衡型 one week in LEAN_FULL
  const WEEKS = 240
  const picks = (t: Record<keyof Attrs, number>) => {
    const s = roomy(t)
    const n: Record<string, number> = {}
    for (let w = 0; w < WEEKS; w++) {
      s.me!.week = w
      const k = talentPick(s) ?? 'none'
      n[k] = (n[k] ?? 0) + 1
    }
    return n
  }
  const even = picks(emptyTalents())
  ok(even.none === WEEKS, `均衡型也排了天赋那一节：${JSON.stringify(even)}`)
  const lean = talentLean(IGL_T)
  const leanSum = ATTR_KEYS.reduce((a, k) => a + lean[k], 0)
  const igl = picks(IGL_T)
  console.log(`  指挥型（比均衡型多 ${leanSum} 点）${WEEKS} 周的天赋那一节：${JSON.stringify(igl)}`)
  ok(!igl.none && leanSum >= LEAN_FULL, `指挥型有 ${igl.none} 周没排天赋那一节`)
  for (const k of ATTR_KEYS) {
    const want = lean[k] / leanSum
    ok(Math.abs((igl[k] ?? 0) / WEEKS - want) <= 0.03, `指挥型的 ${k} 排了 ${igl[k] ?? 0} 周，应约 ${(want * WEEKS).toFixed(0)} 周`)
  }
  const one = picks({ ...emptyTalents(), aim: 4, igl: 1 })
  ok(Math.abs((one.aim ?? 0) / WEEKS - 1 / LEAN_FULL) <= 0.03 && (one.aim ?? 0) + (one.none ?? 0) === WEEKS,
    `比均衡型多 1 点枪法，天赋那一节排了 ${one.aim ?? 0} 周，应约 ${(WEEKS / LEAN_FULL).toFixed(0)} 周`)
}
{
  const s = roomy(IGL_T)
  const me = s.me!
  let callWeek = -1, commWeek = -1
  for (let w = 0; w < 60; w++) {
    me.week = w
    const k = talentPick(s)
    if (k === 'igl' && callWeek < 0) callWeek = w
    if (k === 'communication' && commWeek < 0) commWeek = w
  }
  const role: Practice[] = ['util', 'vod', 'aim']
  const changed = (x: Practice[]) => x.filter((v, i) => v !== role[i]).length
  me.week = callWeek
  const call = talentSessions(s, role)
  ok(changed(call) === 1 && call.filter((v) => v === 'vod').length === 2, `指挥那一周的三节是 ${call.join('、')}，应多一节复盘、只换一节`)
  me.week = commWeek
  const comm = talentSessions(s, role)
  ok(changed(comm) === 1 && comm.includes('duo'), `沟通那一周的三节是 ${comm.join('、')}，应有一节双排、只换一节`)
  // the plan itself: 沟通's week goes to 双排 with the team-mate I get on worst with
  const t = structuredClone(s)
  t.me!.plan = {}
  t.me!.ap = t.me!.apMax
  t.players[t.me!.id].fatigue = 0
  autoPlan(t)
  ok((t.me!.plan.duo ?? 0) >= 1 && t.me!.duoWith === duoMate(t)?.id, `沟通那一周托管没有排和关系最差的队友双排：${JSON.stringify(t.me!.plan)} · ${t.me!.duoWith}`)
  // a session a live break counts never makes room: 枪法 at its ceiling keeps its 枪法训练
  const u = structuredClone(s)
  const q = u.players[u.me!.id]
  q.attrs.aim = q.caps!.aim
  u.me!.week = callWeek
  ok(chasing(u, 'aim'), '（检查本身）枪法顶到上限却没在冲瓶颈')
  ok(talentSessions(u, role).includes('aim'), `枪法正在冲瓶颈，天赋那一节却把枪法训练换掉了：${talentSessions(u, role).join('、')}`)
  // 均衡型: the week's plan is the role's, to the point
  const e1 = fresh()
  const e2 = structuredClone(e1)
  autoPlan(e1)
  autoPlan(e2, false)
  ok(JSON.stringify(e1.me!.plan) === JSON.stringify(e2.me!.plan), `均衡型托管的一周和原来不一样：${JSON.stringify(e1.me!.plan)} / ${JSON.stringify(e2.me!.plan)}`)
}

console.log('七、均衡型决斗者托管六个赛季的争执，以及闹矛盾的都不是「很铁」的队友')
{
  // a guard, not a rate: the count per career runs 1 to 38 and its median moves with the world, so this
  // only catches 争执 being switched off or becoming weekly (see the header, and scripts/probe_argue.ts)
  const ARGUE_GUARD = [1, 40]
  const SEEDS = [7, 8, 9, 11, 12]
  // the regions scripts/probe_argue.ts starts these seeds in
  const REGION_OF: Record<number, Region> = { 7: 'Americas', 8: 'Pacific', 9: 'EMEA', 11: 'Americas', 12: 'Pacific' }
  // the cards of 队内矛盾 that are a row rather than a thaw (me/events_more.ts)
  const ROWS = ['ch_rift_open', 'ch_rift_boil', 'ch_rift_bad']
  const per: string[] = []
  let total = 0
  let tight = 0
  const tightSaid: string[] = []
  for (const seed of SEEDS) {
    const s = createCareer({ name: `P${seed}`, region: REGION_OF[seed], role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2026 })
    const me = s.me!
    const p = s.players[me.id]
    let weeks = 0, argues = 0, feuds = 0, all = 0
    // as scripts/probe_igl.ts counts them: the 💢 lines of a professional week that name me
    while (s.year < 2032 && me.phase !== 'retired' && weeks < 360) {
      // what the team screen said about each of them when the week began (engine/bonds.ts bondWord)
      const seen: Record<string, number> = {}
      if (me.phase === 'pro' && s.myTeam) for (const x of squadOf(s, s.myTeam)) if (x.id !== me.id) seen[x.ign] = bondBetween(s, me.id, x.id)
      const stop = autoWeek(s)
      weeks++
      if (me.phase === 'pro' && s.myTeam) {
        const mine = me.weekNotes.filter((n) => n.includes('💢') && n.includes(p.ign))
        all += mine.length
        argues += mine.filter((n) => n.includes('赛后起了争执')).length
        feuds += mine.filter((n) => n.includes('关系还没缓和')).length
        for (const n of mine) {
          const m = n.match(/^💢 (.+?) [和与] (.+?) (在赛后起了争执|的关系还没缓和)/)
          const other = m ? (m[1] === p.ign ? m[2] : m[1]) : ''
          if (seen[other] != null && seen[other] >= BOND_TIGHT) {
            tight++
            tightSaid.push(`种子 ${seed}：${n.slice(0, 34)}…（周初 ${seen[other].toFixed(0)}）`)
          }
        }
        // and the card of a row that is on screen now names a man the screen does not call 很铁 either
        const card = me.pendingEvent
        const mate = me.chain?.mate
        const bond = mate ? bondBetween(s, me.id, mate) : 0
        if (card && ROWS.includes(card) && mate && bond >= BOND_TIGHT) {
          tight++
          tightSaid.push(`种子 ${seed}：${card} 找上了 ${s.players[mate]?.ign}（${bond.toFixed(0)}）`)
        }
      }
      if (stop.kind === 'game-over') break
    }
    per.push(`种子 ${seed}：${all}（赛后争执 ${argues} · 还没缓和 ${feuds}）`)
    total += all
  }
  const avg = total / SEEDS.length
  console.log(`  ${per.join('；')}；平均 ${avg.toFixed(1)}；其中队伍界面写着「很铁」的 ${tight} 次`)
  ok(avg >= ARGUE_GUARD[0] && avg <= ARGUE_GUARD[1], `均衡型决斗者六个赛季平均 ${avg.toFixed(1)} 条 💢，应在 ${ARGUE_GUARD[0]}–${ARGUE_GUARD[1]}（这一条只防争执被关掉、或者变成每周都吵，不是速率）`)
  ok(tight === 0, `和队伍界面写着「很铁」的队友闹了 ${tight} 次：${tightSaid.slice(0, 3).join('；')}`)
}

const secs = ((Date.now() - t0) / 1000).toFixed(0)
console.log(fails ? `\n✗ ${fails} 项不对 · ${secs}s` : `\n✓ 条件满足才会被任命、拒绝留住原指挥、收回和离队都对，协同、沟通的作用在范围内且只在主角队里，同一对队友的争执和「关系还没缓和」不再反复说，快进和托管仍然期望中性，托管的训练跟着天赋走，均衡型决斗者的争执在目标范围里，天赋页只说真的 · ${secs}s`)
process.exit(fails ? 1 : 0)
