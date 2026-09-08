import { useGame } from '../ctx'
import { Condition, OvrBadge, Panel, Roles } from '../common'
import { bondBetween } from '../../engine/bonds'
import { trustLabel } from '../../engine/trust'
import { duelTarget, EDGE_NEED } from '../../engine/me/coach'

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
                  <td><b style={{ color: isMe ? 'var(--accent)' : undefined }}>{p.ign}</b>{p.isIgl ? <span className="tag" style={{ marginLeft: 6 }}>IGL</span> : null}</td>
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
              ? (me.trial ? `试用期，还剩 ${me.trial.left} 场。赢球或打出队内前二就算过。` : me.proven ? '你是教练认定的首发。' : '本周你在名单里——是因为数值压过了别人，教练还没把你当自己人。')
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
