/**
 * 「我在赛程里看到我打了一场比赛说明联赛都开始了，但是在本周栏目里显示没有安排好的比赛」
 * (reported 2026-09-14). A probe, not a check: scripts/check_nextup.ts is the check.
 *
 * Careers run the way the week's buttons run them, and at the end of every day
 * the probe writes down what the week's 「下一场」 panel would read, whether the
 * schedule page would draw a 「对手待定」 row of ours (engine/qualify.ts
 * nextInEvent, upcomingInternational), and whether a month's fast-forward is on
 * offer (engine/me/auto.ts quietAhead). When the run is over each day is read
 * against what the career really played next, so the verdict leans on no helper
 * under test:
 *
 *  - in an event: my club still had a round to play in an event under way, and
 *    the panel named nothing (or a later match). Each case is read off the event
 *    graph (engine/circuit.ts): was my side of that round already settled that
 *    day (known), were both sides settled and only the tie still to be written
 *    (lag), or did it still wait on results (waiting)?
 *  - between events: nothing under way, the next event not drawn yet
 *  - quiet: the month's fast-forward on offer with a match of mine inside 28 days
 *
 * Before the fix the panel read season.ts nextRealFixtureFor. With `after` it is
 * me/nextup.ts nextUp, and the probe also counts the days it names a round or an
 * event that is not the one the career played next.
 *
 *   npx tsx scripts/probe_nextup.ts [seed=11] [keys=na21,eu21,kr21,cn26,eu26,pa26] [y2] [ff] [after]
 *   (y5: five seasons a career · ff: run a month at a time whenever the week offers it)
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
import { advanceTurn, weekInDays } from '../src/engine/me/week'
import { advanceUntil, autoResolve, quietAhead, runBlocked } from '../src/engine/me/auto'
import { pop } from '../src/engine/me/pending'
import { MeMatch } from '../src/engine/me/matchplay'
import { nextRealFixtureFor } from '../src/engine/season'
import { eventOf, isLeagueEvent } from '../src/engine/circuit'
import type { CEvent, CNode, Slot } from '../src/engine/circuit'
import { nextInEvent, upcomingInternational } from '../src/engine/qualify'
import { formatOf } from '../src/engine/era'
import type { Fixture, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
const FLAGS = /^(ff|after|y\d+)$/
const keys = (process.argv[3] ?? '').split(',').filter((k) => k && !FLAGS.test(k))
const FF = process.argv.includes('ff')
const AFTER = process.argv.includes('after')
/** seasons per career: `y5` runs a 2021 start through 2025 */
const YEARS = Number(process.argv.find((a) => /^y\d+$/.test(a))?.slice(1) ?? 2)
// the helper under test, only once it exists
const nu: typeof import('../src/engine/me/nextup') | null = AFTER ? await import('../src/engine/me/nextup') : null

interface Scn { key: string; label: string; region: string; start: StartPoint; year: number }
const SCN: Scn[] = [
  { key: 'na21', label: '2021 北美 · Challengers 首发', region: 'North America', start: 'chal', year: 2021 },
  { key: 'eu21', label: '2021 欧洲 · 强队第六人', region: 'Europe', start: 't1', year: 2021 },
  { key: 'kr21', label: '2021 韩国 · Challengers 首发', region: 'Korea', start: 'chal', year: 2021 },
  { key: 'cn26', label: '2026 中国 · VCT 第六人', region: 'China', start: 't1', year: 2026 },
  { key: 'eu26', label: '2026 欧洲 · Challengers 首发', region: 'Europe', start: 'chal', year: 2026 },
  { key: 'pa26', label: '2026 太平洋 · VCT 第六人', region: 'Pacific', start: 't1', year: 2026 },
]

const md = (year: number, day: number): string => {
  const d = new Date(Date.UTC(year, 0, 1 + day))
  return `${year}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
const med = (xs: number[]): number => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0 }
const roundOf = (f: Fixture): string => f.label.replace(/^(KO|SW):-?\d+:/, '')
const isScrim = (f: Fixture): boolean => f.comp === 'scrim' || !!f.scrim

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

function fmtOf(year: number, ev: CEvent): string {
  const qual = ev.units.some((u) => u.type === 'open') || /Qualifier|Open|Last Chance/i.test(ev.name)
  const base = ev.plan ? `新赛制·${ev.plan.kind}` : !ev.region ? '国际赛' : isLeagueEvent(year, ev) ? 'VCT 联赛' : ev.scene ? 'Challengers 联赛' : year <= 2022 ? '2021–22 赛区赛' : '其他二线'
  return qual && !ev.plan ? `${base}·含资格赛` : base
}

/** The unit's format, read off its rounds: Swiss rounds pair sides by record (第 N 轮 fed by wins and losses). */
function shapeOf(ev: CEvent, n: FNode): string {
  const u = ev.units[n.unit]
  const nodes = u.nodes ?? []
  const rounds = nodes.map((x) => x.round).join(' ')
  const fed = nodes.some((x) => [x.a, x.b].some((s) => s[0] === 'w' || s[0] === 'l'))
  if (/swiss|瑞士/i.test(`${u.label} ${u.phase ?? ''}`) || (fed && /第 ?\d+ ?轮/.test(rounds) && !/[胜败]者组/.test(rounds))) return '瑞士轮'
  if (u.type === 'rr') return '循环赛'
  if (/组/.test(u.label) && u.size <= 4) return '四队小组双败'
  if (/中段组/.test(rounds)) return '三败淘汰'
  return /败者组/.test(rounds) ? '双败淘汰' : '单败淘汰'
}

interface Track { f: Fixture; year: number; seen: number; played?: number; comp: string; compName: string; evId?: string }
interface Up { kind: string; day: number; name: string; round: string }
interface Sample {
  year: number
  v: number
  club: string
  rest: boolean
  next?: Fixture
  nextTxt: string
  up?: Up
  quiet28: boolean
  pendingOurs: boolean
  nextEvent?: { name: string; start: number }
}
interface Case { s: Sample; u: Track; where: 'event' | 'between'; fmt: string; shape: string; unit: string; slot: string; st: string; wait: number; draw: number; before: number }

const totals = { days: 0, rest: 0, event: 0, eventRest: 0, between: 0, betweenRest: 0, quiet: 0, quietRest: 0, pendingOurs: 0, missed: 0, wrong: 0, phantom: 0, quietLost: 0 }

function run(o: Scn): void {
  const t0 = Date.now()
  const state = createCareer({ name: 'Probe', region: o.region as Region, role: '决斗者', talents: emptyTalents(), originKey: 'netcafe', start: o.start, seed, year: o.year })
  const me = state.me!
  const TR: Track[] = []
  const seenF = new Map<Fixture, Track>()
  const W = new Map<string, number>()
  const BEGIN = new Map<string, number>()
  const samples: Sample[] = []
  const formats = new Map<string, number>()
  const ff = { runs: 0, handed: 0, auto: 0 }

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
    const next = nextRealFixtureFor(state, club)
    const tag = (id: string | null | undefined) => (id ? state.teams[id]?.tag ?? id : '待定')
    let up: Up | undefined
    let nextTxt: string
    if (nu) {
      const x = nu.nextUp(state)
      up = x.kind === 'fixture' ? { kind: x.kind, day: x.day, name: state.comps[x.fixture.comp]?.name ?? x.fixture.comp, round: roundOf(x.fixture) }
        : x.kind === 'none' ? { kind: 'none', day: -1, name: '', round: '' }
          : { kind: x.kind, day: x.day, name: x.name, round: 'round' in x ? x.round : '' }
      nextTxt = x.kind === 'fixture' ? `vs ${tag(x.fixture.teamA === club ? x.fixture.teamB : x.fixture.teamA)} · ${up.name} · ${up.round} · ${x.day - v} 天后`
        : x.kind === 'round' ? `${x.name} · ${x.round} · ${x.opponent ? `vs ${tag(x.opponent)}` : '对手待定'} · ${x.day - v} 天后`
          : x.kind === 'waiting' ? `${x.name} · 等小组打完，出线的话 ${x.day - v} 天后打${x.round}`
            : x.kind === 'event' ? `${x.out ? `${x.out}出局；` : ''}下一项 ${x.name} · ${x.day - v} 天后开打${x.sure ? '' : '（可以报名）'}`
              : `${x.out ? `${x.out}出局；` : ''}暂时没有排定的比赛。`
    } else {
      const opp = next ? state.teams[next.teamA === club ? next.teamB : next.teamA] : undefined
      nextTxt = next && opp
        ? `vs ${opp.tag} · ${state.comps[next.comp]?.name ?? next.comp} · ${roundOf(next)} · ${next.day - v <= 0 ? '今天' : `${next.day - v} 天后`}`
        : '暂时没有排定的比赛。'
    }
    const ne = Object.values(state.comps).filter((c) => !!c.circuit && !c.circuit.mode && c.circuit.start > v && (c.teams.includes(club) || c.circuit.seeds.includes(club)))
      .sort((a, b) => a.circuit!.start - b.circuit!.start)[0]
    samples.push({
      year, v, club, rest: me.weekDay === 0 || weekInDays(state), next, nextTxt, up,
      quiet28: quietAhead(state, 28),
      pendingOurs: !!nextInEvent(state) || (formatOf(year) !== 'open' && !!upcomingInternational(state)),
      nextEvent: ne ? { name: ne.name, start: ne.circuit!.start } : undefined,
    })
  }

  // the end of each day: advanceDay opens the next one with state.day++ (engine/season.ts), everything of the day before done
  let dayValue = state.day
  Object.defineProperty(state, 'day', {
    get: () => dayValue,
    set: (n: number) => { if (n === dayValue + 1) sample(dayValue); dayValue = n },
    enumerable: true,
    configurable: true,
  })

  const clear = (): void => {
    let g = 0
    while (me.pending.length && g++ < 30) {
      const it = me.pending[0]
      autoResolve(state, it)
      if (me.pending[0] === it) pop(state, it.kind, it.id)
    }
  }
  const endYear = o.year + YEARS
  let guard = 0
  try {
    while (state.year < endYear && !state.gameOver && me.phase !== 'retired' && guard++ < 5000) {
      clear()
      if (me.phase === 'retired' || state.gameOver) break
      if (FF && (me.weekDay === 0 || weekInDays(state)) && quietAhead(state, 28) && !runBlocked(state)) {
        const before = me.matches.length
        const r = advanceUntil(state, 'month')
        ff.runs++
        ff.auto += me.matches.length - before
        if (r.stop.kind === 'match') { ff.handed++; new MeMatch(state, r.stop.fixture).runOut() }
        continue
      }
      const stop = advanceTurn(state)
      if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    }
  } catch (e) {
    console.log(`✗ ${o.label}：${state.year} 年第 ${state.day} 天崩了 —— ${String((e as Error).stack ?? e).split('\n').slice(0, 5).join(' | ')}`)
  }
  for (const c of Object.values(state.comps)) formats.set(c.format ?? 'single', (formats.get(c.format ?? 'single') ?? 0) + 1)

  const byNode = new Map<string, Track>()
  for (const t of TR) if (t.f.node != null) byNode.set(`${t.year}:${t.comp}:${t.f.node}`, t)
  const mineCache = new Map<string, Track[]>()
  const mine = (club: string, year: number): Track[] => {
    const k = `${club}:${year}`
    let hit = mineCache.get(k)
    if (!hit) {
      hit = TR.filter((t) => t.year === year && !isScrim(t.f) && (t.f.teamA === club || t.f.teamB === club)).sort((a, b) => a.f.day - b.f.day)
      mineCache.set(k, hit)
    }
    return hit
  }
  const nodeDay = (t: Track, idx: number): number | null => {
    const hit = byNode.get(`${t.year}:${t.comp}:${idx}`)
    if (hit?.played != null) return hit.played
    return W.get(`${t.year}:${t.comp}:${idx}`) ?? null
  }
  const unitDay = (t: Track, ev: CEvent, ui: number): number | null => {
    const u = ev.units[ui]
    if (u.type === 'open') return u.last ?? null
    const { base } = flatOf(ev)
    let max = -1
    for (let i = 0; i < (u.nodes?.length ?? 0); i++) {
      const d = nodeDay(t, base[ui] + i)
      if (d == null) return null
      max = Math.max(max, d)
    }
    return max
  }
  const slotDay = (t: Track, ev: CEvent, n: FNode, s: Slot): number | null => {
    if (s[0] === 'w' || s[0] === 'l') return nodeDay(t, flatOf(ev).base[n.unit] + s[1])
    if (s[0] === 'g') return unitDay(t, ev, s[1])
    const playin = byNode.get(`${t.year}:${t.comp}:-1`)
    return playin?.played ?? BEGIN.get(`${t.year}:${t.comp}`) ?? null
  }

  const cases: Case[] = []
  let quiet = 0
  let quietRest = 0
  let quietLost = 0
  const quietEx: string[] = []
  let pendingOurs = 0
  let days = 0
  let rest = 0
  let gone = 0
  let phantom = 0
  const phantomEx: string[] = []
  let waitingOut = 0
  const waitingOutEx: string[] = []
  for (const s of samples) {
    days++
    if (s.rest) rest++
    if (s.pendingOurs) pendingOurs++
    const all = mine(s.club, s.year)
    const open = all.filter((t) => (t.played == null || t.played > s.v) && t.played != null)
    const first = open.slice().sort((a, b) => a.f.day - b.f.day)[0]
    // after: 「这一阶段还没打完」 said, and the club never played that event again
    if (s.up?.kind === 'waiting' && !open.some((t) => t.compName === s.up!.name)) {
      waitingOut++
      if (waitingOutEx.length < 4) waitingOutEx.push(`${md(s.year, s.v)}${s.rest ? '' : '（跑周中）'}：本周写「${s.nextTxt}」，实际下一场 ${first ? `${md(first.year, first.f.day)} ${first.compName} ${roundOf(first.f)}` : '没有'}`)
    }
    const soon = open.some((t) => t.f.day <= s.v + 28)
    if (s.quiet28 && soon) {
      quiet++
      if (s.rest) quietRest++
      if (quietEx.length < 4 && s.rest) {
        quietEx.push(`${md(s.year, s.v)}：「接下来四周没有你的比赛」，${first.f.day - s.v} 天后打 ${first.compName} ${roundOf(first.f)}（${first.seen > s.v ? `${md(first.year, first.seen)} 那天打完才写进赛程` : '已在赛程里'}）`)
      }
    }
    if (!s.quiet28 && !soon && s.rest) quietLost++
    // after: a round or a tie named that is not what the career played next
    if (s.up && (s.up.kind === 'round' || s.up.kind === 'fixture')) {
      const hit = first && first.compName === s.up.name && roundOf(first.f) === s.up.round && Math.abs(first.f.day - s.up.day) <= 2
      if (!hit) {
        phantom++
        if (phantomEx.length < 4) phantomEx.push(`${md(s.year, s.v)}：本周写「${s.nextTxt}」，实际下一场 ${first ? `${md(first.year, first.f.day)} ${first.compName} ${roundOf(first.f)}` : '没有'}`)
      }
    }
    const u = open.filter((t) => t.seen > s.v).sort((a, b) => a.f.day - b.f.day)[0]
    if (!u) { if (!s.next) gone++; continue }
    if (s.next && u.f.day >= s.next.day) continue
    const begun = BEGIN.get(`${s.year}:${u.comp}`)
    const where: Case['where'] = begun != null && begun <= s.v ? 'event' : 'between'
    const before = all.filter((t) => t.comp === u.comp && t.played != null && t.played <= s.v).length
    const ev = u.evId ? eventOf(u.evId) : undefined
    const fmt = ev ? fmtOf(s.year, ev) : (state.comps[u.comp]?.format ?? '?')
    let shape = '-'
    let unit = '-'
    let slot = '-'
    let st = '-'
    if (ev && u.f.node != null && u.f.node >= 0) {
      const n = flatOf(ev).nodes[u.f.node]
      const mySlot = u.f.teamA === s.club ? n.a : n.b
      const other = u.f.teamA === s.club ? n.b : n.a
      shape = shapeOf(ev, n)
      unit = ev.units[n.unit].label
      slot = mySlot[0]
      const dMine = slotDay(u, ev, n, mySlot)
      const dOther = slotDay(u, ev, n, other)
      st = dMine != null && dMine <= s.v ? (dOther != null && dOther <= s.v ? 'lag' : 'known') : 'waiting'
    } else if (u.f.node === -1) shape = '决胜局'
    cases.push({ s, u, where, fmt, shape, unit, slot, st, wait: u.f.day - s.v, draw: u.seen - s.v, before })
  }

  /** after: did nextUp name this case's round (in an event) or its event (between)? */
  const covered = (c: Case): 'yes' | 'wrong' | 'no' => {
    const up = c.s.up
    if (!up) return 'no'
    if (c.where === 'event') {
      if (up.kind === 'waiting' && up.name === c.u.compName) return 'yes'
      if (up.kind === 'round') return up.name === c.u.compName && up.round === roundOf(c.u.f) && Math.abs(up.day - c.u.f.day) <= 2 ? 'yes' : 'wrong'
      return up.kind === 'waiting' ? 'wrong' : 'no'
    }
    if (up.kind === 'event') return up.name === c.u.compName ? 'yes' : 'wrong'
    return up.kind === 'round' || up.kind === 'waiting' ? 'wrong' : 'no'
  }

  const inEvent = cases.filter((c) => c.where === 'event')
  const between = cases.filter((c) => c.where === 'between')
  const cov = (xs: Case[]) => nu ? ` · 新的「下一场」说对 ${xs.filter((c) => covered(c) === 'yes').length}、说错 ${xs.filter((c) => covered(c) === 'wrong').length}、没说 ${xs.filter((c) => covered(c) === 'no').length}` : ''
  console.log(`\n== ${o.label}（seed ${seed}${FF ? '，按月快进' : ''}${nu ? '，读 nextUp' : ''}）· ${((Date.now() - t0) / 1000).toFixed(0)}s · 走到 ${md(state.year, state.day)}`)
  console.log(`  职业日 ${days}（其中停在本周页等你按的 ${rest}）· 赛事格式：${[...formats].map(([k, v]) => `${k} ${v}`).join(' / ')} · 赛程页会画「对手待定」的天数 ${pendingOurs}`)
  console.log(`  赛事进行中、还有下一轮，赛程里却还没有这一场：${inEvent.length} 天（本周页 ${inEvent.filter((c) => c.s.rest).length}）${cov(inEvent)}`)
  console.log(`  两项赛事之间（下一项还没抽签）：${between.length} 天（本周页 ${between.filter((c) => c.s.rest).length}）${cov(between)} · 真的没有比赛了 ${gone} 天`)
  const groups = new Map<string, Case[]>()
  for (const c of inEvent) {
    const k = `${c.fmt} | ${c.shape} | 我方来自 ${c.slot} | ${c.st}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  const oppOf = (club: string, f: Fixture) => state.teams[f.teamA === club ? f.teamB : f.teamA]?.tag ?? '?'
  for (const [k, xs] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${k}：${xs.length} 天（本周页 ${xs.filter((c) => c.s.rest).length}）· 离开打 中位 ${med(xs.map((c) => c.wait))} 最多 ${Math.max(...xs.map((c) => c.wait))} 天 · 离写进赛程 中位 ${med(xs.map((c) => c.draw))} 最多 ${Math.max(...xs.map((c) => c.draw))} 天${cov(xs)}`)
    const ex = xs.filter((c) => c.s.rest)
    for (const c of (ex.length ? ex : xs).slice(0, 2)) {
      const last = mine(c.s.club, c.s.year).filter((t) => t.played != null && t.played <= c.s.v).sort((a, b) => a.played! - b.played!).pop()
      const r = last?.f.result
      const my = last && r ? (last.f.teamA === c.s.club ? `${r.mapsWonA}-${r.mapsWonB}` : `${r.mapsWonB}-${r.mapsWonA}`) : ''
      console.log(`      ${md(c.s.year, c.s.v)}${c.s.rest ? '' : '（跑周中）'} · ${c.u.compName}（${c.unit}）：本周「下一场」${c.s.nextTxt}`
        + ` · 赛程页最后一行 ${last ? `${md(last.year, last.f.day)} ${last.compName} ${roundOf(last.f)} vs ${oppOf(c.s.club, last.f)} ${my}` : '—'}（这项赛事已打 ${c.before} 场）`
        + ` · 实际下一场 ${md(c.u.year, c.u.f.day)} ${roundOf(c.u.f)} vs ${oppOf(c.s.club, c.u.f)}，${md(c.u.year, c.u.seen)} 那天打完才写进赛程`)
    }
  }
  const bGroups = new Map<string, Case[]>()
  for (const c of between) bGroups.set(c.fmt, [...(bGroups.get(c.fmt) ?? []), c])
  for (const [k, xs] of [...bGroups].sort((a, b) => b[1].length - a[1].length)) {
    const known = xs.filter((c) => !!c.s.nextEvent).length
    console.log(`    两项之间 → ${k}：${xs.length} 天（本周页 ${xs.filter((c) => c.s.rest).length}）· 离开打 中位 ${med(xs.map((c) => c.wait))} 最多 ${Math.max(...xs.map((c) => c.wait))} 天 · 当天名单里已有你 ${known} 天${cov(xs)}`)
    if (nu) for (const c of xs.filter((x) => covered(x) !== 'yes' && x.s.rest).slice(0, 2)) console.log(`      ${md(c.s.year, c.s.v)}：本周写「${c.s.nextTxt}」，实际下一场 ${md(c.u.year, c.u.f.day)} ${c.u.compName}`)
  }
  console.log(`  「接下来四周没有你的比赛」而 28 天内其实有你的比赛：${quiet} 天（本周页 ${quietRest}）· 四周里真没有比赛却没给按月快进（本周页）${quietLost} 天${quietEx.length ? `\n    ${quietEx.join('\n    ')}` : ''}`)
  if (nu) console.log(`  「下一场」写了一场、实际下一场不是它：${phantom} 天${phantomEx.length ? `\n    ${phantomEx.join('\n    ')}` : ''}`)
  if (nu) console.log(`  写「这一阶段还没打完」、后来这项赛事再没打：${waitingOut} 天${waitingOutEx.length ? `\n    ${waitingOutEx.join('\n    ')}` : ''}`)
  if (FF) console.log(`  按月快进 ${ff.runs} 次，停在比赛前交给你 ${ff.handed} 次，路上替你打掉的正式比赛 ${ff.auto} 场`)
  totals.days += days
  totals.rest += rest
  totals.event += inEvent.length
  totals.eventRest += inEvent.filter((c) => c.s.rest).length
  totals.between += between.length
  totals.betweenRest += between.filter((c) => c.s.rest).length
  totals.quiet += quiet
  totals.quietRest += quietRest
  totals.quietLost += quietLost
  totals.pendingOurs += pendingOurs
  totals.missed += nu ? cases.filter((c) => covered(c) === 'no' && (c.where === 'between' ? !!c.s.nextEvent : c.st !== 'waiting')).length : 0
  totals.wrong += nu ? cases.filter((c) => covered(c) === 'wrong').length : 0
  totals.phantom += phantom
}

for (const o of SCN) if (!keys.length || keys.includes(o.key)) run(o)
console.log(`\n合计：职业日 ${totals.days}（本周页 ${totals.rest}）· 赛事中还有下一轮、赛程里却还没有 ${totals.event}（本周页 ${totals.eventRest}）· 两项之间 ${totals.between}（本周页 ${totals.betweenRest}）· 四周无赛却有赛 ${totals.quiet}（本周页 ${totals.quietRest}）· 没给按月快进 ${totals.quietLost} · 赛程页画「对手待定」${totals.pendingOurs}`
  + (nu ? ` · nextUp 该说没说 ${totals.missed}、说错 ${totals.wrong}、写了不是下一场的 ${totals.phantom}` : ''))
