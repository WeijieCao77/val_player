import { useState } from 'react'
import { useGame } from '../ctx'
import { Crest, Modal, money } from '../common'
import type { PendingItem } from '../../engine/me/types'
import { cupOf, cupView, enterCup, skipCup, mountCupMatch, afterCupMatch, TEMP_MINE, TEMP_OPP, cupRng } from '../../engine/me/cups'
import { MeMatch } from '../../engine/me/matchplay'
import { declineInvite, startTryout, tryoutChoose, tryoutDays, tryoutFatiguePenalty } from '../../engine/me/tryout'
import { expectOf, tryoutSkill, CLUB_TIER_CN } from '../../engine/me/prepro'
import { doorsOf, formatOf } from '../../engine/era'
import { hasPlace } from '../../engine/timeline'
import { REGION_CN } from '../../engine/types'
import { ASKS, askDeal, acceptDeal, declineDeal, ROLE_CN } from '../../engine/me/contract'
import { Rng, hashStr } from '../../engine/rng'
import { answerStreamOffer } from '../../engine/me/stream'
import { describeEffect, eventOf, resolveEvent } from '../../engine/me/events'
import { AXIS_CN, traitOf } from '../../engine/me/traits'
import { pop } from '../../engine/me/pending'
import { retire } from '../../engine/me/endings'
import { DIM_CN } from '../../engine/me/nodes'
import { fansCn } from '../../engine/me/fans'
import MatchPlay from './MatchPlay'
import Poster from './Poster'
import ShareCard from './ShareCard'
import CeremonyModal from './Ceremony'

/** Whatever the clock stopped on, as a card in front of everything. */
export default function PendingModal({ item, onDone }: { item: PendingItem; onDone: () => void }) {
  switch (item.kind) {
    case 'cup': return <CupModal cupKey={item.id!} onDone={onDone} />
    case 'invite': return <InviteModal inviteId={item.id!} onDone={onDone} />
    case 'tryout': return <TryoutModal onDone={onDone} />
    case 'deal': return <DealModal dealId={item.id!} onDone={onDone} />
    case 'stream': return <StreamModal onDone={onDone} />
    case 'event': return <EventModal eventId={item.id!} onDone={onDone} />
    case 'trait': return <TraitModal traitKey={item.id!} onDone={onDone} />
    case 'season': return <SeasonModal year={item.id!} onDone={onDone} />
    case 'released': return <ReleasedModal onDone={onDone} />
    case 'ending': return <EndingModal onDone={onDone} />
    case 'ceremony': return <CeremonyModal onDone={onDone} />
  }
  return null
}

// ------------------------------------------------------------------ cup
function CupModal({ cupKey, onDone }: { cupKey: string; onDone: () => void }) {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const cup = cupView(cupOf(cupKey)!, game.year)
  const [live, setLive] = useState<MeMatch | null>(null)
  const run = me.pre.cup
  if (live) {
    return <MatchPlay mm={live} onDone={() => {
      const rec = live.record!
      const done = afterCupMatch(game, rec.won, rec.score, cupRng(game, 'x'))
      setLive(null)
      commit()
      if (done) onDone()
    }} />
  }
  if (run && run.key === cupKey) {
    const r = cup.rounds[run.round]
    return (
      <Modal title={`${cup.name} · ${r.label}`} onClose={() => {}} onBgClose={() => {}}>
        <p className="small muted" style={{ marginTop: 0 }}>你的车队：{run.mates.map((m) => `${m.ign}（${m.role} ${m.overall}）`).join('、')}，还有你。</p>
        {run.results.length > 0 && <p className="small">{run.results.join(' · ')}</p>}
        <p className="small">第 {run.round + 1} 轮，BO{r.bo}。对手一轮比一轮强。</p>
        <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
          <button className="primary" onClick={() => {
            const m = mountCupMatch(game, cup, run.round, cupRng(game, `r${run.round}`))
            setLive(new MeMatch(game, { aId: TEMP_MINE, bId: TEMP_OPP, bo: m.bo, comp: cup.name, label: m.label }))
          }}>打这一轮</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title={cup.name} onClose={() => { skipCup(game, cupKey); commit(); onDone() }} onBgClose={() => {}}>
      <p className="small" style={{ marginTop: 0 }}>{cup.blurb}</p>
      <p className="small muted">
        {cup.rounds.length} 轮 · 对手实力 {cup.band[0]}–{cup.band[1]} · 报名费 {cup.fee ? `$${cup.fee}` : '免费'} · 奖金最高 ${cup.prize[cup.prize.length - 1].toLocaleString()}
        {cup.minFans ? ` · 邀请制（粉丝 ≥ ${cup.minFans}）` : ''}
      </p>
      <p className="small muted">走得越远，越可能有俱乐部的人记下你的名字。你会抽到四个路人队友。</p>
      <div className="row" style={{ gap: 10, justifyContent: 'center' }}>
        <button className="primary" onClick={() => {
          const why = enterCup(game, cupKey, cupRng(game, 'enter'))
          if (why) toast(why)
          commit()
        }} disabled={me.money < cup.fee || me.fans < cup.minFans}>报名</button>
        <button onClick={() => { skipCup(game, cupKey); commit(); onDone() }}>不打</button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ invite
function InviteModal({ inviteId, onDone }: { inviteId: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const me = game.me!
  const inv = me.pre.invites.find((i) => i.id === inviteId)
  if (!inv) { pop(game, 'invite', inviteId); onDone(); return null }
  const team = game.teams[inv.teamId]
  const skill = tryoutSkill(game)
  const expect = expectOf(team)
  const via = { cup: '看了你的杯赛', rank: '在天梯上注意到你', fans: '看了你的直播', scout: '教练组推荐', free: '知道你在找队' }[inv.via]
  return (
    <Modal title={inv.direct ? `${team.name} 的报价` : `${team.name} 的试训邀请`} onClose={() => {}} onBgClose={() => {}}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Crest id={team.id} size={40} />
        <div>
          <b>{team.name}</b> <span className="tag">{REGION_CN[team.region]} · {formatOf(game.year) === 'open' ? (team.tier === 1 ? '一线' : '二线') : team.tier === 1 ? 'VCT' : 'Challengers'} · {CLUB_TIER_CN(team)}</span>
          <div className="tiny muted">实力 {team.rating} · 名单 {team.roster.length} 人 · 他们{via}</div>
        </div>
      </div>
      <p className="small" style={{ margin: '12px 0 4px' }}>
        他们要的水平：<b>{Math.round(expect)}</b>。你现在：<b>{Math.round(skill)}</b>（综合 {game.players[me.id].overall} + 战术素养 + 天梯）。
        {skill >= expect + 8 ? ' 绰绰有余。' : skill >= expect ? ' 够格。' : skill >= expect - 6 ? ' 差一点，四天试训里能补回来。' : ' 差得不少。'}
      </p>
      {/* the most important line on an offer: which game you are signing up for */}
      <p className="small" style={{ margin: '4px 0' }}>接了之后头顶的门：<b>{doorsOf(team.region, game.year)}</b></p>
      {/* from 2023 the leagues are closed: say which one this club is in, or that it is in none */}
      {formatOf(game.year) === 'partnered' && (
        <p className="small" style={{ margin: '4px 0' }}>
          今年打的联赛：<b>{team.league ?? (team.tier === 1 ? 'VCT' : 'Challengers')}</b>
          {!hasPlace(game, team) && <span className="warn">（这家俱乐部今年没有联赛席位，签过去可能无赛可打）</span>}
        </p>
      )}
      <p className="tiny faint">{inv.direct ? '他们看够了，免试训直接谈合同。' : '四天：枪法测试、训练赛、复盘会、经理面谈。每天一个选择，成败对称。'} {inv.expires - game.day} 天内答复；回绝的话今年他们不会再来。</p>
      <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 10 }}>
        <button className="primary" onClick={() => { startTryout(game, inv.id); commit(); onDone() }}>{inv.direct ? '看合同' : '去试训'}</button>
        <button onClick={() => { declineInvite(game, inv.id); commit(); onDone() }}>回绝</button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ tryout
function TryoutModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const me = game.me!
  const t = me.tryout
  const [last, setLast] = useState<string | null>(null)
  if (!t) { onDone(); return null }
  const team = game.teams[t.teamId]
  const days = tryoutDays(game)
  const day = days[t.step]
  const p = game.players[me.id]
  const pen = tryoutFatiguePenalty(game, t.step)
  return (
    <Modal title={`${team.name} 试训 · ${day.name}`} onClose={() => {}} onBgClose={() => {}}>
      <p className="small muted" style={{ marginTop: 0 }}>{day.desc}</p>
      {days.length < 4 && t.step === 0 && (
        <p className="tiny" style={{ color: 'var(--win)', margin: '0 0 6px' }}>
          打过职业的人不用再考单排——你的比赛数据顶掉了第一天。
        </p>
      )}
      {last && <div className="node-line">{last}</div>}
      <p className="small">目前的评估分：<b>{t.score > 0 ? '+' : ''}{t.score.toFixed(1)}</b>{pen > 0 ? `（第 ${t.step + 1} 天，体质拖累 −${pen.toFixed(1)}）` : ''}</p>
      <div className="node-opt">
        {day.opts.map((o, i) => {
          const v = o.dim === 'mental' ? me.mental : p.attrs[o.dim]
          const chance = Math.round(Math.max(0.08, Math.min(0.92, 0.22 + (v - pen) / 100 * 0.62)) * 100)
          return (
            <button key={i} onClick={() => {
              const e = tryoutChoose(game, i)
              setLast(`${e.pick} —— ${e.ok ? '成了' : '没成'}（${e.dim} ${e.p}%）`)
              commit()
              if (!game.me!.tryout) onDone()
            }}>
              <span>{o.t}</span>
              {/* the bet, in words — a choice between three attribute names
                  is a dice roll with extra steps */}
              <span className="m">{o.why}</span>
              <span className="m mech">看{DIM_CN[o.dim]} · 成功率 {chance}% · {o.risk >= 1.1 ? '高风险高回报' : o.risk >= 0.7 ? '中等' : '稳健'}{i === day.rec ? ' · 稳妥的选法' : ''}</span>
            </button>
          )
        })}
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        评级 = 你的水平 + 这几天的分 − 他们的要求：≥16 A+ / ≥8 A / ≥0 B / ≥−9 C / D。C 以下一级俱乐部不签。
        连着几天下来会累，<b>体质就是在这种时候才看得出来</b>。
      </p>
    </Modal>
  )
}

// ------------------------------------------------------------------ deal
function DealModal({ dealId, onDone }: { dealId: string; onDone: () => void }) {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const [last, setLast] = useState<string | null>(null)
  const d = me.deals.find((x) => x.id === dealId)
  if (!d) { pop(game, 'deal', dealId); onDone(); return null }
  const team = game.teams[d.teamId]
  const cur = me.phase === 'pro' ? game.teams[game.myTeam] : null
  const title = d.kind === 'renew' ? `${team.name} 的续约` : d.kind === 'transfer' ? `${team.name} 的转会报价` : `${team.name} 的合同`
  const ask = (key: string) => {
    const r = askDeal(game, dealId, key, new Rng(hashStr(`ask:${game.seed}:${game.day}:${key}:${d.asks.length}`)))
    setLast(r.text)
    commit()
    if (r.blown && !game.me!.deals.find((x) => x.id === dealId)) { toast('谈崩了。'); onDone() }
  }
  return (
    <Modal title={title} onClose={() => {}} onBgClose={() => {}}>
      <div className="row" style={{ gap: 10, alignItems: 'center' }}>
        <Crest id={team.id} size={40} />
        <div>
          <b>{team.name}</b> <span className="tag">{team.tier === 1 ? 'VCT' : 'Challengers'}</span>{d.abroad && <span className="tag warn" style={{ marginLeft: 4 }}>外赛区</span>}
          <div className="tiny muted">实力 {team.rating}{cur ? ` · 你现在的队 ${cur.tag} ${cur.rating}` : ''} · 评级 {d.grade}</div>
        </div>
      </div>
      <table style={{ margin: '12px 0' }}>
        <tbody>
          <tr><td className="muted">身份</td><td><b>{ROLE_CN[d.role]}</b></td><td className="muted">年限</td><td><b>{d.years} 年</b></td></tr>
          <tr><td className="muted">年薪</td><td><b>{money(d.salary)}</b></td><td className="muted">签字费</td><td><b>{money(d.signBonus)}</b></td></tr>
          <tr><td className="muted">违约金</td><td><b>{money(d.buyout)}</b></td><td className="muted">底气</td><td><b>{d.leverage}</b></td></tr>
        </tbody>
      </table>
      {last && <div className="node-line">{last}</div>}
      <p className="tiny faint" style={{ margin: '6px 0' }}>还价：每问一次成功率都更低，被拒可能先降条件，第二次被拒就撤回。底气来自评级、粉丝、天梯、履历、经纪人。</p>
      <div className="row wrap" style={{ gap: 6 }}>
        {ASKS.filter((a) => a.can(d) && !d.asks.includes(a.key)).map((a) => (
          <button key={a.key} className="sm" onClick={() => ask(a.key)} title={a.blurb}>{a.label}</button>
        ))}
      </div>
      <div className="row" style={{ gap: 10, justifyContent: 'center', marginTop: 14 }}>
        <button className="primary" onClick={() => { toast(acceptDeal(game, dealId)); commit(); onDone() }}>签</button>
        <button onClick={() => { declineDeal(game, dealId); if (team.rating >= 86) game.me!.flags.declinedRich = 1; commit(); onDone() }}>不签</button>
      </div>
    </Modal>
  )
}

// ------------------------------------------------------------------ stream
function StreamModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const me = game.me!
  const o = me.stream.offer
  if (!o) { onDone(); return null }
  const pro = me.phase === 'pro'
  const pick = (c: 'club' | 'rival' | 'none') => { answerStreamOffer(game, c); commit(); onDone() }
  return (
    <Modal title={`直播独家 · ${o.tier} 级`} onClose={() => pick('none')} onBgClose={() => {}}>
      <p className="small" style={{ marginTop: 0 }}>{o.platform} 想签你的独家。{pro ? `俱乐部的合作平台是 ${o.clubPlatform}。` : ''}粉丝 {fansCn(me.fans)}。</p>
      <div className="node-opt">
        {pro && (
          <button onClick={() => pick('club')}>
            <span>签俱乐部的合作平台 {o.clubPlatform}</span>
            <span className="m">签字费 {money(o.sign * 0.8)} · 每场保底 {money(o.guarantee)} · 俱乐部抽 20% · 经理信任 +6</span>
          </button>
        )}
        <button onClick={() => pick('rival')}>
          <span>签 {o.platform}</span>
          <span className="m">签字费 {money(o.sign * 1.4)} · 每场保底 {money(o.guarantee * 1.15)}{pro ? ' · 俱乐部抽 40% · 经理信任 −12' : ''}</span>
        </button>
        <button onClick={() => pick('none')}>
          <span>不签</span>
          <span className="m">收入随粉丝 × 热度浮动，上限最高，下限也最低</span>
        </button>
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>签了独家每个赛段至少播 2 次，做不到扣 $2,000；平台推流让粉丝涨得快 25%。</p>
    </Modal>
  )
}

// ------------------------------------------------------------------ event
function EventModal({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const [result, setResult] = useState<{ pick: string; lines: string[] } | null>(null)
  const ev = eventOf(eventId)
  if (!ev) { pop(game, 'event', eventId); onDone(); return null }
  // the question stays on screen after the choice, with what it did right
  // under the option you took — a popup that closes on click teaches nothing
  return (
    <Modal title="事件" onClose={result ? onDone : () => {}} onBgClose={result ? onDone : () => {}}>
      <p className="q" style={{ fontSize: 'var(--t-h2)', fontWeight: 650, margin: '0 0 4px' }}>{ev.q}</p>
      <p className="muted small" style={{ margin: '0 0 12px' }}>{ev.ctx}</p>
      {result ? (
        <>
          <div className="node-line ok">
            你选了「{result.pick}」
            <div className="small" style={{ marginTop: 4 }}>{result.lines.length ? result.lines.join('，') : '没有立刻的变化。'}</div>
          </div>
          <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button className="primary" onClick={onDone}>继续</button></div>
        </>
      ) : (
        <>
          <div className="node-opt">
            {ev.a.map((o, i) => (
              <button key={i} onClick={() => { const lines = resolveEvent(game, ev.id, i); setResult({ pick: o.t, lines }); commit() }}>
                <span>{o.t}</span>
                <span className="m">{describeEffect(o.e) || '看情况'} · {AXIS_CN[o.g]}{i === ev.rec ? ' · 按推荐' : ''}</span>
              </button>
            ))}
          </div>
          <p className="tiny faint" style={{ marginBottom: 0 }}>每个选项都靠向一条气质轴（硬 / 暖 / 苦 / 秀），同一条轴选够五次，你就成了那样的人。</p>
        </>
      )}
    </Modal>
  )
}

function TraitModal({ traitKey, onDone }: { traitKey: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const t = traitOf(traitKey)
  const close = () => { pop(game, 'trait', traitKey); commit(); onDone() }
  if (!t) { close(); return null }
  return (
    <Modal title="你成了这样的人" onClose={close} onBgClose={close}>
      <h2 style={{ margin: '0 0 6px', fontSize: 28 }}>{t.name}</h2>
      <p className="muted">{t.blurb}</p>
      <p className="small">得：<b>{t.gain}</b></p>
      <p className="small">失：<b>{t.cost}</b></p>
      <p className="tiny faint">特质是永久的，会一直写在你的属性卡上。</p>
      <div className="row" style={{ justifyContent: 'center' }}><button className="primary" onClick={close}>知道了</button></div>
    </Modal>
  )
}

// ------------------------------------------------------------------ season / released / ending
function SeasonModal({ year, onDone }: { year: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const s = me.seasons.find((x) => String(x.year) === year) ?? me.seasons[me.seasons.length - 1]
  const close = () => { pop(game, 'season', year); commit(); onDone() }
  return (
    <Modal title={`${year} 赛季结束`} onClose={close} onBgClose={() => {}}>
      {s && (
        <p className="small" style={{ marginTop: 0 }}>
          {s.team}{s.tier ? `（${s.tier === 1 ? 'VCT' : 'Challengers'}）` : ''} · 出场 {s.starts}/{s.matches} · 首发胜 {s.wins} · ACS {s.acs || '—'} · 综合 {s.overallFrom} → {s.overallTo}
          {s.titles.length ? ` · 冠军：${s.titles.join('、')}` : ''}
        </p>
      )}
      <p className="small muted">你 {p.age} 岁了。{me.phase === 'pro' ? `合同还剩 ${p.contractYears} 年。` : me.phase === 'free' ? '还是自由身。' : '还没有合同。'}</p>
      {me.retireAsk && me.phase !== 'retired' && (
        <div className="panel alert" style={{ marginTop: 8 }}>
          <div className="panel-body">
            <p className="small" style={{ marginTop: 0 }}>五个赛季了。可以就此收官拿一个结局，也可以继续。</p>
            <button className="warn sm" onClick={() => { retire(game, `${p.age} 岁，你决定退役`); commit(); onDone() }}>退役</button>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button className="primary" onClick={close}>下一年</button></div>
    </Modal>
  )
}

function ReleasedModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const close = () => { pop(game, 'released'); commit(); onDone() }
  return (
    <Modal title="自由人" onClose={close} onBgClose={close}>
      <p className="small" style={{ marginTop: 0 }}>俱乐部没有续约。你回到了市场上：天梯、杯赛、跟着别的队打训练赛，等电话。两年没人打来，就是退役。</p>
      <div className="row" style={{ justifyContent: 'center' }}><button className="primary" onClick={close}>知道了</button></div>
    </Modal>
  )
}

function EndingModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const [card, setCard] = useState(false)
  const close = () => { pop(game, 'ending'); commit(); onDone() }
  return (
    <>
      <Modal wide title="生涯结束" onClose={close} onBgClose={() => {}}>
        <Poster />
        {/* a screenshot comes with the address bar and no way in for whoever sees it */}
        <div className="row" style={{ justifyContent: 'center', gap: 10, marginTop: 12 }}>
          <button onClick={() => setCard(true)}>生成生涯名片图</button>
          <button className="primary" onClick={close}>合上</button>
        </div>
      </Modal>
      {card && <ShareCard onClose={() => setCard(false)} />}
    </>
  )
}
