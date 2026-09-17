/**
 * 合同承诺是三场保底，不是一辈子的位置 (decided 2026-09-17):
 *   「允许承诺打破，比如签的首发合同那就先稳定首发三场保底，后面如果竞争不行，那就去替补，
 *     替补也是同理，替补合同也是先稳定替补三场，后面竞争」
 *
 * Until now a starting promise seated the career player for as long as it was
 * written: 99.4% of his weeks at a club his place was not the coach's to decide
 * (scripts/probe_room.ts, me/room.ts), so nothing the dressing room or his own
 * form did could ever reach it. The promise is now a floor of PROMISE_FLOOR
 * matches per spell, both ways round:
 *
 *  - signed as 首发 / 核心: the first PROMISE_FLOOR official matches of the spell
 *    he starts, whatever the coach makes of him; from the next one the five is
 *    the coach's own reading and the place can be lost
 *  - signed as 替补 / 轮换: the first PROMISE_FLOOR he is a substitute, and no
 *    trial begins inside them; from the next one he can win a start
 *  - the floor counts matches the club actually played, whether he was on the
 *    floor or on the bench; a cup or exhibition is not one of them
 *  - a club that cannot field five without him plays him, floor or no floor
 *  - a save from before the counter starts with the floor already spent
 *  - and the game says all of it in words (standingLine, the week's log)
 *
 *   npx tsx scripts/check_promise.ts
 */
import { Rng } from '../src/engine/rng'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { CareerOpts } from '../src/engine/me/career'
import {
  EDGE_NEED, PROMISE_FLOOR, afterMyMatch, coachStarters, promiseFloorLeft, promiseHolds,
  promiseSeat, runDuel, standingLine, weeklyLineup,
} from '../src/engine/me/coach'
import { duelBlock } from '../src/engine/me/duel'
import { ROLES } from '../src/engine/types'
import type { GameState, Role, SquadRole } from '../src/engine/types'
import type { MeMatchRecord } from '../src/engine/me/types'

const mem: Record<string, string> = {}
const G = globalThis as unknown as { localStorage: unknown; fetch: unknown }
G.localStorage = {
  getItem: (k: string) => mem[k] ?? null, setItem: (k: string, v: string) => { mem[k] = String(v) },
  removeItem: (k: string) => { delete mem[k] }, clear: () => {}, key: () => null, length: 0,
}
G.fetch = () => Promise.reject(new Error('offline'))

let bad = 0
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? '✓' : '✗'} ${what}`)
  if (!ok) bad++
}

const CORE = ROLES.filter((r) => r !== '自由人') as Role[]

/**
 * A club where the coach's five is exactly the best five by his own reading, so
 * the floor is the only thing that can move anybody: everyone covers every job
 * (no job forces a man in), nobody calls (no caller is swapped in), nobody is
 * hurt, and form and condition are level. `mine` is my 综合, `theirs` everyone
 * else's — so I am plainly the worst of the squad, or plainly the best.
 */
function bench(seed: number, promised: SquadRole, mine: number, theirs = 70, squadSize = 6): GameState {
  const s = createCareer({
    name: 'Promise', region: 'EMEA', role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', start: 't1', year: 2026, seed,
  } as CareerOpts)
  const me = s.me!
  const team = s.teams[s.myTeam]
  // exactly `squadSize` on the books, me included
  for (const id of team.roster.slice(squadSize)) s.players[id].teamId = null
  team.roster = team.roster.slice(0, squadSize)
  if (!team.roster.includes(me.id)) { team.roster[squadSize - 1] = me.id; s.players[me.id].teamId = team.id }
  for (const id of team.roster) {
    const q = s.players[id]
    q.role = '决斗者'
    q.roles = CORE.slice()
    q.isIgl = false
    q.iglSource = undefined
    q.injuredUntil = 0
    q.form = 70
    q.fatigue = 0
    q.rounds = 5000
    q.overall = id === me.id ? mine : theirs
  }
  me.proven = false
  me.trial = undefined
  me.benchLock = undefined
  me.badStreak = 0
  me.rotateHeat = 0
  me.startsHere = 0
  me.graceMatches = 0
  me.coachTrust = 60
  me.edge = 0
  me.promiseMatches = 0
  me.flags.promiseLost = 0
  me.flags.promiseWon = 0
  s.players[me.id].contract!.promisedRole = promised
  team.starters = coachStarters(s)
  return s
}

const starts = (s: GameState) => coachStarters(s).includes(s.me!.id)

let fx = 0
const rec = (s: GameState, o: Partial<MeMatchRecord> = {}): MeMatchRecord => ({
  fixtureId: `promise-${fx++}`, day: s.day, year: s.year, comp: 'probe', label: '', opp: 'Probe', oppTag: 'PRB',
  started: true, won: true, score: '2-0', maps: 2, rounds: 44, kills: 30, deaths: 28, assists: 10,
  firstKills: 3, clutches: 1, acs: 200, rating: 1, mvp: false, carried: false, nodes: [], rank: 3,
  ...o,
})
/** one match the club played, with me on the floor or on the bench as the coach named it */
const play = (s: GameState, o: Partial<MeMatchRecord> = {}) => {
  s.day++
  const started = starts(s)
  afterMyMatch(s, rec(s, { started, rank: started ? 3 : 0, ...o }))
  s.teams[s.myTeam].starters = coachStarters(s)
}

console.log(`签的是首发合同，打不过也先打满 ${PROMISE_FLOOR} 场`)
{
  // plainly the worst man at the club: only the contract can be seating him
  const s = bench(5, 'starter', 35)
  const me = s.me!
  let held = 0
  for (let i = 0; i < PROMISE_FLOOR; i++) {
    if (starts(s)) held++
    check(promiseSeat(s) === 'start' && promiseFloorLeft(s) === PROMISE_FLOOR - i, `第 ${i + 1} 场前：合同还压着，剩 ${promiseFloorLeft(s)} 场`)
    play(s)
  }
  check(held === PROMISE_FLOOR, `综合 35 对 70，前 ${PROMISE_FLOOR} 场场场首发：${held}`)
  check(me.promiseMatches === PROMISE_FLOOR, `保底按俱乐部打的场次数：${me.promiseMatches}`)
  check(promiseFloorLeft(s) === 0 && promiseSeat(s) === null && !promiseHolds(s), '第四场起合同不再说了算')
  check(!starts(s), '第四场：教练按自己的读数排人，全队最差的你回到替补席')
  check(me.log.some((l) => l.text.includes('保底')), `保底打完当场说了一句：「${me.log.filter((l) => l.text.includes('保底')).slice(-1)[0]?.text}」`)
}

console.log('同一份首发合同，打得过就还是首发')
{
  const s = bench(5, 'starter', 95)
  for (let i = 0; i < PROMISE_FLOOR + 3; i++) play(s)
  check(promiseFloorLeft(s) === 0, '保底已经打完')
  check(starts(s), '综合 95 对 70：保底过了照样在首发里 —— 保底之后两边都可能')
}

console.log(`签的是替补合同，打得过也先坐满 ${PROMISE_FLOOR} 场`)
{
  // plainly the best man at the club: only the contract can be keeping him out
  const s = bench(9, 'bench', 95)
  const me = s.me!
  let sat = 0
  for (let i = 0; i < PROMISE_FLOOR; i++) {
    if (!starts(s)) sat++
    check(promiseSeat(s) === 'bench', `第 ${i + 1} 场前：合同把你按在替补席，剩 ${promiseFloorLeft(s)} 场`)
    play(s)
  }
  check(sat === PROMISE_FLOOR, `综合 95 对 70，前 ${PROMISE_FLOOR} 场场场替补：${sat}`)
  check(coachStarters(s).length === 5, '被按住的这几场，首发还是五个人')
  check(promiseFloorLeft(s) === 0 && promiseSeat(s) === null, `第 ${PROMISE_FLOOR + 1} 场起合同不再说了算`)
  check(starts(s), `第 ${PROMISE_FLOOR + 1} 场：教练按自己的读数排人，全队最好的你进了首发`)
  check(me.log.some((l) => l.text.includes('保底')), '替补保底坐完也说了一句')
}

console.log('同一份替补合同，打不过就还坐着')
{
  const s = bench(9, 'bench', 35)
  for (let i = 0; i < PROMISE_FLOOR + 3; i++) play(s)
  check(promiseFloorLeft(s) === 0 && !starts(s), '综合 35 对 70：保底过了也进不了首发 —— 保底之后两边都可能')
}

console.log('轮换合同两边都不保：位置从第一场起就归教练')
{
  // 轮换 is what a contract says when it promises nothing about selection — the
  // value scripts/check_igl.ts uses to read the coach's eye with the contract out
  // of the way. It must not seat him, and it must not bench him.
  const good = bench(13, 'rotation', 95)
  check(promiseSeat(good) === null && !promiseHolds(good), '一份轮换合同不压位置')
  check(starts(good), '综合 95 对 70：第一场就在首发里，合同不会把你按回替补席')
  const poor = bench(13, 'rotation', 35)
  check(!starts(poor), '综合 35 对 70：第一场就不在首发里，合同也不会把你抬进去')
}

console.log('保底就是 PROMISE_FLOOR 场，不多不少')
{
  const s = bench(21, 'starter', 35)
  const me = s.me!
  me.promiseMatches = PROMISE_FLOOR - 1
  check(starts(s), `已经打了 ${PROMISE_FLOOR - 1} 场：还在首发`)
  me.promiseMatches = PROMISE_FLOOR
  s.teams[s.myTeam].starters = coachStarters(s)
  check(!starts(s), `打满 ${PROMISE_FLOOR} 场：位置就要自己守了`)

  const b = bench(21, 'bench', 95)
  b.me!.promiseMatches = PROMISE_FLOOR - 1
  check(!starts(b), `替补一侧同理：${PROMISE_FLOOR - 1} 场时还坐着`)
  b.me!.promiseMatches = PROMISE_FLOOR
  check(starts(b), `替补一侧同理：${PROMISE_FLOOR} 场打完就能争`)
}

console.log('保底数的是俱乐部打的比赛，不是周数')
{
  const s = bench(33, 'starter', 35)
  const me = s.me!
  afterMyMatch(s, rec(s, { started: false, rank: 0 }))
  check(me.promiseMatches === 1, '你在替补席上看完的一场，也是俱乐部打的一场')
  afterMyMatch(s, rec(s, { friendly: true }))
  check(me.promiseMatches === 1, '杯赛、表演赛不算')
  const week0 = me.promiseMatches
  s.day += 21
  check(me.promiseMatches === week0, '三周过去、一场没打：保底一场没少')
}

console.log('队里凑不出五个人的时候，替补保底让路')
{
  const s = bench(41, 'bench', 95, 70, 6)
  const team = s.teams[s.myTeam]
  const other = team.roster.find((id) => id !== s.me!.id)!
  s.players[other].injuredUntil = s.day + 30
  const five = coachStarters(s)
  check(five.length === 5, `六个人伤了一个：首发还是五个人（${five.length}）`)
  check(five.includes(s.me!.id), '没有第六个健康的人可换，合同让路，你上')
}

console.log('替补保底没打完，试用期不开始')
{
  const s = bench(55, 'bench', 35)
  const me = s.me!
  check(!starts(s), '先确认你在替补席上')
  check(!!duelBlock(s) && /保底|替补/.test(duelBlock(s)!), `对位挑战说得清楚：「${duelBlock(s)}」`)
  for (let i = 0; i < 6; i++) { me.edge = EDGE_NEED + 1; me.duelsThisWeek = 0; runDuel(s, new Rng(100 + i)) }
  check(!me.trial, '保底没过：资本攒够了也开不了试用期')
  me.promiseMatches = PROMISE_FLOOR
  me.duelsThisWeek = 0
  check(!duelBlock(s), `保底过了：对位挑战可以打（${duelBlock(s) ?? '没有拦住'}）`)
  me.edge = EDGE_NEED + 1
  me.duelsThisWeek = 0
  runDuel(s, new Rng(7))
  check(!!me.trial, '保底过了：资本攒够就给试用期')
}

console.log('老存档：没有计数的合同，保底当作已经打完')
{
  const s = bench(67, 'starter', 35)
  const me = s.me!
  delete me.promiseMatches
  check(promiseFloorLeft(s) === 0 && !promiseHolds(s), '首发合同的老存档：位置立刻归教练管')
  check(!starts(s), '全队最差：这一周就回替补席')

  const b = bench(67, 'bench', 95)
  delete b.me!.promiseMatches
  check(starts(b), '替补合同的老存档：不会平白把正在首发的人按回替补席')
  b.me!.promiseMatches = (b.me!.promiseMatches ?? PROMISE_FLOOR) + 1
  check(b.me!.promiseMatches === PROMISE_FLOOR + 1, '再打一场，计数从「已经打完」往上走，不会倒回去')
}

console.log('这些话说给人听')
{
  const s = bench(77, 'starter', 35)
  const week = standingLine(s, 'week')
  const team = standingLine(s, 'team')
  check(week.includes(String(PROMISE_FLOOR)) && /保底|写死|承诺/.test(week), `首发保底期，本周页：「${week}」`)
  check(week === team, '本周页和队伍页说的是同一句')

  const b = bench(77, 'bench', 95)
  const bl = standingLine(b, 'week')
  check(bl.includes(String(PROMISE_FLOOR)) && /替补/.test(bl), `替补保底期，本周页：「${bl}」`)

  // the place actually changing hands, in the week's own words
  // the floor spent, but the five still last week's: this is the week it moves
  const s2 = bench(79, 'starter', 35)
  for (let i = 0; i < PROMISE_FLOOR; i++) { s2.day++; afterMyMatch(s2, rec(s2, { started: true, rank: 3 })) }
  check(s2.teams[s2.myTeam].starters.includes(s2.me!.id), '保底的三场里你一直在首发名单上')
  const before = s2.me!.log.length
  weeklyLineup(s2)
  const said = s2.me!.log.slice(before).map((l) => l.text)
  check(!s2.me!.lastLineupIn, '保底过了，这一周教练没排你')
  check(said.some((x) => x.includes('替补席')), `掉出首发当周说了出来：「${said.join(' / ')}」`)
  check(said.some((x) => /合同|保底/.test(x)), '而且说清楚了为什么：合同写的那几场已经过去了')
  const again = s2.me!.log.length
  s2.teams[s2.myTeam].starters = [s2.me!.id, ...s2.teams[s2.myTeam].starters.filter((id) => id !== s2.me!.id).slice(0, 4)]
  weeklyLineup(s2)
  check(!s2.me!.log.slice(again).some((x) => /合同写的|保底/.test(x.text)), '这句只说一次，不是每周复读')
}

if (bad) {
  console.log(`\n${bad} 项没过`)
  process.exit(1)
}
console.log('\n全部通过')
