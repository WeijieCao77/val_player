/**
 * A real transfer offer, on demand, without playing to one.
 *
 *   npm run dev  →  /offer-preview.html?theme=dark
 *   theme: dark | light | cream
 *   wide=1   the same offer with the longest money strings the game can write
 *            (a top-tier 韩元 contract), to measure the worst realistic case
 *
 * Why it exists: the contract table in the offer card (ui/me/Modals.tsx DealModal)
 * is one of only two tables in the game that are not wrapped in `.table-wrap`, so
 * nothing stops it pushing the page sideways on a phone. Proving that needs a real
 * offer on screen at 375px, and an offer is many weeks of play away.
 *
 * Runs a career forward with the autopilot and stops the first week an offer
 * lands, then mounts the real card with the real game context — what is on screen
 * is what a player would get. The card is wrapped in `.app.career` because every
 * phone rule for modals is scoped to that shell (base.css 手机段); without it the
 * measurement would be of a desktop modal at a phone width.
 *
 * Dev only; the build's only entry is index.html. Built after the same pattern as
 * scripts/ending_preview.tsx.
 */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createCareer, emptyTalents } from '../src/engine/me/career'
import { autoWeek } from '../src/engine/me/auto'
import PendingModal from '../src/ui/me/Modals'
import { GameCtx } from '../src/ui/me/ctx'
import { paintTheme } from '../src/ui/me/theme'
import type { Theme } from '../src/ui/me/theme'
import type { GameState } from '../src/engine/types'
import type { PendingItem } from '../src/engine/me/types'
import '../src/ui/me/base.css'
import '../src/me.css'

const q = new URLSearchParams(location.search)
const theme = (q.get('theme') ?? 'dark') as Theme
const wide = q.get('wide') === '1'
paintTheme(theme)

/**
 * The first offer this seed produces. Several seeds, because whether a club
 * calls depends on how the career went, and a harness that only works on a
 * lucky seed is not a harness.
 */
function findOffer(): { state: GameState; item: PendingItem } | null {
  for (const seed of [7, 11, 23, 42, 99, 137]) {
    // createCareer throws when a region has no club of that tier to open at
    // (「2026 年开季时 China 没有二线俱乐部可以签」), so a seed that cannot be
    // built is skipped rather than taking the page down with it
    let state: GameState
    try {
      state = createCareer({
        name: 'Probe', region: 'Europe', role: '决斗者',
        talents: emptyTalents(), originKey: 'netcafe', start: 'chal', seed,
      })
    } catch { continue }
    const me = state.me!
    let guard = 0
    while (guard++ < 60 * 8) {
      // autoWeek answers whatever is pending at the START of its week, so an
      // offer pushed during this week is still unanswered when it returns
      if (autoWeek(state).kind === 'game-over') break
      const item = me.pending.find((p) => p.kind === 'deal')
      if (item && me.deals.some((d) => d.id === item.id)) return { state, item }
    }
  }
  return null
}

const found = findOffer()

function Harness({ state, item }: { state: GameState; item: PendingItem }) {
  const [n, setN] = useState(0)
  const deal = state.me!.deals.find((d) => d.id === item.id)!
  if (wide) {
    // the longest money the game can write: a first-team 韩元 contract
    deal.cur = 'KRW'
    deal.salary = 1_200_000_000
    deal.signBonus = 450_000_000
    deal.buyout = 3_600_000_000
    deal.years = 3
  }
  return (
    <GameCtx.Provider value={{
      game: state,
      commit: () => setN((k) => k + 1),
      toast: () => {},
      openPlayer: () => {}, openMatch: () => {}, go: () => {}, startTutorial: () => {},
    }}>
      {/* the shell the real card lives in: the phone rules are scoped to it */}
      <div className="app career">
        <PendingModal item={item} onDone={() => setN((k) => k + 1)} />
      </div>
      <span hidden data-n={n} />
    </GameCtx.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {found
      ? <Harness state={found.state} item={found.item} />
      : <p style={{ padding: 16 }}>没有找到报价：这几个种子跑完八个赛季都没有俱乐部开价。</p>}
  </StrictMode>,
)
