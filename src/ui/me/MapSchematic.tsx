import { MINIMAPS } from '../../data/minimaps'
import type { MiniPt } from '../../data/minimaps'
import { schematicFor } from '../../data/mapSchematics'
import { minimapImg } from '../common'
import type { RoundLog } from '../../engine/types'

/**
 * The real map under this round.
 *
 * The official top-down minimap is the floor; the sites and both spawns are
 * placed from the game's own coordinates (data/minimaps.ts), so nothing here
 * is guessed. The engine does not track positions, so the picture is drawn
 * from what it does know — who is attacking, which round, how the last one
 * ended — plus a site for the round chosen deterministically. The attacking
 * side's arrow bends from its spawn through the middle of the map to that
 * site and pulses while a decision is open; my marker sits where my side is
 * coming from.
 */
export default function MapSchematic({
  map, roundNo, myAttack, lastRound, mineIsA, deciding, agent,
}: {
  map: string
  roundNo: number
  myAttack: boolean
  lastRound: RoundLog | null
  mineIsA: boolean
  deciding: boolean
  agent?: string
}) {
  const real = MINIMAPS[map]
  const fallback = schematicFor(map)
  const sites: Record<string, MiniPt> = real?.sites ?? fallback.sites
  const atk: MiniPt = real?.atk ?? fallback.atk
  const def: MiniPt = real?.def ?? fallback.def
  const siteKeys = Object.keys(sites)
  if (!siteKeys.length) return null

  // stable per (map, round): the same round on the same map goes to the same site
  let h = 2166136261
  for (const ch of `${map}:${roundNo}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  h >>>= 0
  const site = siteKeys[h % siteKeys.length]
  const target = sites[site]

  // a curve from the attacker spawn to the site, bent through the map's middle
  const mid: MiniPt = [50, 50]
  const ctrl: MiniPt = [(atk[0] + target[0]) / 2 * 0.4 + mid[0] * 0.6, (atk[1] + target[1]) / 2 * 0.4 + mid[1] * 0.6]
  const path = `M${atk[0]} ${atk[1]} Q${ctrl[0]} ${ctrl[1]} ${target[0]} ${target[1]}`
  // my marker: a third of the way down the arrow when attacking, on the site when defending
  const me: MiniPt = myAttack
    ? [atk[0] * 0.5 + ctrl[0] * 0.4 + target[0] * 0.1, atk[1] * 0.5 + ctrl[1] * 0.4 + target[1] * 0.1]
    : target
  const lastMineWon = lastRound ? (lastRound.winner === 'A') === mineIsA : null

  return (
    <div className="map-board">
      <div className="map-real">
        {real ? <img src={minimapImg(map)} alt={`${map} 平面图`} draggable={false} /> : null}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
              <path d="M0 0 L10 5 L0 10 Z" fill="var(--warn)" />
            </marker>
          </defs>
          {!real && fallback.floor && <path d={fallback.floor} className="map-floor" />}
          {siteKeys.map((k) => {
            const p = sites[k]
            const hot = k === site
            return (
              <g key={k} transform={`translate(${p[0]} ${p[1]})`}>
                <circle r={hot ? 6.5 : 4.5} className={`map-site${hot ? ' hot' : ''}`} />
                {/* the official image marks sites with a tint but no letter — the letter is ours */}
                <text y={2.2} className="map-site-label">{k}</text>
              </g>
            )
          })}
          <g transform={`translate(${atk[0]} ${atk[1]})`}><circle r={3.2} className="map-spawn-atk" /></g>
          <g transform={`translate(${def[0]} ${def[1]})`}><circle r={3.2} className="map-spawn-def" /></g>
          <path d={path} className={`map-arrow${deciding ? ' deciding' : ''}`} markerEnd="url(#arrowhead)" />
          <g transform={`translate(${me[0]} ${me[1]})`} className={deciding ? 'map-me deciding' : 'map-me'}>
            <circle r={3.4} fill="var(--accent)" />
            <circle r={5.2} fill="none" stroke="var(--accent)" strokeWidth={0.6} opacity={0.6} />
          </g>
        </svg>
      </div>
      <div className="map-read">
        <b>{myAttack ? '我方进攻' : '我方防守'}</b> · 这回合打 <b>{site} 点</b>
        {agent ? <span className="muted"> · 你是 {agent}</span> : null}
        {lastRound && lastMineWon !== null && (
          <span className={lastMineWon ? 'win' : 'loss'} style={{ marginLeft: 8 }}>上回合{lastMineWon ? '拿下' : '丢了'}</span>
        )}
        <div className="tiny faint" style={{ marginTop: 4 }}>
          <span className="dot atk" /> 进攻方出生　<span className="dot def" /> 防守方出生　<span className="dot me" /> 你
        </div>
      </div>
    </div>
  )
}
