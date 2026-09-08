import { schematicFor } from '../../data/mapSchematics'
import type { Pt } from '../../data/mapSchematics'
import type { RoundLog } from '../../engine/types'

/**
 * The whiteboard: where this round is happening on the map.
 *
 * The engine does not track positions, so the picture is drawn from what it
 * does know — who is attacking, which round it is, how the last one ended —
 * plus a site for the round chosen deterministically, so the same round on
 * the same map always goes to the same place. The attacking side's arrow
 * runs down one lane to that site and pulses while a decision is open; my
 * marker sits where my side is coming from.
 */
export default function MapSchematic({
  map, roundNo, myAttack, lastRound, mineIsA, deciding, agent,
}: {
  map: string
  roundNo: number
  /** is my side attacking this round */
  myAttack: boolean
  lastRound: RoundLog | null
  mineIsA: boolean
  /** a decision is open right now */
  deciding: boolean
  agent?: string
}) {
  const s = schematicFor(map)
  const siteKeys = Object.keys(s.sites)
  // stable per (map, round): the target site and which lane leads there
  let h = 2166136261
  for (const ch of `${map}:${roundNo}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) }
  h >>>= 0
  const site = siteKeys[h % siteKeys.length]
  const lanesTo = s.lanes.filter((l) => l.to === site)
  const lane = lanesTo[(h >>> 8) % Math.max(1, lanesTo.length)] ?? s.lanes[0]
  const target = s.sites[site]
  const path = lane ? lane.pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ') : ''
  const lastMineWon = lastRound ? (lastRound.winner === 'A') === mineIsA : null
  const me: Pt = myAttack ? (lane ? lane.pts[1] ?? s.atk : s.atk) : target

  const atkColor = 'var(--warn)'
  const defColor = 'var(--def)'
  const myColor = 'var(--accent)'

  return (
    <div className="map-board">
      <svg viewBox="0 0 100 100" role="img" aria-label={`${map} 示意图`}>
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M0 0 L10 5 L0 10 Z" fill={atkColor} />
          </marker>
        </defs>
        {s.floor && <path d={s.floor} className="map-floor" />}
        {s.lanes.map((l, i) => (
          <polyline key={i} points={l.pts.map((p) => p.join(',')).join(' ')} className="map-lane" />
        ))}
        {(s.links ?? []).map((k, i) => (
          <line key={i} x1={k.from[0]} y1={k.from[1]} x2={k.to[0]} y2={k.to[1]} className={`map-link ${k.kind}`} />
        ))}
        {s.mid && <text x={s.mid[0]} y={s.mid[1]} className="map-label">中</text>}
        {siteKeys.map((k) => {
          const p = s.sites[k]
          const hot = k === site
          return (
            <g key={k} transform={`translate(${p[0]} ${p[1]})`}>
              <rect x={-7} y={-6} width={14} height={12} rx={2} className={`map-site${hot ? ' hot' : ''}`} />
              <text y={1.6} className="map-site-label">{k}</text>
            </g>
          )
        })}
        <g transform={`translate(${s.atk[0]} ${s.atk[1]})`}><path d="M0 -3.2 L3 2 L-3 2 Z" fill={atkColor} /><text y={7} className="map-spawn">进攻</text></g>
        <g transform={`translate(${s.def[0]} ${s.def[1]})`}><path d="M0 3.2 L3 -2 L-3 -2 Z" fill={defColor} /><text y={-4} className="map-spawn">防守</text></g>
        {path && (
          <path d={path} className={`map-arrow${deciding ? ' deciding' : ''}`} markerEnd="url(#arrowhead)" />
        )}
        <g transform={`translate(${me[0]} ${me[1]})`} className={deciding ? 'map-me deciding' : 'map-me'}>
          <circle r={3.4} fill={myColor} />
          <circle r={5.2} fill="none" stroke={myColor} strokeWidth={0.6} opacity={0.6} />
        </g>
      </svg>
      <div className="map-read">
        <b>{myAttack ? '我方进攻' : '我方防守'}</b> · 这回合打 <b>{site} 点</b>{lane ? ` · ${lane.label}` : ''}
        {agent ? <span className="muted"> · 你是 {agent}</span> : null}
        {lastRound && lastMineWon !== null && (
          <span className={lastMineWon ? 'win' : 'loss'} style={{ marginLeft: 8 }}>上回合{lastMineWon ? '拿下' : '丢了'}</span>
        )}
      </div>
    </div>
  )
}
