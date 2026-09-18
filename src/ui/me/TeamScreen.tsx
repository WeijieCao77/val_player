import { useGame } from './ctx'
import { Condition, OvrBadge, Panel, Roles } from './common'
import { bondBetween, bondWord } from '../../engine/bonds'
import { callerOf, squadOf } from '../../engine/roster'
import { attrWord, trustLabel, useNumbers } from './words'
import { BOND_ROLE_TEXT, bondAll, bondMainRole } from '../../engine/me/bond'
import { duelTarget, roomCall, standingLine } from '../../engine/me/coach'
import { IGL_TRUST_LOST, SKID_OF, SKID_WINS, clubCaller, iglBlock, iglGates, myCall } from '../../engine/me/igl'
import { roomView } from '../../engine/me/room'
import { mateMark } from '../../engine/me/hurtplay'
import {
  canList, canSign, cloutBreakdown, cloutTier,
  doList, doSign, listOdds, signTargets,
} from '../../engine/me/clout'
import { worldMoney } from './common'
import { leagueCurOf } from '../../engine/me/currency'
import { useState } from 'react'
import Face from './Face'

// 很铁 / 不错 / 一般 …: the ladder is the engine's (engine/bonds.ts bondWord), because the room's own
// friction reads it — a pair this screen calls 很铁 does not argue over a defeat and is not who
// 队内矛盾 comes for

export default function TeamScreen() {
  const { game, openPlayer } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const team = game.teams[game.myTeam]
  const target = duelTarget(game)
  // who calls: the club's named caller, else its loudest flagged man; the others who carry the flag are deputies
  const caller = callerOf(game, game.myTeam)
  const rows = team.roster.map((id) => game.players[id]).filter(Boolean)
    .sort((a, b) => Number(team.starters.includes(b.id)) - Number(team.starters.includes(a.id)) || b.overall - a.overall)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
      <Panel title={team.name} flush>
        <div className="table-wrap">
        <table>
          <thead><tr><th className="sticky-name at-left">选手</th><th>位置</th><th>综合</th><th>年龄</th><th>状态</th><th>身份</th><th>和你</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const isMe = p.id === me.id
              const starter = team.starters.includes(p.id)
              const bond = isMe ? 0 : bondBetween(game, me.id, p.id)
              const main = caller?.id === p.id
              return (
                <tr key={p.id} className={isMe ? 'me' : 'clickable'} onClick={() => !isMe && openPlayer(p.id)}>
                  <td className="sticky-name at-left"><Face id={p.id} name={p.ign} size={22} /><b style={{ color: isMe ? 'var(--accent)' : undefined }}>{p.ign}</b>{p.isIgl ? <span className={`tag${main ? ' t1' : ''}`} style={{ marginLeft: 6 }} title={main ? '主指挥：比赛里全队按他的指挥来打' : '副指挥：主指挥不在场上时由他来喊'}>{main ? '主指挥' : '副指挥'}</span> : null}{p.fictional ? <span className="tag" style={{ marginLeft: 6 }} title="虚构选手，不对应真实的人">虚构新人</span> : null}</td>
                  <td><Roles p={p} /></td>
                  <td className="num"><OvrBadge value={p.overall} /></td>
                  <td className="num">{p.age}</td>
                  {/* out hurt: the lay-off in words, with no diagnosis of a real person's body (engine/me/hurtplay.ts) */}
                  <td style={{ minWidth: 72 }}>{mateMark(game, p.id) ? <span className="tag warn">{mateMark(game, p.id)}</span> : <Condition p={p} day={game.day} hideNumber />}</td>
                  <td>{starter ? <span className="tag win">首发</span> : <span className="tag">替补</span>}{target?.id === p.id ? <span className="tag warn" style={{ marginLeft: 4 }}>你的对位</span> : null}</td>
                  <td className="tiny">{isMe ? '—' : bondWord(bond)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </Panel>
      <div>
        <Panel title="教练组">
          <p className="small" style={{ margin: 0 }}>主教练 <b>{team.coach?.name ?? '（未知）'}</b> · 对你：<b>{trustLabel(me.coachTrust)}</b></p>
        </Panel>
        <IglPanel />
        <RoomPanel />
        {/* who you have played beside, and which of you was carrying */}
        {(() => {
          const all = bondAll(game)
          if (!all.length) return null
          const here = all.filter((e) => !e.gone)
          const gone = all.filter((e) => e.gone).slice(0, 6)
          const row = (e: ReturnType<typeof bondAll>[number]) => {
            const role = bondMainRole(e)
            const years = Math.max(1, e.lastYear - e.firstYear + 1)
            return (
              <div key={e.id} className={`bond-row${e.gone ? ' bond-gone' : ''}`}>
                <span><b>{e.ign}</b> <span className="muted">{e.role}</span>{e.gone && <span className="muted"> · {e.gone === 'retired' ? '已退役' : '已离队'}</span>}</span>
                <span className="muted">{years} 年{e.titles.length ? ` · ${e.titles.length} 冠` : ''}</span>
                {role ? <span className={`bond-tag ${role}`}>{BOND_ROLE_TEXT[role]}</span> : <span className="bond-tag">还看不出</span>}
              </div>
            )
          }
          return (
            <Panel title="共事">
              {here.map(row)}
              {gone.length > 0 && (
                <>
                  <p className="tiny muted" style={{ margin: '10px 0 2px' }}>走过的人</p>
                  {gone.map(row)}
                </>
              )}
            </Panel>
          )
        })()}
        <CloutPanel />
        <Panel title="首发之争">
          {/* the people I am actually racing: same slot, on this roster */}
          {(() => {
            const rivals = team.roster
              .map((id) => game.players[id])
              .filter((x) => x && x.id !== me.id && (x.roles ?? [x.role]).includes(p.role))
            return rivals.length ? (
              <div style={{ marginBottom: 8 }}>
                <p className="tiny muted" style={{ margin: '0 0 4px' }}>和你抢 {p.role} 位置的：</p>
                {rivals.map((r) => {
                  const rs = team.starters.includes(r.id)
                  return (
                    <p key={r.id} className="small" style={{ margin: '0 0 3px' }}>
                      <b>{r.ign}</b> · {rs ? '首发' : '替补'}
                      <span className="muted">{r.overall > p.overall ? ' · 综合压着你' : r.overall < p.overall ? ' · 你压着他' : ' · 综合持平'}</span>
                    </p>
                  )
                })}
              </div>
            ) : <p className="tiny muted" style={{ margin: '0 0 6px' }}>名单里没有第二个 {p.role}，这个位置暂时没人跟你抢。</p>
          })()}
          <p className="small" style={{ margin: '0 0 6px' }}>
            {/* the week screen's own sentence (engine/me/coach.ts standingLine), so the two never disagree */}
            {standingLine(game, 'team')}
          </p>
          <p className="tiny faint" style={{ margin: 0 }}>
            名单每周一重排；以首发打满 8 场、教练信任到「信任」以上，或者以首发拿下冠军，就是他认定的首发，输了比赛也不会被拿去试新阵容；连着三场全队最差会被换下两周（刚以首发拿下冠军的几场不算）；能力接近时，教练先用和队伍合得来的人。
          </p>
        </Panel>
      </div>
    </div>
  )
}

/**
 * 指挥: who calls, and what the coach waits for before he hands the calls to me
 * (engine/me/igl.ts). Every gate is on the screen, met or not — a locked door
 * says what the lock is.
 */
function IglPanel() {
  const { game } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const w = (v: number) => (nums ? ` ${v}` : attrWord(v))
  if (myCall(game)) {
    const since = me.igl?.since
    const runs = since ? me.matches.filter((m) => !m.friendly && m.started && (m.year > since.year || (m.year === since.year && m.day >= since.day))) : []
    return (
      <Panel title="指挥" actions={<span className="tag t1">主指挥</span>}>
        <p className="small" style={{ margin: '0 0 6px' }}>你是队里的主指挥：比赛里全队按你的指挥来打（指挥{w(p.attrs.igl)}）。复盘和每一张你喊过的图都会涨指挥；关键回合里看协同、沟通的选项也会加上它。</p>
        <p className="tiny muted" style={{ margin: 0 }}>
          {since ? `${since.year} 年接的指挥，之后首发 ${since.n ?? runs.length} 场，赢 ${since.w ?? runs.filter((m) => m.won).length} 场。` : ''}
          最近 {SKID_OF} 场只赢 {SKID_WINS} 场以下、教练的信任掉到{nums ? ` ${IGL_TRUST_LOST} 以下` : '「有保留」'}，或者你被换下场，他会把指挥收回去。
        </p>
      </Panel>
    )
  }
  const caller = clubCaller(game)
  const block = iglBlock(game)
  return (
    <Panel title="指挥">
      <p className="small" style={{ margin: '0 0 6px' }}>
        {caller
          ? <>队里的主指挥是 <b>{caller.ign}</b>（指挥{w(caller.attrs.igl)} · 沟通{w(caller.attrs.communication)}{caller.iglSource === 'inferred' ? ' · 临时顶上的' : ''}）。</>
          : '队里现在没人真正在喊。'}
      </p>
      <p className="tiny muted" style={{ margin: '0 0 4px' }}>这几条都满足，教练会让你来喊：</p>
      <div className="row wrap" style={{ gap: 6 }}>
        {iglGates(game).map((g) => (
          <span key={g.key} className={`tag${g.ok ? ' win' : ''}`}>
            {g.ok ? '✓' : '✗'} {g.label}
            {g.key === 'weeks' ? ` ${g.have}/${g.need} 周` : g.key !== 'starter' && nums ? ` ${g.have}/${g.need}` : ''}
          </span>
        ))}
      </div>
      {block && <p className="tiny faint" style={{ margin: '6px 0 0' }}>{block}。</p>}
    </Panel>
  )
}

/**
 * 化学反应: how the room takes me (engine/bonds.ts ease, engine/me/room.ts) — my
 * bond with the squad, what my 协同 and 沟通 do to it, and what it does to my
 * form and to a close call for a place. The figures ride the 数值 switch.
 */
function RoomPanel() {
  const { game } = useGame()
  const [nums] = useNumbers()
  const v = roomView(game)
  if (!v) return null
  const call = roomCall(game)
  const f1 = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`
  const vsMates = v.ease - v.mates
  // 你和队友 is one number over four of them, so it can read 很铁 while one pair is nowhere near it —
  // and that pair is the one a row comes from. Name him where the word for him is not the word above.
  const me = game.me!
  const cool = squadOf(game, game.myTeam)
    .filter((x) => x.id !== me.id)
    .map((x) => ({ x, v: bondBetween(game, me.id, x.id) }))
    .sort((a, b) => a.v - b.v)[0]
  const odd = cool && bondWord(cool.v) !== bondWord(v.mine)
  return (
    <Panel title="化学反应">
      <p className="small" style={{ margin: '0 0 6px' }}>
        你和队友：<b>{bondWord(v.mine)}</b>{nums ? `（${Math.round(v.mine)}）` : ''}
        {odd ? <span className="muted">（和 {cool.x.ign} 只算{bondWord(cool.v)}）</span> : null} · 全队之间：<b>{bondWord(v.squad)}</b>{nums ? `（${Math.round(v.squad)}）` : ''}
      </p>
      <p className="small" style={{ margin: '0 0 6px' }}>
        你的协同、沟通{vsMates >= 3 ? '比队里多数人高' : vsMates <= -3 ? '比队里多数人低' : '和队里差不多'}
        {v.ease >= 3 ? '：和队友的关系掉得慢，赢了比赛涨得多，输了不容易起争执。'
          : v.ease <= -3 ? '：和队友的关系掉得快，输了比赛伤得重，也容易起争执。'
            : '：和队友的关系照常涨落。'}
      </p>
      <p className="tiny muted" style={{ margin: 0 }}>
        状态{nums ? ` ${f1(v.form)}` : v.form >= 1 ? '因此更好' : v.form <= -1 ? '因此受影响' : '不受影响'}
        {' · '}教练选首发{nums ? ` ${f1(v.edge)}` : v.edge >= 0.4 ? '会加分' : v.edge <= -0.4 ? '会减分' : '不加不减'}（只在能力接近时起作用）
      </p>
      {call && <p className="tiny" style={{ margin: '6px 0 0' }}>{call}</p>}
    </Panel>
  )
}

/**
 * 威望, and the two things it lets you ask for.
 *
 * Both gates print the threshold and where you actually stand, because a
 * greyed-out button that does not say why is just a hidden button. Neither
 * action is a market: one is a sentence to the coach, the other a sentence to
 * the manager, and both can blow up in the room.
 */
function CloutPanel() {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const [open, setOpen] = useState<'' | 'list' | 'sign'>('')
  const { total } = cloutBreakdown(game)
  const tier = cloutTier(total)
  const listGate = canList(game)
  const signGate = canSign(game)
  const team = game.teams[game.myTeam]
  const mates = team.roster.map((id) => game.players[id]).filter((x) => x && x.id !== me.id)
  const targets = signGate.ok ? signTargets(game) : []

  const act = (line: string) => { toast(line); setOpen(''); commit() }

  return (
    <Panel title="话语权" actions={<span className={`tag${total >= 62 ? ' t1' : ''}`}>{tier.name}</span>}>
      <p className="small" style={{ marginTop: 0 }}>{tier.blurb}</p>

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="sm" disabled={!listGate.ok} onClick={() => setOpen(open === 'list' ? '' : 'list')}>提出换人</button>
        <button className="sm" disabled={!signGate.ok} onClick={() => setOpen(open === 'sign' ? '' : 'sign')}>要求签人</button>
      </div>
      {!listGate.ok && <p className="tiny muted" style={{ margin: '6px 0 0' }}>提出换人：{listGate.why}</p>}
      {!signGate.ok && <p className="tiny muted" style={{ margin: '4px 0 0' }}>要求签人：{signGate.why}</p>}

      {open === 'list' && (
        <div className="clout-list">
          <p className="tiny muted" style={{ margin: '8px 0 4px' }}>
            跟教练组说队里该换人了。<b>说成了，他被放走，全队都知道是你提的；说不成，消息一样会走漏。</b>
          </p>
          {mates.map((t) => {
            const odds = listOdds(game, t)
            return (
              <div key={t.id} className="clout-row">
                <span><b>{t.ign}</b> <span className="muted">{t.role} · {t.age} 岁 · 综合 {t.overall}</span></span>
                <button className="sm" onClick={() => act(doList(game, t.id))}>提（{odds >= 0.6 ? '有把握' : odds >= 0.35 ? '看运气' : '希望不大'}）</button>
              </div>
            )
          })}
        </div>
      )}

      {open === 'sign' && (
        <div className="clout-list">
          <p className="tiny muted" style={{ margin: '8px 0 4px' }}>
            你能开口要的人就这几个——档次跟着你的威望和经理对你的信任走。<b>谈崩了，经理对你的信任会掉一截。</b>
          </p>
          {targets.length ? targets.map((t) => (
            <div key={t.id} className="clout-row">
              <span><b>{t.ign}</b> <span className="muted">{t.role} · 综合 {t.overall} · {t.teamName}{t.away ? ` · ${t.away}` : ''} · 身价 {worldMoney(t.fee, leagueCurOf(team.region), game.year)}</span></span>
              <button className="sm" onClick={() => act(doSign(game, t.id))}>要</button>
            </div>
          )) : <p className="small muted" style={{ margin: 0 }}>现在没有你够得着、又比队里现有的人强的目标。</p>}
        </div>
      )}

    </Panel>
  )
}
