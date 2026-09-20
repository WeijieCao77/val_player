import { Fragment, useState } from 'react'
import { useGame } from './ctx'
import { Crest, Panel, fmtDay } from './common'
import { FaceRow } from './Face'
import { ACTIONS, ACTION_GROUP_CN } from '../../engine/me/actions'
import { ceilingNote } from '../../engine/me/bottleneck'
import { fillerNote, goalOf, hourLine, weightsOf } from '../../engine/me/goal'
import NextStep, { LineText } from './NextStep'
import { nextCardDue, useNextHidden } from './guide'
import { actionBlock, doAction, matchAhead, repeatLastWeek, staminaLeft, undoAction, undoWeek, weekCalendar, weekInDays } from '../../engine/me/week'
import { REPLAY_CN, UNDO_EDGE_CN, canUndo, undoDepth } from '../../engine/me/undo'
import { duelBlock, startDuel } from '../../engine/me/duel'
import { injuryStatus } from '../../engine/me/injury'
import DuelPlay from './DuelPlay'
import type { AdvanceUntil } from '../../engine/me/auto'
import { EDGE_NEED, duelTarget, standingLine } from '../../engine/me/coach'
import { autoPlan, quietAhead, runBlocked, stopLine } from '../../engine/me/auto'
import { asideReminders } from '../../engine/me/aside'
import { fixturesFor } from '../../engine/season'
import { WAIT_CN, nextUp, roadAhead, roadLines } from '../../engine/me/nextup'
import { dateCn, inviteBlock, signedThisPeriod, windowLine } from '../../engine/me/window'
import { PITCH_AP, PITCH_MAX } from '../../engine/me/selfpitch'
import { pitchBook } from '../../engine/me/pitchbook'
import { iglLine } from '../../engine/me/igl'
import { trustLabel } from './words'
import { INVITE_FANS, INVITE_LADDER, INVITE_LADDER_T1, skillToLadder } from '../../engine/me/prepro'
import { RADIANT_SLOTS, rankAt, rankBar, rankFull, rankText, riseOf, rulesAt, standingOf } from '../../engine/me/rank'
import { CUPS, CUP_ROUND_GAP, clubCupBlock, cupRoundToday, cupStatus, cupView } from '../../engine/me/cups'
import CupDetail from './CupDetail'
import { RankBadge } from './art/emblem'
import { focusEvent } from './eventFocus'
import { FRIENDLY_MAP_FATIGUE } from '../../engine/me/matchplay'
import { fansCn } from '../../engine/me/fans'
import { useNumbers } from './words'
import { chainLine } from '../../engine/me/story'
import type { GameState } from '../../engine/types'

/**
 * The week's one way forward, as its button says it: a day of a match week,
 * otherwise a week — never more. A month is 「快进到…」's to offer, and named
 * there: the button used to turn into 「推进一个月」 when four quiet weeks lay
 * ahead, and pressed unread it ran into a renewal or a signing (reported
 * 2026-09-12). The button ends the week's panel; on a phone the overview
 * carries a copy of it where the page opens (PlayerGame .hero-go), the way
 * 破晓's HUD mirrors the page's main button. One function, so the two never
 * say different things.
 */
export function advanceOf(game: GameState): { label: string; title?: string } {
  // a round of my cup is today's and its card is up: the press opens it, as it would my club's match (engine/me/cups.ts)
  if (cupRoundToday(game)) return { label: '打今天的比赛 →', title: '今天是杯赛的比赛日，打完回到这里' }
  if (weekInDays(game)) {
    return {
      label: weekCalendar(game).some((d) => d.next && d.day === game.day) ? '打今天的比赛 →' : '推进一天 →',
      title: '过一天；比赛日当天开打，打完回到这里',
    }
  }
  return { label: '推进一周 →' }
}

export default function Week({ onAdvance, onAdvanceUntil }: { onAdvance: () => void; onAdvanceUntil: (until: AdvanceUntil) => void }) {
  const { game, commit, toast, openMatch, go } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const starter = !!team && team.starters.includes(me.id)
  // my club's next match, its tie written or not, or else the next event that is its own (engine/me/nextup.ts)
  const up = pro ? nextUp(game) : undefined
  // nothing named: the rest of the season and the next one (engine/me/nextup.ts roadAhead)
  const road = up?.kind === 'none' ? roadAhead(game) : undefined
  const next = up?.kind === 'fixture' ? up.fixture : undefined
  const oppId = next ? (next.teamA === game.myTeam ? next.teamB : next.teamA) : up?.kind === 'round' ? up.opponent : null
  const opp = oppId ? game.teams[oppId] ?? null : null
  // the event this names, a click from its own panel on 「积分榜」 — its table, its bracket, its dates (ui/me/eventFocus.ts)
  const nextKey = !up ? undefined
    : up.kind === 'fixture' ? up.fixture.comp
      : up.kind === 'round' || up.kind === 'waiting' ? up.comp?.key
        : up.kind === 'event' ? Object.values(game.comps).find((c) => c.name === up.name)?.key
          : road?.next || road?.maybe ? Object.values(game.comps).find((c) => c.name === (road.next ?? road.maybe)!.name)?.key : undefined
  const nextComp = nextKey ? game.comps[nextKey] : undefined
  const soon = pro ? fixturesFor(game, game.myTeam).filter((f) => !f.played && f.day > game.day && f.day <= game.day + 7) : []
  const recent = pro ? fixturesFor(game, game.myTeam).filter((f) => f.played && f.comp !== 'scrim').slice(-3).reverse() : []
  const target = pro ? duelTarget(game) : null
  const mates = team ? team.roster.filter((id) => id !== me.id).map((id) => game.players[id]).filter(Boolean) : []
  const est = opp && team ? 1 / (1 + Math.exp(-((team.rating - opp.rating) / 9))) : 0.5
  // the paper odds in words; the figures ride the 「数值」 switch
  const paper = est >= 0.65 ? '明显占优' : est >= 0.55 ? '略占优' : est > 0.45 ? '五五开' : est > 0.35 ? '略处下风' : '明显处下风'
  // where the ladder is heading: ranked pulls where I stand toward the spot my skill is worth (prepro.ts playRanked);
  // a week off moves no score, and from 神话 up the board climbs past me (rank.ts boardWeek)
  const aim = skillToLadder(p.overall)
  const stand = standingOf(game)
  const rise = riseOf(me.pre)
  // the board has climbed past me far enough to cost a place: today's place against the one my RR holds on the board as it stands
  const ladderNow = rankAt(game)
  const slid = (ladderNow.pos ?? 0) > (rankAt(game, me.pre.ladder).pos ?? 0)
  const climb = aim > stand + 3 ? (slid ? '实力比现在的名次高，打回去能追上' : '还在往上爬') : aim < stand - 3 ? '打得比实力高，接着打会往回掉' : '和实力相当'
  const week = Math.floor(game.day / 7)
  // 策划稿 §3.5 A: nothing of mine for four weeks — the clock can run a month at a time
  const quiet = quietAhead(game, 28)
  // two or more of my club's matches this week: it goes a day to a press, its seven days laid out over the button (engine/me/week.ts weekInDays)
  const days = weekInDays(game)
  // the cup opened from 「今年的赛事」 (ui/me/CupDetail.tsx)
  const [cupOpen, setCupOpen] = useState<string | null>(null)

  // the card is the button and the click is the action: it happens now, and the
  // line it leaves goes on 本周流水 over the cards (engine/me/week.ts doAction)
  const act = (k: typeof ACTIONS[number]['key']) => {
    const why = doAction(game, k)
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
  // 重点 and 调剂 for the goal of the phase (engine/me/goal.ts) — a tag on the card, nothing hidden
  const weights = weightsOf(game)
  const goalTitle = goalOf(game)?.title ?? ''
  const weightTag = (k: typeof ACTIONS[number]['key']) => {
    const w = weights[k]
    if (!w) return null
    return w === 'focus'
      ? <span className="tag focus" title={`对「${goalTitle}」最有用`}>重点</span>
      : <span className="tag filler" title={fillerNote(game)}>调剂</span>
  }
  // the 下一步 card carries the week's recommendation while it is up; put away, the line comes back here
  useNextHidden(goalOf(game)?.phase ?? 'pre')
  const card = nextCardDue(game)

  // the run under way, a round a week: where it stands, the next round's day, and that the days before it are mine
  // (engine/me/cups.ts) — without a club, or entered at this one between its events
  const cupRun = (() => {
    const run = me.pre.cup
    const raw = run && CUPS.find((x) => x.key === run.key)
    // at a club, only a run entered there, between its events (engine/me/cups.ts clubCupBlock, resumeCup)
    if (!run || !raw || (pro && run.club !== game.myTeam)) return null
    const c = cupView(raw, game.year, p.region)
    const next = run.next ?? game.day
    const left = next - game.day
    const on = (d: number) => `${fmtDay(d, game.year)} 周${'日一二三四五六'[new Date(Date.UTC(game.year, 0, 1 + d)).getUTCDay()]}`
    const bo = c.rounds[run.round]?.bo ?? 3
    return (
      <Panel title={`杯赛 · ${c.name}`} className="own" actions={<button className="sm ghost" aria-haspopup="dialog" onClick={() => setCupOpen(run.key)}>赛事详情</button>}>
        <div role="list" aria-label="赛程" style={{ marginBottom: 8 }}>
          {c.rounds.map((r, i) => {
            const past = i < run.round
            const now = i === run.round
            return (
              <div key={i} role="listitem" className={`small${past ? ' muted' : now ? '' : ' faint'}`} style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 8px', alignItems: 'baseline', margin: '0 0 4px' }}>
                <b>{r.label}</b>
                <span className="tiny">BO{r.bo}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {past ? (run.results[i]?.slice(r.label.length + 1) || '胜')
                    : now ? <b style={{ color: 'var(--accent)' }}>{on(next)} · {left <= 0 ? '今天' : `还有 ${left} 天`}</b>
                      : `约 ${on(next + (i - run.round) * CUP_ROUND_GAP)} · 赢下${c.rounds[i - 1].label}才打`}
                </span>
              </div>
            )
          })}
        </div>
        <p className="tiny muted" style={{ margin: '0 0 4px' }}>车队：{run.mates.map((m) => `${m.ign}（${m.role}）`).join('、')}</p>
        <p className="tiny" style={{ margin: 0 }}>
          体力 {Math.round(100 - p.fatigue)}{nums ? `，这一轮约耗 ${Math.round((bo === 1 ? 1 : 2.5) * FRIENDLY_MAP_FATIGUE)}` : ''}。
          {left > 0 ? '比赛日之前是平常的日子：休息在周结算时回体力，理疗和外设在「经济」页，买了当场生效。' : '今天开打。'}
        </p>
        <p className="tiny faint" style={{ margin: '4px 0 0' }}>比赛日弹卡开打；打不了可以在卡上弃权，奖金按已赢的轮次算。</p>
      </Panel>
    )
  })()
  // this year's cups, a click from each one's own page (ui/me/CupDetail.tsx) — on a signed player's week too
  const proCupLine = (() => {
    if (!pro || me.pre.cup) return ''
    // the next cup still to open: whether my club's calendar leaves room for it, as things stand
    const week = Math.floor(game.day / 7)
    const raw = CUPS.find((x) => x.key !== 'premier' && x.week >= week && cupStatus(game, x.key).kind !== 'skipped')
    if (!raw) return ''
    const c = cupView(raw, game.year, p.region)
    const why = clubCupBlock(game, raw.key)
    return why ? `${c.name}：${why}，报不了。` : `${c.name}：照现在的赛程，俱乐部到那时没有比赛，可以报。`
  })()
  const cupList = (
    <Panel title="今年的赛事">
      {/* each cup opens its own page: when, the rounds, who can enter, what it gives, how it went
          (ui/me/CupDetail.tsx). Reported 2026-09-18: the list could be read and not opened */}
      <div className="cup-list">
        {CUPS.map((raw) => {
          const c = cupView(raw, game.year, p.region)
          const st = cupStatus(game, c.key)
          const at = (i: number) => c.rounds[Math.min(i, c.rounds.length - 1)].label
          const when = st.kind === 'ahead' ? `${st.weeks} 周后` : st.kind === 'now' ? '本周' : ''
          const how = st.kind === 'done'
            ? (st.run.won ? '冠军' : st.run.forfeit ? `${at(st.run.reached)}弃权` : `止步${at(st.run.reached)}`)
            : st.kind === 'running' ? `已报名 · ${c.rounds[me.pre.cup!.round]?.label ?? ''}${me.pre.cup!.next != null ? ` ${fmtDay(me.pre.cup!.next, game.year)}` : ''}`
              : st.kind === 'skipped' ? '没参加' : st.kind === 'missed' ? '错过了' : ''
          const over = st.kind === 'done' || st.kind === 'skipped' || st.kind === 'missed'
          // signed: the Challengers road is the club's (engine/me/cups.ts clubCupBlock)
          const signedOut = pro && c.key === 'premier' && (st.kind === 'ahead' || st.kind === 'now')
          return (
            <button key={c.key} type="button" className={`cup-row${over ? ' over' : ''}${st.kind === 'running' || st.kind === 'now' ? ' on' : ''}`} aria-haspopup="dialog" onClick={() => setCupOpen(c.key)}>
              <span className="t">
                <b>{c.name}</b>{when ? ` · ${when}` : ''}{c.minFans ? ` · 邀请制（粉丝过 ${fansCn(c.minFans)}）` : ''}{how ? ` · ${how}` : ''}{signedOut ? ' · 签了约不报' : ''}
              </span>
              <span className="go" aria-hidden="true">›</span>
            </button>
          )
        })}
      </div>
      {pro ? (
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>
          签了约也能报：俱乐部在一项杯赛打完之前没有比赛就行（挑战者组除外），拿奖金和人气，俱乐部不会有意见。{proCupLine}点一项看赛程和报名条件。
        </p>
      ) : <p className="tiny faint" style={{ margin: '6px 0 0' }}>点一项看赛程、报名条件和奖励。俱乐部要什么水平：看「转会」页。</p>}
    </Panel>
  )

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)' }}>
      {/* the goal of this stretch and the week's one thing, first on the page (ui/me/NextStep.tsx) */}
      <NextStep />
      {/* a chain under way: one line across both columns — how long is left, what it wants (me/story.ts) */}
      {(() => {
        const line = chainLine(game)
        return line ? <div className="node-line" style={{ gridColumn: '1 / -1', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{line}</div> : null
      })()}
      {/* an offer set aside on the 转会 page that runs out before this week is over: a line over the button,
          never a card that stops the week again (engine/me/aside.ts asideReminders) */}
      {(() => {
        const lines = asideReminders(game)
        return lines.length ? (
          <div className="node-line bad" style={{ gridColumn: '1 / -1', margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
            <span>{lines.join('；')}。</span>
            <button className="sm" onClick={() => go('transfer')}>去「转会」页</button>
          </div>
        ) : null
      })()}
      <div>
        <Panel
          title={`本周行动 · 剩 ${me.ap} 点`}
        >
          {/* the hour worth the most to 综合 right now (me/growth.ts hourValues): one line, not a plan — on the 下一步 card while it is up */}
          {(() => {
            const line = card ? null : hourLine(game)
            return line ? (
              <p className="tiny muted" style={{ margin: '0 0 10px' }}>
                <LineText line={line} />
              </p>
            ) : null
          })()}
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
          {/* the other budget, and it is spent as the cards are clicked: the number itself, never a forecast */}
          {(() => {
            const left = staminaLeft(game)
            return (
              <div className="winbar-row" style={{ margin: '0 0 12px' }}>
                <span className="tiny muted">体力</span>
                <div className="winbar" style={{ flex: 1 }}><i style={{ width: `${left}%`, background: left < 40 ? 'var(--loss)' : undefined }} /></div>
                <span className="n">{left}</span>
                <span className="tiny muted">{left < 40 ? '太累了' : ''}</span>
              </div>
            )
          })()}
          {/* a match of mine still to come this week: what is spent now is still on the body
              when it is played (engine/me/week.ts matchAhead) — said where the choice is made */}
          {(() => {
            const up = matchAhead(game)
            if (!up) return null
            const left = up.day - game.day
            const opp = game.teams[up.fixture.teamA === game.myTeam ? up.fixture.teamB : up.fixture.teamA]
            return (
              <p className="tiny muted" style={{ margin: '-6px 0 12px' }}>
                {left <= 0 ? '今天' : `${left} 天后`}打 {opp?.tag ?? '对手'}，你是首发：现在练的累，到比赛那天还在身上。
              </p>
            )
          })()}
          {/* 本周流水: what this week's clicks did, over the cards — 破晓 keeps the
              same strip at the top of its action card, for exactly this reason
              (「点了「练操作」之后原来只有数字悄悄变了一下」) */}
          {(() => {
            const log = me.weekLog ?? []
            const tally = acts.filter((a) => (me.plan[a.key] ?? 0) > 0).map((a) => `${a.label} ×${me.plan[a.key]}`)
            if ((me.plan.duel ?? 0) > 0) tally.push(`对位挑战 ×${me.plan.duel}`)
            if (!log.length && !tally.length) return null
            return (
              <div className="week-did" role="status" aria-label="本周流水">
                {log.slice(-3).map((l, i) => <p key={i}>{l}</p>)}
                {tally.length > 0 && <p className="sum">这周：{tally.join(' · ')}</p>}
                {/* the boundary, said where the cards are and never as a dialog (engine/me/undo.ts) */}
                {undoDepth(game) > 0 && <p className="sum">{UNDO_EDGE_CN}</p>}
              </div>
            )
          })()}
          {/* three blocks, so the eye finds "mine" / "needs a club" / "outside
              the game" without reading every card */}
          {(['train', 'team', 'life'] as const).map((g) => {
            const rows = acts.filter((a) => a.group === g)
            return (
              <div key={g} className="act-group" data-group={g}>
                <div className="act-group-head">
                  {ACTION_GROUP_CN[g]}
                  {/* when the hours outside the game are the right call, said once over them */}
                  {g === 'life' && <span className="act-group-note">{fillerNote(game)}</span>}
                </div>
                <div className="act-grid">
                  {rows.map((a) => {
                    const n = me.plan[a.key] ?? 0
                    const why = actionBlock(game, a.key)
                    const locked = !!why && n === 0
                    // the card itself is the button, and the click is the thing:
                    // it happens now, the way 破晓 does it. Nothing takes it back.
                    return (
                      <div
                        key={a.key} role="button" tabIndex={why ? -1 : 0} aria-disabled={!!why}
                        className={`act-card${n ? ' on' : ''}${locked ? ' locked' : ''}`}
                        onClick={() => { if (!why) act(a.key) }}
                        onKeyDown={(e) => { if (!why && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); act(a.key) } }}
                      >
                        <div className="t">{a.label}{weightTag(a.key)}<span className="tag">{a.cost} 点</span></div>
                        {/* the body's cost is the bar above and the lock's reason; its figure rides the switch */}
                        <div className="d">{a.desc}{nums && a.fatigue ? `。体力 ${a.fatigue > 0 ? '−' : '+'}${Math.abs(a.fatigue)}` : ''}</div>
                        {why && <div className="why">{why}</div>}
                        {/* at the ceiling: what more hours do, and what opens it — never a bare 1/2 (me/bottleneck.ts) */}
                        {!why && ceilingNote(game, a.key) && <div className="tiny muted" style={{ marginTop: 4 }}>{ceilingNote(game, a.key)}</div>}
                        {/* Who the 双排 goes to. The picker is live while the next evening is still
                            unspent; once one has been played the card says who it was with instead, because
                            a control that looks re-settable and only moves the *next* evening is a lie
                            (reported 2026-09-20). The 「−」 takes that evening back, picker and all. */}
                        {a.key === 'duo' && mates.length > 0 && (n === 0 || !canUndo(game, 'duo') ? (
                          <select value={me.duoWith ?? ''} onClick={(e) => e.stopPropagation()} onChange={(e) => { me.duoWith = e.target.value || undefined; commit() }}>
                            <option value="">谁都行（挑关系最远的）</option>
                            {mates.map((m) => <option key={m.id} value={m.id}>{m.ign}</option>)}
                          </select>
                        ) : (
                          <div className="tiny muted">和 {game.players[me.duoWith ?? '']?.ign ?? '队友'} 打的；要换人先按「−」退回去</div>
                        ))}
                        {n > 0 && (
                          <div className="c">
                            <b>这周做了 {n} 次</b>
                            {/* 「−」 takes this card's last session of the week off: the week is played
                                again from its start without it (engine/me/undo.ts). Asked for 2026-09-20:
                                「每个选项后面都可以加减，加了数值就会变化，减了就变回去」 */}
                            {canUndo(game, a.key) && (
                              <button
                                className="sm" aria-label={`${a.label} 退回一次`}
                                title={`退回一次${a.label}${(me.weekDone ?? []).lastIndexOf(a.key) < (me.weekDone ?? []).length - 1 ? `。${REPLAY_CN}` : ''}`}
                                onClick={(e) => { e.stopPropagation(); const why = undoAction(game, a.key); if (why) toast(why); commit() }}
                              >
                                −
                              </button>
                            )}
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
                      <div className="t">对位挑战{weightTag('duel')}<span className="tag">2 点</span></div>
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
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>行动点还是按周给：点一下当场就做，剩下的点哪天用都行，第七天结工资。</p>
            </>
          )}
          <div className="advance-me">
            {/* his own week again, in the order he clicked it (engine/me/week.ts repeatLastWeek) — asked for
                2026-09-20: 「玩家反映推荐的加点他们不喜欢，有时候就想重复自己上回合的加点方式」 */}
            <button
              onClick={() => { toast(repeatLastWeek(game)); commit() }}
              disabled={!(me.lastWeekDone ?? []).length || me.ap === 0}
              title={(me.lastWeekDone ?? []).length ? '照上一周做过的再做一遍，做不下的会告诉你' : '上一周没有可以照搬的'}
            >
              重复上一周
            </button>
            {/* one press, the whole rest of the week, through the same clicks a player makes — and one line for what it did */}
            <button onClick={() => { const line = autoPlan(game); toast(line); commit() }} disabled={me.ap === 0} title="把这周剩下的行动点按推荐一次做完">按推荐做完</button>
            {/* the whole week off in one press: the same machinery as a card's 「−」, run to the bottom */}
            {undoDepth(game) > 1 && (
              <button
                className="ghost" title="把这周做过的都退回去，回到这周刚开始的样子"
                onClick={() => { const off = undoWeek(game); toast(off.length ? `这周的 ${off.length} 次都退回去了。` : '没有可以退的。'); commit() }}
              >
                全部撤回 · {undoDepth(game)} 次
              </button>
            )}
            {/* one way forward on the button; the longer runs share one control (asked 2026-09-11: four advance buttons read as clutter) */}
            {/* here, at the end of the week's panel, on a phone too: 破晓 keeps its 进入下一周 in the row under the actions, not pinned over the tab bar */}
            {(() => {
              const go = advanceOf(game)
              return <button className="primary" onClick={onAdvance} title={go.title}>{go.label}</button>
            })()}
            {(() => {
              // a decision already waiting: no run starts, and the control says what is waiting (engine/me/auto.ts runBlocked)
              const wait = runBlocked(game)
              return (
                <select
                  className="advance-far"
                  value=""
                  aria-label="快进"
                  disabled={!!wait}
                  title={wait ? `先处理：${stopLine(game, wait)}` : '按推荐一路推进，路上的小事替你处理；合同、邀请这类要你拿主意的事会停下来'}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === 'month' || v === 'match' || v === 'stage' || v === 'season') onAdvanceUntil(v)
                  }}
                >
                  <option value="">{wait ? '先处理等着的事' : '快进到…'}</option>
                  {quiet && !days && <option value="month">一个月后（四周）</option>}
                  <option value="match">下一场比赛</option>
                  <option value="stage">赛段末</option>
                  <option value="season">赛季末</option>
                </select>
              )
            })()}
            <span className="hint">
              {me.ap > 0 ? `还有 ${me.ap} 点没用，${days ? '这一周过完' : '推进后'}作废。` : ''}
              {quiet ? '接下来四周没有你的比赛，可以快进一个月。' : ''}
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
            <Panel
              title="下一场"
              className={starter ? 'own' : ''}
              actions={nextComp ? (
                <button className="sm ghost" title={`到「积分榜」看${nextComp.name}`} onClick={() => { focusEvent(nextComp.key); go('standings') }}>赛事详情 →</button>
              ) : undefined}
            >
              {up && (up.kind === 'fixture' || up.kind === 'round') && team ? (
                <>
                  <div className="score-line" style={{ padding: '4px 0 8px' }}>
                    <div className="t a"><Crest id={game.myTeam} size={28} /><span>{team.tag}</span></div>
                    <div className="s muted" style={{ fontSize: 18 }}>VS</div>
                    {opp
                      ? <div className="t"><Crest id={opp.id} size={28} /><span>{opp.tag}</span></div>
                      : <div className="t"><span className="muted">待定</span></div>}
                  </div>
                  {opp && <FaceRow ids={opp.starters.length ? opp.starters : opp.roster.slice(0, 5)} />}
                  <p className="small" style={{ margin: '0 0 6px' }}>
                    {up.kind === 'fixture'
                      ? `${game.comps[up.fixture.comp]?.name ?? up.fixture.comp} · ${up.fixture.label.replace(/^(KO|SW):\d+:/, '')} · BO${up.fixture.bo}`
                      : `${up.name} · ${up.round}${up.bo ? ` · BO${up.bo}` : ''}`}
                    {' · '}{up.day - game.day <= 0 ? '今天' : `${up.day - game.day} 天后`}
                  </p>
                  {/* a round already ours with no tie written yet: what the other side is still waiting on */}
                  {up.kind === 'round' && !opp && <p className="tiny faint" style={{ margin: '0 0 6px' }}>{WAIT_CN[up.wait]}</p>}
                  {opp && <p className="small" style={{ margin: 0 }}>纸面：<b>{paper}</b>{nums ? `（实力 ${team.rating} vs ${opp.rating}，约 ${Math.round(est * 100)}%）` : ''}</p>}
                  {/* whether I start is on the top bar; here only a benching, with its clock */}
                  {me.benchLock && me.benchLock > game.day ? (
                    <p className="small" style={{ margin: '6px 0 0', color: 'var(--loss)' }}>被换下，还有 {me.benchLock - game.day} 天</p>
                  ) : null}
                </>
              ) : up?.kind === 'waiting' ? (
                <p className="small" style={{ margin: 0 }}>
                  <b>{up.name}</b>：这一阶段还没打完，名次出来才知道有没有下一场。出线的话 {fmtDay(up.day, game.year)} 打{up.round}（{up.day - game.day} 天后）。
                </p>
              ) : (
                <>
                  {/* out of an event still being played: said first, then what is next */}
                  {up && (up.kind === 'event' || up.kind === 'none') && up.out && <p className="small" style={{ margin: '0 0 6px' }}>{up.out}：已经出局。</p>}
                  {up?.kind === 'event' ? (
                    <>
                      <p className="small" style={{ margin: 0 }}>
                        {up.stage ? '下一个赛段' : '下一项赛事'}：<b>{up.name}</b> · {fmtDay(up.day, game.year)} {up.stage ? '开始' : up.day > up.opens ? '打第一场' : '开打'}（{up.day - game.day} 天后）
                      </p>
                      {/* my club's first tie there comes after the event opens: said when it opens (engine/me/nextup.ts) */}
                      {!up.stage && <p className="tiny faint" style={{ margin: '4px 0 0' }}>{up.sure ? `${up.day > up.opens ? `赛事 ${fmtDay(up.opens, game.year)} 开打，` : ''}对阵开打前一天才排出来。` : '你们可以报名，名单开打前一天定。'}</p>}
                    </>
                  ) : (
                    // nothing named: why, in words, and what comes next — never a blank panel (engine/me/nextup.ts roadLines)
                    roadLines(game, road).map((l, i) => <p key={i} className="small" style={{ margin: i ? '4px 0 0' : 0 }}>{l}</p>)
                  )}
                </>
              )}
              {(() => {
                const others = soon.filter((f) => f.id !== next?.id)
                return others.length > 0 ? (
                  <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                    七天内还有：{others.map((f) => `${game.teams[f.teamA === game.myTeam ? f.teamB : f.teamA]?.tag}（${f.day - game.day} 天后）`).join('，')}
                  </p>
                ) : null
              })()}
              {/* the transfer window in one line, in the transfer screen's own words (engine/me/window.ts) */}
              <p className="tiny faint" style={{ margin: '8px 0 0' }}>{windowLine(game)}{signedThisPeriod(game) ? ` · ${inviteBlock(game)}` : ''}</p>
              {(() => {
                // a contact on its way, as the transfer page says it (engine/me/selfpitch.ts)
                const out = pitchBook(game).out
                return out ? <p className="tiny" style={{ margin: '4px 0 0' }}>已经接触了 <b>{game.teams[out.teamId]?.name ?? '俱乐部'}</b>，{dateCn(out.due, game.year)}前回复。</p> : null
              })()}
            </Panel>
            {cupRun}
            <Panel title="教练怎么看你">
              <p className="small" style={{ margin: '0 0 6px' }}>
                主教练 <b>{team?.coach?.name ?? '（未知）'}</b> · {trustLabel(me.coachTrust)}{nums ? `（${Math.round(me.coachTrust)}）` : ''}
              </p>
              <p className="small" style={{ margin: 0 }}>
                {/* the team screen's own sentence (engine/me/coach.ts standingLine), so the two never disagree */}
                {standingLine(game, 'week')}
              </p>
              {/* who calls, and what stands between me and the calls (engine/me/igl.ts) */}
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>{iglLine(game)}</p>
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
            {cupList}
          </>
        ) : (
          <>
            {cupRun}
            <Panel title="天梯" className="own">
              {/* as the client shows it (engine/me/rank.ts): division, RR with 数值, and from 神话 up the place on my
                  server's board — the board as it has climbed past me in the weeks I did not play (rankAt with no score) */}
              {/* the tier's badge beside it (2026-09-18, art/emblem.tsx): the words stay as they were */}
              <div className="ladder-now">
                <RankBadge tier={ladderNow.tier} div={ladderNow.div} size={44} />
                <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{nums ? rankFull(ladderNow) : rankText(ladderNow)}</p>
              </div>
              <p className="small" style={{ margin: '0 0 6px' }}>
                {climb} · 最高 {rankText(rankAt(game, me.pre.ladderPeak))}{nums ? `（实力对应 ${rankAt(game, aim).name}）` : ''}
              </p>
              {slid && (
                <p className="small" style={{ margin: '0 0 6px' }}>
                  {nums ? `停排的那些周，榜上的人比你多涨了约 ${Math.round(rise)} RR` : '停排的那些周，榜上的人还在涨分'}，名次按涨上去的榜单排，你的分数和 RR 没掉。
                  {aim > stand + 3 ? '接着打排位，RR 追过涨上去的榜单，名次才回来。' : ''}
                </p>
              )}
              <p className="tiny faint" style={{ margin: '0 0 4px' }}>
                {/* 辐能战魂 asks the 500 and the RR floor at once (me/rank.ts rankAt); without the 数值 switch the
                    floor used to go unsaid, and 「排进前 500 名才是辐能战魂」 read as the whole rule (reported 2026-09-19) */}
                神话起上{rankAt(game).server.name}排行榜，排进前 {RADIANT_SLOTS} 名、{nums ? `胜点过 ${rankAt(game).server.radiantRR} RR` : '胜点也够本服的门槛'}才是辐能战魂。不打排位分数不掉；神话起别人还在打，名次会往后掉。
                {/* 神话 was one rank from Episode 2 until patch 3.05 (me/rank.ts rulesAt); a player who knows today's
                    神话 1/2/3 asked why his had no number (2026-09-18) */}
                {!rulesAt(game.year, game.day).immortalDivs ? '这时候的神话还不分 1、2、3，2021 年 9 月 8 日起才分。' : ''}
                {me.region === 'China' && rankAt(game).server.key === 'AP' ? '国服 2023 年 7 月开服以前，都在亚服打。' : ''}
              </p>
              <p className="tiny faint" style={{ margin: 0 }}>
                {/* the lines rollInvites actually opens at (prepro.ts INVITE_*), said on my server; a call reads where I stand today */}
                打到{rankBar(game, INVITE_LADDER)}有俱乐部来看，打到{rankBar(game, INVITE_LADDER_T1)}一级俱乐部会看，看的是你现在的名次。
              </p>
            </Panel>
            {cupList}
            <Panel title="怎么被看见">
              <p className="tiny faint" style={{ margin: 0 }}>
                四条路：杯赛走得远、天梯打到{rankBar(game, INVITE_LADDER)}、粉丝过 {fansCn(INVITE_FANS)}，或者在「转会」页挑一家发自荐（每次 {PITCH_AP} 行动点，一个转会期最多 {PITCH_MAX} 次）。天梯看的是现在的名次，停排会被别人超过。
                {me.pre.year >= 3 ? ` 这是第 ${me.pre.year} 年。四年没签到合同，就该想想别的了。` : ''}
              </p>
              {(() => {
                // the 自荐 on its way, as the transfer page says it (engine/me/selfpitch.ts)
                const out = pitchBook(game).out
                return out ? <p className="tiny" style={{ margin: '4px 0 0' }}>已发给 <b>{game.teams[out.teamId]?.name ?? '俱乐部'}</b>，{dateCn(out.due, game.year)}前回复。</p> : null
              })()}
            </Panel>
          </>
        )}
        {cupOpen && <CupDetail cupKey={cupOpen} onClose={() => setCupOpen(null)} />}
      </div>
    </div>
  )
}
