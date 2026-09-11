import { MINIMAPS } from '../../data/minimaps'
import type { MiniPt } from '../../data/minimaps'
import { minimapImg } from './common'
import type { RoundLog } from '../../engine/types'

/**
 * The map this round is being played on.
 *
 * Static on purpose. The official top-down minimap is the floor, and the only
 * things drawn on it are the ones we actually know: the sites and both spawns,
 * placed from the game's own coordinates (data/minimaps.ts).
 *
 * There is deliberately no movement here. The round engine does not track
 * positions, so any arrow would be invented — an earlier version picked a site
 * per round from a hash and drew an attack path to it, which looked like
 * information and was not. Until the engine can say where a round happened,
 * the board stays a board.
 */
export default function MapSchematic({
  map, myAttack, lastRound, mineIsA, agent,
}: {
  map: string
  /** is my side attacking this round */
  myAttack: boolean
  lastRound: RoundLog | null
  mineIsA: boolean
  agent?: string
}) {
  const real = MINIMAPS[map]
  if (!real) return null
  const sites: Record<string, MiniPt> = real.sites
  const siteKeys = Object.keys(sites)
  const lastMineWon = lastRound ? (lastRound.winner === 'A') === mineIsA : null

  return (
    <div className="map-board">
      <div className="map-real">
        <img src={minimapImg(map)} alt={`${map} 平面图`} draggable={false} />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          {siteKeys.map((k) => {
            const p = sites[k]
            return (
              <g key={k} transform={`translate(${p[0]} ${p[1]})`}>
                <circle r={5} className="map-site" />
                {/* the official image tints the sites but prints no letter */}
                <text y={2.2} className="map-site-label">{k}</text>
              </g>
            )
          })}
          <g transform={`translate(${real.atk[0]} ${real.atk[1]})`}><circle r={3.2} className="map-spawn-atk" /></g>
          <g transform={`translate(${real.def[0]} ${real.def[1]})`}><circle r={3.2} className="map-spawn-def" /></g>
        </svg>
      </div>
      <div className="map-read">
        <b>{myAttack ? '我方进攻' : '我方防守'}</b>
        {agent ? <span className="muted"> · 你是 {agent}</span> : null}
        {lastRound && lastMineWon !== null && (
          <span className={lastMineWon ? 'win' : 'loss'} style={{ marginLeft: 8 }}>上回合{lastMineWon ? '拿下' : '丢了'}</span>
        )}
        <div className="tiny faint" style={{ marginTop: 4 }}>
          <span className="dot atk" /> 进攻方出生　<span className="dot def" /> 防守方出生
        </div>
      </div>
    </div>
  )
}
