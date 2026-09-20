/**
 * Career dressing-room incident budget (2026-09-20).
 *
 * The career player's club says and charges at most one confrontation per
 * match and one lingering feud per week, without suppressing any pair's bond
 * movement. A spontaneous rift needs a genuinely weak relationship; an
 * explicit earlier fight may still echo at the old threshold. Manager saves
 * retain the uncapped pair-by-pair behavior.
 *
 *   npx tsx scripts/check_room_conflict.ts
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { openChain } from '../src/engine/me/storyweek'
import { squadOf } from '../src/engine/roster'
import { ARGUE_GAP, FEUD_GAP, applyMatchBonds, bondBetween, duoBonded, weeklyBonds } from '../src/engine/bonds'
import { Rng } from '../src/engine/rng'
import type { GameState, MatchResult, Player } from '../src/engine/types'

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
const ok = (condition: boolean, message: string) => {
  if (condition) return
  fails++
  console.log(`  ✗ ${message}`)
}
const pairKey = (a: string, b: string) => [a, b].sort().join('|')

const base = createCareer({
  name: 'RoomProbe', region: 'EMEA', role: '决斗者', talents: emptyTalents(),
  originKey: 'netcafe', start: 'chal', seed: 7, year: 2026,
})
if (base.me?.phase !== 'pro') throw new Error('probe must start at a club')
const fresh = (): GameState => structuredClone(base)

const setAllBonds = (state: GameState, players: Player[], value: number) => {
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      duoBonded(state, players[i].id, players[j].id, value - bondBetween(state, players[i].id, players[j].id))
    }
  }
}

const line = (kills: number, deaths: number) => ({
  rounds: 24, kills, deaths, assists: 0, firstKills: 0, firstDeaths: 0, damage: 0, clutches: 0,
})
const lopsidedLoss = (five: Player[]): MatchResult => {
  const lines: Record<string, ReturnType<typeof line>> = {}
  five.forEach((p, i) => { lines[p.id] = i === 0 ? line(40, 5) : line(2, 24) })
  return {
    mapsWonA: 0, mapsWonB: 2,
    lineups: { a: five.map((p) => p.id), b: [] },
    maps: [{ lines }],
  } as unknown as MatchResult
}

console.log('一、玩家一场最多一对争执，关系照常变化')
{
  const s = fresh()
  const five = squadOf(s, s.myTeam).slice(0, 5)
  setAllBonds(s, five, -60)
  five.forEach((p) => { p.morale = 100 })
  const before = new Map<string, number>()
  for (let i = 0; i < five.length; i++) for (let j = i + 1; j < five.length; j++) {
    before.set(pairKey(five[i].id, five[j].id), bondBetween(s, five[i].id, five[j].id))
  }
  const notes: string[] = []
  applyMatchBonds(s, lopsidedLoss(five), s.myTeam, true, new Rng(1), notes)
  ok(notes.length === 1, `一场写了 ${notes.length} 条争执，不是 1 条`)
  ok(Object.keys(s.argueSaid ?? {}).length === 1, `一场把 ${Object.keys(s.argueSaid ?? {}).length} 对记进争执冷却，不是 1 对`)
  const changed = [...before].filter(([k, v]) => {
    const [a, b] = k.split('|')
    return bondBetween(s, a, b) < v
  })
  const afterBonds = [...before].map(([k]) => {
    const [a, b] = k.split('|')
    return bondBetween(s, a, b)
  })
  // Frozen from review-batch@3addd0f with the same career, five and Rng(1):
  // incident presentation may change, every pair's numeric loss must not.
  const reviewBatchBonds = [
    -100, -100, -100, -100,
    -60.924501416364684, -61.09115127253533, -61.61319978519743,
    -61.34505650255829, -61.22796480904068, -60.65801121879201,
  ]
  ok(changed.length === before.size, `10 对关系只有 ${changed.length} 对发生了败局变化`)
  ok(JSON.stringify(afterBonds) === JSON.stringify(reviewBatchBonds),
    `10 对关系值没有逐项保持 review-batch 基线：${JSON.stringify(afterBonds)}`)
  ok(five[0].morale === 95, `carry 一场被重复扣士气，100 → ${five[0].morale}`)
  ok(five.slice(1).filter((p) => p.morale === 91).length === 1, '不是恰好一个落后队友承担 -9 士气')
  ok(five.slice(1).filter((p) => p.morale === 100).length === 3, '没有卷入唯一争执的队友也被扣了士气')
  console.log(`  10 对关系全部变化；争执 ${notes.length} 条；士气 ${five.map((p) => `${p.ign} ${p.morale}`).join(' / ')}`)
}

console.log('二、玩家一周一次俱乐部抽签，最多一对宿怨')
{
  const s = fresh()
  const squad = squadOf(s, s.myTeam)
  setAllBonds(s, squad, -80)
  squad.forEach((p) => { p.morale = 100; p.grievance = 0 })
  let chances = 0
  const always = {
    range: () => 0,
    chance: () => { chances++; return true },
  } as unknown as Rng
  const notes: string[] = []
  weeklyBonds(s, always, notes)
  ok(chances === 1, `${squad.length * (squad.length - 1) / 2} 对宿怨却抽了 ${chances} 次，不是俱乐部一次`)
  ok(notes.length === 1, `一次周结算写了 ${notes.length} 条宿怨，不是 1 条`)
  ok(squad.filter((p) => p.morale === 97).length === 2, '不是恰好一对队友承担 -3 士气')
  ok(squad.every((p) => p.morale >= 97), '同一个队友一周被多对宿怨重复扣士气')

  // Keep every pair cold and force the club roll to hit. A pair may rotate
  // back into the single slot, but never inside its 56-day cooldown.
  let prior = { ...(s.feudSaid ?? {}) }
  for (let week = 1; week <= 12; week++) {
    s.day += 7
    setAllBonds(s, squad, -80)
    const weekly: string[] = []
    weeklyBonds(s, always, weekly)
    ok(weekly.length <= 1, `第 ${week} 周写了 ${weekly.length} 条宿怨`)
    for (const [k, day] of Object.entries(s.feudSaid ?? {})) {
      if (prior[k] != null && day !== prior[k]) {
        ok(day - prior[k] >= FEUD_GAP, `${k} 隔 ${day - prior[k]} 天再次出现，小于 ${FEUD_GAP}`)
      }
    }
    prior = { ...(s.feudSaid ?? {}) }
  }
  console.log(`  ${squad.length * (squad.length - 1) / 2} 对同时闹掰：每周抽签 1 次、每周最多 1 条、同对间隔至少 ${FEUD_GAP} 天`)
}

console.log('三、自然矛盾只从一般以下开始，明确旧争吵可回响')
{
  const at = (bond: number, fight = false) => {
    const s = fresh()
    const me = s.me!
    const mine = s.players[me.id]
    const mates = squadOf(s, s.myTeam).filter((p) => p.id !== me.id)
    for (const mate of mates) duoBonded(s, mine.id, mate.id, 55 - bondBetween(s, mine.id, mate.id))
    duoBonded(s, mine.id, mates[0].id, bond - bondBetween(s, mine.id, mates[0].id))
    if (fight) {
      me.seeds = {
        ...(me.seeds ?? {}),
        blame: { v: 'fight', t: '当场怼回去', day: s.day - 7, year: s.year, wk: me.week - 2 },
      }
    }
    return { opened: openChain(s, 'rift', new Rng(7)), s, mate: mates[0] }
  }
  const mild = at(44)
  const weak = at(19)
  const echo = at(44, true)
  const tight = at(45, true)
  ok(!mild.opened, '没有前因、关系 44（不错）仍然开启了队内矛盾')
  ok(weak.opened, '没有前因、关系 19（一般）却无法开启队内矛盾')
  ok(echo.opened && echo.s.me?.chain?.from === 'blame', '明确 blame:fight 没有按旧门槛回响')
  ok(!tight.opened, '关系 45（很铁）仍被明确 fight 前因拉进了队内矛盾')
  console.log('  关系 44：自然不触发；关系 19：可触发；关系 44 + blame:fight：可回响；关系 45：仍不触发')
}

console.log('四、经理模式仍走逐对旧规则')
{
  const s = fresh()
  s.me = undefined
  const squad = squadOf(s, s.myTeam)
  const five = squad.slice(0, 5)
  setAllBonds(s, squad, -80)
  squad.forEach((p) => { p.morale = 100; p.grievance = 0 })
  const matchNotes: string[] = []
  applyMatchBonds(s, lopsidedLoss(five), s.myTeam, true, new Rng(1), matchNotes)
  ok(matchNotes.length === 4, `经理模式单场争执从旧规则的 4 条变成了 ${matchNotes.length} 条`)
  ok(five[0].morale === 80, `经理模式carry的旧逐对士气 80 变成了 ${five[0].morale}`)

  setAllBonds(s, squad, -80)
  squad.forEach((p) => { p.morale = 100; p.grievance = 0 })
  let chances = 0
  const always = {
    range: () => 0,
    chance: () => { chances++; return true },
  } as unknown as Rng
  const feudNotes: string[] = []
  weeklyBonds(s, always, feudNotes)
  const pairs = squad.length * (squad.length - 1) / 2
  ok(chances === pairs, `经理模式旧逐对抽签应为 ${pairs} 次，实际 ${chances}`)
  ok(feudNotes.length === pairs, `经理模式旧逐对宿怨应为 ${pairs} 条，实际 ${feudNotes.length}`)
  ok(s.feudSaid === undefined && s.argueSaid === undefined, '经理模式写入了玩家生涯专用冷却')
  console.log(`  赛后仍为 4 条；周宿怨仍为 ${pairs} 对各抽一次；不写玩家冷却`)

  // A match outside the career player's own club has liveEase=null too and
  // must retain the same uncapped shared-engine behavior.
  const t = fresh()
  const other = Object.values(t.teams).find((team) => team.id !== t.myTeam && squadOf(t, team.id).length >= 5)
  if (!other) {
    ok(false, '找不到五人齐整的非己方俱乐部做隔离检查')
  } else {
    const theirs = squadOf(t, other.id).slice(0, 5)
    setAllBonds(t, theirs, -80)
    theirs.forEach((p) => { p.morale = 100 })
    const otherNotes: string[] = []
    applyMatchBonds(t, lopsidedLoss(theirs), other.id, true, new Rng(1), otherNotes)
    ok(otherNotes.length === 4, `非己方俱乐部单场争执从旧规则的 4 条变成了 ${otherNotes.length} 条`)
    ok(theirs[0].morale === 80, `非己方俱乐部carry的旧逐对士气 80 变成了 ${theirs[0].morale}`)
    ok(t.argueSaid === undefined, '非己方俱乐部写入了玩家俱乐部专用冷却')
    console.log('  非己方俱乐部同样保留旧逐对规则与RNG路径')
  }
}

if (fails) {
  console.error(`\n${fails} 项失败`)
  process.exit(1)
}
console.log(`\n全部通过（赛后同对冷却仍为 ${ARGUE_GAP} 天）。`)
