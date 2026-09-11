import { useGame } from '../ctx'
import { Modal, OvrBadge, Roles } from '../common'
import { closeDuel, duelCompare, duelOptP, duelPick, duelScene, DIM_CN } from '../../engine/me/duel'
import { EDGE_NEED } from '../../engine/me/coach'
import type { DuelSceneLog } from '../../engine/me/types'
import { attrWord, sayDim, useNumbers } from './words'

/** A scene's line in words: the same sentence the engine writes, without the numbers. */
const wordsLine = (r: DuelSceneLog) =>
  `第 ${r.r} 局 · ${r.t}（${r.dim} ${sayDim(false, r.dim, r.mine)} 对 ${sayDim(false, r.dim, r.his)}）—— ${r.ok ? (r.flash ? '打成了，很亮眼' : '打成了') : '被他压住了'}`

/**
 * The practice duel on screen: score, the scene in front of me, three ways
 * to play it with my number against his, then the verdict and the
 * side-by-side — so a loss says where the gap is, not just that there is one.
 */
export default function DuelPlay({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const live = me.duelLive
  if (!live) return null
  const p = game.players[me.id]
  const him = game.players[live.himId]
  const scene = duelScene(game)

  const pick = (i: number) => { duelPick(game, i); commit() }
  const close = () => { closeDuel(game); commit(); onDone() }

  return (
    <Modal title={`训练赛 · 对位挑战 vs ${him?.ign ?? '首发'}`} onClose={live.done ? close : () => {}} onBgClose={() => {}}>
      <div className="score-line" style={{ padding: '4px 0 8px' }}>
        <div className="t a"><Roles p={p} /><span>{p.ign}</span><OvrBadge value={p.overall} /></div>
        <div className="s">{live.sc[0]} : {live.sc[1]}</div>
        <div className="t"><Roles p={him} /><span>{him?.ign}</span><OvrBadge value={him?.overall ?? 0} /></div>
      </div>

      {scene && !live.done ? (
        <div className="node-box">
          <p className="tiny muted" style={{ margin: '0 0 6px' }}>第 {live.round} 局</p>
          <p className="q">{scene.q}</p>
          <p className="ctx">{scene.ctx}</p>
          <div className="node-opt">
            {scene.a.map((o, i) => {
              const pc = Math.round(duelOptP(game, o) * 100)
              const mine = o.dim === 'mental' ? Math.round(me.mental) : p.attrs[o.dim]
              const his = o.dim === 'mental' ? 55 : him?.attrs[o.dim] ?? 50
              return (
                <button key={i} onClick={() => pick(i)}>
                  <span>{o.t}</span>
                  <span className="m">
                    {nums
                      ? <>看{DIM_CN[o.dim]}：你 {mine} · 他 {his}　成功率 <b style={{ color: pc >= 60 ? 'var(--win)' : pc >= 40 ? 'var(--warn)' : 'var(--loss)' }}>{pc}%</b></>
                      : <>看{DIM_CN[o.dim]} · <b style={{ color: mine - his > 3 ? 'var(--win)' : his - mine > 3 ? 'var(--loss)' : undefined }}>{Math.abs(mine - his) <= 3 ? '差不多' : mine > his ? '你占上风' : '他更强'}</b></>}
                    {o.risk >= 1.1 ? ' · 打成算亮眼' : o.risk <= 0.7 ? ' · 稳' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          <div className={`node-line ${live.sc[0] > live.sc[1] ? 'ok' : 'bad'}`}>{live.verdict}</div>
          {live.trial && <div className="node-line ok"><b>教练给了你试用期。</b></div>}
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>赛后拆解</h2></div>
            <div className="panel-body">
              <div className="grid tiny duel-compare">
                {duelCompare(game).map((row) => (
                  <div key={row.dim} className="row" style={{ gap: 6 }}>
                    <span className="muted" style={{ flex: 1 }}>{row.dim}</span>
                    <b style={{ color: row.mine > row.his ? 'var(--win)' : row.mine < row.his ? 'var(--loss)' : undefined }}>{nums ? row.mine : attrWord(row.mine)}</b>
                    <span className="faint">/ {nums ? row.his : attrWord(row.his)}</span>
                  </div>
                ))}
              </div>
              {(() => {
                const gaps = duelCompare(game).filter((r) => r.his > r.mine).sort((a, b) => (b.his - b.mine) - (a.his - a.mine))
                return gaps.length
                  ? <p className="tiny muted" style={{ margin: '8px 0 0' }}>他压你最多的是 <b>{gaps[0].dim}</b>{nums ? `（差 ${gaps[0].his - gaps[0].mine}）` : ''}——明天先练这个。</p>
                  : <p className="tiny muted" style={{ margin: '8px 0 0' }}>八项你都不比他差，剩下的是教练的信任和上场的回合。</p>
              })()}
            </div>
          </div>
        </>
      )}

      {live.rounds.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {live.rounds.slice().reverse().map((r) => (
            <div key={r.r} className={`node-line ${r.ok ? 'ok' : 'bad'}`}>{nums ? r.line : wordsLine(r)}</div>
          ))}
        </div>
      )}
      {live.done && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
          <button className="primary" onClick={close}>回到本周 →</button>
        </div>
      )}
      {!live.done && <p className="tiny faint" style={{ margin: '8px 0 0' }}>再赢约 {Math.max(1, Math.ceil(EDGE_NEED - me.edge))} 场，教练给试用期。</p>}
    </Modal>
  )
}
