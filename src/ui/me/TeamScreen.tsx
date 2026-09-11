import { useGame } from '../ctx'
import { Condition, OvrBadge, Panel, Roles } from '../common'
import { bondBetween } from '../../engine/bonds'
import { trustLabel } from '../../engine/trust'
import { BOND_ROLE_TEXT, bondAll, bondMainRole } from '../../engine/me/bond'
import { duelTarget, EDGE_NEED } from '../../engine/me/coach'
import {
  LIST_GATE, SIGN_GATE, attrAvg, canList, canSign, cloutBreakdown, cloutTier,
  doList, doSign, listOdds, signTargets,
} from '../../engine/me/clout'
import { moneyFull } from '../common'
import { useState } from 'react'
import Face from './Face'

const bondWord = (v: number) => v >= 45 ? '很铁' : v >= 20 ? '不错' : v >= 0 ? '一般' : v >= -30 ? '有点疏远' : '闹掰了'

export default function TeamScreen() {
  const { game, openPlayer } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const team = game.teams[game.myTeam]
  const target = duelTarget(game)
  const rows = team.roster.map((id) => game.players[id]).filter(Boolean)
    .sort((a, b) => Number(team.starters.includes(b.id)) - Number(team.starters.includes(a.id)) || b.overall - a.overall)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
      <Panel title={`${team.name} · 名单 ${rows.length} 人`} flush>
        <table>
          <thead><tr><th>选手</th><th>位置</th><th>综合</th><th>年龄</th><th>状态</th><th>身份</th><th>和你</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const isMe = p.id === me.id
              const starter = team.starters.includes(p.id)
              const bond = isMe ? 0 : bondBetween(game, me.id, p.id)
              return (
                <tr key={p.id} className={isMe ? 'me' : 'clickable'} onClick={() => !isMe && openPlayer(p.id)}>
                  <td><Face id={p.id} name={p.ign} size={22} /><b style={{ color: isMe ? 'var(--accent)' : undefined }}>{p.ign}</b>{p.isIgl ? <span className="tag" style={{ marginLeft: 6 }}>IGL</span> : null}</td>
                  <td><Roles p={p} /></td>
                  <td className="num"><OvrBadge value={p.overall} /></td>
                  <td className="num">{p.age}</td>
                  <td><Condition p={p} day={game.day} /></td>
                  <td>{starter ? <span className="tag win">首发</span> : <span className="tag">替补</span>}{target?.id === p.id ? <span className="tag warn" style={{ marginLeft: 4 }}>你的对位</span> : null}</td>
                  <td className="tiny">{isMe ? '—' : `${bondWord(bond)}（${Math.round(bond)}）`}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
      <div>
        <Panel title="教练组">
          <p className="small" style={{ margin: '0 0 6px' }}>主教练 <b>{team.coach?.name ?? '（未知）'}</b></p>
          <p className="tiny faint" style={{ margin: '0 0 8px' }}>
            战术 {team.coach?.tactics ?? '—'} · 培养 {team.coach?.development ?? '—'} · 激励 {team.coach?.motivation ?? '—'} · 设施 {team.facilities}
          </p>
          <p className="small" style={{ margin: 0 }}>他对你的信任：<b>{Math.round(me.coachTrust)}</b>（{trustLabel(me.coachTrust)}）</p>
        </Panel>
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
                <span className="muted">{years} 年 · {e.matches} 场{e.titles.length ? ` · ${e.titles.length} 冠` : ''}</span>
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
              <p className="tiny faint" style={{ margin: '8px 0 0' }}>
                「带人」是你比他强、他比你年轻；「被带飞」是他比你强、也比你年轻。一个赛段至少打三场才算数。
              </p>
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
                      <b>{r.ign}</b> {r.age} 岁 · 综合 <b>{r.overall}</b>（你 {p.overall}）· 状态 {Math.round(r.form)}（你 {Math.round(p.form)}）· {rs ? '首发' : '替补'}
                      <span className="muted">{r.overall > p.overall ? ' · 综合压着你' : r.overall < p.overall ? ' · 你压着他' : ' · 综合持平'}</span>
                    </p>
                  )
                })}
              </div>
            ) : <p className="tiny muted" style={{ margin: '0 0 6px' }}>名单里没有第二个 {p.role}，这个位置暂时没人跟你抢。</p>
          })()}
          <p className="small" style={{ margin: '0 0 6px' }}>
            {team.starters.includes(me.id)
              ? (me.trial ? `试用期，还剩 ${me.trial.left} 场。赢下比赛或打出队内前二就算过。` : me.proven ? '你是教练认定的首发。' : '本周你在名单里——是因为数值压过了别人，教练还没把你当自己人。')
              : `资本 ${me.edge.toFixed(1)}/${EDGE_NEED}。对位挑战赢一次 +1（三局全胜 +1.5），输一次 −0.5，攒够了教练给试用期。`}
          </p>
          <p className="tiny faint" style={{ margin: 0 }}>
            教练每周重排名单：看综合、这周的状态和疲劳、他对你的信任；同位置的人在他眼里压过你，你就下去。连着三场全队最差会被直接换下两周。新人的数据要打折，直到他亲眼看过足够多的回合。
          </p>
        </Panel>
      </div>
    </div>
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
  const { total, parts } = cloutBreakdown(game)
  const tier = cloutTier(total)
  const listGate = canList(game)
  const signGate = canSign(game)
  const team = game.teams[game.myTeam]
  const mates = team.roster.map((id) => game.players[id]).filter((x) => x && x.id !== me.id)
  const targets = signGate.ok ? signTargets(game) : []

  const act = (line: string) => { toast(line); setOpen(''); commit() }

  return (
    <Panel title="话语权" actions={<span className={`tag${total >= 62 ? ' t1' : ''}`}>{tier.name} {total}</span>}>
      <p className="small" style={{ marginTop: 0 }}>{tier.blurb}</p>
      <div className="clout-parts">
        {parts.map((x) => (
          <span key={x.label}>{x.label} <b className={x.value < 0 ? 'bad' : ''}>{x.value > 0 ? '+' : ''}{x.value}</b></span>
        ))}
      </div>
      <p className="tiny faint" style={{ margin: '6px 0 10px' }}>
        威望是算出来的，不是攒出来的——冠军、人气、你比队友强多少、生涯胜率、教练组和经理怎么看你。下面两件事只查它，不花它。
      </p>

      <div className="row" style={{ gap: 8 }}>
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
          {mates.map((t) => (
            <div key={t.id} className="clout-row">
              <span><b>{t.ign}</b> <span className="muted">{t.role} · {t.age} 岁 · 综合 {t.overall} · 八项均值 {attrAvg(t).toFixed(0)}</span></span>
              <button className="sm" onClick={() => act(doList(game, t.id))}>提（成功率 {Math.round(listOdds(game, t) * 100)}%）</button>
            </div>
          ))}
        </div>
      )}

      {open === 'sign' && (
        <div className="clout-list">
          <p className="tiny muted" style={{ margin: '8px 0 4px' }}>
            你能开口要的人就这几个——档次跟着你的威望和经理对你的信任走。<b>谈崩了，经理会觉得你不懂行情。</b>
          </p>
          {targets.length ? targets.map((t) => (
            <div key={t.id} className="clout-row">
              <span><b>{t.ign}</b> <span className="muted">{t.role} · 综合 {t.overall} · {t.teamName}{t.abroad ? ' · 外赛区' : ''} · 身价 {moneyFull(t.fee)}</span></span>
              <button className="sm" onClick={() => act(doSign(game, t.id))}>要</button>
            </div>
          )) : <p className="small muted" style={{ margin: 0 }}>现在没有你够得着、又比队里现有的人强的目标。</p>}
        </div>
      )}

      <p className="tiny faint" style={{ margin: '10px 0 0' }}>
        提出换人要威望 {LIST_GATE.clout} 且教练信任 {LIST_GATE.coach}（或威望 {LIST_GATE.vetClout} 用功勋压过教练组）；
        要求签人要威望 {SIGN_GATE.clout}、经理信任 {SIGN_GATE.gm}，而且转会窗得开着。两件事各有几个赛段的冷却。
      </p>
    </Panel>
  )
}
