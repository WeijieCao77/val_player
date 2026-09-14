/**
 * The week's 「下一场」 names my club's next match whether or not its tie is
 * written yet (engine/me/nextup.ts), and a month's fast-forward is not on offer
 * with a match of mine inside four weeks (engine/me/auto.ts quietAhead).
 *
 * Reported 2026-09-14: 「我在赛程里看到我打了一场比赛说明联赛都开始了，但是在本周
 * 栏目里显示没有安排好的比赛」. A real event writes a tie only once both of its
 * sides are known, so the panel, which read the ties written, said nothing was
 * scheduled for a club that had just lost a Swiss round, or sat seeded into a
 * playoff while its groups were on; and it offered a month's run three weeks
 * before a Masters the club had qualified for (scripts/probe_nextup.ts).
 *
 * Careers run the way the week's buttons run them. At the end of every day the
 * check reads nextUp and quietAhead, and once a career is over it reads each day
 * against what the club really played next — off the fixtures and the event
 * graph, not off the helper under test:
 *
 *  - known: a round whose tie was written later, in an event under way, with my
 *    side of it already settled that day by a result or a seed. nextUp names it:
 *    its event, its round, and its day (the tie can land a day or so later than
 *    the round's own day, never earlier)
 *  - named: nextUp never names a round the club did not play next
 *  - quiet: quietAhead(28) is false on every day with a match of mine inside 28 days
 *  - between: between events, an event nextUp names is the one the club plays
 *    next on at least nine days in ten. It names only an event whose draw as
 *    things stand seats the club, or one open to it; history's booking and a
 *    place results may yet earn are left unsaid, and those days are counted
 *
 * And it counts, without failing, the days it said a phase of mine was still to
 * be settled when the club never played that event again.
 *
 *   npx tsx scripts/check_nextup.ts [seed=11]
 */
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

import { createCareer, emptyTalents } from '../src/engine/me/career'
import type { StartPoint } from '../src/engine/me/career'
import { advanceTurn } from '../src/engine/me/week'
import { autoResolve, quietAhead } from '../src/engine/me/auto'
import { pop } from '../src/engine/me/pending'
import { MeMatch } from '../src/engine/me/matchplay'
import { nextUp } from '../src/engine/me/nextup'
import type { NextUp } from '../src/engine/me/nextup'
import { eventOf } from '../src/engine/circuit'
import type { CEvent, CNode, Slot } from '../src/engine/circuit'
import type { Fixture, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
const RUNS: { label: string; region: string; start: StartPoint; year: number; years: number }[] = [
  { label: '2021 欧洲 · 强队第六人，打到 2025', region: 'Europe', start: 't1', year: 2021, years: 5 },
  { label: '2026 欧洲 · Challengers 首发，打到 2027', region: 'Europe', start: 'chal', year: 2026, years: 2 },
  { label: '2026 中国 · VCT 第六人', region: 'China', start: 't1', year: 2026, years: 1 },
]
/** between events, the share of named events that may be some other event than the one played next */
const WRONG_EVENT_MAX = 0.1
let bad = 0
const fail = (m: string) => { bad++; if (bad <= 40) console.log(`  ✗ ${m}`) }
const t0 = Date.now()

const md = (year: number, day: number): string => {
  const d = new Date(Date.UTC(year, 0, 1 + day))
  return `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
const roundOf = (f: Fixture): string => f.label.replace(/^(KO|SW):-?\d+:/, '')

type FNode = CNode & { unit: number }
const FLAT = new Map<string, { nodes: FNode[]; base: number[] }>()
function flatOf(ev: CEvent): { nodes: FNode[]; base: number[] } {
  let hit = FLAT.get(ev.id)
  if (hit) return hit
  const nodes: FNode[] = []
  const base: number[] = []
  ev.units.forEach((u, ui) => {
    base.push(nodes.length)
    for (const n of u.nodes ?? []) nodes.push({ ...n, unit: ui })
  })
  hit = { nodes, base }
  FLAT.set(ev.id, hit)
  return hit
}

interface Track { f: Fixture; year: number; seen: number; played?: number; comp: string; compName: string; evId?: string }
interface Sample { year: number; v: number; club: string; up: NextUp; quiet: boolean }

const said = (up: NextUp): string =>
  up.kind === 'fixture' ? `${roundOf(up.fixture)}（第 ${up.day} 天）`
    : up.kind === 'round' || up.kind === 'waiting' ? `${up.kind === 'waiting' ? '等本阶段名次 ' : ''}${up.name} ${up.round}（第 ${up.day} 天）`
      : up.kind === 'event' ? `下一项 ${up.name}（第 ${up.day} 天开打）` : '暂时没有排定的比赛'

const sum = { days: 0, known: 0, quiet: 0, named: 0, right: 0, wrong: 0, none: 0, waitingOut: 0 }

for (const o of RUNS) {
  const t1 = Date.now()
  const state = createCareer({ name: 'Check', region: o.region as Region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: o.start, seed, year: o.year })
  const me = state.me!
  const TR: Track[] = []
  const seenF = new Map<Fixture, Track>()
  const W = new Map<string, number>()
  const BEGIN = new Map<string, number>()
  const samples: Sample[] = []
  let ms = 0

  const sample = (v: number): void => {
    const year = state.year
    for (const f of state.fixtures) {
      let t = seenF.get(f)
      if (!t) {
        const c = state.comps[f.comp]
        t = { f, year, seen: v, comp: f.comp, compName: c?.name ?? f.comp, evId: c?.circuit?.id }
        seenF.set(f, t)
        TR.push(t)
      }
      if (f.played && t.played == null) t.played = v
    }
    for (const c of Object.values(state.comps)) {
      const k = `${year}:${c.key}`
      if (c.circuit?.mode && !BEGIN.has(k)) BEGIN.set(k, v)
      for (const w of Object.keys(c.circuit?.walk ?? {})) if (!W.has(`${k}:${w}`)) W.set(`${k}:${w}`, v)
    }
    const club = me.phase === 'pro' ? state.myTeam : ''
    if (!club || !state.teams[club]) return
    const at = performance.now()
    const up = nextUp(state)
    const quiet = quietAhead(state, 28)
    ms += performance.now() - at
    samples.push({ year, v, club, up, quiet })
  }
  // the end of each day: advanceDay opens the next one with state.day++ (engine/season.ts)
  let dayValue = state.day
  Object.defineProperty(state, 'day', {
    get: () => dayValue,
    set: (n: number) => { if (n === dayValue + 1) sample(dayValue); dayValue = n },
    enumerable: true,
    configurable: true,
  })

  let guard = 0
  try {
    while (state.year < o.year + o.years && !state.gameOver && me.phase !== 'retired' && guard++ < 5000) {
      let g = 0
      while (me.pending.length && g++ < 30) {
        const it = me.pending[0]
        autoResolve(state, it)
        if (me.pending[0] === it) pop(state, it.kind, it.id)
      }
      if (me.phase === 'retired' || state.gameOver) break
      const stop = advanceTurn(state)
      if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    }
  } catch (e) {
    fail(`${o.label}：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
    continue
  }

  // ---- read each day against what was played
  const byNode = new Map<string, Track>()
  for (const t of TR) if (t.f.node != null) byNode.set(`${t.year}:${t.comp}:${t.f.node}`, t)
  const mine = new Map<string, Track[]>()
  const mineOf = (club: string, year: number): Track[] => {
    const k = `${club}:${year}`
    let hit = mine.get(k)
    if (!hit) {
      hit = TR.filter((t) => t.year === year && t.played != null && t.f.comp !== 'scrim' && !t.f.scrim && (t.f.teamA === club || t.f.teamB === club))
        .sort((a, b) => a.f.day - b.f.day)
      mine.set(k, hit)
    }
    return hit
  }
  const nodeDay = (t: Track, idx: number): number | null => byNode.get(`${t.year}:${t.comp}:${idx}`)?.played ?? W.get(`${t.year}:${t.comp}:${idx}`) ?? null
  const slotDay = (t: Track, ev: CEvent, n: FNode, s: Slot): number | null => {
    const { base } = flatOf(ev)
    if (s[0] === 'w' || s[0] === 'l') return nodeDay(t, base[n.unit] + s[1])
    if (s[0] === 'g') {
      const u = ev.units[s[1]]
      if (u.type === 'open') return u.last ?? null
      let max = -1
      for (let i = 0; i < (u.nodes?.length ?? 0); i++) {
        const d = nodeDay(t, base[s[1]] + i)
        if (d == null) return null
        max = Math.max(max, d)
      }
      return max
    }
    return byNode.get(`${t.year}:${t.comp}:-1`)?.played ?? BEGIN.get(`${t.year}:${t.comp}`) ?? null
  }

  const n = { days: 0, known: 0, quiet: 0, named: 0, right: 0, wrong: 0, none: 0, waitingOut: 0 }
  const outEx: string[] = []
  const wrongEx: string[] = []
  for (const s of samples) {
    n.days++
    const open = mineOf(s.club, s.year).filter((t) => t.played! > s.v)
    const first = open[0]
    // quiet: never a month's run with a match of mine inside four weeks
    if (s.quiet && first && first.f.day <= s.v + 28) {
      n.quiet++
      if (n.quiet <= 3) fail(`${o.label} ${md(s.year, s.v)}：说「接下来四周没有你的比赛」，${first.f.day - s.v} 天后打 ${first.compName} ${roundOf(first.f)}`)
    }
    // named: a round named is the one played next
    if (s.up.kind === 'round') {
      const up = s.up
      const hit = open.find((t) => t.compName === up.name && roundOf(t.f) === up.round)
      if (!hit || hit !== first || up.day > hit.f.day + 1 || hit.f.day - up.day > 3) {
        n.named++
        if (n.named <= 3) fail(`${o.label} ${md(s.year, s.v)}：「下一场」写 ${said(up)}，实际下一场 ${first ? `${first.compName} ${roundOf(first.f)}（第 ${first.f.day} 天）` : '没有'}`)
      }
    }
    // a phase said to be still open for us, and the club never played that event again (counted, not failed)
    if (s.up.kind === 'waiting' && !open.some((t) => t.compName === (s.up as { name: string }).name)) {
      n.waitingOut++
      if (outEx.length < 2) outEx.push(`${md(s.year, s.v)} ${said(s.up)}，实际下一场 ${first ? `${first.compName} ${roundOf(first.f)}` : '没有'}`)
    }
    // the next match, if its tie was not written yet and no written tie comes first
    const u = open.find((t) => t.seen > s.v)
    if (!u || open.some((t) => t.seen <= s.v && t.f.day <= u.f.day)) continue
    const begun = BEGIN.get(`${s.year}:${u.comp}`)
    if (begun == null || begun > s.v) {
      // between: an event named is the one the club plays next
      if (s.up.kind === 'event') {
        if (s.up.name === u.compName) n.right++
        else {
          n.wrong++
          if (wrongEx.length < 2) wrongEx.push(`${md(s.year, s.v)} 写 ${said(s.up)}，实际下一场 ${u.compName}`)
        }
      } else if (s.up.kind === 'none') n.none++
      continue
    }
    const ev = u.evId ? eventOf(u.evId) : undefined
    if (!ev || u.f.node == null || u.f.node < 0) continue
    const node = flatOf(ev).nodes[u.f.node]
    const dMine = slotDay(u, ev, node, u.f.teamA === s.club ? node.a : node.b)
    if (dMine == null || dMine > s.v) continue
    // known: my side of that round settled that day
    n.known++
    const up = s.up
    const ok = up.kind === 'round' && up.name === u.compName && up.round === roundOf(u.f) && up.day <= u.f.day + 1 && u.f.day - up.day <= 3
    if (!ok) fail(`${o.label} ${md(s.year, s.v)}：${u.compName} 下一轮 ${roundOf(u.f)}（${md(u.year, u.f.day)}）已经有你，「下一场」却写「${said(up)}」`)
  }
  console.log(`  ${o.label}：职业日 ${n.days} · 下一轮已定、对阵还没写进赛程 ${n.known} 天`
    + ` · 两项之间写的下一项赛事 说对 ${n.right}、说成别的 ${n.wrong}${wrongEx.length ? `（${wrongEx.join('；')}）` : ''}、没写 ${n.none} 天`
    + ` · 写「本阶段名次未定」而后来没再打这项赛事 ${n.waitingOut} 天${outEx.length ? `（${outEx.join('；')}）` : ''}`
    + ` · 读「下一场」和四周空窗共 ${(ms / 1000).toFixed(1)}s · ${((Date.now() - t1) / 1000).toFixed(0)}s`)
  for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += n[k]
}

const named = sum.right + sum.wrong
if (sum.quiet) fail(`${sum.quiet} 天说「接下来四周没有你的比赛」，28 天内却有你的比赛`)
if (sum.named) fail(`${sum.named} 天「下一场」写的轮次不是实际打的下一场`)
if (sum.wrong > named * WRONG_EVENT_MAX) fail(`两项赛事之间写出的下一项赛事有 ${sum.wrong}/${named} 天不是实际打的那项，超过 ${WRONG_EVENT_MAX * 100}%`)
if (sum.known < 20) fail(`下一轮已定、对阵没写的日子只有 ${sum.known} 天，样本太少`)
if (named < 100) fail(`两项赛事之间写出下一项赛事的日子只有 ${named} 天，样本太少`)
console.log(bad
  ? `\n✗ ${bad} 项不对。`
  : `\n✓ 下一轮已经有你、对阵还没写进赛程的 ${sum.known} 天，「下一场」都写出了这一轮和日子；没有一天写了不是下一场的轮次，也没有一天在四周内有比赛时说可以快进一个月；两项赛事之间写出的下一项赛事 ${sum.right}/${named} 天是实际打的那项，${sum.none} 天没写（${sum.days} 个职业日）· ${((Date.now() - t0) / 1000).toFixed(0)}s`)
process.exit(bad ? 1 : 0)
