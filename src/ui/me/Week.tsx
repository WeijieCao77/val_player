import { useState } from 'react'
import { useGame } from '../ctx'
import { Crest, Panel, fmtDay } from '../common'
import { ACTIONS } from '../../engine/me/actions'
import { doDuel, setPlan } from '../../engine/me/week'
import type { DuelResult } from '../../engine/me/coach'
import { EDGE_NEED, duelTarget } from '../../engine/me/coach'
import { autoPlan } from '../../engine/me/auto'
import { nextRealFixtureFor, fixturesFor } from '../../engine/season'
import { trustLabel } from '../../engine/trust'

export default function Week({ onAdvance }: { onAdvance: () => void }) {
  const { game, commit, toast, openMatch } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const team = game.teams[game.myTeam]
  const starter = team.starters.includes(me.id)
  const [duel, setDuel] = useState<DuelResult | null>(null)
  const next = nextRealFixtureFor(game, game.myTeam)
  const opp = next ? game.teams[next.teamA === game.myTeam ? next.teamB : next.teamA] : null
  const soon = fixturesFor(game, game.myTeam).filter((f) => !f.played && f.day > game.day && f.day <= game.day + 7)
  const recent = fixturesFor(game, game.myTeam).filter((f) => f.played && f.comp !== 'scrim').slice(-3).reverse()
  const target = duelTarget(game)
  const mates = team.roster.filter((id) => id !== me.id).map((id) => game.players[id]).filter(Boolean)
  const est = opp ? 1 / (1 + Math.exp(-((team.rating - opp.rating) / 9))) : 0.5

  const plan = (k: typeof ACTIONS[number]['key'], d: 1 | -1) => {
    const why = setPlan(game, k, d)
    if (why) toast(why)
    commit()
  }
  const tryDuel = () => {
    const r = doDuel(game)
    if (typeof r === 'string') { toast(r); return }
    setDuel(r)
    commit()
  }

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
      <div>
        <Panel
          title={`本周行动 · 剩 ${me.ap}/${me.apMax} 点`}
          actions={<button className="sm" onClick={() => { autoPlan(game); commit() }}>按推荐安排</button>}
        >
          <div className="act-grid">
            {ACTIONS.filter((a) => a.key !== 'duel').map((a) => {
              const n = me.plan[a.key] ?? 0
              return (
                <div key={a.key} className={`act-card${n ? ' on' : ''}`}>
                  <div className="t">{a.label}<span className="tag">{a.cost} 点</span></div>
                  <div className="d">{a.desc}{a.fatigue ? `。体力 ${a.fatigue > 0 ? '−' : '+'}${Math.abs(a.fatigue)}` : ''}</div>
                  {a.key === 'duo' && n > 0 && (
                    <select value={me.duoWith ?? ''} onChange={(e) => { me.duoWith = e.target.value || undefined; commit() }}>
                      <option value="">和谁双排…</option>
                      {mates.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
                    </select>
                  )}
                  <div className="c">
                    <button className="sm" onClick={() => plan(a.key, -1)} disabled={n <= 0}>−</button>
                    <b>{n}</b>
                    <button className="sm" onClick={() => plan(a.key, 1)} disabled={me.ap < a.cost}>+</button>
                  </div>
                </div>
              )
            })}
            <div className={`act-card${(me.plan.duel ?? 0) ? ' on' : ''}`}>
              <div className="t">对位挑战<span className="tag">2 点</span></div>
              <div className="d">
                {starter ? '你已经是首发，不用挑战谁。'
                  : target ? `向 ${target.ign}（${target.overall}）发起训练赛对位，赢够 ${EDGE_NEED} 次教练给你试用期。资本 ${me.edge.toFixed(1)}/${EDGE_NEED}，本周 ${me.duelsThisWeek}/2。`
                    : '现在没有可以挑战的首发。'}
              </div>
              <div className="c">
                <button className="sm primary" onClick={tryDuel} disabled={starter || !target || me.ap < 2}>现在打</button>
              </div>
            </div>
          </div>
          {duel && (
            <div className={`node-line ${duel.won ? 'ok' : 'bad'}`} style={{ marginTop: 10 }}>
              对位 <b>{duel.him.ign}</b>：{duel.rounds.map((r) => `${r.dim} ${r.mine} vs ${r.his}（${r.p}%）${r.ok ? '✓' : '✗'}`).join(' · ')}
              —— <b>{duel.won ? (duel.flash ? '三局全胜' : '赢了') : '输了'}</b>，资本 {duel.edge.toFixed(1)}/{EDGE_NEED}
              {duel.trial && <b style={{ color: 'var(--win)' }}>　教练给了你试用期！</b>}
            </div>
          )}
          <div className="advance-me">
            <button className="primary" onClick={onAdvance}>推进一周 →</button>
            <span className="hint">
              {me.ap > 0 ? `还有 ${me.ap} 点没用，推进后作废。` : '行动点已用完。'}
              一周里遇到你队的比赛会停下来打。
            </span>
          </div>
        </Panel>

        <Panel title="这一周">
          {me.weekNotes.length === 0 ? <p className="muted" style={{ margin: 0 }}>还没有发生什么。</p> : (
            <ul className="diary">
              {me.weekNotes.slice(-14).map((n, i) => <li key={i}><span>{n}</span></li>)}
            </ul>
          )}
        </Panel>
      </div>

      <div>
        <Panel title="下一场" className={starter ? 'own' : ''}>
          {next && opp ? (
            <>
              <div className="score-line" style={{ padding: '4px 0 8px' }}>
                <div className="t a"><Crest id={game.myTeam} size={28} /><span>{team.tag}</span></div>
                <div className="s muted" style={{ fontSize: 18 }}>VS</div>
                <div className="t"><Crest id={opp.id} size={28} /><span>{opp.tag}</span></div>
              </div>
              <p className="small" style={{ margin: '0 0 6px' }}>
                {game.comps[next.comp]?.name ?? next.comp} · {next.label.replace(/^(KO|SW):\d+:/, '')} · BO{next.bo} · {fmtDay(next.day, game.year)}（{next.day - game.day} 天后）
              </p>
              <p className="small" style={{ margin: '0 0 6px' }}>
                实力 {team.rating} vs {opp.rating}，纸面赢面约 <b>{Math.round(est * 100)}%</b>
              </p>
              <p className="small" style={{ margin: 0 }}>
                教练本周的名单：{me.trial ? <b style={{ color: 'var(--accent)' }}>你在试用期，首发</b>
                  : starter ? <b style={{ color: 'var(--win)' }}>你首发</b>
                    : <b style={{ color: 'var(--loss)' }}>你在替补席</b>}
                {me.benchLock && me.benchLock > game.day ? `（被换下，还有 ${me.benchLock - game.day} 天）` : ''}
              </p>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>暂时没有排定的比赛。</p>}
          {soon.length > 1 && (
            <p className="tiny faint" style={{ margin: '8px 0 0' }}>
              七天内还有：{soon.slice(1).map((f) => `${game.teams[f.teamA === game.myTeam ? f.teamB : f.teamA]?.tag}（${f.day - game.day} 天后）`).join('，')}
            </p>
          )}
        </Panel>

        <Panel title="教练怎么看你">
          <p className="small" style={{ margin: '0 0 6px' }}>
            主教练 <b>{team.coach?.name ?? '（未知）'}</b> · 信任 <b>{Math.round(me.coachTrust)}</b>（{trustLabel(me.coachTrust)}）
          </p>
          <p className="small" style={{ margin: '0 0 6px' }}>
            {me.proven ? '你已经是他认定的首发。' : '在他眼里你还是个没打过多少比赛的新人：跟队训练赛、对位挑战、正赛数据，都会改变这一点。'}
          </p>
          <p className="tiny faint" style={{ margin: 0 }}>
            首发名单每周一重排。同位置首发：{target ? `${target.ign}（${target.overall}）` : '—'}；你 {p.overall}，上限 {p.potential}。
          </p>
        </Panel>

        {recent.length > 0 && (
          <Panel title="最近的比赛" flush>
            <table>
              <tbody>
                {recent.map((f) => {
                  const mine = f.teamA === game.myTeam
                  const r = f.result!
                  const w = mine ? r.mapsWonA > r.mapsWonB : r.mapsWonB > r.mapsWonA
                  const o = game.teams[mine ? f.teamB : f.teamA]
                  return (
                    <tr key={f.id} className="clickable" onClick={() => openMatch(f)}>
                      <td>{fmtDay(f.day, game.year)}</td>
                      <td>{o?.tag}</td>
                      <td className="num"><span className={w ? 'pos-ink' : 'neg-ink'} style={{ color: w ? 'var(--win)' : 'var(--loss)' }}>{mine ? `${r.mapsWonA}-${r.mapsWonB}` : `${r.mapsWonB}-${r.mapsWonA}`}</span></td>
                      <td className="muted">{r.lineups && (mine ? r.lineups.a : r.lineups.b).includes(me.id) ? '出场' : '替补'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  )
}
