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
import '../src/ui/me/base.css'
import '../src/me.css'

type Title = { year: number; title: string; started: boolean }
type Case = { label: string; titles: (y: number) => Title[]; flags?: Record<string, number>; seasons?: number }

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
  // 泯然众人 — a real career with nothing on the shelf
  none: { label: '泯然众人（无冠）', titles: () => [] },
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
        <div style={{ padding: '12px 16px' }}>
          <p className="small" style={{ margin: 0 }}>
            <b>{kase.label}</b> · 「{me.ending?.title}」 · {me.seasons.length} 季 · {me.titles.length} 冠 ·
            {Object.keys(CASES).map((k) => (
              <a key={k} href={`?case=${k}&theme=${theme}`} style={{ marginLeft: 8 }}>{k}</a>
            ))}
            <span style={{ marginLeft: 14 }}>
              {(['dark', 'light', 'cream'] as Theme[]).map((t) => (
                <a key={t} href={`?case=${key}&theme=${t}`} style={{ marginLeft: 8 }}>{t}</a>
              ))}
            </span>
          </p>
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
