import { useGame } from '../ctx'
import { Crest, Panel, money } from '../common'
import { inWindow, listSelf, perfWord, proPerf, PLAYER_WINDOWS } from '../../engine/me/transfer'
import { expectOf, reachableClubs, tryoutSkill, CLUB_TIER_CN } from '../../engine/me/prepro'
import { ROLE_CN } from '../../engine/me/contract'

export default function TransferScreen() {
  const { game, commit, toast } = useGame()
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
              {team.name} · {ROLE_CN[p.contract?.promisedRole ?? 'rotation']} · 年薪 <b>{money(p.salary)}</b> · 还剩 <b>{p.contractYears}</b> 年 · 违约金 {money(me.flags.buyout ?? 0)} · 在队 {me.tenure} 季
            </p>
          </Panel>
        )}
        {pro && (
          <Panel title="市场怎么看你" actions={<span className="tag">{perf.toFixed(1)}</span>}>
            <p className="small" style={{ marginTop: 0 }}><b>{perfWord(perf)}</b>。</p>
            <p className="tiny faint">这个数字由：综合与联赛水平的差 ×1.2、队伍胜率、你的场均评分、院长局、冠军、状态、粉丝、坐过的板凳、训练赛，减去违约金的拖累。赛段结束时够高，看台上就会出现别队的教练；转会窗开了他们来报价。</p>
            {me.intents.length > 0 && <p className="small">记下你名字的：{me.intents.map((i) => game.teams[i.teamId]?.tag).join('、')}</p>}
            <p className="small">转会窗：{PLAYER_WINDOWS.map(([a, b]) => `第 ${a}–${b} 天`).join('，')}。{inWindow(game) ? '现在开着。' : '现在关着。'}</p>
            <button className="sm" disabled={!inWindow(game) || me.listedYear === game.year} onClick={() => { toast(listSelf(game)); commit() }}>主动挂牌（经理信任 −8）</button>
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
            {me.pre.invites.length === 0 ? <p className="muted small" style={{ margin: 0 }}>还没有俱乐部来电话。杯赛走得远、天梯前 100、粉丝过 150，都会有人注意到你。</p>
              : me.pre.invites.map((i) => <p key={i.id} className="small">{game.teams[i.teamId]?.name} · {i.expires - game.day} 天内答复</p>)}
            {me.declined.length > 0 && <p className="tiny faint">今年回绝过：{me.declined.map((id) => game.teams[id]?.tag).join('、')}</p>}
          </Panel>
        )}
      </div>
      <Panel title="门槛 · 各档俱乐部要什么水平" flush>
        <p className="tiny faint" style={{ padding: '8px 12px 0' }}>你现在 <b>{Math.round(skill)}</b>（综合 {p.overall} + 战术素养 {Math.round(me.pre.tac)} × 0.15 + 天梯 {Math.round(me.pre.ladder)} × 0.05）。绿色是够得着的。</p>
        <table>
          <thead><tr><th>俱乐部</th><th>档</th><th>实力</th><th>要求</th><th>差</th></tr></thead>
          <tbody>
            {clubs.map((t) => {
              const e = expectOf(t)
              const d = skill - e
              return (
                <tr key={t.id} style={{ opacity: reach.has(t.id) ? 1 : 0.55 }}>
                  <td className="row" style={{ gap: 6 }}><Crest id={t.id} size={18} />{t.tag}</td>
                  <td className="tiny">{CLUB_TIER_CN(t)}{t.region !== me.region ? ' · 外赛区' : ''}</td>
                  <td className="num">{t.rating}</td>
                  <td className="num">{Math.round(e)}</td>
                  <td className="num" style={{ color: d >= 0 ? 'var(--win)' : d >= -6 ? 'var(--warn)' : 'var(--loss)' }}>{d >= 0 ? '+' : ''}{Math.round(d)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
