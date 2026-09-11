import { useContext, useState } from 'react'
import { GameCtx } from '../ctx'
import { AgentIcon } from '../common'
import { dossierOf } from '../../engine/dossier'
import { AGENT_CN, canonAgent } from '../../engine/content'
import './media.css'

const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'
/**
 * The protagonist's id (engine/me/career.ts ME_ID). Spelled out rather than
 * imported: career.ts reads the 2021 roster book, and this file is drawn on
 * the shared player card, which the manager game loads too.
 */
const ME = 'ME'
const EN_OF_CN = new Map(Object.entries(AGENT_CN).map(([en, cn]) => [cn, en]))

/**
 * A real player's photograph, round, at list size.
 *
 * The photo is the dossier's (vlr.gg / Liquipedia / 号角), looked up by id —
 * a 2021 roster id reaches it through the bridge, same as the crests. At 32px
 * and under it is the 64px thumbnail in faces/s/ (scripts/build_face_thumbs.py),
 * about a tenth of the bytes; a missing thumbnail falls back to the full photo,
 * a missing photo to the first letter of the handle.
 *
 * The protagonist is nobody real and never gets a face: a plain silhouette.
 */
export default function Face({ id, name, size = 22 }: { id: string; name?: string; size?: number }) {
  const ctx = useContext(GameCtx)
  const [fail, setFail] = useState<{ id: string; n: number }>({ id, n: 0 })
  const tries = fail.id === id ? fail.n : 0
  const box = { width: size, height: size }

  if (id === ME || ctx?.game?.me?.id === id) {
    return (
      <span className="face face-me" style={box} aria-hidden="true">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="4.4" /><path d="M3 24c.6-5.4 4.3-8.6 9-8.6s8.4 3.2 9 8.6z" /></svg>
      </span>
    )
  }
  const d = dossierOf(id)
  if (d?.img && tries < 2) {
    const thumb = size <= 32 && tries === 0
    return (
      <img
        className="face"
        src={`${BASE}faces/${thumb ? 's/' : ''}${d.img}${d.v ? `?v=${d.v}` : ''}`}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        width={size}
        height={size}
        style={box}
        onError={() => setFail({ id, n: thumb ? 1 : 2 })}
      />
    )
  }
  const ch = (name ?? '').trim().charAt(0).toUpperCase()
  return (
    <span className="face face-init" style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.44)) }} aria-hidden="true">
      {ch || '·'}
    </span>
  )
}

/** A lineup unit: the agent he is on, his face tucked against it. `agent` may be the English or the Chinese name. */
export function Mug({ id, name, agent }: { id: string; name?: string; agent?: string }) {
  const en = agent ? canonAgent(agent) ?? EN_OF_CN.get(agent) : undefined
  return (
    <span className={`mug${en ? '' : ' bare'}`}>
      {en && <AgentIcon name={en} size={18} />}
      <Face id={id} name={name} size={18} />
    </span>
  )
}

/**
 * A five as faces with their handles — tap one for his card. In a narrow box
 * (the week's side column on a phone) it folds to a small overlapping stack
 * with the names left to the tooltip; see media.css.
 */
export function FaceRow({ ids }: { ids: string[] }) {
  const ctx = useContext(GameCtx)
  const g = ctx?.game
  if (!ctx || !g || !ids.length) return null
  return (
    <div className="face-row-box">
      <div className="face-row">
        {ids.map((pid) => {
          const p = g.players[pid]
          if (!p) return null
          return (
            <button key={pid} type="button" className="face-btn" onClick={() => ctx.openPlayer(pid)} title={p.ign} aria-label={p.ign}>
              <Face id={pid} name={p.ign} size={30} />
              <span className="face-name">{p.ign}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
