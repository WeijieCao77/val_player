import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from '../ctx'
import { Crest, Modal, OvrBadge, Roles } from '../common'
import RoundRibbon, { RibbonLegend } from '../RoundRibbon'
import { mapCn } from '../../engine/content'
import type { MeMatch } from '../../engine/me/matchplay'
import { DIM_CN, nodeChance } from '../../engine/me/nodes'
import type { NodeLogEntry } from '../../engine/me/types'

type Phase = 'pre' | 'live' | 'node' | 'done'
const TICK_MS = 380

/**
 * My club's match, a round at a time. The engine plays it; I am asked
 * something a few times a map, and the answer moves the next rounds. 快进
 * takes the steady option every time — same path, same maps.
 */
export default function MatchPlay({ mm, onDone }: { mm: MeMatch; onDone: () => void }) {
  const { game, commit } = useGame()
  const [phase, setPhase] = useState<Phase>('pre')
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((x) => x + 1), [])
  const [last, setLast] = useState<NodeLogEntry | null>(null)
  const me = game.me!
  const f = mm.fixture
  const a = game.teams[f.teamA]
  const b = game.teams[f.teamB]
  const mine = game.teams[game.myTeam]
  const oppId = mm.mineIsA ? f.teamB : f.teamA
  const opp = game.teams[oppId]
  const starterNow = mine.starters.includes(me.id) && game.players[me.id].injuredUntil <= game.day

  const finishUp = useCallback(() => {
    commit()
    setPhase('done')
  }, [commit])

  const step = useCallback(() => {
    const k = mm.step()
    if (k === 'node') { setPhase('node'); rerender(); return }
    if (k === 'done') { finishUp(); return }
    rerender()
  }, [mm, finishUp, rerender])

  useEffect(() => {
    if (phase !== 'live') return
    const id = window.setInterval(step, TICK_MS)
    return () => window.clearInterval(id)
  }, [phase, step])

  const startedAt = useRef(0)
  const skip = () => {
    if (startedAt.current && Date.now() - startedAt.current < 1000) return
    mm.runOut()
    finishUp()
  }
  const choose = (i: number) => {
    const e = mm.choose(i)
    setLast(e)
    setPhase('live')
  }

  const map = mm.map
  const myR = mm.myRounds
  const theirR = mm.theirRounds
  const wp = map && !map.over ? mm.winProb() : null
  const rec = mm.record

  if (phase === 'pre') {
    return (
      <Modal title={`${game.comps[f.comp]?.name ?? f.comp} · ${f.label.replace(/^(KO|SW):\d+:/, '')} · BO${f.bo}`} onClose={skip} onBgClose={() => {}}>
        <div className="score-line">
          <div className="t a" title={a?.name}><Crest id={f.teamA} size={30} /><span>{a?.tag}</span></div>
          <div className="s muted" style={{ fontSize: 22 }}>VS</div>
          <div className="t" title={b?.name}><Crest id={f.teamB} size={30} /><span>{b?.tag}</span></div>
        </div>
        <p className="center small muted" style={{ marginTop: -4 }}>地图：{mm.sim.maps.map(mapCn).join(' / ')}</p>
        <div className={`panel ${starterNow ? 'own' : 'alert'}`} style={{ marginTop: 12 }}>
          <div className="panel-head"><h2>{starterNow ? '你今晚首发' : '你在替补席'}</h2></div>
          <div className="panel-body">
            <div className="row wrap tiny" style={{ gap: 10 }}>
              {mine.starters.map((id) => game.players[id]).filter(Boolean).map((p) => (
                <span key={p.id} className="row" style={{ gap: 4, color: p.id === me.id ? 'var(--accent)' : undefined }}>
                  <Roles p={p} /><span>{p.ign}</span><OvrBadge value={p.overall} />
                </span>
              ))}
            </div>
            <p className="tiny faint" style={{ margin: '8px 0 0' }}>
              {starterNow
                ? '比赛里会有几次要你拿主意的时刻。每次决定后立刻能看到本图赢面怎么变。'
                : '你不上场就没有决定要做，看结果就行。想上场：跟队训练赛、对位挑战。'}
            </p>
          </div>
        </div>
        <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button className="primary" onClick={() => { startedAt.current = Date.now(); setPhase('live') }}>逐回合观战</button>
          <button onClick={skip}>快进到结果</button>
        </div>
      </Modal>
    )
  }

  if (phase === 'done' && rec) {
    return (
      <Modal title={`终场 · ${mine.tag} ${rec.score} ${opp?.tag}`} onClose={onDone} onBgClose={() => {}}>
        <div className="score-line" style={{ padding: '6px 0' }}>
          <div className={`t a ${rec.won ? 'win' : ''}`}><Crest id={game.myTeam} size={26} /><span>{mine.tag}</span></div>
          <div className="s">{rec.score}</div>
          <div className={`t ${!rec.won ? 'win' : ''}`}><Crest id={oppId} size={26} /><span>{opp?.tag}</span></div>
        </div>
        <div className="row wrap" style={{ gap: 8, justifyContent: 'center', marginBottom: 10 }}>
          {mm.sim.played.map((m, i) => (
            <span key={i} className="tag">{mapCn(m.map)} {mm.mineIsA ? `${m.scoreA}-${m.scoreB}` : `${m.scoreB}-${m.scoreA}`}</span>
          ))}
        </div>
        {rec.started ? (
          <div className="panel own">
            <div className="panel-head"><h2>你的数据</h2></div>
            <div className="panel-body">
              <p className="small" style={{ margin: 0 }}>
                <b>{rec.kills}/{rec.deaths}/{rec.assists}</b> · ACS <b>{rec.acs}</b> · 首杀 {rec.firstKills} · 残局 {rec.clutches} · 评分 <b>{rec.rating.toFixed(2)}</b>
                · 队内第 {rec.rank}{rec.mvp ? ' · 全场 MVP' : ''}{rec.carried ? ' · 输球但你全队最高' : ''}
              </p>
            </div>
          </div>
        ) : <p className="muted center">你没有出场。</p>}
        {rec.nodes.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>你的决定 · {rec.nodes.length} 次</h2></div>
            <div className="panel-body">
              {rec.nodes.map((n, i) => (
                <div key={i} className={`node-line ${n.ok ? 'ok' : 'bad'}`}>
                  <span className="faint">{mapCn(n.map)} 第 {n.round} 回合</span> · {n.pick}（{DIM_CN[n.dim]} {n.p}%）
                  —— <b>{n.ok ? '成了' : '没成'}</b>，赢面 {n.before}% → {n.after}%
                </div>
              ))}
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>
                成功率七成看你、三成看队友；风险高的选项成功率更低、摆动更大。做对了不一定赢，做错了也不一定输——但账都在这里。
              </p>
            </div>
          </div>
        )}
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <button className="primary" onClick={onDone}>继续这一周</button>
        </div>
      </Modal>
    )
  }

  // ---- live / node
  const roundNo = Math.max(1, (map?.round ?? 0) + 1)
  const pend = mm.pending
  return (
    <Modal wide title={`${map ? mapCn(map.map) : '换图中'} · 第 ${roundNo} 回合`} onClose={skip} onBgClose={() => {}}>
      <div className="row wrap" style={{ gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        {mm.sim.played.map((m, i) => (
          <span key={i} className="tag">{mapCn(m.map)} {mm.mineIsA ? `${m.scoreA}-${m.scoreB}` : `${m.scoreB}-${m.scoreA}`}</span>
        ))}
        <span className="tag t1">大比分 {mm.myMaps} - {mm.theirMaps}</span>
      </div>
      <div className="score-line" style={{ padding: '8px 0' }}>
        <div className={`t a ${myR > theirR ? 'win' : ''}`}><Crest id={game.myTeam} size={26} /><span>{mine.tag}</span></div>
        <div className="s">{myR} : {theirR}</div>
        <div className={`t ${theirR > myR ? 'win' : ''}`}><Crest id={oppId} size={26} /><span>{opp?.tag}</span></div>
      </div>
      {wp !== null && (
        <div className="winbar-row">
          <span className="tiny muted">本图赢面</span>
          <div className="winbar" style={{ flex: 1 }}><i style={{ width: `${Math.round(wp * 100)}%` }} /></div>
          <span className="n">{Math.round(wp * 100)}%</span>
        </div>
      )}
      {map && map.rounds.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <RoundRibbon rounds={map.rounds} mineIsA={mm.mineIsA} mineTag={mine.tag} theirTag={opp?.tag} />
          <div style={{ marginTop: 6 }}><RibbonLegend /></div>
        </div>
      )}

      {phase === 'node' && pend ? (
        <div className="node-box">
          <p className="q">{pend.node.q}</p>
          <p className="ctx">{pend.node.ctx}</p>
          <div className="node-opt">
            {pend.node.a.map((o, i) => {
              const pc = Math.round(nodeChance(game, o) * 100)
              return (
                <button key={i} onClick={() => choose(i)}>
                  <span>{o.t}</span>
                  <span className="m">看{DIM_CN[o.dim]} · 成功率 {pc}% · {o.risk >= 0.85 ? '高风险，摆动大' : o.risk >= 0.6 ? '中等风险' : '稳健'}{i === pend.node.rec ? ' · 教练会选这个' : ''}</span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          {last && (
            <div className={`node-line ${last.ok ? 'ok' : 'bad'}`}>
              上一次决定：{last.pick} —— <b>{last.ok ? '成了' : '没成'}</b>，赢面 {last.before}% → {last.after}%
            </div>
          )}
          <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 8 }}>
            <button onClick={skip}>快进剩余</button>
          </div>
        </>
      )}
      {map && (
        <div className="row wrap tiny faint" style={{ gap: 10, justifyContent: 'center', marginTop: 10 }}>
          {(mm.mineIsA ? map.A : map.B).players.map((p) => (
            <span key={p.id} className="row" style={{ gap: 4, color: p.id === me.id ? 'var(--accent)' : undefined }}>
              <Roles p={p} /><span>{p.ign}</span>
            </span>
          ))}
          {!mm.playing && <span>· 你不在场上</span>}
        </div>
      )}
    </Modal>
  )
}
