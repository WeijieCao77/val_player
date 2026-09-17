/**
 * The career-end card, on demand, without playing to retirement.
 *
 *   npm run dev  →  /ending-preview.html?case=champ&theme=dark
 *   case:  champ | breaker | ring | regional | none | shore
 *   theme: dark | light | cream
 *   bare=1  draw the card alone, no modal chrome, for a clean screenshot
 *
 * Runs a career forward with the autopilot, replaces its trophy shelf with the
 * one the case is about, retires the player, and mounts the real pending card
 * with the real game context — so what is on screen is what a player would get.
 *
 * The cases are the ones the card has to carry and that a played save reaches
 * only by luck: a world champion who started, the same shelf won from the
 * bench, and a career with nothing on it at all.
 *
 * Dev only; the build's only entry is index.html.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { retire } from '../src/engine/me/endings'
import PendingModal from '../src/ui/me/Modals'
import Poster from '../src/ui/me/Poster'
import { GameCtx } from '../src/ui/me/ctx'
import { paintTheme } from '../src/ui/me/theme'
import type { Theme } from '../src/ui/me/theme'
import type { MeIntlRun } from '../src/engine/me/types'
import '../src/ui/me/base.css'
import '../src/me.css'

type Title = { year: number; title: string; started: boolean }
type Case = {
  label: string
  titles: (y: number) => Title[]
  /** 大师赛 / 冠军赛 the club played — engine-written (me/intl.ts), so a built end state has to supply its own */
  runs?: (y: number) => MeIntlRun[]
  flags?: Record<string, number>
  seasons?: number
}

/**
 * Names, not keys: `compClass` reads the kind of event off the stored name, so
 * the shelf here has to be spelled the way the timeline spells it or the card
 * would rank a fake trophy correctly by accident.
 */
const CASES: Record<string, Case> = {
  // 世界冠军 — the top of the three tiers, started, with a Masters and regional under it
  champ: {
    label: '世界冠军（首发）',
    titles: (y) => [
      { year: y - 4, title: 'VCT Europe · Stage 1', started: true },
      { year: y - 3, title: '东京大师赛', started: true },
      { year: y - 2, title: 'VCT Europe · Stage 2', started: true },
      { year: y - 1, title: `${y - 1} 全球冠军赛`, started: true },
    ],
  },
  // 破局者 — Masters and Champions in one year, the rarest ending
  breaker: {
    label: '破局者（同年双冠）',
    titles: (y) => [
      { year: y - 3, title: 'VCT Europe · Stage 1', started: true },
      { year: y - 1, title: '马德里大师赛', started: true },
      { year: y - 1, title: `${y - 1} 全球冠军赛`, started: true },
    ],
  },
  // 板凳上的冠军 — the same shelf, none of it started
  ring: {
    label: '板凳上的冠军',
    titles: (y) => [
      { year: y - 3, title: '东京大师赛', started: false },
      { year: y - 2, title: 'VCT Europe · Stage 2', started: false },
      { year: y - 1, title: `${y - 1} 全球冠军赛`, started: false },
    ],
  },
  // 赛区功勋 — three regional titles, no international
  regional: {
    label: '赛区功勋',
    titles: (y) => [
      { year: y - 4, title: 'VCT Europe · Stage 1', started: true },
      { year: y - 3, title: 'VCT Europe · Stage 2', started: true },
      { year: y - 1, title: 'VCT Europe · Stage 1', started: true },
    ],
  },
  // 打进过冠军赛却没捧杯 — what the structured cls/place on MeIntlRun are for.
  // Listed here out of order on purpose: the card ranks by class then placing,
  // so 冠军赛第 4 must come out above 大师赛第 3, and the side that never placed last.
  deep: {
    label: '冠军赛第四，没有冠军',
    titles: () => [],
    flags: { abroadSeasons: 0 },
    runs: (y) => [
      { year: y - 1, key: `${y - 1}:m2`, comp: '马德里大师赛', cls: 'masters', matches: 4, starts: 2, wins: 1,
        line: '马德里大师赛 1 胜 3 负 · 没能排上名次（你首发 2 场）' },
      { year: y - 2, key: `${y - 2}:c`, comp: `${y - 2} 全球冠军赛`, cls: 'champions', place: 4, matches: 9, starts: 9, wins: 5,
        line: `${y - 2} 全球冠军赛 5 胜 4 负 · 第 4 名（你首发 9 场）` },
      { year: y - 3, key: `${y - 3}:m1`, comp: '东京大师赛', cls: 'masters', place: 3, matches: 7, starts: 7, wins: 4,
        line: '东京大师赛 4 胜 3 负 · 第 3 名（你首发 7 场）' },
    ],
  },
  // 泯然众人 — a real career with nothing on the shelf, at home. Since 2026-09-17
  // a trophyless career cannot read 「远征」 whatever it did abroad (me/endings.ts),
  // so the spell abroad is a line inside this ending instead of a verdict above it:
  // `away` is the same career with three seasons in another region.
  none: { label: '泯然众人（无冠）', titles: () => [], flags: { abroadSeasons: 0 } },
  away: { label: '泯然众人（无冠 · 在外赛区打过）', titles: () => [], flags: { abroadSeasons: 3 } },
  // 没能上岸 — never signed at all
  shore: { label: '没能上岸', titles: () => [], seasons: 0 },
}

const q = new URLSearchParams(location.search)
const key = q.get('case') ?? 'champ'
const kase = CASES[key] ?? CASES.champ
const theme = (q.get('theme') ?? 'dark') as Theme
const bare = q.get('bare') === '1'
paintTheme(theme)

const state = createCareer({
  name: 'Probe', region: 'Europe', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed: 7,
})
const me = state.me!
const year0 = state.year
const want = kase.seasons ?? 7
let guard = 0
while (state.year - year0 < want && guard++ < 60 * (want + 1)) {
  if (autoWeek(state).kind === 'game-over') break
}

// the shelf the case is about, in place of whatever the autopilot happened to win
me.titles = kase.titles(state.year)
for (const s of me.seasons) s.titles = me.titles.filter((t) => t.year === s.year).map((t) => t.title)
if (kase.flags) Object.assign(me.flags, kase.flags)
// me/intl.ts writes these as the club plays them; a built end state supplies its own
if (kase.runs) me.intlRuns = kase.runs(state.year)

if (me.phase !== 'retired') retire(state, '预览')
// the night before the card is its own ceremony; the card is what this page is for
me.cer = undefined
me.pending = me.pending.filter((p) => p.kind === 'ending')
if (!me.pending.length) me.pending = [{ kind: 'ending', day: state.day }]

function Harness() {
  const [n, setN] = useState(0)
  return (
    <GameCtx.Provider value={{
      game: state,
      commit: () => setN((k) => k + 1),
      toast: () => {},
      openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
    }}>
      {!bare && (
        // wraps, so the preview's own chrome never widens the page past the
        // phone the card is being checked at
        <div className="small" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'baseline', padding: '12px 16px' }}>
          <b>{kase.label}</b>
          <span>「{me.ending?.title}」</span>
          <span>{me.seasons.length} 季 · {me.titles.length} 冠</span>
          {Object.keys(CASES).map((k) => <a key={k} href={`?case=${k}&theme=${theme}`}>{k}</a>)}
          {(['dark', 'light', 'cream'] as Theme[]).map((t) => (
            <a key={t} href={`?case=${key}&theme=${t}`}>{t}</a>
          ))}
        </div>
      )}
      {bare
        ? <div id="shot" style={{ padding: 16 }}><Poster /></div>
        : <PendingModal item={me.pending[0]} onDone={() => setN((k) => k + 1)} />}
      <span hidden data-n={n} />
    </GameCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Harness /></StrictMode>)
