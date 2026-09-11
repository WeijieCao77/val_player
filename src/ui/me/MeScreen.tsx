import { useGame } from '../ctx'
import { Bar, Panel, Stat, fmtDay, money } from '../common'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import { statLine } from '../../engine/player'
import { AXIS_CN, TRAIT_NEED, traitOf } from '../../engine/me/traits'
import { fansCn, fanTier } from '../../engine/me/fans'
import { originOf } from '../../engine/me/origins'
import { cupOf, cupView } from '../../engine/me/cups'

export default function MeScreen() {
  const { game } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const team = me.phase === 'pro' ? game.teams[game.myTeam] : null
  const s = statLine(p.season)
  const c = statLine(p.career)
  const recent = me.matches.slice(-10).reverse()
  const origin = originOf(me.originKey)

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        <Panel title={`${p.ign} · ${p.role} · ${p.age} 岁 · ${origin.name}`} actions={<span className="tag t1">综合 {p.overall} / 上限 {p.potential}</span>}>
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
            {team && <Stat k="教练信任" v={Math.round(me.coachTrust)} />}
            <Stat k="粉丝" v={fansCn(me.fans)} small />
            <Stat k="热度" v={Math.round(me.heat)} />
            <Stat k="存款" v={money(me.money)} small />
          </div>
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>
            咖位：{fanTier(me.fans).name}。心态气压超过 55 开始拖累发挥；休息、赢下比赛都能泄压。疲劳超过 45 训练收益打折，超过 70 伤病风险明显上升。
          </p>
        </Panel>
        <Panel title="性格">
          <div className="row wrap" style={{ gap: 14 }}>
            {(Object.keys(AXIS_CN) as (keyof typeof AXIS_CN)[]).map((a) => (
              <Stat key={a} k={AXIS_CN[a]} v={`${me.axes[a] ?? 0}/${TRAIT_NEED}`} small />
            ))}
          </div>
          {me.traits.length ? me.traits.map((k) => {
            const t = traitOf(k)
            return t ? <p key={k} className="small" style={{ margin: '8px 0 0' }}><b>{t.name}</b> · {t.gain}；{t.cost}</p> : null
          }) : <p className="tiny faint" style={{ margin: '8px 0 0' }}>事件里的选择会累积在四条轴上，同一条轴选够五次就成了永久特质。互为反面的两组只能有一个。</p>}
        </Panel>
        {team && (
          <Panel title="合同">
            <p className="small" style={{ margin: 0 }}>
              {team.name} · 年薪 <b>{money(p.salary)}</b> · 还剩 <b>{p.contractYears}</b> 年 · 承诺：{p.contract?.promisedRole === 'star' ? '核心' : p.contract?.promisedRole === 'starter' ? '首发' : '轮换'} · 违约金 {money(me.flags.buyout ?? 0)}
            </p>
          </Panel>
        )}
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
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>生涯：{p.career.maps} 张图 · ACS {c.acs.toFixed(0)} · K/D {c.kd.toFixed(2)} · MVP {p.career.mvps} · 冠军 {me.titles.length}</p>
        </Panel>
        <Panel title="最近的比赛" flush>
          {recent.length === 0 ? <p className="muted" style={{ padding: 12, margin: 0 }}>还没打过比赛。</p> : (
            // a long event name wraps and a narrow screen scrolls: the table never spills out of its panel
            <div className="me-recent-wrap">
              <table className="me-recent">
                <thead><tr><th>日期</th><th>赛事</th><th>对手</th><th>比分</th><th>K/D/A</th><th>ACS</th><th>评分</th><th></th></tr></thead>
                <tbody>
                  {recent.map((m) => (
                    <tr key={m.fixtureId}>
                      <td className="muted">{fmtDay(m.day, m.year)}</td>
                      <td className="tiny comp">{m.comp.replace(/VCT |VALORANT /, '')}</td>
                      <td>{m.oppTag}</td>
                      <td className="num" style={{ color: m.won ? 'var(--win)' : 'var(--loss)' }}>{m.score}</td>
                      <td className="num">{m.started ? `${m.kills}/${m.deaths}/${m.assists}` : '替补'}</td>
                      <td className="num">{m.started ? m.acs : '—'}</td>
                      <td className="num" style={{ color: m.rating >= 1.1 ? 'var(--win)' : m.rating > 0 && m.rating < 0.85 ? 'var(--loss)' : undefined }}>{m.started ? m.rating.toFixed(2) : '—'}</td>
                      <td className="badge">
                        {m.mvp ? <span className="tag win">MVP</span>
                          : m.carried ? <span className="tag" title="输了这场，但你是全队评分最高的">全队最高</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        {me.pre.cups.length > 0 && (
          <Panel title="杯赛" flush>
            <table><tbody>
              {me.pre.cups.slice().reverse().map((cu, i) => (
                <tr key={i}><td>{cu.year}</td><td>{cupOf(cu.key) && cupView(cupOf(cu.key)!, cu.year).name}</td><td className="num">{cu.won ? '冠军' : `${cu.reached}/${cu.rounds}`}</td><td className="num">{cu.prize ? money(cu.prize) : ''}</td></tr>
              ))}
            </tbody></table>
          </Panel>
        )}
        {me.seasons.length > 0 && (
          <Panel title="生涯" flush>
            <table>
              <thead><tr><th>年</th><th>队伍</th><th>出场</th><th>首发胜</th><th>ACS</th><th>综合</th><th>荣誉</th></tr></thead>
              <tbody>
                {me.seasons.map((x) => (
                  <tr key={x.year}>
                    <td>{x.year}</td><td>{x.team}{x.tier === 2 ? ' (CHAL)' : ''}</td>
                    <td className="num">{x.tier ? `${x.starts}/${x.matches}` : '—'}</td><td className="num">{x.tier ? x.wins : '—'}</td>
                    <td className="num">{x.acs || '—'}</td><td className="num">{x.overallFrom}→{x.overallTo}</td>
                    <td className="tiny">{x.titles.join('、') || '—'}</td>
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
