import { useGame } from './ctx'
import { Panel } from './common'
import { activeRivals, rivalOnTeam } from '../../engine/me/rivals'
import { starTitleOf } from '../../engine/me/startitles'
import type { MeMatchRecord } from '../../engine/me/types'
import './rivals.css'

/**
 * 宿敌 and 称号 on screen, kept to a line wherever they appear: two before a
 * match at most, one after it, a short list on the profile, a tag on a card.
 * Everything is read from engine/me/rivals.ts and engine/me/startitles.ts.
 */

/** A player's title as a tag, in player mode only. The reason is on hover. */
export function StarTitleTag({ id }: { id: string }) {
  const { game } = useGame()
  if (!game.me) return null
  const t = starTitleOf(game, id)
  return t ? <span className="tag t1 st-tag" title={t.why}>{t.name}</span> : null
}

/** Before the match: the rival on the other five and why, and one of theirs with a title. */
export function RivalPre({ oppId }: { oppId: string }) {
  const { game } = useGame()
  const me = game.me
  const opp = game.teams[oppId]
  if (!me || !opp) return null
  const rv = rivalOnTeam(game, oppId)
  const role = game.players[me.id]?.role
  const five = opp.starters.length ? opp.starters : opp.roster
  const rvTitle = rv ? starTitleOf(game, rv.id) : null
  const starId = five
    .filter((id) => id !== rv?.id && starTitleOf(game, id))
    .sort((a, b) => Number(game.players[b]?.role === role) - Number(game.players[a]?.role === role))[0]
  const star = starId ? starTitleOf(game, starId) : null
  if (!rv && !star) return null
  return (
    <div className="rv-pre">
      {rv && (
        <div className="rv-line foe">
          宿敌 <b>{rv.ign}</b>{rvTitle && <span title={rvTitle.why}>「{rvTitle.name}」</span>}
          <span className="muted"> · {rv.reason} · {rv.w} 胜 {rv.l} 负</span>
        </div>
      )}
      {star && starId && (
        <div className="rv-line" title={star.why}>
          <b>{game.players[starId]?.ign}</b>「{star.name}」<span className="muted"> · {star.why}</span>
        </div>
      )}
    </div>
  )
}

/** On a decision: who is across from you, when it is him. */
export function RivalNode({ oppId }: { oppId: string }) {
  const { game } = useGame()
  const rv = game.me ? rivalOnTeam(game, oppId) : null
  return rv ? <p className="tiny muted rv-node">宿敌 <b>{rv.ign}</b> 就在对面。</p> : null
}

/** After the match: the one line about a rival or my direct counterpart. */
export function RivalPost({ rec }: { rec: MeMatchRecord }) {
  const n = rec.rivalNote
  return n ? <div className={`node-line ${n.ok ? 'ok' : 'bad'}`}>{n.t}</div> : null
}

/** The profile's short list: declared rivals, and my own title if the save gave me one. */
export default function RivalsPanel() {
  const { game, openPlayer } = useGame()
  const me = game.me
  if (!me) return null
  const list = activeRivals(game)
  const mine = starTitleOf(game, me.id)
  if (!list.length && !mine && me.phase !== 'pro') return null
  return (
    <Panel title="宿敌" actions={mine ? <span className="tag t1 st-tag" title={mine.why}>你的称号 · {mine.name}</span> : undefined}>
      {list.length ? list.map((r) => (
        <div key={r.id} className="rv-row" role="button" tabIndex={0} onClick={() => openPlayer(r.id)}
          onKeyDown={(e) => { if (e.key === 'Enter') openPlayer(r.id) }}>
          <span><b>{r.ign}</b> <span className="muted">{r.team}</span></span>
          <span className={`rv-heat h${r.level}`}>{r.word}</span>
          <span className="muted rv-wl">{r.w}-{r.l}</span>
          <span className="rv-why">{r.reason}</span>
        </div>
      )) : <p className="tiny faint" style={{ margin: 0 }}>还没有。常碰的同位置对手、淘汰你的人，会被记住。</p>}
    </Panel>
  )
}
