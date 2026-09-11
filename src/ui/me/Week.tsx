import { Fragment } from 'react'
import { useGame } from '../ctx'
import { Crest, Panel, fmtDay } from '../common'
import { ACTIONS, ACTION_GROUP_CN } from '../../engine/me/actions'
import { planBlock, setPlan, staminaLeft, weekCalendar, weekInDays, weekMatches } from '../../engine/me/week'
import { duelBlock, startDuel } from '../../engine/me/duel'
import { injuryStatus } from '../../engine/me/injury'
import DuelPlay from './DuelPlay'
import type { AdvanceUntil } from '../../engine/me/auto'
import { EDGE_NEED, duelTarget } from '../../engine/me/coach'
import { autoPlan, quietAhead } from '../../engine/me/auto'
import { nextRealFixtureFor, fixturesFor } from '../../engine/season'
import { trustLabel } from '../../engine/trust'
import { ladderLabel, ladderTier, skillToLadder, tryoutSkill } from '../../engine/me/prepro'
import { CUPS, cupView } from '../../engine/me/cups'

export default function Week({ onAdvance, onAdvanceUntil }: { onAdvance: () => void; onAdvanceUntil: (until: AdvanceUntil) => void }) {
  const { game, commit, toast, openMatch } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const starter = !!team && team.starters.includes(me.id)
  const next = pro ? nextRealFixtureFor(game, game.myTeam) : undefined
  const opp = next ? game.teams[next.teamA === game.myTeam ? next.teamB : next.teamA] : null
  const soon = pro ? fixturesFor(game, game.myTeam).filter((f) => !f.played && f.day > game.day && f.day <= game.day + 7) : []
  const recent = pro ? fixturesFor(game, game.myTeam).filter((f) => f.played && f.comp !== 'scrim').slice(-3).reverse() : []
  const target = pro ? duelTarget(game) : null
  const mates = team ? team.roster.filter((id) => id !== me.id).map((id) => game.players[id]).filter(Boolean) : []
  const est = opp && team ? 1 / (1 + Math.exp(-((team.rating - opp.rating) / 9))) : 0.5
  const week = Math.floor(game.day / 7)
  // 策划稿 §3.5 A: nothing of mine for four weeks — the clock can run a month at a time
  const quiet = quietAhead(game, 28)
  // two or more of my club's matches this week: it goes a day to a press, its seven days laid out over the button (engine/me/week.ts weekInDays)
  const days = weekInDays(game)

  const plan = (k: typeof ACTIONS[number]['key'], d: 1 | -1) => {
    const why = setPlan(game, k, d)
    if (why) toast(why)
    commit()
  }
  const tryDuel = () => {
    const why = startDuel(game)
    if (why) { toast(why); return }
    commit()
  }
  const duelWhy = pro ? duelBlock(game) : '需要先加入战队'
  // every action stays on the board; the ones I cannot take yet are greyed
  // with the reason under them, so the board also shows what is ahead
  const acts = ACTIONS.filter((a) => a.key !== 'duel')

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
      <div>
        <Panel
          title={`本周行动 · 剩 ${me.ap}/${me.apMax} 点`}
        >
          {/* hurt: say what it is and how long, not just fewer action points */}
          {(() => {
            const inj = injuryStatus(game)
            return inj ? (
              <div className="node-line bad" style={{ marginBottom: 10 }}>
                <b>{inj.note}</b> · 还要 {inj.weeksLeft} 周
                <div className="tiny muted" style={{ marginTop: 2 }}>{inj.text}</div>
              </div>
            ) : null
          })()}
          {/* the other budget: what the body has left after this week's plan */}
          {(() => {
            const left = staminaLeft(game)
            const now = Math.round(100 - p.fatigue)
            return (
              <div className="winbar-row" style={{ margin: '0 0 12px' }}>
                <span className="tiny muted">体力</span>
                <div className="winbar" style={{ flex: 1 }}><i style={{ width: `${left}%`, background: left < 40 ? 'var(--loss)' : undefined }} /></div>
                <span className="n">{left}<span className="tiny muted">/100</span></span>
                <span className="tiny muted">{left < now ? `（本周安排后）` : ''}{now < 40 ? ' · 四成以下，状态和比赛发挥明显下滑' : ''}</span>
              </div>
            )
          })()}
          {/* three blocks, so the eye finds "mine" / "needs a club" / "outside
              the game" without reading every card */}
          {(['train', 'team', 'life'] as const).map((g) => {
            const rows = acts.filter((a) => a.group === g)
            return (
              <div key={g} className="act-group">
                <div className="act-group-head">{ACTION_GROUP_CN[g]}</div>
                <div className="act-grid">
                  {rows.map((a) => {
                    const n = me.plan[a.key] ?? 0
                    const why = planBlock(game, a.key)
                    const locked = !!why && n === 0
                    // the card itself is the action: one click plans it once
                    // more, the way 破晓 does it; a small − takes one back
                    return (
                      <div
                        key={a.key} role="button" tabIndex={why ? -1 : 0} aria-disabled={!!why}
                        className={`act-card${n ? ' on' : ''}${locked ? ' locked' : ''}`}
                        onClick={() => { if (!why) plan(a.key, 1) }}
                        onKeyDown={(e) => { if (!why && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); plan(a.key, 1) } }}
                      >
                        <div className="t">{a.label}<span className="tag">{a.cost} 点{n ? ` · ×${n}` : ''}</span></div>
                        <div className="d">{a.desc}{a.fatigue ? `。体力 ${a.fatigue > 0 ? '−' : '+'}${Math.abs(a.fatigue)}` : ''}</div>
                        {why && <div className="why">{why}</div>}
                        {a.key === 'duo' && n > 0 && (
                          <select value={me.duoWith ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => { me.duoWith = e.target.value || undefined; commit() }}>
                            <option value="">和谁双排…</option>
                            {mates.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
                          </select>
                        )}
                        {n > 0 && (
                          <div className="c">
                            <b>已安排 {n} 次</b>
                            <button className="sm" onClick={(e) => { e.stopPropagation(); plan(a.key, -1) }}>−</button>
                          </div>
                        )}
                      </div>
                    )
                  })}
                  {g === 'team' && (
                    <div
                      role="button" tabIndex={duelWhy ? -1 : 0}
                      className={`act-card${(me.plan.duel ?? 0) ? ' on' : ''}${duelWhy ? ' locked' : ''}`}
                      onClick={() => { if (!duelWhy) tryDuel() }}
                    >
                      <div className="t">对位挑战<span className="tag">2 点</span></div>
                      <div className="d">
                        {target
                          ? `和 ${target.ign}（${target.overall}）打一场三局两胜的训练赛对位：每局一个场面，你选怎么打。资本 ${me.edge.toFixed(1)}/${EDGE_NEED}，本周 ${me.duelsThisWeek}/2。`
                          : '替补时向同位置首发发起训练赛对位，三局两胜，赢够三次教练给你试用期。'}
                      </div>
                      {duelWhy && <div className="why">{duelWhy}</div>}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          {me.duelLive && <DuelPlay onDone={() => commit()} />}
          {days && (
            <>
              {/* the week's rhythm, right over the button: what each of its seven days holds */}
              <div className="week-days" role="list" aria-label="这一周的七天">
                {weekCalendar(game).map((d, i) => {
                  const date = new Date(Date.UTC(game.year, 0, 1 + d.day))
                  return (
                    <div key={d.day} role="listitem" className={`week-day${d.matches.length ? ' match' : ''}${d.past ? ' past' : ''}${d.next ? ' next' : ''}`}>
                      <span className="d">{fmtDay(d.day, game.year)} 周{'日一二三四五六'[date.getUTCDay()]}</span>
                      {d.matches.length ? d.matches.map((f) => {
                        const mine = f.teamA === game.myTeam
                        const r = f.result
                        const my = r ? (mine ? r.mapsWonA : r.mapsWonB) : 0
                        const their = r ? (mine ? r.mapsWonB : r.mapsWonA) : 0
                        return (
                          <Fragment key={f.id}>
                            <span className="w" title={`${game.comps[f.comp]?.name ?? f.comp} · ${f.label.replace(/^(KO|SW):\d+:/, '')} · BO${f.bo}`}>vs {game.teams[mine ? f.teamB : f.teamA]?.tag}</span>
                            <span className={`s${r && my !== their ? (my > their ? ' up' : ' dn') : ''}`}>{r ? `${my > their ? '胜' : my < their ? '负' : '平'} ${my}-${their}` : `BO${f.bo}`}</span>
                          </Fragment>
                        )
                      }) : <span className="w">训练</span>}
                      {i === 6 && <span className="s">周结算</span>}
                    </div>
                  )
                })}
              </div>
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>行动点还是按周给：没有比赛的日子拿来练，第七天和工资一起结算。</p>
            </>
          )}
          <div className="advance-me">
            <button onClick={() => { autoPlan(game); commit() }} disabled={me.ap === 0} title="把这周剩下的行动点按推荐填满，填完还能改">按推荐安排</button>
            {days
              ? <button className="primary" onClick={onAdvance} title="过一天；比赛日当天开打，打完回到这里">{weekCalendar(game).some((d) => d.next && d.day === game.day) ? '打今天的比赛 →' : '推进一天 →'}</button>
              : <button className={quiet ? undefined : 'primary'} onClick={onAdvance}>推进一周 →</button>}
            {quiet && (
              <button className="primary" onClick={() => onAdvanceUntil('month')} aria-label="推进一个月" title="四周按推荐安排；中间有你的比赛、赛事开始或要你拿主意的事就停">推进一个月 →</button>
            )}
            <button onClick={() => onAdvanceUntil('match')}>到下一场比赛</button>
            <button onClick={() => onAdvanceUntil('stage')}>到赛段末</button>
            <button onClick={() => onAdvanceUntil('season')}>到赛季末</button>
            <span className="hint">
              {quiet && '接下来四周你这里没有比赛：可以一次推一个月，训练、排位、直播照常，有事会停下来。'}
              {me.ap > 0 ? `还有 ${me.ap} 点没用，${days ? '这一周过完' : '推进后'}作废。` : '行动点已用完。'}
              {days ? `这周你队有 ${weekMatches(game).length} 场比赛，改成一天一推：比赛日当天开打，打完回到这里。`
                : pro ? '一周里遇到你队的比赛会停下来打；一周有两场以上就改成一天一推。' : '杯赛、邀请、事件都会停下来等你。'}
              自动推进的周按推荐安排，遇到你的比赛或要你拿主意的事就停。
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

        <Panel title={`电竞周报 · 第 ${week} 周`}>
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
                    {game.comps[next.comp]?.name ?? next.comp} · {next.label.replace(/^(KO|SW):\d+:/, '')} · BO{next.bo} · {fmtDay(next.day, game.year)}（{next.day - game.day <= 0 ? '今天' : `${next.day - game.day} 天后`}）
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
              {CUPS.map((raw) => {
                const c = cupView(raw, game.year)
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
