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
import { ladderLabel, ladderTier, skillToLadder, tryoutSkill } from '../../engine/me/prepro'
import { CUPS } from '../../engine/me/cups'

const PRO_ONLY = new Set(['scrim', 'duo', 'duel'])

export default function Week({ onAdvance }: { onAdvance: () => void }) {
  const { game, commit, toast, openMatch } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const starter = !!team && team.starters.includes(me.id)
  const [duel, setDuel] = useState<DuelResult | null>(null)
  const next = pro ? nextRealFixtureFor(game, game.myTeam) : undefined
  const opp = next ? game.teams[next.teamA === game.myTeam ? next.teamB : next.teamA] : null
  const soon = pro ? fixturesFor(game, game.myTeam).filter((f) => !f.played && f.day > game.day && f.day <= game.day + 7) : []
  const recent = pro ? fixturesFor(game, game.myTeam).filter((f) => f.played && f.comp !== 'scrim').slice(-3).reverse() : []
  const target = pro ? duelTarget(game) : null
  const mates = team ? team.roster.filter((id) => id !== me.id).map((id) => game.players[id]).filter(Boolean) : []
  const est = opp && team ? 1 / (1 + Math.exp(-((team.rating - opp.rating) / 9))) : 0.5
  const week = Math.floor(game.day / 7)

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
  const acts = ACTIONS.filter((a) => a.key !== 'duel' && (pro || !PRO_ONLY.has(a.key)))

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
      <div>
        <Panel
          title={`本周行动 · 剩 ${me.ap}/${me.apMax} 点`}
          actions={<button className="sm" onClick={() => { autoPlan(game); commit() }}>按推荐安排</button>}
        >
          <div className="act-grid">
            {acts.map((a) => {
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
            {pro && (
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
            )}
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
              {pro ? '一周里遇到你队的比赛会停下来打。' : '杯赛、邀请、事件都会停下来等你。'}
            </span>
          </div>
        </Panel>

        {me.quests.length > 0 && (
          <Panel title="待办">
            {me.quests.map((q) => (
              <p key={q.id} className="small" style={{ margin: '0 0 4px' }}>
                <b>{q.title}</b> · {q.done}/{q.need} · 还有 {Math.max(0, q.deadline - game.day)} 天 · 做到 {q.rewardText}，做不到 {q.penaltyText}
              </p>
            ))}
          </Panel>
        )}

        <Panel title="这一周">
          {me.weekNotes.length === 0 ? <p className="muted" style={{ margin: 0 }}>还没有发生什么。</p> : (
            <ul className="diary">{me.weekNotes.slice(-14).map((n, i) => <li key={i}><span>{n}</span></li>)}</ul>
          )}
        </Panel>
      </div>

      <div>
        {pro ? (
          <>
            <Panel title="下一场" className={starter ? 'own' : ''}>
              {next && opp && team ? (
                <>
                  <div className="score-line" style={{ padding: '4px 0 8px' }}>
                    <div className="t a"><Crest id={game.myTeam} size={28} /><span>{team.tag}</span></div>
                    <div className="s muted" style={{ fontSize: 18 }}>VS</div>
                    <div className="t"><Crest id={opp.id} size={28} /><span>{opp.tag}</span></div>
                  </div>
                  <p className="small" style={{ margin: '0 0 6px' }}>
                    {game.comps[next.comp]?.name ?? next.comp} · {next.label.replace(/^(KO|SW):\d+:/, '')} · BO{next.bo} · {fmtDay(next.day, game.year)}（{next.day - game.day} 天后）
                  </p>
                  <p className="small" style={{ margin: '0 0 6px' }}>实力 {team.rating} vs {opp.rating}，纸面赢面约 <b>{Math.round(est * 100)}%</b></p>
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
                主教练 <b>{team?.coach?.name ?? '（未知）'}</b> · 信任 <b>{Math.round(me.coachTrust)}</b>（{trustLabel(me.coachTrust)}）· 经理信任 {Math.round(me.gmTrust)}
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
                <table><tbody>
                  {recent.map((f) => {
                    const mine = f.teamA === game.myTeam
                    const r = f.result!
                    const w = mine ? r.mapsWonA > r.mapsWonB : r.mapsWonB > r.mapsWonA
                    const o = game.teams[mine ? f.teamB : f.teamA]
                    return (
                      <tr key={f.id} className="clickable" onClick={() => openMatch(f)}>
                        <td>{fmtDay(f.day, game.year)}</td><td>{o?.tag}</td>
                        <td className="num" style={{ color: w ? 'var(--win)' : 'var(--loss)' }}>{mine ? `${r.mapsWonA}-${r.mapsWonB}` : `${r.mapsWonB}-${r.mapsWonA}`}</td>
                        <td className="muted">{r.lineups && (mine ? r.lineups.a : r.lineups.b).includes(me.id) ? '出场' : '替补'}</td>
                      </tr>
                    )
                  })}
                </tbody></table>
              </Panel>
            )}
          </>
        ) : (
          <>
            <Panel title="天梯" className="own">
              <p style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700 }}>{ladderLabel(me.pre.ladder)}</p>
              <p className="small" style={{ margin: '0 0 6px' }}>
                天梯分 <b>{Math.round(me.pre.ladder)}</b>（{ladderTier(me.pre.ladder).name}）· 最高 {Math.round(me.pre.ladderPeak)} · 你的水平对应约 {Math.round(skillToLadder(p.overall))}
              </p>
              <p className="tiny faint" style={{ margin: 0 }}>
                一点行动打六把。分数朝你的实力对应的位置爬，越高越慢；一周不打会往下漏。前 100 有人看，前 10 一级俱乐部会看。
              </p>
            </Panel>
            <Panel title="今年的赛事">
              {CUPS.map((c) => {
                const done = me.pre.cups.find((x) => x.key === c.key && x.year === game.year)
                const seen = me.pre.seen.includes(`${game.year}:${c.key}`)
                return (
                  <p key={c.key} className="small" style={{ margin: '0 0 4px' }}>
                    <b>{c.name}</b> · 第 {c.week + 1} 周{c.minFans ? ` · 邀请制（粉丝 ≥ ${c.minFans}）` : ''}
                    {done ? ` · ${done.won ? '冠军' : `打到 ${done.reached}/${done.rounds}`}` : seen ? ' · 没参加' : week > c.week ? ' · 错过了' : week === c.week ? ' · 本周' : ''}
                  </p>
                )
              })}
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>俱乐部要的水平 vs 你现在：看「转会」页的门槛表。你现在 {Math.round(tryoutSkill(game))}。</p>
            </Panel>
            <Panel title="怎么被看见">
              <p className="tiny faint" style={{ margin: 0 }}>
                三条路：杯赛走得远（深度 × 50% + 冠军 30%）、天梯前 100（每周 5% 起）、粉丝过 150（每周 3.5%）。被记下来的次数 {me.pre.scoutSeen}，每次 +4.5%。
                {me.pre.year > 1 ? ` 这是第 ${me.pre.year} 年。四年没签到合同，就该想想别的了。` : ''}
              </p>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
