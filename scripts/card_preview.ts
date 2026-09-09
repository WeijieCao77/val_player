/**
 * Look at the career card without playing to retirement.
 *
 *   npm run dev   →   http://localhost:5173/card-preview.html
 *
 * Runs a career forward for a few seasons with the autopilot, retires the
 * player, draws the card at full size and puts it on the page. Dev only — the
 * build's only entry is index.html, so this ships nowhere.
 */
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import { retire } from '../src/engine/me/endings'
import { drawCareerCard } from '../src/ui/me/share'

const seasons = Number(new URLSearchParams(location.search).get('seasons') ?? 6)
const seed = Number(new URLSearchParams(location.search).get('seed') ?? 7)

const state = createCareer({
  name: 'Probe', region: 'China', role: '决斗者',
  talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
})
const me = state.me!
const year0 = state.year
let guard = 0
while (state.year - year0 < seasons && guard++ < 60 * seasons) {
  if (autoWeek(state).kind === 'game-over') break
}
if (!me.ending) retire(state, '预览')

const bar = document.getElementById('bar')!
bar.textContent = `seed ${seed} · ${year0}–${state.year} · ${me.seasons.length} 季 · `
  + `${me.titles.length} 冠 · 生涯收入 $${(me.ledger?.lifetimeIn ?? 0).toLocaleString()} · 「${me.ending?.title}」`

const cv = drawCareerCard(state)
if (cv) document.getElementById('out')!.appendChild(cv)
else bar.textContent += ' — 画不出来'
