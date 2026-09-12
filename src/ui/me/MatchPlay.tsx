import { useCallback, useEffect, useRef, useState } from 'react'
import { useGame } from './ctx'
import { Crest, Modal, OvrBadge, RoleTag, Roles } from './common'
import RoundRibbon from './RoundRibbon'
import MapSchematic from './MapSchematic'
import { AGENT_ROLE, agentCn, mapCn } from '../../engine/content'
import { loadRecords, recordsNow } from '../../engine/dossier'
import type { Records } from '../../engine/dossier'
import { spotlights } from '../../engine/me/stars'
import type { MeMatch } from '../../engine/me/matchplay'
import { DIM_CN, gapVerdict, nodeChance, nodeReadout } from '../../engine/me/nodes'
import { ledgerNotes } from '../../engine/me/postmatch'
import type { NodeLogEntry } from '../../engine/me/types'
import type { Player, Role, RoundLog } from '../../engine/types'
import { sayDim, useNumbers } from './words'
import { RivalNode, RivalPost, RivalPre } from './Rivals'
import Face, { Mug } from './Face'
import { playsHurt } from '../../engine/me/hurtplay'
import { injuryStatus } from '../../engine/me/injury'

type Phase = 'pre' | 'live' | 'node' | 'break' | 'done'
const TICK_MS = 380

const BUY_CN = { full: '满配', force: '半配', eco: '经济局' } as const
const END_CN = { elim: '全歼', spike: '炸包', defuse: '拆包', time: '时间到' } as const

/** the round just played, from my side of the table */
function roundLine(r: RoundLog, mineIsA: boolean): string {
  const mineWon = (r.winner === 'A') === mineIsA
  const mineAttack = mineIsA ? r.aAttack : !r.aAttack
  const pistol = r.n === 1 || r.n === 13
  const myBuy = mineIsA ? r.buyA : r.buyB
  const theirBuy = mineIsA ? r.buyB : r.buyA
  const buy = pistol ? '手枪局' : `${BUY_CN[myBuy]} 对 ${BUY_CN[theirBuy]}`
  return `第 ${r.n} 回合 · ${mineAttack ? '我方进攻' : '我方防守'} · ${buy} · ${mineWon ? '拿下' : '丢了'}（${END_CN[r.end]}）`
}

/**
 * Every round of the series so far, newest first — the round's line with the
 * score it left, the call I made on it, and what the engine wrote about it —
 * in a box of its own height that scrolls, so a thirty-round map does not push
 * the rest of the screen away. Maps already played stay in it.
 */
function RoundFeed({ mm }: { mm: MeMatch }) {
  const [nums] = useNumbers()
  const maps = [
    ...mm.sim.played.map((s) => ({ map: s.map, rounds: s.rounds ?? [], live: false })),
    ...(mm.map ? [{ map: mm.map.map, rounds: mm.map.rounds, live: true }] : []),
  ]
  const total = maps.reduce((s, m) => s + m.rounds.length, 0)
  if (!total) return null
  const tallied = maps.map((m, mi) => {
    let my = 0
    let their = 0
    const rows = m.rounds.map((r) => {
      const won = (r.winner === 'A') === mm.mineIsA
      if (won) my++
      else their++
      return { r, won, my, their }
    })
    return { m, mi, rows, my, their }
  })
  return (
    <div className="round-feed">
      <div className="round-feed-head">回合记录</div>
      <div className="round-feed-body">
        {tallied.slice().reverse().map(({ m, mi, rows, my, their }) => (
          <div key={mi}>
            <div className="round-feed-map">{mapCn(m.map)} · {m.live ? `进行中 ${my} : ${their}` : `${my} : ${their}`}</div>
            {rows.slice().reverse().map(({ r, won, my: a, their: b }) => (
              <div key={r.n} className={`node-line ${won ? 'ok' : 'bad'}`}>
                <span className="round-feed-score">{a} : {b}</span>{roundLine(r, mm.mineIsA)}
                {mm.nodes.filter((n) => n.map === m.map && n.round === r.n).map((n, i) => (
                  <div key={`call${i}`} className="tiny" style={{ marginTop: 2 }}>
                    「{n.pick}」—— <b>{n.ok ? '成了' : '没成'}</b>{nums && n.won !== undefined ? `（本图赢面 ${n.before}% → ${n.after}%）` : ''}
                  </div>
                ))}
                {r.hl?.map((h, i) => <div key={i} className="tiny muted" style={{ marginTop: 2 }}>{h}</div>)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * My club's match, a round at a time. The engine plays it; I am asked
 * something a few times a map, and the answer moves the next rounds. 快进
 * takes the steady option every time — same path, same maps.
 *
 * What the screen owes the player: the round that just happened in one line,
 * who did what on both fives, and — when a call lands or fails — which of my
 * attributes it came down to, against whose.
 */
export default function MatchPlay({ mm, onDone }: { mm: MeMatch; onDone: () => void }) {
  const { game, commit } = useGame()
  const [nums] = useNumbers()
  const [phase, setPhase] = useState<Phase>('pre')
  const [, bump] = useState(0)
  const rerender = useCallback(() => bump((x) => x + 1), [])
  const [last, setLast] = useState<NodeLogEntry | null>(null)
  const me = game.me!
  const f = mm.fixture
  const a = game.teams[f.teamA]
  const b = game.teams[f.teamB]
  const mine = game.teams[mm.myTeamId]
  const oppId = mm.oppTeamId
  const opp = game.teams[oppId]
  // playing through an injury I said I would, or a cup entered hurt, is still starting (engine/me/hurtplay.ts)
  const starterNow = mine.starters.includes(me.id) && (game.players[me.id].injuredUntil <= game.day || playsHurt(game, f.id, !!mm.friendly))

  // bring the first map up before kickoff so the pre-match screen can read
  // the engine's own estimate, not a guess from team ratings
  useEffect(() => {
    if (phase === 'pre' && !mm.map && !mm.done) { mm.step(); rerender() }
  }, [phase, mm, rerender])

  const finishUp = useCallback(() => {
    commit()
    setPhase('done')
  }, [commit])

  const step = useCallback(() => {
    const k = mm.step()
    if (k === 'node') { setPhase('node'); rerender(); return }
    // a map just ended and another is to come: the clock stops until the player starts it
    if (k === 'map-end') { setPhase('break'); rerender(); return }
    if (k === 'done') { finishUp(); return }
    rerender()
  }, [mm, finishUp, rerender])

  useEffect(() => {
    if (phase !== 'live') return
    const id = window.setInterval(step, TICK_MS)
    return () => window.clearInterval(id)
  }, [phase, step])

  // the other side's names and what they have won — records.json is the heavy
  // half of the data, so it is fetched once and only when a match opens
  const [recs, setRecs] = useState<Records | null>(recordsNow())
  useEffect(() => { if (!recs) loadRecords().then(setRecs).catch(() => {}) }, [recs])
  const lights = spotlights(game, oppId, game.players[me.id].role, recs)

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
  const verdict = map && !map.over ? gapVerdict(mm.roundProb()) : null
  const verdictTag = (k: string) => k === 'crush' || k === 'edge' ? 'tag win' : k === 'even' ? 'tag' : 'tag warn'

  // the five on the floor for the current map, with the agent each is on;
  // before the first map is built, the club's starters without agents
  const five = (teamId: string): { p: Player; agent: string; role?: Role }[] => {
    const side = map ? (teamId === mm.myTeamId ? (mm.mineIsA ? map.A : map.B) : (mm.mineIsA ? map.B : map.A)) : null
    if (side) return side.players.map((p) => ({ p, agent: side.agents[p.id] ? agentCn(side.agents[p.id]) : '', role: AGENT_ROLE[side.agents[p.id]] }))
    return (game.teams[teamId]?.starters ?? []).map((id) => game.players[id]).filter(Boolean).map((p) => ({ p, agent: '' }))
  }

  if (phase === 'pre') {
    return (
      <Modal title={`${mm.friendly ? mm.friendly.comp : (game.comps[f.comp]?.name ?? f.comp)} · ${f.label.replace(/^(KO|SW):\d+:/, '')} · BO${f.bo}`} onClose={skip} onBgClose={() => {}}>
        <div className="score-line">
          <div className="t a" title={a?.name}><Crest id={f.teamA} size={30} /><span>{a?.tag}</span></div>
          <div className="s muted" style={{ fontSize: 22 }}>VS</div>
          <div className="t" title={b?.name}><Crest id={f.teamB} size={30} /><span>{b?.tag}</span></div>
        </div>
        <p className="center small muted" style={{ marginTop: -4 }}>地图：{mm.sim.maps.map(mapCn).join(' / ')}</p>
        {verdict && (
          <p className="center small" style={{ margin: '4px 0 8px' }}>
            <span className={verdictTag(verdict.k)}>{verdict.t}</span>
            <span className="muted" style={{ marginLeft: 8 }}>{verdict.d}</span>
          </p>
        )}
        <div className="grid mp-sides">
          <div className={`panel ${starterNow ? 'own' : 'alert'}`} style={{ marginTop: 12 }}>
            <div className="panel-head"><h2>{mine.tag} · {starterNow ? '你今晚首发' : '你在替补席'}</h2></div>
            <div className="panel-body">
              <div className="col tiny" style={{ gap: 4 }}>
                {five(mm.myTeamId).map(({ p, agent, role }) => (
                  <span key={p.id} className="row" style={{ gap: 4, color: p.id === me.id ? 'var(--accent)' : undefined }}>
                    {role ? <RoleTag role={role} /> : <Roles p={p} />}<Mug id={p.id} name={p.ign} agent={agent} /><span>{p.ign}</span>{agent && <span className="muted">{agent}</span>}<OvrBadge value={p.overall} />
                  </span>
                ))}
              </div>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 12 }}>
            <div className="panel-head"><h2>{opp?.tag ?? '对手'}</h2></div>
            <div className="panel-body">
              <div className="col tiny" style={{ gap: 4 }}>
                {five(oppId).map(({ p, agent, role }) => (
                  <span key={p.id} className="row" style={{ gap: 4 }}>
                    {role ? <RoleTag role={role} /> : <Roles p={p} />}<Mug id={p.id} name={p.ign} agent={agent} /><span>{p.ign}</span>{agent && <span className="muted">{agent}</span>}<OvrBadge value={p.overall} />
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <RivalPre oppId={oppId} />
        {lights.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>今晚对面有谁</h2></div>
            <div className="panel-body">
              {lights.map((s) => (
                <div key={s.id} className={`light${s.opposite ? ' opposite' : ''}`}>
                  <Face id={s.id} name={s.ign} size={30} />
                  <div className="n"><b>{s.ign}</b> <span className="muted">{s.role}</span>{s.opposite && <span className="tag t1">你的对位</span>}</div>
                  <div className="cv muted">{s.cv}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="tiny faint center" style={{ margin: '8px 0 0' }}>
          {starterNow
            ? '比赛里会有几次要你拿主意。'
            : mm.friendly ? '车队赛，你当然上。' : injuryStatus(game) ? '你在养伤，这场看结果。' : '你在替补席，这场看结果。'}
        </p>
        <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 16 }}>
          <button className="primary" onClick={() => { startedAt.current = Date.now(); setPhase('live') }}>逐回合观战</button>
          <button onClick={skip}>快进到结果</button>
        </div>
      </Modal>
    )
  }

  if (phase === 'done' && rec) {
    return (
      <Modal title="终场" onClose={onDone} onBgClose={() => {}}>
        <div className="score-line" style={{ padding: '6px 0' }}>
          <div className={`t a ${rec.won ? 'win' : ''}`}><Crest id={mm.myTeamId} size={26} /><span>{mine.tag}</span></div>
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
                <b>{rec.kills}/{rec.deaths}/{rec.assists}</b> · 评分 <b>{rec.rating.toFixed(2)}</b> · 队内第 {rec.rank}{rec.mvp ? ' · MVP' : ''}{rec.carried ? ' · 输了比赛但你全队最高' : ''}
              </p>
            </div>
          </div>
        ) : <p className="muted center">你没有出场。</p>}
        {rec.highlights && rec.highlights.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>今晚关于你的几个回合</h2></div>
            <div className="panel-body">
              {rec.highlights.map((h, i) => <div key={i} className="node-line">{h}</div>)}
            </div>
          </div>
        )}
        {rec.starBeat && <div className={`node-line ${rec.starBeat.includes('上了一课') ? 'bad' : 'ok'}`}>{rec.starBeat}</div>}
        <RivalPost rec={rec} />
        {/* why it went that way — every row is a term the engine actually used */}
        {rec.verdict && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>为什么是这个结果</h2></div>
            <div className="panel-body">
              <p className="small" style={{ margin: '0 0 8px' }}>{rec.verdict}</p>
              {rec.blame && <div className={`node-line ${rec.won ? 'ok' : 'bad'}`}>{rec.blame}</div>}
              {rec.edge && rec.edge.length > 0 && (
                <div className="edge-list">
                  {/* the three that moved it most; which way is the colour and a word, the size rides the 「数值」 switch */}
                  {rec.edge.slice(0, 3).map((r) => (
                    <div key={r.key} className="edge-row">
                      <span className="k">{r.label}</span>
                      <span className={`v ${r.diff > 0 ? 'up' : 'dn'}`}>{nums ? `${r.diff > 0 ? '+' : ''}${r.diff}` : r.diff > 0 ? '占优' : '吃亏'}</span>
                      <span className="a muted">{r.advice}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        {/* all ten, from the engine's own lines — nothing synthesised */}
        {rec.box && rec.box.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>全员数据</h2></div>
            <div className="panel-body">
              <div className="table-wrap">
              <table className="box">
                <thead><tr><th></th><th>选手</th><th>K</th><th>D</th><th>A</th><th>ACS</th><th>评分</th></tr></thead>
                <tbody>
                  {rec.box.map((r) => (
                    <tr key={r.id} className={`${r.mine ? 'mine' : ''}${r.me ? ' me' : ''}`}>
                      <td className="tiny muted">{r.mine ? mine.tag : opp?.tag}</td>
                      <td>{r.ign}<span className="tiny muted"> {r.role}</span></td>
                      <td className="num">{r.k}</td><td className="num">{r.d}</td><td className="num">{r.a}</td>
                      <td className="num">{r.acs}</td>
                      <td className={`num rt ${r.rating >= 1.15 ? 'up' : r.rating < 0.85 ? 'dn' : ''}`}>{r.rating.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
        {rec.nodes.length > 0 && (
          <div className="panel" style={{ marginTop: 10 }}>
            <div className="panel-head"><h2>临场账本 · 你的 {rec.nodes.length} 次决定</h2></div>
            <div className="panel-body">
              {/* each call against the round it was about, which was really played: nothing here is a projection */}
              {rec.nodes.map((n, i) => (
                <div key={i} className={`node-line ${n.ok ? 'ok' : 'bad'}`}>
                  <span className="faint">{mapCn(n.map)} 第 {n.round} 回合</span> · 「{n.pick}」（看{DIM_CN[n.dim]}{nums ? ` · 成功率 ${n.p}%` : ''}）—— <b>{n.ok ? '成了' : '没成'}</b>
                  {n.won !== undefined && <> · 这回合{n.won ? '拿下' : '丢了'}{n.decided ? '（由这一下定）' : ''}{nums ? ` · 本图赢面 ${n.before}% → ${n.after}%` : ''}</>}
                  {nums && n.mine != null && <span className="tiny muted">（你 {sayDim(true, n.dim, n.mine)}{n.theirs != null ? ` 对 ${sayDim(true, n.dim, n.theirs)}` : ''}）</span>}
                  {n.hl && <div className="tiny muted" style={{ marginTop: 2 }}>{n.hl}</div>}
                </div>
              ))}
              {ledgerNotes(rec.nodes).map((t, i) => <p key={i} className="tiny faint" style={{ margin: '6px 0 0' }}>{t}</p>)}
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
  // between two maps: the one just played, and the one after it
  const justPlayed = phase === 'break' ? mm.sim.played[mm.sim.played.length - 1] : undefined
  const upNext = phase === 'break' ? mm.sim.maps[mm.sim.mapIndex + 1] : undefined
  const myScore = justPlayed ? (mm.mineIsA ? justPlayed.scoreA : justPlayed.scoreB) : myR
  const theirScore = justPlayed ? (mm.mineIsA ? justPlayed.scoreB : justPlayed.scoreA) : theirR
  const lastRound = map && map.rounds.length ? map.rounds[map.rounds.length - 1] : null
  const myFive = map ? (mm.mineIsA ? map.A : map.B).players : []
  const theirFive = map ? (mm.mineIsA ? map.B : map.A).players : []
  const lineOf = (id: string) => map?.lines[id]

  return (
    <Modal wide title={justPlayed ? `${mapCn(justPlayed.map)} 打完了` : `${map ? mapCn(map.map) : '换图中'} · 第 ${roundNo} 回合`} onClose={skip} onBgClose={() => {}}>
      <div className="row wrap" style={{ gap: 8, justifyContent: 'center', marginBottom: 6 }}>
        {mm.sim.played.map((m, i) => (
          <span key={i} className="tag">{mapCn(m.map)} {mm.mineIsA ? `${m.scoreA}-${m.scoreB}` : `${m.scoreB}-${m.scoreA}`}</span>
        ))}
        <span className="tag t1">大比分 {mm.myMaps} - {mm.theirMaps}</span>
        {verdict && <span className={verdictTag(verdict.k)} title={verdict.d}>{verdict.t}</span>}
      </div>
      <div className="score-line" style={{ padding: '8px 0' }}>
        <div className={`t a ${myScore > theirScore ? 'win' : ''}`}><Crest id={mm.myTeamId} size={26} /><span>{mine.tag}</span></div>
        <div className="s">{myScore} : {theirScore}</div>
        <div className={`t ${theirScore > myScore ? 'win' : ''}`}><Crest id={oppId} size={26} /><span>{opp?.tag}</span></div>
      </div>
      {wp !== null && (
        <div className="winbar-row">
          <span className="tiny muted">本图赢面</span>
          <div className="winbar" style={{ flex: 1 }}><i style={{ width: `${Math.round(wp * 100)}%` }} /></div>
          {nums && <span className="n">{Math.round(wp * 100)}%</span>}
        </div>
      )}
      {map && (
        <MapSchematic
          map={map.map}
          myAttack={mm.mineIsA === (roundNo <= 12 || (roundNo >= 25 && (roundNo - 25) % 2 === 0))}
          lastRound={lastRound} mineIsA={mm.mineIsA} agent={mm.myAgent()}
        />
      )}
      {/* the legend is on the finished match's sheet; between maps the break panel carries its own ribbon */}
      {map && !justPlayed && map.rounds.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <RoundRibbon rounds={map.rounds} mineIsA={mm.mineIsA} mineTag={mine.tag} theirTag={opp?.tag} />
        </div>
      )}
      {justPlayed ? (
        <div className="node-box">
          <p className="q">{mapCn(justPlayed.map)} {myScore} : {theirScore}，{myScore > theirScore ? '这一把拿下了' : myScore < theirScore ? '这一把丢了' : '这一把打平'}</p>
          {upNext && <p className="ctx">下一把：{mapCn(upNext)}。</p>}
          {justPlayed.rounds && justPlayed.rounds.length > 0 && (
            <div style={{ margin: '8px 0' }}>
              <RoundRibbon rounds={justPlayed.rounds} mineIsA={mm.mineIsA} mineTag={mine.tag} theirTag={opp?.tag} />
            </div>
          )}
          <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 8 }}>
            <button className="primary" onClick={() => setPhase('live')}>开始下一把{upNext ? `：${mapCn(upNext)}` : ''}</button>
            <button onClick={skip}>快进剩余</button>
          </div>
        </div>
      ) : phase === 'node' && pend ? (
        <div className="node-box">
          <RivalNode oppId={oppId} />
          <p className="q">{pend.node.q}</p>
          <p className="ctx">{pend.node.ctx}</p>
          <div className="node-opt">
            {pend.node.a.map((o, i) => {
              const pc = Math.round(nodeChance(game, o, mm.myTeamId) * 100)
              const ro = nodeReadout(game, o, mm.myTeamId, oppId)
              const risk = o.risk >= 0.85 ? '高风险' : o.risk >= 0.6 ? '中等风险' : '稳健'
              // who the bet leans on, in a word — within 3 is even; the figures and the odds ride the switch
              const edge = ro.theirs == null ? `你${sayDim(false, o.dim, ro.mine)}` : Math.abs(ro.mine - ro.theirs) <= 3 ? '差不多' : ro.mine > ro.theirs ? '你占上风' : '对面更强'
              return (
                <button key={i} onClick={() => choose(i)}>
                  <span>{o.t}</span>
                  <span className="m">
                    {nums
                      ? <>看{DIM_CN[o.dim]}：你 {ro.mine}{ro.mates != null ? `（队友均 ${ro.mates}）` : ''}{ro.theirs != null ? ` · 对方 ${ro.theirs}` : ''}　成功率 {pc}% · {risk}</>
                      : <>看{DIM_CN[o.dim]} · {edge} · {risk}</>}
                    {i === pend.node.rec ? ' · 教练会选这个' : ''}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <>
          {last && (
            <div className={`node-line ${last.ok ? 'ok' : 'bad'}`}>
              {/* the intent first; what the round did only once it has been played */}
              你选了「{last.pick}」（看{DIM_CN[last.dim]}）—— <b>{last.ok ? '成了' : '没成'}</b>
              {nums && last.mine != null && <span className="tiny muted">（你 {Math.round(last.mine)}{last.theirs != null ? ` 对 ${Math.round(last.theirs)}` : ''}）</span>}
              {last.won !== undefined && (
                <div className="small" style={{ marginTop: 2 }}>
                  第 {last.round} 回合{last.won ? '拿下' : '丢了'}{nums ? ` · 本图赢面 ${last.before}% → ${last.after}%` : ''}
                </div>
              )}
              {last.hl && <div className="tiny muted" style={{ marginTop: 2 }}>{last.hl}</div>}
            </div>
          )}
          {map && !mm.playing && <p className="tiny faint center" style={{ margin: '6px 0 0' }}>你不在场上，这张图没有要你拿主意的回合。</p>}
          <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 8 }}>
            <button onClick={skip}>快进剩余</button>
          </div>
        </>
      )}
      <RoundFeed mm={mm} />
      {map && (
        <div className="grid tiny mp-sides" style={{ marginTop: 10 }}>
          <div>
            <div className="faint" style={{ marginBottom: 4 }}>{mine.tag}{!mm.playing && ' · 你不在场上'}</div>
            {myFive.map((p) => {
              const l = lineOf(p.id)
              const ag = map ? (mm.mineIsA ? map.A : map.B).agents[p.id] : ''
              return (
                <div key={p.id} className="row" style={{ gap: 6, color: p.id === me.id ? 'var(--accent)' : undefined }}>
                  {ag && AGENT_ROLE[ag] ? <RoleTag role={AGENT_ROLE[ag]} /> : <Roles p={p} />}<Mug id={p.id} name={p.ign} agent={ag} /><span style={{ flex: 1 }}>{p.ign}{ag && <span className="muted"> · {agentCn(ag)}</span>}</span>
                  <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{l ? `${l.kills}/${l.deaths}/${l.assists}` : '0/0/0'}</span>
                </div>
              )
            })}
          </div>
          <div>
            <div className="faint" style={{ marginBottom: 4 }}>{opp?.tag}</div>
            {theirFive.map((p) => {
              const l = lineOf(p.id)
              const ag = map ? (mm.mineIsA ? map.B : map.A).agents[p.id] : ''
              return (
                <div key={p.id} className="row" style={{ gap: 6 }}>
                  {ag && AGENT_ROLE[ag] ? <RoleTag role={AGENT_ROLE[ag]} /> : <Roles p={p} />}<Mug id={p.id} name={p.ign} agent={ag} /><span style={{ flex: 1 }}>{p.ign}{ag && <span className="muted"> · {agentCn(ag)}</span>}</span>
                  <span className="muted" style={{ fontVariantNumeric: 'tabular-nums' }}>{l ? `${l.kills}/${l.deaths}/${l.assists}` : '0/0/0'}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Modal>
  )
}
