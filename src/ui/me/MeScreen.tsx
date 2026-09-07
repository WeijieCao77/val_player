import { useGame } from '../ctx'
import { Bar, Panel, Stat, fmtDay, money } from '../common'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import { statLine } from '../../engine/player'

export default function MeScreen() {
  const { game } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const team = game.teams[game.myTeam]
  const s = statLine(p.season)
  const c = statLine(p.career)
  const recent = me.matches.slice(-10).reverse()

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        <Panel title={`${p.ign} · ${p.role} · ${p.age} 岁`} actions={<span className="tag t1">综合 {p.overall} / 上限 {p.potential}</span>}>
          {ATTR_KEYS.map((k) => (
            <div key={k} className="attr-row">
              <span className="k">{ATTR_CN[k]}</span>
              <Bar value={p.attrs[k]} />
              <span className="v">{p.attrs[k]}</span>
              <span className="xp">进度 {Math.round(p.xp[k] ?? 0)}%</span>
            </div>
          ))}
          <div className="attr-row" style={{ marginTop: 8 }}>
            <span className="k">心态</span><Bar value={me.mental} color="var(--accent)" /><span className="v">{Math.round(me.mental)}</span><span className="xp">大场面的成功率</span>
          </div>
          <div className="attr-row">
            <span className="k">体质</span><Bar value={me.body} color="var(--accent)" /><span className="v">{Math.round(me.body)}</span><span className="xp">休息回多少</span>
          </div>
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>
            能力是练出来的水位，慢涨慢掉；状态是最近打成什么样。八项按位置加权成综合——{p.role}最看重的是
            {p.role === '决斗者' ? '枪法、反应、残局' : p.role === '先锋' ? '意识、道具、枪法' : p.role === '控场' ? '道具、意识、协同' : '意识、枪法、残局'}。
          </p>
        </Panel>
        <Panel title="现在">
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat k="状态" v={Math.round(p.form)} />
            <Stat k="疲劳" v={Math.round(p.fatigue)} />
            <Stat k="士气" v={Math.round(p.morale)} />
            <Stat k="心态气压" v={Math.round(me.tilt)} />
            <Stat k="教练信任" v={Math.round(me.coachTrust)} />
            <Stat k="粉丝" v={Math.round(me.fans)} />
            <Stat k="热度" v={Math.round(me.heat)} />
            <Stat k="存款" v={money(me.money)} />
          </div>
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>
            心态气压超过 55 开始拖累发挥；休息、赢球都能泄压。疲劳超过 45 训练收益打折，超过 70 伤病风险明显上升。
          </p>
        </Panel>
        <Panel title="合同">
          <p className="small" style={{ margin: 0 }}>
            {team.name} · 年薪 <b>{money(p.salary)}</b> · 还剩 <b>{p.contractYears}</b> 年 · 承诺位置：{p.contract?.promisedRole === 'starter' ? '首发' : p.contract?.promisedRole === 'star' ? '核心' : '轮换'}
            {p.expiredYear != null ? ' · 已到期，冬窗自动续' : ''}
          </p>
        </Panel>
      </div>
      <div>
        <Panel title="本赛季数据" actions={<span className="tiny faint">{p.season.maps} 张图</span>}>
          <div className="row wrap" style={{ gap: 18 }}>
            <Stat k="ACS" v={s.acs.toFixed(0)} />
            <Stat k="K/D" v={s.kd.toFixed(2)} />
            <Stat k="ADR" v={s.adr.toFixed(0)} />
            <Stat k="KPR" v={s.kpr.toFixed(2)} />
            <Stat k="首杀差" v={s.fkDiff} />
            <Stat k="残局" v={p.season.clutches} />
            <Stat k="MVP" v={p.season.mvps} />
          </div>
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>
            生涯：{p.career.maps} 张图 · ACS {c.acs.toFixed(0)} · K/D {c.kd.toFixed(2)} · MVP {p.career.mvps}
          </p>
        </Panel>
        <Panel title="最近的比赛" flush>
          {recent.length === 0 ? <p className="muted" style={{ padding: 12, margin: 0 }}>还没打过正赛。</p> : (
            <table>
              <thead><tr><th>日期</th><th>对手</th><th>比分</th><th>K/D/A</th><th>ACS</th><th>评分</th><th></th></tr></thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.fixtureId}>
                    <td className="muted">{fmtDay(m.day, m.year)}</td>
                    <td>{m.oppTag}</td>
                    <td className="num" style={{ color: m.won ? 'var(--win)' : 'var(--loss)' }}>{m.score}</td>
                    <td className="num">{m.started ? `${m.kills}/${m.deaths}/${m.assists}` : '替补'}</td>
                    <td className="num">{m.started ? m.acs : '—'}</td>
                    <td className="num" style={{ color: m.rating >= 1.1 ? 'var(--win)' : m.rating > 0 && m.rating < 0.85 ? 'var(--loss)' : undefined }}>{m.started ? m.rating.toFixed(2) : '—'}</td>
                    <td className="tiny faint">{m.mvp ? 'MVP' : m.carried ? '院长局' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        {me.seasons.length > 0 && (
          <Panel title="生涯" flush>
            <table>
              <thead><tr><th>年</th><th>队伍</th><th>出场</th><th>首发胜</th><th>ACS</th><th>综合</th><th>荣誉</th></tr></thead>
              <tbody>
                {me.seasons.map((s) => (
                  <tr key={s.year}>
                    <td>{s.year}</td><td>{s.team}</td>
                    <td className="num">{s.starts}/{s.matches}</td><td className="num">{s.wins}</td>
                    <td className="num">{s.acs || '—'}</td><td className="num">{s.overallFrom}→{s.overallTo}</td>
                    <td className="tiny">{s.titles.join('、') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </div>
    </div>
  )
}
