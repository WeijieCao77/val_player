/**
 * 点一下就执行. The author, 2026-09-19: 「玩家们表示都不喜欢每周的行动点了之后不执行要等点下一周才会
 * 统一执行这个方式，希望改成破晓那样点击就直接执行。」 (me/week.ts doAction, me/growth.ts runAction).
 *
 *  一 every card lands inside its own click: the attribute, the ladder, the money, the body and the line
 *    that says so all move before anything is advanced, and the week is not settled by it
 *  二 the guards in front of the click are the ones that were there: the points, the ≤0 stamina block,
 *    the greyed reason, 没有队伍 on the club's three, and 对位挑战 only through its own button
 *  二之二 a match of mine still to come this week is said over the cards, and only when it is true:
 *    a starter with one left this week, never a substitute, never a week already played out
 *  二之三 a card's 「−」 takes its last session off: the whole save goes back byte for byte, the ones
 *    after it keep their own draw, taken off and done again reproduces it, a reload keeps the 「−」,
 *    advancing and a duel seal it
 *  二之四 重复上一周 replays last week's list in its own order, obeys every floor, and names what
 *    would not fit
 *  三 the settlement does not do it again: after 推进一周 the body has only what a week gives back, and
 *    the week's tally, its books and its paper are cleared
 *  四 the same save and the same clicks in the same order play out the same way (破晓's own guarantee)
 *  五 按推荐做完 spends through the same clicks, keeps the same floors, stops when it cannot spend, and
 *    says in one line what it did
 *  六 an old save whose week was planned and never settled runs none of it, gets its points back, and is
 *    told once
 *
 *   npx tsx scripts/check_week_instant.ts
 */
import './check_undo_economy'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { ACTIONS, ACTION_BY_KEY, DUELS_PER_WEEK } from '../src/engine/me/actions'
import { actionBlock, advanceWeek, doAction, matchAhead, repeatLastWeek, settleWeek, staminaLeft, undoAction, undoWeek, weekMatches } from '../src/engine/me/week'
import { undoDepth } from '../src/engine/me/undo'
import { packState, unpackState } from '../src/engine/save'
import { autoPlan } from '../src/engine/me/auto'
import { startDuel } from '../src/engine/me/duel'
import { migratePlayerSave } from '../src/engine/me/save'
import { ATTR_KEYS } from '../src/engine/types'
import type { GameState } from '../src/engine/types'
import type { MeAction } from '../src/engine/me/types'

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
const check = (ok: boolean, what: string): void => { console.log(`  ${ok ? '✓' : '✗'} ${what}`); if (!ok) fails++ }
const info = (m: string): void => console.log(`    ${m}`)
const t0 = Date.now()

const career = (start: 'pre' | 't1' = 'pre', seed = 7): GameState =>
  createCareer({ name: '本周', region: 'China', role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start, seed })

/**
 * The whole save, byte for byte — what a take-back has to put back exactly.
 * me.weekStart itself is left out: keeping what the week started from is the
 * bookkeeping of the take-back, not part of the week it restores.
 */
const whole = (s: GameState): string => {
  const me = s.me!
  const keep = me.weekStart
  me.weekStart = undefined
  const out = packState(s)
  me.weekStart = keep
  return out
}

/** everything a click could move, as one string */
const snap = (s: GameState): string => {
  const me = s.me!
  const p = s.players[me.id]
  return JSON.stringify([
    ATTR_KEYS.map((k) => [p.attrs[k], Math.round((p.xp[k] ?? 0) * 100)]),
    Math.round(p.fatigue * 100), Math.round(p.form * 100), Math.round(me.tilt * 100), Math.round(me.body * 100),
    Math.round(me.money), Math.round(me.heat * 100), Math.round(me.fans * 100), Math.round(me.pre.ladder * 1000),
    Math.round(me.coachTrust * 100), me.scrimRounds, me.stream.total, me.ap, { ...me.plan }, me.weekNotes.length,
  ])
}
/** get a signed career to the week board with the points in hand */
const proReady = (seed = 7): GameState => {
  const s = career('t1', seed)
  const me = s.me!
  // off the bench is not the point here: what matters is a club, a coach and eight points
  me.ap = me.apMax
  me.plan = {}
  return s
}

/* ---- 一 ---- */
console.log('一、点一下就落地：属性、天梯、钱、体力和那行字当场就动，周还没结算')
{
  type Case = { key: MeAction; pro: boolean; moved: (a: GameState, b: GameState) => boolean; what: string }
  const xpOf = (s: GameState): number => ATTR_KEYS.reduce((n, k) => n + s.players[s.me!.id].attrs[k] * 100 + (s.players[s.me!.id].xp[k] ?? 0), 0)
  const cases: Case[] = [
    { key: 'aim', pro: false, moved: (a, b) => xpOf(b) > xpOf(a), what: '枪法训练：枪法、反应的进度当场涨' },
    { key: 'vod', pro: false, moved: (a, b) => xpOf(b) > xpOf(a), what: '复盘：意识、残局、指挥的进度当场涨' },
    { key: 'util', pro: false, moved: (a, b) => xpOf(b) > xpOf(a), what: '道具与跑图：道具、协同、沟通的进度当场涨' },
    { key: 'ranked', pro: false, moved: (a, b) => b.me!.pre.ladder !== a.me!.pre.ladder, what: '打排位：六把当场打完，天梯分当场变' },
    { key: 'stream', pro: false, moved: (a, b) => b.me!.money > a.me!.money && b.me!.heat > a.me!.heat, what: '直播：礼物当场进账，热度当场涨' },
    { key: 'content', pro: false, moved: (a, b) => b.me!.money > a.me!.money && b.me!.heat > a.me!.heat, what: '做内容：收入当场进账，热度当场涨' },
    { key: 'rest', pro: false, moved: (a, b) => b.players[b.me!.id].fatigue < a.players[a.me!.id].fatigue, what: '休息：体力当场回来' },
    { key: 'scrim', pro: true, moved: (a, b) => b.me!.coachTrust > a.me!.coachTrust && b.me!.scrimRounds > a.me!.scrimRounds, what: '跟队训练赛：教练当场看在眼里' },
  ]
  for (const c of cases) {
    const s = c.pro ? proReady() : career()
    const me = s.me!
    const p = s.players[me.id]
    // a body with room for anything, and something to rest off
    p.fatigue = 30
    if (c.key === 'duo') me.duoWith = s.teams[s.myTeam]?.roster.find((id) => id !== me.id)
    const before = { state: structuredClone(s), ap: me.ap, week: me.week, day: s.day, weekDay: me.weekDay, notes: me.weekNotes.length, stamina: staminaLeft(s) }
    const why = doAction(s, c.key)
    if (why) { check(false, `${c.what}——点不下去：${why}`); continue }
    const def = ACTION_BY_KEY[c.key]
    const landed = c.moved(before.state, s)
    const paid = me.ap === before.ap - def.cost
    const body = def.fatigue > 0 ? staminaLeft(s) < before.stamina : staminaLeft(s) > before.stamina
    const said = me.weekNotes.length > before.notes && (me.weekLog ?? []).length > 0
    const still = me.week === before.week && s.day === before.day && me.weekDay === before.weekDay
    check(landed && paid && body && said && still,
      `${c.what}；行动点 ${before.ap} → ${me.ap}，体力 ${before.stamina} → ${staminaLeft(s)}，周报多了一行，周没有被结算${landed ? '' : '（没落地）'}${said ? '' : '（没写那行字）'}${still ? '' : '（周被推进了）'}`)
    if (c.key === 'aim') info(`本周流水最后一行：${(me.weekLog ?? []).slice(-1)[0]}`)
  }
  // 队友双排 needs someone to play with, so it is asked on its own
  {
    const s = proReady()
    const me = s.me!
    s.players[me.id].fatigue = 30
    const mate = s.teams[s.myTeam].roster.find((id) => id !== me.id)!
    me.duoWith = mate
    const bonds0 = JSON.stringify(s.bonds ?? {})
    const why = doAction(s, 'duo')
    check(!why && JSON.stringify(s.bonds ?? {}) !== bonds0 && (me.weekLog ?? []).length === 1,
      `队友双排：和 ${s.players[mate].ign} 的关系当场近了一点${why ? `（${why}）` : ''}`)
  }
}

/* ---- 二 ---- */
console.log('\n二、点之前的拦截一个没少：点数、体力、灰掉的理由、没有队伍、对位挑战走自己的按钮')
{
  const s = career()
  const me = s.me!
  const p = s.players[me.id]
  // the points: an action nobody can pay for is refused and says how short it is
  me.ap = 1
  const poor = doAction(s, 'aim')
  check(poor === `行动点不够（需 ${ACTION_BY_KEY.aim.cost}，剩 1）` && (me.plan.aim ?? 0) === 0,
    `行动点不够就点不下去，说清差多少：「${poor}」`)
  // the body: the ≤0 block, exactly where it was
  me.ap = me.apMax
  p.fatigue = 100 - (ACTION_BY_KEY.aim.fatigue - 1)
  const tired = doAction(s, 'aim')
  check(tired === `体力不够（需 ${ACTION_BY_KEY.aim.fatigue}，剩 ${ACTION_BY_KEY.aim.fatigue - 1}）` && (me.plan.aim ?? 0) === 0,
    `体力不够就点不下去：「${tired}」`)
  check(actionBlock(s, 'aim') === tired, '卡片上灰掉的理由，和点下去被拦住时说的是同一句')
  // 休息 is what is left when the body is gone: never blocked by the body
  check(actionBlock(s, 'rest') === null && doAction(s, 'rest') === null,
    '体力见底时，休息照样点得下去（它不耗体力）')
  // and the body never goes over the top or under the floor
  p.fatigue = 99
  me.ap = me.apMax
  let guard = 0
  while (me.ap > 0 && guard++ < 20) doAction(s, 'rest')
  check(p.fatigue >= 0 && p.fatigue <= 100, `连着休息到行动点用完，疲劳留在 0–100 之间（${p.fatigue.toFixed(1)}）`)
  // the club's three
  const free = career()
  free.me!.ap = free.me!.apMax
  const proOnly = (['scrim', 'duo'] as const).map((k) => doAction(free, k))
  check(proOnly.every((w) => w === '需要先加入战队'), '没有队伍时，跟队训练赛和队友双排点不下去，写明「需要先加入战队」')
  // 对位挑战 is its own button
  check(doAction(free, 'duel') === '对位挑战是当场打的，用下面的按钮。', '对位挑战不走行动卡这条路，它有自己的按钮')
}
{
  // the weekly cap on duels, through the button that owns it
  const s = proReady()
  const me = s.me!
  const team = s.teams[s.myTeam]
  team.starters = team.roster.filter((id) => id !== me.id).slice(0, 5)
  me.ap = me.apMax
  me.trial = undefined
  let done = 0
  for (let i = 0; i < 5; i++) {
    if (startDuel(s)) break
    done++
    me.duelLive = undefined
  }
  check(done <= DUELS_PER_WEEK, `一周最多 ${DUELS_PER_WEEK} 次对位挑战，这周打了 ${done} 次`)
}

/* ---- 二之二 ---- */
console.log('\n二之二、这周还有你的比赛时，周页会说一句——只在真有这回事的时候')
{
  const s = proReady()
  const me = s.me!
  const team = s.teams[s.myTeam]
  // on the bench: his legs are not what the match asks for, so nothing is said
  team.starters = team.roster.filter((id) => id !== me.id).slice(0, 5)
  check(matchAhead(s) === null, '替补的一周不说这句：他的腿不是这场比赛要的东西')
  // in the five, with one of my club's matches still to come inside the week
  team.starters = [me.id, ...team.roster.filter((id) => id !== me.id).slice(0, 4)]
  check(matchAhead(s) === null, '首发，但这周没有你的比赛：一个字不说')
  // one tie of my club's, written for tomorrow — the only thing matchAhead reads off it
  const other = Object.keys(s.teams).find((id) => id !== s.myTeam)!
  s.fixtures.push({
    id: 'wi:ahead', day: s.day + 1, stage: s.stage, comp: '中国联赛',
    teamA: s.myTeam, teamB: other, bo: 3, label: '常规赛 W1', played: false,
  })
  const mine = weekMatches(s).filter((w) => w.day >= s.day && !w.fixture.played)
  const up = matchAhead(s)
  check(!!up && up.day === mine[0]?.day && up.day === s.day + 1,
    `首发、明天就有一场：说的是最近那一场（第 ${up?.day} 天，今天是第 ${s.day} 天，本周还剩 ${mine.length} 场）`)
  // a week with nothing of mine left says nothing
  const quiet = proReady(11)
  for (const f of quiet.fixtures) if (f.teamA === quiet.myTeam || f.teamB === quiet.myTeam) f.played = true
  check(matchAhead(quiet) === null, '这周的比赛都打完了：一个字不说')
  // and without a club there is nothing to say either
  check(matchAhead(career()) === null, '没有俱乐部：一个字不说')
}

/* ---- 二之三 ---- */
console.log('\n二之三、点了能减掉：退回去就是这周从头没做过这一项，退掉再点回来还是原来那个结果')
{
  // every card, one at a time: done then taken off leaves the state exactly as it was
  for (const a of ACTIONS) {
    if (a.key === 'duel') continue
    const s = a.key === 'scrim' || a.key === 'duo' ? proReady() : career()
    const me = s.me!
    s.players[me.id].fatigue = 30
    me.ap = me.apMax
    if (a.key === 'duo') me.duoWith = s.teams[s.myTeam].roster.find((id) => id !== me.id)
    const before = whole(s)
    if (doAction(s, a.key)) { check(false, `${a.label}：点不下去`); continue }
    const moved = whole(s) !== before
    const why = undoAction(s, a.key)
    check(!why && moved && whole(s) === before, `${a.label}：点一次再减掉，整份存档一个字节都没变${why ? `（${why}）` : ''}${moved ? '' : '（点了什么都没动）'}`)
  }
}
{
  // taken off and done again: the same draw, because the seed counts that card's own uses (me/growth.ts runAction)
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 25
  me.ap = me.apMax
  doAction(s, 'ranked')
  const first = (me.weekLog ?? [])[0]
  const mark = whole(s)
  undoAction(s, 'ranked')
  doAction(s, 'ranked')
  check((me.weekLog ?? [])[0] === first && whole(s) === mark, `打排位退掉再点回来，还是同一场：「${first}」 / 「${(me.weekLog ?? [])[0]}」`)
}
{
  // an earlier one taken off: the ones after it keep their own draw, and are replayed against the week as it now is
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 25
  me.ap = me.apMax
  doAction(s, 'aim')
  doAction(s, 'ranked')
  const rankedWith = (me.weekLog ?? [])[1]
  undoAction(s, 'aim')
  const rankedWithout = (me.weekLog ?? [])[0]
  check((me.weekDone ?? []).join(',') === 'ranked', `退掉枪法以后，这周只剩打排位（${(me.weekDone ?? []).join('、')}）`)
  // the ranked night itself is the same six games; what changed is the body it was played on
  const games = (l: string) => l.slice(0, l.indexOf('，'))
  check(games(rankedWithout) === games(rankedWith),
    `打排位那六把没有重摇：带枪法时「${games(rankedWith)}」，退掉以后「${games(rankedWithout)}」`)
  check(rankedWithout !== rankedWith, `退掉前面那次以后，打排位是按没练过重算的：「${rankedWith}」 → 「${rankedWithout}」`)
}
{
  // 全部撤回, and the boundary: advancing settles the week
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 25
  me.ap = me.apMax
  const start = whole(s)
  for (const k of ['aim', 'ranked', 'rest', 'ranked'] as MeAction[]) doAction(s, k)
  check(undoDepth(s) === 4, `这周做了 4 次，4 次都能退（${undoDepth(s)}）`)
  const off = undoWeek(s)
  check(off.length === 4 && whole(s) === start, `全部撤回：4 次都退了回去，整份存档回到这周刚开始的样子（退了 ${off.length} 次）`)
  // and once the week is advanced there is nothing to take back
  for (const k of ['aim', 'ranked'] as MeAction[]) doAction(s, k)
  advanceWeek(s)
  check(undoDepth(s) === 0 && !me.weekStart, '推进以后，这周的「−」退不回去了')
  check(undoAction(s, 'aim') !== null, `推进以后再按「−」，说清退不了：「${undoAction(s, 'aim')}」`)
}
{
  // the take-back survives a reload: the week's start rides in the save
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 25
  me.ap = me.apMax
  // the same week, read back the same way, is the yardstick: a load does its own tidying
  // (me/save.ts migratePlayerSave), so the before has to come through it too
  const reload = (x: GameState): GameState => migratePlayerSave(unpackState(packState(x)))
  const start = whole(reload(structuredClone(s)))
  doAction(s, 'aim')
  doAction(s, 'ranked')
  // packed and read back the way the browser autosaves it (me/save.ts)
  const back = reload(s)
  check(!!back.me!.weekStart && undoDepth(back) === 2, `读档以后这两次还能退（能退 ${undoDepth(back)} 次）`)
  undoWeek(back)
  check(whole(back) === start, '读档以后全部撤回，回到这周刚开始的样子')
}
{
  // a duel is sat through: it seals what came before it, and says so
  const s = proReady()
  const me = s.me!
  const team = s.teams[s.myTeam]
  team.starters = team.roster.filter((id) => id !== me.id).slice(0, 5)
  s.players[me.id].fatigue = 20
  me.ap = me.apMax
  me.trial = undefined
  doAction(s, 'vod')
  check(undoDepth(s) === 1, '打对位之前，复盘还能退')
  if (!startDuel(s)) {
    me.duelLive = undefined
    check(undoDepth(s) === 0 && undoAction(s, 'vod') !== null, '打完对位，之前那次复盘就定下来了——对位是一局一局打过的，不能连它一起重放')
    doAction(s, 'rest')
    check(undoDepth(s) === 1, '对位之后再做的，照样能退')
  } else check(false, '（检查本身）没能开一场对位')
}

/* ---- 二之四 ---- */
console.log('\n二之四、重复上一周：按上一周点的顺序再来一遍，点数、体力和灰掉的理由一条不放过')
{
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 20
  me.ap = me.apMax
  const mine: MeAction[] = ['vod', 'ranked', 'rest', 'ranked']
  for (const k of mine) doAction(s, k)
  settleWeek(s)
  check((me.lastWeekDone ?? []).join(',') === mine.join(','), `上一周做了什么按顺序记着了：${(me.lastWeekDone ?? []).join('、')}`)
  s.players[me.id].fatigue = 20
  me.ap = me.apMax
  const line = repeatLastWeek(s)
  check((me.weekDone ?? []).join(',') === mine.join(','), `照着又做了一遍，顺序一样：${(me.weekDone ?? []).join('、')}`)
  check(line.startsWith('照上一周做了：'), `做完给一句话——「${line}」`)
  // the week's own floors still apply: no points, nothing happens, and it says so
  const tight = career()
  tight.me!.lastWeekDone = ['aim', 'aim', 'aim', 'aim', 'aim', 'aim', 'aim']
  tight.me!.ap = 3
  tight.players[tight.me!.id].fatigue = 20
  const tightLine = repeatLastWeek(tight)
  check((tight.me!.plan.aim ?? 0) === 1 && tight.me!.ap === 1, `点数不够就只做得下几次：枪法 ${tight.me!.plan.aim ?? 0} 次，还剩 ${tight.me!.ap} 点`)
  check(tightLine.includes('排不下'), `做不下的会说出来——「${tightLine}」`)
  // 对位挑战 is never replayed for you
  const duel = career('t1')
  duel.me!.lastWeekDone = ['duel']
  duel.me!.ap = duel.me!.apMax
  const duelLine = repeatLastWeek(duel)
  check((duel.me!.plan.duel ?? 0) === 0 && duelLine.includes('对位挑战'),
    `对位挑战不替你打，只说排不下——「${duelLine}」`)
  // nothing to copy
  const fresh = career()
  check(repeatLastWeek(fresh) === '上一周没做什么可以照搬的。', '上一周什么都没做过时，直说没有可照搬的')
}

/* ---- 三 ---- */
console.log('\n三、周结算不再做一遍：只把身体自己回的那点补上，本周的账清空')
{
  const s = career()
  const me = s.me!
  const p = s.players[me.id]
  p.fatigue = 20
  me.ap = me.apMax
  const clicks: MeAction[] = ['aim', 'vod', 'ranked']
  for (const k of clicks) doAction(s, k)
  const spent = ACTIONS.filter((a) => clicks.includes(a.key)).reduce((n, a) => n + a.fatigue, 0)
  check(Math.abs(p.fatigue - (20 + spent)) < 0.001, `点完三张卡，疲劳正好是点出来的那些：20 → ${p.fatigue.toFixed(1)}（该是 ${20 + spent}）`)
  const money0 = me.money
  const xp0 = ATTR_KEYS.reduce((n, k) => n + p.attrs[k] * 100 + (p.xp[k] ?? 0), 0)
  const fat0 = p.fatigue
  const ladder0 = me.pre.ladder
  settleWeek(s)
  const back = fat0 - p.fatigue
  check(back > 0 && back <= 13, `周结算只把身体自己回的那点还回来：疲劳 ${fat0.toFixed(1)} → ${p.fatigue.toFixed(1)}，回了 ${back.toFixed(1)}`)
  const xp1 = ATTR_KEYS.reduce((n, k) => n + p.attrs[k] * 100 + (p.xp[k] ?? 0), 0)
  check(xp1 === xp0, '周结算没有再练一遍：属性和进度一点没动')
  check(me.pre.ladder === ladder0, '周结算没有再打一遍排位：天梯分一点没动')
  check(me.money !== money0 || me.phase !== 'pro', '周结算照常结工资和账本')
  check(Object.keys(me.plan).length === 0 && (me.weekLog ?? []).length === 0 && (me.mediaWeek ?? 0) === 0 && !me.trainWeek,
    '周结算清空本周的账：做过什么、本周流水、平台已结的钱、这周的训练底子')
}
{
  // the paper: what I did this week survives the first press of 推进
  const s = career()
  const me = s.me!
  s.players[me.id].fatigue = 20
  me.ap = me.apMax
  doAction(s, 'aim')
  const mine = (me.weekLog ?? [])[0]
  advanceWeek(s)
  check(me.weekNotes.includes(mine), `推进以后，这周点出来的那行字还在周报上：「${mine}」`)
}

/* ---- 四 ---- */
console.log('\n四、同一份存档、同样的点击顺序，结果一样')
{
  const a = career()
  a.players[a.me!.id].fatigue = 25
  a.me!.ap = a.me!.apMax
  const b = structuredClone(a)
  const order: MeAction[] = ['ranked', 'aim', 'stream', 'rest', 'ranked', 'vod']
  for (const k of order) { doAction(a, k); doAction(b, k) }
  check(snap(a) === snap(b), '两份一样的存档，同样六次点击，落到同一个结果')
  // and a career built again from the same seed, played the same way, lands in the same place
  const again = career()
  again.players[again.me!.id].fatigue = 25
  again.me!.ap = again.me!.apMax
  for (const k of order) doAction(again, k)
  check(snap(again) === snap(a), '同一个种子重新开一局，同样六次点击，还是同一个结果')
  // a different order is a different week — that is the price of the click, and it is 破晓's too
  const other = career()
  other.players[other.me!.id].fatigue = 25
  other.me!.ap = other.me!.apMax
  for (const k of [...order].reverse()) doAction(other, k)
  info(`换个顺序是另一周，这是「点了就算」的代价：${snap(other) === snap(a) ? '这次正好一样' : '结果不同'}`)
}

/* ---- 五 ---- */
console.log('\n五、按推荐做完：同一条路，同样的门槛，做不动就停，一句话说清')
{
  for (const start of ['pre', 't1'] as const) {
    const s = career(start)
    const me = s.me!
    const p = s.players[me.id]
    p.fatigue = 20
    me.ap = me.apMax
    const ap0 = me.ap
    const line = autoPlan(s)
    const spent = ACTIONS.reduce((n, a) => n + a.cost * (me.plan[a.key] ?? 0), 0)
    check(me.ap >= 0 && spent === ap0 - me.ap, `${start}：点数没超支，花掉的正好对得上（${ap0} → ${me.ap}）`)
    check(staminaLeft(s) >= 0 && p.fatigue <= 100, `${start}：体力没被做成负数（剩 ${staminaLeft(s)}）`)
    const stuck = ACTIONS.every((a) => a.key === 'duel' || actionBlock(s, a.key) !== null)
    check(me.ap === 0 || stuck, `${start}：停下来的时候要么点用完了，要么剩下的卡都点不动`)
    check(/^(按推荐做完了 \d+ 点：|这周)/.test(line), `${start}：做完给一句话——「${line}」`)
  }
  // nothing left to spend: it says so instead of pretending
  const s = career()
  s.me!.ap = 0
  check(autoPlan(s) === '这周的行动点已经用完了。', '点数已经用完时，按推荐做完直说没得做')
}

/* ---- 六 ---- */
console.log('\n六、老存档里排好还没结算的那一周：一件不做，点数退回，说一次')
{
  const s = career()
  const me = s.me!
  const p = s.players[me.id]
  p.fatigue = 30
  // a save written by the old board: the hours are on the plan and the points are gone
  me.ap = 2
  me.plan = { aim: 2, rest: 1, duel: 1 }
  const before = snapNoAp(s)
  migratePlayerSave(s)
  const owed = ACTION_BY_KEY.aim.cost * 2 + ACTION_BY_KEY.rest.cost
  check(me.ap === Math.min(me.apMax, 2 + owed), `退回了 ${owed} 点行动（${2} → ${me.ap}，本周上限 ${me.apMax}）`)
  check(!me.plan.aim && !me.plan.rest, '排好的那些没有替你做，也没有留在这周的账上')
  check(me.plan.duel === 1, '已经打过的对位挑战留着，它当时就打完了')
  check(snapNoAp(s) === before, '身上什么都没变：属性、体力、钱、天梯一点没动')
  const said = (me.weekLog ?? []).some((l) => l.includes('退回了') && l.includes('行动'))
  check(said, `周报上说了一次：「${(me.weekLog ?? []).find((l) => l.includes('退回了')) ?? '（没说）'}」`)
  // and a save with nothing on the plan is not told anything
  const clean = career()
  migratePlayerSave(clean)
  check(!(clean.me!.weekLog ?? []).length, '没有排过东西的存档，不会被无缘无故说一句')
}

/** the same as snap, without the action points — for the refund, which is exactly what moves them */
function snapNoAp(s: GameState): string {
  const me = s.me!
  const p = s.players[me.id]
  return JSON.stringify([
    ATTR_KEYS.map((k) => [p.attrs[k], Math.round((p.xp[k] ?? 0) * 100)]),
    Math.round(p.fatigue * 100), Math.round(p.form * 100), Math.round(me.tilt * 100),
    Math.round(me.money), Math.round(me.heat * 100), Math.round(me.pre.ladder * 1000), me.stream.total,
  ])
}

console.log(fails
  ? `\n✗ ${fails} 项不对。`
  : `\n✓ 点一下卡片就做一次：属性、天梯、钱、体力和那行字当场就动；点之前的点数和体力门槛一个没少；周结算只管身体自己回的那点、工资和这一周的世界；同一份存档同样的点击结果一样；按推荐做完走同一条路并说清做了什么；老存档排好没结算的那一周一件不做、点数退回。（${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
process.exit(fails ? 1 : 0)
