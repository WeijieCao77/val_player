import { ATTR_KEYS } from '../types'
import type { GameState } from '../types'
import { weightsFor } from '../player'
import { ACTION_BY_KEY } from './actions'
import { advanceWeek, doDuel, setPlan } from './week'
import type { WeekStop } from './week'
import { MeMatch } from './matchplay'
import { EDGE_NEED } from './coach'

/**
 * The steady plan: rest when worn, chase a trial when benched, otherwise
 * practise what my role is judged on. This is also the headless bot's week —
 * it goes through setPlan/doDuel/advanceWeek exactly as the buttons do.
 */
export function autoPlan(state: GameState): void {
  const me = state.me!
  const p = state.players[me.id]
  const team = state.teams[state.myTeam]
  const starter = team.starters.includes(me.id)
  const spend = (k: keyof typeof ACTION_BY_KEY) => setPlan(state, k, 1) === null

  if (p.fatigue > 65) { spend('rest'); spend('rest') }
  else if (p.fatigue > 45) spend('rest')

  if (!starter && !me.trial && me.edge < EDGE_NEED) {
    let guard = 0
    while (me.ap >= ACTION_BY_KEY.duel.cost && guard++ < 3) {
      const r = doDuel(state)
      if (typeof r === 'string') break
      if (r.trial) break
    }
  }

  const w = weightsFor(p)
  const weakest = ATTR_KEYS
    .filter((k) => k !== 'igl')
    .sort((a, b) => (p.attrs[a] * 1) / w[a] - (p.attrs[b] * 1) / w[b])[0]
  const first = weakest === 'aim' || weakest === 'reaction' ? 'aim'
    : weakest === 'awareness' || weakest === 'clutch' ? 'vod' : 'util'
  spend(first)
  if (me.ap >= 3 && !starter) spend('scrim')
  spend('vod')
  spend('aim')
  while (me.ap > 0) {
    if (me.ap >= 2 && me.fans < 200 && spend('stream')) continue
    if (spend('ranked')) continue
    break
  }
}

/** One whole week the steady way, matches included. */
export function autoWeek(state: GameState): WeekStop {
  autoPlan(state)
  let stop = advanceWeek(state)
  let guard = 0
  while (stop.kind === 'match' && guard++ < 12) {
    new MeMatch(state, stop.fixture).runOut()
    stop = advanceWeek(state)
  }
  return stop
}
