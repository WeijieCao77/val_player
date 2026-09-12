import { useGame } from './ctx'
import { Panel, money, moneyFull } from './common'
import { KIND_CN, LEDGER_IN, LEDGER_OUT, ledgerSum, prizeRows } from '../../engine/me/money'
import { prizeNote } from '../../engine/me/prizes'
import { compCn } from '../../engine/me/compname'
import type { MeState } from '../../engine/me/types'
import type { GameState } from '../../engine/types'
import { AGENTS, COURSES, GEAR_PRICE, GEAR_SLOTS, GEAR_TIER_CN, LIFESTYLE, RELAX, buyCourse, buyGear, buyLifestyle, buyRelax, gearModel, hireAgent, lifeFlag, lifestyleLocked } from '../../engine/me/shop'
import { STREAM_TIERS, streamCut } from '../../engine/me/stream'
import { fanCap, fansCn, fanTier } from '../../engine/me/fans'
import OutletPanels from './OutletPanels'

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
            {me.phase === 'pro' ? `年薪 ${moneyFull(p.salary)}` : '没有薪水'}{me.upkeep ? ` · 每周固定支出 $${me.upkeep}` : ''}
          </p>
          <LedgerTable me={me} />
        </Panel>
        <Panel title="赛事奖金">
          {me.phase === 'pro' && (p.contract?.bonusShare ?? 0) > 0 ? (
            <PrizeList game={game} />
          ) : (
            <p className="small" style={{ margin: 0 }}>还没有职业合同，赛事奖金分成也就无从谈起。业余赛事的奖金是全额归你的。</p>
          )}
        </Panel>
        <Panel title="粉丝与直播">
          <p className="small" style={{ marginTop: 0 }}>
            粉丝 <b>{fansCn(me.fans)}</b>（{fanTier(me.fans).name}）· 天花板约 {fansCn(cap)}
          </p>
          <p className="tiny faint">天花板看天梯、杯赛、首发和冠军。</p>
          <p className="small">礼物分成 <b>{Math.round(streamCut(me.fans) * 100)}%</b></p>
          <p className="small" style={{ margin: 0 }}>
            {me.stream.deal ? `独家：${me.stream.deal.platform} · 本赛段 ${me.stream.thisStage}/${me.stream.deal.minPerStage} 次 · 到 ${me.stream.deal.untilYear} 年`
              : `没有独家。播满 3 次、粉丝过 ${fansCn(STREAM_TIERS.B.minFans)}，平台会来谈。`}
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
              <div key={s.key} className="shop-row">
                <span className="nm">{s.name}</span>
                <span className="tag">{GEAR_TIER_CN[t]}</span><span className="small md">{gearModel(s.key, t)}</span>
                {t < 2 && <button className="sm" onClick={() => act(buyGear(game, s.key))}>换成 {gearModel(s.key, t + 1)} {money(GEAR_PRICE[t + 1])}</button>}
              </div>
            )
          })}
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
        <Panel title="家人与生活">
          {LIFESTYLE.map((x) => {
            const why = lifestyleLocked(game, x)
            return (
              <div key={x.key} className="row" style={{ gap: 10, padding: '4px 0' }}>
                <span style={{ minWidth: 72 }}>{x.name}</span>
                <span className="tiny muted" style={{ flex: 1 }}>{x.blurb}{why && !me.flags[lifeFlag(x.key)] ? `（${why}）` : ''}</span>
                {me.flags[lifeFlag(x.key)] ? <span className="tag win">已办</span> : <button className="sm" disabled={!!why} onClick={() => act(buyLifestyle(game, x.key))}>{money(x.price)}</button>}
              </div>
            )
          })}
          <p className="tiny faint" style={{ margin: '6px 0 0' }}>不改变任何能力和比赛。办过的事，退役时写进你的结局。</p>
        </Panel>
        <OutletPanels />
      </div>
    </div>
  )
}

/** Four columns on a phone: thousands as $47K, a smaller prize to the dollar. */
const prizeAmount = (x: number): string => (x >= 10_000 ? money(x) : moneyFull(x))

/**
 * What the events in front of me pay me, read off each event's own table
 * (engine/me/prizes.ts). An estimate for an event that never published its
 * amounts says it is one, and what it is drawn from; an event with neither
 * says so instead of showing a number — next to the event's name, where a
 * phone shows it, not at the far end of a table it would have to scroll; one
 * from 2027 on says whose amounts it is using.
 */
function PrizeList({ game }: { game: GameState }) {
  const me = game.me!
  const p = game.players[me.id]
  const team = game.teams[p.teamId ?? '']
  const rows = prizeRows(game)
  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>
        分成 <b>{p.contract!.bonusShare}%</b> · {team?.roster.length ?? 0} 人分 · 下面是你个人到手
      </p>
      {rows.length ? (
        <div className="table-wrap">
          <table className="small">
            <thead><tr><th>赛事</th><th className="num">冠军</th><th className="num">亚军</th><th className="num">季军</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const note = [r.now ? '进行中' : '', prizeNote(r.table)].filter(Boolean).join(' · ')
                return (
                  <tr key={r.key}>
                    {/* cells keep to one line; the note under the name wraps, so a phone does not scroll sideways for it */}
                    <td>{compCn(r.name)}{note && <div className="tiny faint" style={{ whiteSpace: 'normal' }}>{note}</div>}</td>
                    {r.table.status === 'paid' || r.table.status === 'est'
                      ? r.mine.map((x, i) => <td key={i} className="num">{x ? prizeAmount(x) : '—'}</td>)
                      : <td colSpan={3} className="muted">{r.table.status === 'none' ? '无奖金' : '奖金未公开'}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>眼下没有你的队伍够得着的赛事。</p>
      )}
      <p className="tiny faint" style={{ margin: '6px 0 0' }}>金额取自各赛事 Liquipedia 奖金表，本地货币按页面给出的美元计；标「估算」的没公布过奖金，按同类真实赛事推算。</p>
    </>
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
          上赛段净 {prevNet >= 0 ? '+' : '−'}{moneyFull(Math.abs(prevNet))}
        </p>
      )}
    </>
  )
}
