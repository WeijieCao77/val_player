import { useGame } from '../ctx'
import { Crest, Panel, money } from '../common'
import { inWindow, listSelf, nextWindow, perfWord, proPerf } from '../../engine/me/transfer'
import { clubBars, expectOf, ladderTier, reachableClubs, tryoutSkill, CLUB_TIER_CN, INVITE_FANS, INVITE_LADDER } from '../../engine/me/prepro'
import { ROLE_CN } from '../../engine/me/contract'
import { fansCn } from '../../engine/me/fans'
import { attrWord, gapWord, useNumbers } from './words'

export default function TransferScreen() {
  const { game, commit, toast } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  const skill = tryoutSkill(game)
  const clubs = Object.values(game.teams)
    .filter((t) => t.id !== game.myTeam && (t.region === me.region || me.flags.lang))
    .sort((a, b) => expectOf(a) - expectOf(b))
  const reach = new Set(reachableClubs(game).map((t) => t.id))
  const perf = pro ? proPerf(game) : 0
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        {pro && team && (
          <Panel title="合同">
            <p className="small" style={{ margin: 0 }}>
              <b>{team.name}</b> · {ROLE_CN[p.contract?.promisedRole ?? 'rotation']} · 年薪 <b>{money(p.salary)}</b>
              <br />到 <b>{game.year + Math.max(0, p.contractYears - 1)} 赛季末</b> · <span title={`合同没到期时别的俱乐部要带走你，得付给 ${team.tag} 这个数。`}>违约金 {money(me.flags.buyout ?? 0)}</span>
            </p>
          </Panel>
        )}
        {pro && (
          <Panel title="市场怎么看你" actions={nums ? <span className="tag">{perf.toFixed(1)}</span> : undefined}>
            <p className="small" style={{ marginTop: 0 }}><b>{perfWord(perf)}</b>。</p>
            <p className="tiny faint">评价够高，赛段结束时会有别队来看你的比赛；转会窗开了就来报价。</p>
            {me.intents.length > 0 && <p className="small">记下你名字的：{me.intents.map((i) => game.teams[i.teamId]?.tag).join('、')}</p>}
            <p className="small">
              {inWindow(game) ? <b>转会窗开着。</b> : <>转会窗关着，下一次：<b>{nextWindow(game).label}</b>（约 {nextWindow(game).weeks} 周后）。</>}
            </p>
            <button className="sm" disabled={!inWindow(game) || me.listedYear === game.year} onClick={() => { toast(listSelf(game)); commit() }}>主动挂牌（经理会不高兴）</button>
          </Panel>
        )}
        {me.deals.length > 0 && (
          <Panel title="桌上的报价">
            {me.deals.map((d) => (
              <p key={d.id} className="small">{game.teams[d.teamId]?.name} · {ROLE_CN[d.role]} · {money(d.salary)} × {d.years} 年 · 到 {d.expires - game.day} 天后</p>
            ))}
          </Panel>
        )}
        {!pro && (
          <Panel title="邀请">
            {me.pre.invites.length === 0 ? <p className="muted small" style={{ margin: 0 }}>还没有俱乐部来电话。杯赛走得远、天梯进{ladderTier(INVITE_LADDER).name}、粉丝过 {fansCn(INVITE_FANS)}，都会有人注意到你。</p>
              : me.pre.invites.map((i) => <p key={i.id} className="small">{game.teams[i.teamId]?.name} · {i.expires - game.day} 天内答复</p>)}
            {me.declined.length > 0 && <p className="tiny faint">今年回绝过：{me.declined.map((id) => game.teams[id]?.tag).join('、')}</p>}
          </Panel>
        )}
      </div>
      <div>
        {/* the whole ladder on one card: what each rung asks and how far short
            you are. A locked door has to say what the lock is — grinding
            without seeing the target is what made the pre-pro stretch drag. */}
        <Panel title="你离下一级还差多少" actions={<span className="tag t1">{nums ? Math.round(skill) : attrWord(skill)}</span>}>
          <div className="bars">
            {clubBars(game).map((b) => (
              <div key={b.key} className={`bar-row${b.ok ? ' ok' : ''}`}>
                <span className="n"><b>{b.name}</b> <span className="muted">最低一扇门：{b.example}</span></span>
                <span className="mono">{nums ? b.expect : attrWord(b.expect)}</span>
                <span className={`mono ${b.ok ? 'good' : b.gap <= 6 ? 'warn' : 'bad'}`}>
                  {b.ok ? '够了' : nums ? `差 ${b.gap}` : gapWord(b.gap)}
                </span>
              </div>
            ))}
          </div>
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>差一点也能去试训。</p>
        </Panel>
      <Panel title="门槛 · 各档俱乐部要什么水平" flush>
        <p className="tiny faint" style={{ padding: '8px 12px 0' }}>绿色是够得着的。</p>
        <div className="table-wrap">
        <table>
          <thead><tr><th>俱乐部</th><th>档</th>{nums && <><th>实力</th><th>要求</th></>}<th>差</th></tr></thead>
          <tbody>
            {clubs.map((t) => {
              const e = expectOf(t)
              const d = skill - e
              return (
                <tr key={t.id} style={{ opacity: reach.has(t.id) ? 1 : 0.55 }}>
                  <td><span className="club"><Crest id={t.id} size={18} />{t.tag}</span></td>
                  <td className="tiny">{CLUB_TIER_CN(t)}{t.region !== me.region ? ' · 外赛区' : ''}</td>
                  {nums && <><td className="num">{t.rating}</td><td className="num">{Math.round(e)}</td></>}
                  <td className="num" style={{ color: d >= 0 ? 'var(--win)' : d >= -6 ? 'var(--warn)' : 'var(--loss)' }}>{nums ? `${d >= 0 ? '+' : ''}${Math.round(d)}` : gapWord(-d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </Panel>
      </div>
    </div>
  )
}
