/**
 * 「点击推进到赛季末从来都不会模拟大师赛和冠军赛」 (reported 2026-09-16).
 *
 * A probe, not a check. One career, two ways of playing the same season out:
 *
 *   周推   the week screen's own button — engine/me/week.ts advanceTurn, my
 *          club's matches played as the match screen plays them (runOut)
 *   快进   「快进到…」 → 赛季末 — engine/me/auto.ts advanceUntil(state, 'season'),
 *          which is exactly what ui PlayerGame.tsx advanceMany calls
 *
 * Both runs start from the same career (the same save, cloned), so anything
 * that differs between them is the fast-forward's doing and nothing else.
 *
 * Every day of both runs is sampled — a getter on state.day, so nothing in the
 * engine is touched — and for each 大师赛 / 冠军赛 / LOCK//IN of that year it
 * writes down: whether my club is in the field, whether the event is being
 * played here or kept as history, how many ties of my club's it wrote, how many
 * were played, how many of them are in my own record, and who won it. The
 * 推进总结's own lines are kept too, so the report's 「看总结」 can be read
 * against what actually happened.
 *
 *   npx tsx scripts/probe_seasonend.ts [seed=11] [years=2] [scn=cn26,eu26,pa26]
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
import { advanceUntil, autoPlan, autoResolve, runAutoPilot } from '../src/engine/me/auto'
import { MeMatch } from '../src/engine/me/matchplay'
import { compClass, isIntlComp } from '../src/engine/me/compclass'
import { compCn } from '../src/engine/me/compname'
import type { GameState, Region } from '../src/engine/types'

const seed = Number(process.argv[2] ?? 11)
const YEARS = Number(process.argv[3] ?? 2)
const only = (process.argv[4] ?? '').split(',').filter(Boolean)

interface Scn { key: string; label: string; region: string; start: StartPoint; year: number }
const SCN: Scn[] = [
  { key: 'cn26', label: '2026 中国 · VCT 第六人', region: 'China', start: 't1', year: 2026 },
  { key: 'eu26', label: '2026 欧洲 · VCT 第六人', region: 'Europe', start: 't1', year: 2026 },
  { key: 'pa26', label: '2026 太平洋 · VCT 第六人', region: 'Pacific', start: 't1', year: 2026 },
  { key: 'eu21', label: '2021 欧洲 · 强队第六人', region: 'Europe', start: 't1', year: 2021 },
]

/** one international of one year, as the last day of that year saw it */
interface Row {
  year: number
  key: string
  name: string
  cls: string
  /** 'sim' plays it here, 'history' keeps the real result and plays nothing */
  mode: string
  /** my club in its field */
  seated: boolean
  /** ties of my club's written into the schedule, and how many were played */
  fx: number
  fxPlayed: number
  /** matches of mine on my own record (bench included) */
  mine: number
  starts: number
  champion: string
  over: boolean
  start: number
  end: number
  /** the 打进大赛 card fired (me/moments.ts noteQualify) */
  card: boolean
}

const rowsOf = (state: GameState, book: Map<string, Row>): void => {
  const me = state.me
  if (!me) return
  const club = state.myTeam
  for (const comp of Object.values(state.comps)) {
    if (!isIntlComp(comp.name)) continue
    const c = comp.circuit
    const seated = !!club && (comp.teams.includes(club)
      || !!c?.seeds.includes(club) || Object.values(c?.fill ?? {}).includes(club))
    const fx = state.fixtures.filter((f) => f.comp === comp.key && !!club && (f.teamA === club || f.teamB === club))
    const mine = me.matches.filter((m) => m.year === state.year && !m.friendly
      && (m.comp === comp.key || m.comp === comp.name))
    book.set(`${state.year}:${comp.key}`, {
      year: state.year, key: comp.key, name: comp.name, cls: compClass(comp.name),
      mode: c ? (c.mode ?? '未开') : '非真实赛历',
      seated,
      fx: fx.length,
      fxPlayed: fx.filter((f) => f.played).length,
      mine: mine.length,
      starts: mine.filter((m) => m.started).length,
      champion: comp.champion ? (state.teams[comp.champion]?.tag ?? comp.champion) : '',
      over: !!comp.champion || !!c?.done,
      start: c?.start ?? 0,
      end: c?.end ?? 0,
      card: !!me.flags[`qual:${comp.key}`],
    })
  }
}

/** sample every morning, without the engine knowing: state.day is written once a day (season.ts advanceDay) */
function watchDays(state: GameState, on: () => void): void {
  let d = state.day
  Object.defineProperty(state, 'day', {
    get: () => d,
    // only a day going forward: the year's turn puts the day back to 0 with the old
    // year's competitions still on the books (season.ts endSeason), and that is not a day
    set: (v: number) => { const fwd = v > d; d = v; if (fwd) on() },
    configurable: true, enumerable: true,
  })
}

const clone = (state: GameState): GameState => JSON.parse(JSON.stringify(state)) as GameState

/** 周推: the week screen's button, and my club's matches played by the numbers */
function weekly(state: GameState, untilYear: number): void {
  const me = state.me!
  let guard = 0
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 4000) {
    runAutoPilot(state)
    let g = 0
    while (me.pending.length && g++ < 40) autoResolve(state, me.pending[0])
    if (me.weekDay === 0 && me.ap === me.apMax) autoPlan(state)
    const stop = advanceTurn(state)
    if (stop.kind === 'match') new MeMatch(state, stop.fixture).runOut()
    if (stop.kind === 'game-over') break
  }
}

/** 快进到赛季末, pressed again for each year — every press's summary kept as the player would read it */
function fastForward(state: GameState, untilYear: number): { notes: string[]; presses: string[] } {
  const me = state.me!
  const out: string[] = []
  const presses: string[] = []
  let guard = 0
  let at = ''
  while (state.year < untilYear && me.phase !== 'retired' && !state.gameOver && guard++ < 400) {
    const r = advanceUntil(state, 'season')
    out.push(...r.notes)
    presses.push(`${state.year} 年第 ${state.day} 天 · 推进了 ${r.weeks} 周 · 总结 ${r.notes.length} 行 · 停在 ${r.stop.kind}`
      + `${r.stop.kind === 'pending' ? `（${r.stop.item.kind}）` : ''}`)
    if (r.stop.kind === 'game-over') break
    // the run handed me a match or a decision: the screen plays it / answers it, then it is pressed again
    if (r.stop.kind === 'match') { new MeMatch(state, r.stop.fixture).runOut(); continue }
    if (r.stop.kind === 'pending' && me.pending.length) { autoResolve(state, me.pending[0]); continue }
    const now = `${state.year}:${state.day}:${me.pending.length}`
    if (now === at && !r.weeks) break
    at = now
  }
  return { notes: out, presses }
}

const fmt = (r: Row): string =>
  `${r.name}（第 ${r.start}–${r.end} 天）${r.seated ? '我队在列' : '我队不在'}`
  + ` · ${r.mode === 'sim' ? '这里打' : r.mode === 'history' ? '按真实历史' : r.mode}`
  + ` · 我队赛程 ${r.fx} 场（打完 ${r.fxPlayed}）· 我的记录 ${r.mine} 场（首发 ${r.starts}）`
  + `${r.card ? ' · 出过打进大赛的卡' : ''}${r.champion ? ` · 冠军 ${r.champion}` : r.over ? ' · 已结束' : ' · 未结束'}`

let bad = 0
const t0 = Date.now()

for (const o of SCN) {
  if (only.length && !only.includes(o.key)) continue
  const born = createCareer({
    name: 'Probe', region: o.region as Region, role: '决斗者', talents: emptyTalents(),
    originKey: 'netcafe', start: o.start, seed, year: o.year,
  })
  const club = born.teams[born.myTeam]
  console.log(`\n=== ${o.label} · seed ${seed} · ${club?.name ?? '?'}（${club?.tag ?? '?'}，实力 ${club?.rating ?? 0}）· 打到 ${o.year + YEARS - 1} 年 ===`)

  const runs: { label: string; book: Map<string, Row>; notes: string[]; presses: string[]; state: GameState }[] = []
  for (const mode of ['周推', '快进到赛季末'] as const) {
    const state = clone(born)
    const book = new Map<string, Row>()
    watchDays(state, () => rowsOf(state, book))
    rowsOf(state, book)
    const t1 = Date.now()
    const ff = mode === '周推' ? (weekly(state, o.year + YEARS), { notes: [], presses: [] }) : fastForward(state, o.year + YEARS)
    runs.push({ label: mode, book, notes: ff.notes, presses: ff.presses, state })
    const me = state.me!
    const intl = me.matches.filter((m) => !m.friendly && isIntlComp(state.comps[m.comp]?.name ?? m.comp))
    console.log(`\n-- ${mode} · ${((Date.now() - t1) / 1000).toFixed(0)}s · 到 ${state.year} 年第 ${state.day} 天 · 我的全部比赛 ${me.matches.filter((m) => !m.friendly).length} 场，其中国际赛 ${intl.length} 场`)
    const years = [...new Set([...book.values()].map((r) => r.year))].sort()
    for (const y of years) {
      const rows = [...book.values()].filter((r) => r.year === y).sort((a, b) => a.start - b.start)
      const mineRows = rows.filter((r) => r.seated)
      console.log(`  ${y}：国际赛 ${rows.length} 项，我队在列 ${mineRows.length} 项`)
      for (const r of rows) console.log(`    ${r.seated ? '★' : '·'} ${fmt(r)}`)
    }
    const s = me.seasons.map((x) => `${x.year} ${x.team} 出场 ${x.starts}/${x.matches}${x.titles.length ? ` 冠军 ${x.titles.join('、')}` : ''}${x.quals?.length ? ` 出线 ${x.quals.join('、')}` : ''}`)
    for (const line of s) console.log(`  生涯行：${line}`)
  }

  // ---- the two runs side by side
  const [a, b] = runs
  if (!a || !b) continue
  const keys = [...new Set([...a.book.keys(), ...b.book.keys()])].sort()
  const diffs: string[] = []
  for (const k of keys) {
    const x = a.book.get(k)
    const y = b.book.get(k)
    if (!x || !y) { diffs.push(`${k}：只有${x ? a.label : b.label}有这项赛事`); continue }
    if (!x.seated && !y.seated) continue
    if (x.seated !== y.seated || x.mode !== y.mode || x.fx !== y.fx || x.fxPlayed !== y.fxPlayed || x.mine !== y.mine) {
      diffs.push(`${x.name}（${x.year}）：${a.label} ${x.seated ? '在列' : '不在'}/${x.mode}/赛程 ${x.fx} 打完 ${x.fxPlayed}/我的记录 ${x.mine}`
        + ` ≠ ${b.label} ${y.seated ? '在列' : '不在'}/${y.mode}/赛程 ${y.fx} 打完 ${y.fxPlayed}/我的记录 ${y.mine}`)
    }
  }
  console.log(`\n-- 两种推进方式的差别：${diffs.length ? '' : '没有'}`)
  for (const d of diffs) { console.log(`  ✗ ${d}`); bad++ }

  const intlNotes = b.notes.filter((n) => isIntlComp(n.split(' vs ')[0] ?? ''))
  console.log(`-- 「快进到赛季末」按了 ${b.presses.length} 次，每次的总结：`)
  for (const s of b.presses.slice(0, 20)) console.log(`     ${s}`)
  console.log(`-- 推进总结一共 ${b.notes.length} 行，其中写到国际赛的 ${intlNotes.length} 行${intlNotes.length ? '（前 12 行）：' : ''}`)
  for (const n of intlNotes.slice(0, 12)) console.log(`     ${n}`)
  // what a club's international record looks like in the summary the player reads
  const seatedB = [...b.book.values()].filter((r) => r.seated && (r.cls === 'masters' || r.cls === 'champions'))
  for (const r of seatedB) {
    if (r.fxPlayed === 0) { console.log(`  ✗ 快进：${r.year} ${r.name} 我队在列，却一场都没打`); bad++ }
    else if (!b.notes.some((n) => n.includes(r.name))) { console.log(`  ✗ 快进：${r.year} ${r.name} 打了 ${r.fxPlayed} 场，推进总结里一行都没写`); bad++ }
  }
  // and what the 赛季结束 card and the 生涯 table say about it (ui/me/Modals.tsx SeasonModal, ui/me/MeScreen.tsx).
  // 冠军 and 出线 were all the season's row ever kept; the club's own record of a Masters it did not
  // win was nowhere, which is what the report was about (engine/me/intl.ts)
  console.log('-- 赛季结束那张卡 / 「我」页生涯表里，这一年的国际赛写了什么：')
  for (const r of seatedB) {
    const s = b.state.me!.seasons.find((x) => x.year === r.year)
    const won = [...(s?.titles ?? []), ...(s?.quals ?? [])].filter((t) => t.includes(r.name) || r.name.includes(t))
    const line = (s?.intl ?? []).filter((x) => x.startsWith(compCn(r.name)))
    console.log(`     ${r.year} ${r.name}：打了 ${r.fxPlayed} 场 → 生涯行写「${[...line, ...won].join('、') || '什么都没写'}」`)
  }
}

console.log(`\n${bad ? `✗ ${bad} 处对不上` : '✓ 两种推进方式看到的国际赛一样'} · ${((Date.now() - t0) / 1000).toFixed(0)}s`)
