import { Fragment } from 'react'
import { useGame } from '../ctx'
import { Crest, Panel, fmtDay } from '../common'
import { FaceRow } from './Face'
import { ACTIONS, ACTION_GROUP_CN } from '../../engine/me/actions'
import { planBlock, setPlan, staminaLeft, weekCalendar, weekInDays } from '../../engine/me/week'
import { duelBlock, startDuel } from '../../engine/me/duel'
import { injuryStatus } from '../../engine/me/injury'
import DuelPlay from './DuelPlay'
import type { AdvanceUntil } from '../../engine/me/auto'
import { EDGE_NEED, duelTarget } from '../../engine/me/coach'
import { autoPlan, quietAhead } from '../../engine/me/auto'
import { nextRealFixtureFor, fixturesFor } from '../../engine/season'
import { trustLabel } from '../../engine/trust'
import { INVITE_FANS, INVITE_LADDER, INVITE_LADDER_T1, ladderLabel, ladderTier, skillToLadder } from '../../engine/me/prepro'
import { CUPS, cupView } from '../../engine/me/cups'
import { fansCn } from '../../engine/me/fans'
import { useNumbers } from './words'

export default function Week({ onAdvance, onAdvanceUntil }: { onAdvance: () => void; onAdvanceUntil: (until: AdvanceUntil) => void }) {
  const { game, commit, toast, openMatch } = useGame()
  const [nums] = useNumbers()
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
  // the paper odds in words; the figures ride the 「数值」 switch
  const paper = est >= 0.65 ? '明显占优' : est >= 0.55 ? '略占优' : est > 0.45 ? '五五开' : est > 0.35 ? '略处下风' : '明显处下风'
  // where the ladder is heading: ranked pulls the score toward the spot my skill is worth (prepro.ts playRanked)
  const aim = skillToLadder(p.overall)
  const climb = aim > me.pre.ladder + 3 ? '还在往上爬' : aim < me.pre.ladder - 3 ? '打得比实力高，会往回掉' : '和实力相当'
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
          title={`本周行动 · 剩 ${me.ap} 点`}
        >
          {/* hurt: say what it is and how long, not just fewer action points */}
          {(() => {
            const inj = injuryStatus(game)
            return inj ? (
              <div className="node-line bad" style={{ marginBottom: 10 }}>
                <b>{inj.note}</b>：{inj.effect}，{inj.duration}
                <div className="tiny muted" style={{ marginTop: 2 }}>{inj.text}{inj.care}</div>
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
                <span className="n">{left}</span>
                <span className="tiny muted">{left < now ? '安排后' : ''}{left < 40 ? ' · 太累了' : ''}</span>
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
                        <div className="t">{a.label}<span className="tag">{a.cost} 点</span></div>
                        {/* the body's cost is the bar above and the lock's reason; its figure rides the switch */}
                        <div className="d">{a.desc}{nums && a.fatigue ? `。体力 ${a.fatigue > 0 ? '−' : '+'}${Math.abs(a.fatigue)}` : ''}</div>
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
                          ? `和 ${target.ign} 打三局两胜的对位，再赢约 ${Math.max(1, Math.ceil(EDGE_NEED - me.edge))} 场教练给试用期。`
                          : '替补时挑战同位置首发，赢够三次拿试用期。'}
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
            {/* one way forward on the button; the longer runs share one control (asked 2026-09-11: four advance buttons read as clutter) */}
            {days
              ? <button className="primary" onClick={onAdvance} title="过一天；比赛日当天开打，打完回到这里">{weekCalendar(game).some((d) => d.next && d.day === game.day) ? '打今天的比赛 →' : '推进一天 →'}</button>
              : quiet
                ? <button className="primary" onClick={() => onAdvanceUntil('month')} aria-label="推进一个月" title="四周按推荐安排；中间有你的比赛、赛事开始或要你拿主意的事就停">推进一个月 →</button>
                : <button className="primary" onClick={onAdvance}>推进一周 →</button>}
            <select
              className="advance-far"
              value=""
              aria-label="快进"
              title="按推荐安排一路推进，替你处理路上的事；有要你拿主意的事就停"
              onChange={(e) => {
                const v = e.target.value
                if (v === 'week') onAdvance()
                else if (v === 'match' || v === 'stage' || v === 'season') onAdvanceUntil(v)
              }}
            >
              <option value="">快进到…</option>
              {quiet && !days && <option value="week">只推进一周</option>}
              <option value="match">下一场比赛</option>
              <option value="stage">赛段末</option>
              <option value="season">赛季末</option>
            </select>
            <span className="hint">
              {me.ap > 0 ? `还有 ${me.ap} 点没用，${days ? '这一周过完' : '推进后'}作废。` : ''}
              {quiet ? '接下来四周没有你的比赛。' : ''}
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
                  <FaceRow ids={opp.starters.length ? opp.starters : opp.roster.slice(0, 5)} />
                  <p className="small" style={{ margin: '0 0 6px' }}>
                    {game.comps[next.comp]?.name ?? next.comp} · {next.label.replace(/^(KO|SW):\d+:/, '')} · BO{next.bo} · {next.day - game.day <= 0 ? '今天' : `${next.day - game.day} 天后`}
                  </p>
                  <p className="small" style={{ margin: 0 }}>纸面：<b>{paper}</b>{nums ? `（实力 ${team.rating} vs ${opp.rating}，约 ${Math.round(est * 100)}%）` : ''}</p>
                  {/* whether I start is on the top bar; here only a benching, with its clock */}
                  {me.benchLock && me.benchLock > game.day ? (
                    <p className="small" style={{ margin: '6px 0 0', color: 'var(--loss)' }}>被换下，还有 {me.benchLock - game.day} 天</p>
                  ) : null}
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
                主教练 <b>{team?.coach?.name ?? '（未知）'}</b> · {trustLabel(me.coachTrust)}{nums ? `（${Math.round(me.coachTrust)}）` : ''}
              </p>
              <p className="small" style={{ margin: 0 }}>
                {me.proven ? '你已经是他认定的首发。' : '他还当你是新人：训练赛、对位、正赛都能改变这一点。'}
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
                {climb} · 最高 {ladderLabel(me.pre.ladderPeak)}{nums ? `（天梯分 ${Math.round(me.pre.ladder)}，水平对应约 ${Math.round(aim)}）` : ''}
              </p>
              <p className="tiny faint" style={{ margin: 0 }}>
                {/* the lines rollInvites actually opens at (prepro.ts INVITE_*) */}
                进{ladderTier(INVITE_LADDER).name} 有俱乐部来看，进{ladderTier(INVITE_LADDER_T1).name} 一级俱乐部会看。
              </p>
            </Panel>
            <Panel title="今年的赛事">
              {CUPS.map((raw) => {
                const c = cupView(raw, game.year, p.region)
                const done = me.pre.cups.find((x) => x.key === c.key && x.year === game.year)
                // entering a cup marks it seen, exactly as skipping one does: a cup still being played is neither
                const running = me.pre.cup?.key === c.key
                const seen = me.pre.seen.includes(`${game.year}:${c.key}`)
                const when = week < c.week ? `${c.week - week} 周后` : week === c.week ? '本周' : ''
                return (
                  <p key={c.key} className="small" style={{ margin: '0 0 4px' }}>
                    <b>{c.name}</b>{when ? ` · ${when}` : ''}{c.minFans ? ` · 邀请制（粉丝过 ${fansCn(c.minFans)}）` : ''}
                    {done ? ` · ${done.won ? '冠军' : `止步${c.rounds[Math.min(done.reached, c.rounds.length - 1)].label}`}` : running ? ' · 已报名，正在打' : seen ? ' · 没参加' : week > c.week ? ' · 错过了' : ''}
                  </p>
                )
              })}
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>俱乐部要什么水平：看「转会」页。</p>
            </Panel>
            <Panel title="怎么被看见">
              <p className="tiny faint" style={{ margin: 0 }}>
                三条路：杯赛走得远、天梯进{ladderTier(INVITE_LADDER).name}、粉丝过 {fansCn(INVITE_FANS)}。
                {me.pre.year >= 3 ? ` 这是第 ${me.pre.year} 年。四年没签到合同，就该想想别的了。` : ''}
              </p>
            </Panel>
          </>
        )}
      </div>
    </div>
  )
}
