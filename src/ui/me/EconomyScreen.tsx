import { useGame } from '../ctx'
import { Panel, money } from '../common'
import { AGENTS, COURSES, GEAR_PRICE, GEAR_SLOTS, GEAR_TIER_CN, RELAX, buyCourse, buyGear, buyRelax, hireAgent } from '../../engine/me/shop'
import { STREAM_CUTS, streamCut, streamIncome } from '../../engine/me/stream'
import { fanCap, fansCn, fanTier } from '../../engine/me/fans'

export default function EconomyScreen() {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const act = (why: string | null) => { if (why) toast(why); commit() }
  const cap = fanCap(game)
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        <Panel title="账本" actions={<span className="tag t1">{money(me.money)}</span>}>
          <p className="small" style={{ marginTop: 0 }}>
            {me.phase === 'pro' ? `年薪 ${money(p.salary)}，税与开销 30%${me.agentTier ? `、经纪人 ${Math.round((AGENTS[me.agentTier]?.cut ?? 0) * 100)}%` : ''}，每周到手 ${money(p.salary / 52 * (1 - (AGENTS[me.agentTier]?.cut ?? 0) - 0.3))}` : '没有薪水'}
            {me.upkeep ? ` · 每周寄家 $${me.upkeep}` : ''} · 一场直播约 {money(streamIncome(game))}
          </p>
          <p className="tiny faint" style={{ margin: 0 }}>钱不会变成能力：外设和课程买的是训练速度、心态和门路，到第二档为止。</p>
        </Panel>
        <Panel title="粉丝与直播">
          <p className="small" style={{ marginTop: 0 }}>
            粉丝 <b>{fansCn(me.fans)}</b>（{fanTier(me.fans).name}）· 热度 <b>{Math.round(me.heat)}</b> · 天花板约 {fansCn(cap)}
          </p>
          <p className="tiny faint">热度每周掉一成，粉丝朝天花板收敛；天花板由天梯、杯赛、首发场次、冠军决定——不是你玩了多久。</p>
          <p className="small">礼物分成 <b>{Math.round(streamCut(me.fans) * 100)}%</b>（{STREAM_CUTS.map((c) => `${c.at}→${Math.round(c.cut * 100)}%`).join(' · ')}）</p>
          <p className="small" style={{ margin: 0 }}>
            {me.stream.deal ? `独家：${me.stream.deal.platform}，每场保底 ${money(me.stream.deal.guarantee)}${me.stream.deal.clubCut ? `，俱乐部抽 ${Math.round(me.stream.deal.clubCut * 100)}%` : ''}，每赛段至少 ${me.stream.deal.minPerStage} 次（本赛段 ${me.stream.thisStage}），到 ${me.stream.deal.untilYear} 年`
              : `没有独家。播满 3 次、粉丝过 95，平台会来谈。累计播了 ${me.stream.total} 次。`}
          </p>
        </Panel>
        <Panel title="经纪人">
          <div className="row wrap" style={{ gap: 6 }}>
            {AGENTS.map((a) => (
              <button key={a.tier} className={`sm${me.agentTier === a.tier ? ' primary' : ''}`} onClick={() => act(hireAgent(game, a.tier))} title={a.blurb}>
                {a.name}{a.fee ? ` ${money(a.fee)}` : ''}{a.cut ? ` · 抽 ${Math.round(a.cut * 100)}%` : ''}
              </button>
            ))}
          </div>
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>{AGENTS[me.agentTier].blurb}</p>
        </Panel>
      </div>
      <div>
        <Panel title="外设">
          {GEAR_SLOTS.map((s) => {
            const t = me.gear[s.key] ?? 0
            return (
              <div key={s.key} className="row" style={{ gap: 10, padding: '4px 0' }}>
                <span style={{ minWidth: 56 }}>{s.name}</span>
                <span className="tag">{GEAR_TIER_CN[t]}</span>
                <span className="spacer" style={{ flex: 1 }} />
                {t < 2 && <button className="sm" onClick={() => act(buyGear(game, s.key))}>升到{GEAR_TIER_CN[t + 1]} {money(GEAR_PRICE[t + 1])}</button>}
              </div>
            )
          })}
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>每档：训练收益 +0.8%，临场决策成功率 +0.4%。</p>
        </Panel>
        <Panel title="课程">
          {COURSES.map((c) => (
            <div key={c.key} className="row" style={{ gap: 10, padding: '4px 0' }}>
              <span style={{ minWidth: 72 }}>{c.name}</span>
              <span className="tiny muted" style={{ flex: 1 }}>{c.blurb}</span>
              {me.courses.includes(c.key) ? <span className="tag win">已上</span> : <button className="sm" onClick={() => act(buyCourse(game, c.key))}>{money(c.price)}</button>}
            </div>
          ))}
        </Panel>
        <Panel title="放松与住处">
          {RELAX.map((r) => (
            <div key={r.key} className="row" style={{ gap: 10, padding: '4px 0' }}>
              <span style={{ minWidth: 72 }}>{r.name}</span>
              <span className="tiny muted" style={{ flex: 1 }}>{r.blurb}</span>
              {r.once && me.flags[`relax_${r.key}`] ? <span className="tag win">已有</span> : <button className="sm" onClick={() => act(buyRelax(game, r.key))}>{money(r.price)}</button>}
            </div>
          ))}
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>不占行动点；理疗和旅行每周最多两次。</p>
        </Panel>
      </div>
    </div>
  )
}
