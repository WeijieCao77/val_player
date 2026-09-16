/**
 * 更衣室和教练，量出来的 — the dressing room, the coach's trust, and the key
 * rounds that test what I am worst at, measured on careers replayed the steady
 * way (me/auto.ts autoPlan, the same buttons a player presses).
 *
 * Three numbers, the three the tuning is about:
 *
 *  一 更衣室翻盘：every official match of my club is played twice on the same
 *    seed — once as it stands, once with the room taken out of the world (every
 *    squad member's form moved back by me/room.ts roomForm, and the coach's five
 *    named without roomEdge). The two results differ, or they do not. Alongside
 *    it, the cheap weekly reading: how often the room's edge alone moves the
 *    five the coach names, and how often it moves my own place in it.
 *
 *  二 教练信任：the coach's trust read every week I am at a club, by season —
 *    where it sits, how far from the 60 the week pulls it back to, and how much
 *    of a season is spent at 「信任」 or under 50.
 *
 *  三 最弱的一项：every key round played, whether the option I took was judged
 *    on my weakest relevant attribute, and whether the round put it on the table
 *    at all.
 *
 *   npx tsx scripts/probe_room.ts [seasons=3] [seeds=7,8,9] [roles=决斗者,控场]
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoPlan, autoResolve } from '../src/engine/me/auto'
import { advanceWeek } from '../src/engine/me/week'
import type { WeekStop } from '../src/engine/me/week'
import { MeMatch } from '../src/engine/me/matchplay'
import { NODES } from '../src/engine/me/nodes'
import { coachStarters, coachView } from '../src/engine/me/coach'
import { roomBase, roomEdge, roomForm } from '../src/engine/me/room'
import { squadOf } from '../src/engine/roster'
import { weightsFor } from '../src/engine/player'
import { clamp } from '../src/engine/rng'
import { ATTR_KEYS } from '../src/engine/types'
import type { Attrs, Fixture, GameState, Player, Region, Role } from '../src/engine/types'

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

const SEASONS = Number(process.argv[2] ?? 3)
const SEEDS = (process.argv[3] ?? '7,8,9').split(',').map(Number)
const ROLES = (process.argv[4] ?? '决斗者,控场').split(',') as Role[]
// only places with a Challengers club to sign for in 2026 — a China start finds none and createCareer throws
const REGION_OF: Record<number, Region> = { 7: 'Americas', 8: 'Pacific', 9: 'EMEA', 10: 'Americas', 11: 'Pacific', 12: 'EMEA' }

const f1 = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : '-')
const f2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '-')
const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—')
const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN)
const q = (a: number[], f: number) => {
  const s = a.slice().sort((x, y) => x - y)
  return s.length ? s[Math.min(s.length - 1, Math.floor(f * s.length))] : NaN
}

/**
 * The attributes a key round can put on the line, and of those the ones my role
 * is actually judged on (engine/player.ts ROLE_WEIGHT ≥ RELEVANT). 指挥 is left
 * out: no key-round option is judged on it.
 */
const DIMS = ATTR_KEYS.filter((k) => k !== 'igl') as (keyof Attrs)[]
const RELEVANT = 0.07
function weakDim(p: Player): keyof Attrs {
  const w = weightsFor(p)
  const pool = DIMS.filter((k) => w[k] >= RELEVANT)
  return (pool.length ? pool : DIMS).slice().sort((a, b) => p.attrs[a] - p.attrs[b])[0]
}

interface Tally {
  /** 一 the room off, same seed */
  matches: number
  flips: number
  lineupWeeks: number
  fiveMoved: number
  meMoved: number
  /** weeks my place is the contract's or a trial's, whatever the coach reads */
  pinned: number
  /** how far the coach's own reading puts me from the 5/6 line — what the room would have to cross */
  margins: number[]
  edges: number[]
  forms: number[]
  edgeAtCap: number
  formAtCap: number
  /** 二 */
  trustBySeason: Map<number, number[]>
  trust: number[]
  /** 三 */
  calls: number
  onWeak: number
  offered: number
  proWeeks: number
  secs: number
}

const blank = (): Tally => ({
  matches: 0, flips: 0, lineupWeeks: 0, fiveMoved: 0, meMoved: 0, pinned: 0, margins: [],
  edges: [], forms: [], edgeAtCap: 0, formAtCap: 0,
  trustBySeason: new Map(), trust: [], calls: 0, onWeak: 0, offered: 0, proWeeks: 0, secs: 0,
})

/** The same world with the room taken out of it: everyone's form moved back by what the room put there, and the five named without the coach's room term. */
function roomOff(state: GameState): GameState {
  const clone = structuredClone(state)
  if (!clone.myTeam || !clone.teams[clone.myTeam]) return clone
  const base = roomBase(clone, clone.myTeam)
  const squad = squadOf(clone, clone.myTeam)
  const back = squad.map((p) => roomForm(clone, p, base))
  squad.forEach((p, i) => { p.form = clamp(p.form - back[i], 30, 99) })
  clone.teams[clone.myTeam].starters = coachStarters(clone, false)
  return clone
}

/** One official match, played for real and — on a copy, same seed — with the room off. */
function playMatch(state: GameState, fixture: Fixture, t: Tally): void {
  const me = state.me!
  const counted = me.phase === 'pro' && !!state.myTeam && fixture.comp !== 'scrim'
  let without: boolean | null = null
  if (counted) {
    const clone = roomOff(state)
    const twin = clone.fixtures.find((f) => f.id === fixture.id)
    if (twin) without = new MeMatch(clone, twin).runOut().won
  }
  const rec = new MeMatch(state, fixture).runOut()
  if (counted && without !== null) {
    t.matches++
    if (rec.won !== without) t.flips++
  }
  // 三 the key rounds of this match, against what I am worst at right now
  const weak = weakDim(state.players[me.id])
  for (const n of rec.nodes) {
    t.calls++
    if (n.dim === weak) t.onWeak++
    const def = NODES.find((x) => x.id === n.id)
    if (def?.a.some((o) => o.dim === weak)) t.offered++
  }
}

/** A week the steady way, stopping on my club's matches so each can be played twice. */
function week(state: GameState, t: Tally): WeekStop {
  const me = state.me!
  const clear = () => { let g = 0; while (me.pending.length && g++ < 20) autoResolve(state, me.pending[0]) }
  clear()
  if (me.phase === 'retired' || state.gameOver) return { kind: 'game-over' }
  autoPlan(state)
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind !== 'week-end' && stop.kind !== 'game-over' && guard++ < 40) {
    if (stop.kind === 'match') playMatch(state, stop.fixture, t)
    else clear()
    stop = advanceWeek(state)
  }
  return stop
}

function career(role: Role, seed: number, t: Tally): void {
  const t0 = Date.now()
  const state = createCareer({
    name: `R${seed}`, region: REGION_OF[seed] ?? 'EMEA', role,
    talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed, year: 2026,
  })
  const me = state.me!
  const year0 = state.year
  let weeks = 0
  while (state.year < year0 + SEASONS && me.phase !== 'retired' && weeks < SEASONS * 60) {
    const stop = week(state, t)
    weeks++
    if (me.phase === 'pro' && state.myTeam && state.teams[state.myTeam]) {
      t.proWeeks++
      t.trust.push(me.coachTrust)
      const bySeason = t.trustBySeason.get(state.year) ?? []
      bySeason.push(me.coachTrust)
      t.trustBySeason.set(state.year, bySeason)
      // 一 the edge alone, weekly: does the room move the five the coach names
      const withRoom = coachStarters(state)
      const plain = coachStarters(state, false)
      t.lineupWeeks++
      const same = withRoom.slice().sort().join() === plain.slice().sort().join()
      if (!same) t.fiveMoved++
      if (withRoom.includes(me.id) !== plain.includes(me.id)) t.meMoved++
      // why it reaches my place or does not: a place written into the contract, or a trial, is mine
      // whatever the coach reads (me/coach.ts coachStarters) — and when it is not, how far his own
      // reading puts me from the 5/6 line, which is the distance the room would have to cover
      const mine = state.players[me.id]
      const promised = mine?.contract?.promisedRole
      if (me.trial || ((promised === 'starter' || promised === 'star') && !(me.benchLock && me.benchLock > state.day))) t.pinned++
      const squadNow = squadOf(state, state.myTeam)
      if (squadNow.length > 5) {
        const cv = new Map(squadNow.map((p) => [p.id, coachView(state, p, false)]))
        const sorted = squadNow.slice().sort((a, b) => cv.get(b.id)! - cv.get(a.id)!)
        const rank = sorted.findIndex((p) => p.id === me.id)
        if (rank >= 0) {
          t.margins.push(rank < 5
            ? cv.get(sorted[rank].id)! - cv.get(sorted[5].id)!
            : cv.get(sorted[4].id)! - cv.get(sorted[rank].id)!)
        }
      }
      // and how big the room's two terms actually are, across the whole squad
      const base = roomBase(state, state.myTeam)
      for (const p of squadOf(state, state.myTeam)) {
        const e = roomEdge(state, p, base)
        const f = roomForm(state, p, base)
        t.edges.push(e)
        t.forms.push(f)
        if (Math.abs(Math.abs(e) - CAP_EDGE) < 1e-9) t.edgeAtCap++
        if (Math.abs(Math.abs(f) - CAP_FORM) < 1e-9) t.formAtCap++
      }
    }
    if (stop.kind === 'game-over') break
  }
  t.secs += Math.round((Date.now() - t0) / 1000)
}

// read the caps off the engine, so the report says which build it measured
import { ROOM_EDGE_MAX, ROOM_FORM_MAX } from '../src/engine/me/room'
import { PROVEN_TRUST } from '../src/engine/me/coach'
const CAP_EDGE = ROOM_EDGE_MAX
const CAP_FORM = ROOM_FORM_MAX

const t = blank()
for (const role of ROLES) for (const seed of SEEDS) {
  career(role, seed, t)
  process.stderr.write(`${role} seed ${seed} 打完：比赛 ${t.matches}、翻盘 ${t.flips}、关键回合 ${t.calls} · ${t.secs}s\n`)
}

console.log(`\n更衣室探针 · ${ROLES.join('/')} × 种子 ${SEEDS.join('/')} × ${SEASONS} 个赛季 · 上限 roomEdge ±${CAP_EDGE} / roomForm ±${CAP_FORM} · ${t.secs}s`)

console.log(`\n一、更衣室能不能决定比赛`)
console.log(`  同一个种子打两遍（有更衣室 / 把更衣室从世界里拿掉）：${t.matches} 场正赛，结果不一样的 ${t.flips} 场（${pct(t.flips, t.matches)}）`)
console.log(`  只看教练那一项：${t.lineupWeeks} 个在队的周里，首发名单被它改动 ${t.fiveMoved} 周（${pct(t.fiveMoved, t.lineupWeeks)}），你自己的位置被它改动 ${t.meMoved} 周（${pct(t.meMoved, t.lineupWeeks)}）`)
console.log(`  你的位置为什么（没）被它改：合同写死首发、或正在试用期的周 ${pct(t.pinned, t.lineupWeeks)}；教练自己的读数把你和首发线隔开 p10 ${f2(q(t.margins, 0.1))} · p50 ${f2(q(t.margins, 0.5))} · p90 ${f2(q(t.margins, 0.9))}（更衣室那一项要跨过这个数才动得了你）`)
console.log(`  这两项本身有多大：教练眼里 p10 ${f2(q(t.edges, 0.1))} · p50 ${f2(q(t.edges, 0.5))} · p90 ${f2(q(t.edges, 0.9))}，顶到上限的 ${pct(t.edgeAtCap, t.edges.length)}`)
console.log(`                    状态   p10 ${f2(q(t.forms, 0.1))} · p50 ${f2(q(t.forms, 0.5))} · p90 ${f2(q(t.forms, 0.9))}，顶到上限的 ${pct(t.formAtCap, t.forms.length)}`)

console.log(`\n二、教练信任`)
const years = [...t.trustBySeason.keys()].sort()
for (const y of years) {
  const xs = t.trustBySeason.get(y)!
  console.log(`  ${y}：${xs.length} 周 · p10 ${f1(q(xs, 0.1))} · p50 ${f1(q(xs, 0.5))} · p90 ${f1(q(xs, 0.9))} · 均值 ${f1(mean(xs))}`)
}
const away = t.trust.map((v) => Math.abs(v - 60))
console.log(`  合计 ${t.trust.length} 周：均值 ${f1(mean(t.trust))} · 离 60 多远 均值 ${f1(mean(away))} · p90 ${f1(q(away, 0.9))}`)
console.log(`  到「信任」（${PROVEN_TRUST}）以上的周 ${pct(t.trust.filter((v) => v >= PROVEN_TRUST).length, t.trust.length)} · 掉到 50 以下的周 ${pct(t.trust.filter((v) => v <= 50).length, t.trust.length)}`)

console.log(`\n三、关键回合有没有考到你最弱的一项`)
console.log(`  ${t.calls} 次关键回合：你选的那一项就是最弱的一项 ${t.onWeak} 次（${pct(t.onWeak, t.calls)}）；这一回合的选项里有最弱的一项 ${t.offered} 次（${pct(t.offered, t.calls)}）`)
