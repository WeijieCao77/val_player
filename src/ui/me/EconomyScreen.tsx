import { useGame } from '../ctx'
import { Panel, money, moneyFull } from '../common'
import { KIND_CN, LEDGER_IN, LEDGER_OUT, ledgerSum, prizePreview, prizeRows } from '../../engine/me/money'
import type { MeState } from '../../engine/me/types'
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
        <Panel title="账本" actions={<span className="tag t1">{moneyFull(me.money)}</span>}>
          <p className="small" style={{ marginTop: 0 }}>
            {me.phase === 'pro' ? `年薪 ${moneyFull(p.salary)}，每周发 ${moneyFull(p.salary / 52)}——下面这张表是它去了哪里` : '没有薪水'}
            {me.upkeep ? ` · 每周固定支出 $${me.upkeep}` : ''} · 一场直播约 {money(streamIncome(game))}
          </p>
          <LedgerTable me={me} />
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>钱只从这一个口进出，每一笔都记在这里。钱不会变成能力：外设和课程买的是训练速度、心态和门路，到第二档为止。</p>
        </Panel>
        <Panel title="奖金标准" actions={<span className="tiny muted">按名次发，每次都发</span>}>
          {me.phase === 'pro' && (p.contract?.bonusShare ?? 0) > 0 ? (
            <>
              <p className="small" style={{ marginTop: 0 }}>
                合同里的奖金分成是 <b>{p.contract!.bonusShare}%</b>，全队按人头分。下面是<b>你</b>能拿到的数，不是赛事总奖金。
              </p>
              <table className="small">
                <thead><tr><th>赛事</th><th className="num">冠军</th><th className="num">亚军</th><th className="num">四强</th></tr></thead>
                <tbody>
                  {prizeRows(game.year).map((r) => {
                    const v = prizePreview(game, r.stage)
                    if (!v.some((x) => x > 0)) return null
                    return (
                      <tr key={r.stage}>
                        <td>{r.name}</td>
                        {v.map((x, i) => <td key={i} className="num">{x ? moneyFull(x) : '—'}</td>)}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="tiny faint" style={{ margin: '6px 0 0' }}>不是一次性的成就奖励——每年、每项赛事、走到哪一档就发哪一档，钱在赛事结束当周到账。</p>
            </>
          ) : (
            <p className="small" style={{ margin: 0 }}>还没有职业合同，赛事奖金分成也就无从谈起。业余赛事的奖金是全额归你的。</p>
          )}
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

/**
 * Where the money went this stage. Every row here was written by addMoney();
 * nothing can reach the balance without appearing on it.
 */
function LedgerTable({ me }: { me: MeState }) {
  const led = me.ledger
  const cur = led?.cur ?? { in: {}, out: {} }
  const inSum = ledgerSum(cur.in), outSum = ledgerSum(cur.out)
  const net = inSum - outSum
  const prevNet = led?.prev ? ledgerSum(led.prev.in) - ledgerSum(led.prev.out) : null
  const rows: [string, number, boolean][] = [
    ...LEDGER_IN.filter(([k]) => cur.in[k]).map(([k]) => [KIND_CN[k], cur.in[k]!, false] as [string, number, boolean]),
    ...LEDGER_OUT.filter(([k]) => cur.out[k]).map(([k]) => [KIND_CN[k], cur.out[k]!, true] as [string, number, boolean]),
  ]
  if (!rows.length) return <p className="small muted" style={{ margin: 0 }}>本赛段还没有进出账。</p>
  return (
    <>
      <div className="ledger">
        {rows.map(([name, v, out]) => (
          <div key={name} className="ledger-r">
            <span>{name}</span>
            <span className={`mono ${out ? 'bad' : 'good'}`}>{out ? '−' : '+'}{moneyFull(v)}</span>
          </div>
        ))}
        <div className="ledger-r net">
          <span>本赛段净{led?.label ? ` · ${led.label}` : ''}</span>
          <span className={`mono ${net >= 0 ? 'good' : 'bad'}`}>{net >= 0 ? '+' : '−'}{moneyFull(Math.abs(net))}</span>
        </div>
      </div>
      {prevNet !== null && (
        <p className="tiny muted" style={{ margin: '6px 0 0' }}>
          上赛段（{led!.prevLabel || '—'}）净 {prevNet >= 0 ? '+' : '−'}{moneyFull(Math.abs(prevNet))}。
          生涯累计进 {moneyFull(led!.lifetimeIn)}、出 {moneyFull(led!.lifetimeOut)}。
        </p>
      )}
    </>
  )
}
