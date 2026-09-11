import { useGame } from '../ctx'
import { Bar, Panel, Stat, fmtDay, money } from '../common'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import { statLine } from '../../engine/player'
import { AXIS_CN, TRAIT_NEED, traitOf } from '../../engine/me/traits'
import { fansCn, fanTier } from '../../engine/me/fans'
import { originOf } from '../../engine/me/origins'
import { cupOf, cupView } from '../../engine/me/cups'
import { CAP_EXP_MAX, CAP_HARD, SEASON_LOOSENS, breakInfo, ceilingsOf } from '../../engine/me/bottleneck'
import { TIER_LADDER, attrRank, attrWord, bodyWord, mentalWord, useNumbers } from './words'

/**
 * One attribute's bar: the fill is the value, the upright tick is its ceiling
 * (me/bottleneck.ts), and the hairline under it is the way to the next point.
 */
function AttrTrack({ value, cap, next }: { value: number; cap: number; next: number }) {
  const pct = Math.max(0, Math.min(100, value))
  const color = pct >= 75 ? 'var(--win)' : pct >= 45 ? 'var(--warn)' : 'var(--loss)'
  return (
    <div className="attr-track">
      <div className="bar">
        <i style={{ width: `${pct}%`, background: color }} />
        <span className="capline" style={{ left: `${Math.min(100, cap)}%` }} aria-hidden="true" />
      </div>
      <div className="attr-next"><i style={{ width: `${Math.max(0, Math.min(100, next))}%` }} /></div>
    </div>
  )
}

export default function MeScreen() {
  const { game } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const team = me.phase === 'pro' ? game.teams[game.myTeam] : null
  const s = statLine(p.season)
  const c = statLine(p.career)
  const recent = me.matches.slice(-10).reverse()
  const origin = originOf(me.originKey)
  const caps = ceilingsOf(p)
  const pinned = ATTR_KEYS.filter((k) => p.attrs[k] >= caps[k])

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        <Panel
          title={`${p.ign} · ${p.role} · ${p.age} 岁 · ${origin.name}`}
          actions={(
            <span className="tag t1" title="上限是八项瓶颈按你的位置合起来的综合：破开任何一项，上限跟着涨。">
              {nums ? `综合 ${p.overall} / 上限 ${p.potential}` : `综合 ${attrWord(p.overall)} · 上限 ${attrWord(p.potential)}`}
            </span>
          )}
        >
          {ATTR_KEYS.map((k) => {
            const v = p.attrs[k]
            const cap = caps[k]
            const next = Math.min(100, Math.round(p.xp[k] ?? 0))
            const atCap = v >= cap
            const near = !atCap && cap - v <= 2
            // 进度 on its own said nothing: say what it is progress toward, and
            // at the ceiling say that instead
            const note = atCap ? (cap >= CAP_HARD ? '到头了' : '卡在瓶颈')
              : nums ? `到 ${v + 1} · ${next}%`
                : near ? '快到瓶颈'
                  : attrRank(cap) > attrRank(v) ? `够得着${attrWord(cap)}` : '还在长'
            const tip = atCap
              ? (cap >= CAP_HARD ? '99 是所有人的终点。' : '练到瓶颈就上不去了：再练只会把下面那道细线攒满，等瓶颈松开的那一刻涨 1 点。怎么破写在下面。')
              : nums
                ? `练到 ${v + 1} 的进度：训练、训练赛、复盘和一些事件都往里攒，攒满 100% 就涨 1 点。瓶颈在 ${cap}，还能再涨 ${cap - v} 点。`
                : '条下面的细线是练到下一点的进度：训练、训练赛、复盘和一些事件都往里攒，攒满就涨一点。竖线是瓶颈。'
            return (
              <div key={k} className={`attr-row${atCap ? ' capped' : near ? ' near' : ''}`}>
                <span className="k">{ATTR_CN[k]}</span>
                <AttrTrack value={v} cap={cap} next={next} />
                <span className="v">{nums ? <>{v}<em>/{cap}</em></> : attrWord(v)}</span>
                <span className="xp" title={tip}>{note}</span>
              </div>
            )
          })}
          {pinned.length > 0 && (
            <div className="breaks">
              <div className="bh">卡在瓶颈的几项 · 怎么破</div>
              {pinned.map((k) => {
                const b = breakInfo(game, k)
                return (
                  <div key={k} className={`brk${b.dead ? ' dead' : ''}`}>
                    <span className="bd">{ATTR_CN[k]}</span>
                    <span className="bw">{b.dead ?? b.how}{b.locked ? '（签下一支队以后才能开始）' : ''}</span>
                    <span className="bp">{b.dead ? (caps[k] >= CAP_HARD ? '到头' : '靠里程碑') : b.prog}</span>
                  </div>
                )
              })}
              <p className="bn">
                照着做就一定破得开，不看运气。冠军这样的时刻另算，会把残局和沟通的瓶颈顶得更开；每打完一个职业赛季，{SEASON_LOOSENS.map((x) => ATTR_CN[x]).join('、')}也会各松 1 点（最多 {CAP_EXP_MAX} 次）。
              </p>
            </div>
          )}
          <div className="attr-row" style={{ marginTop: 8 }}>
            <span className="k">心态</span><Bar value={me.mental} color="var(--accent)" /><span className="v">{nums ? Math.round(me.mental) : mentalWord(me.mental)}</span><span className="xp">大场面里拿主意的成功率</span>
          </div>
          <div className="attr-row">
            <span className="k">体质</span><Bar value={me.body} color="var(--accent)" /><span className="v">{nums ? Math.round(me.body) : bodyWord(me.body)}</span><span className="xp">休息能回多少体力</span>
          </div>
          <p className="tiny faint" style={{ margin: '10px 0 0' }}>
            能力是练出来的水位，慢涨慢掉；状态是最近打成什么样。八项按位置加权成综合——{p.role}最看重的是
            {p.role === '决斗者' ? '枪法、反应、残局' : p.role === '先锋' ? '意识、道具、枪法' : p.role === '控场' ? '道具、意识、协同' : '意识、枪法、残局'}。
            竖线是这一项的瓶颈：练到那里就不涨了，要先把它破开；条下面的细线是练到下一点的进度，攒满涨 1 点。
            {!nums && ` 文字从低到高：${TIER_LADDER}（职业级 ≈ Challengers 首发，一流起够得上 VCT 联赛首发）。想看具体数字，点右下角的「数值」。`}
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
            咖位：{fanTier(me.fans).name}。心态气压超过 55 开始拖累发挥；休息、赢球都能泄压。疲劳超过 45 训练收益打折，超过 70 伤病风险明显上升。
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
            <table>
              <thead><tr><th>日期</th><th>赛事</th><th>对手</th><th>比分</th><th>K/D/A</th><th>ACS</th><th>评分</th></tr></thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.fixtureId}>
                    <td className="muted">{fmtDay(m.day, m.year)}</td>
                    <td className="tiny">{m.comp.replace(/VCT |VALORANT /, '')}</td>
                    <td>{m.oppTag}</td>
                    <td className="num" style={{ color: m.won ? 'var(--win)' : 'var(--loss)' }}>{m.score}</td>
                    <td className="num">{m.started ? `${m.kills}/${m.deaths}/${m.assists}` : '替补'}</td>
                    <td className="num">{m.started ? m.acs : '—'}</td>
                    <td className="num" style={{ color: m.rating >= 1.1 ? 'var(--win)' : m.rating > 0 && m.rating < 0.85 ? 'var(--loss)' : undefined }}>{m.started ? m.rating.toFixed(2) : '—'}{m.mvp ? ' MVP' : m.carried ? ' 院长' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
