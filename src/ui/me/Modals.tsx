import { useState } from 'react'
import { useGame } from './ctx'
import { Crest, Modal, money } from './common'
import type { PendingItem } from '../../engine/me/types'
import { cupFor, enterCup, skipCup, mountCupMatch, afterCupMatch, TEMP_MINE, TEMP_OPP, cupRng } from '../../engine/me/cups'
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
import { storyHint, storyTag } from '../../engine/me/story'
import { AXIS_CN, traitOf } from '../../engine/me/traits'
import { pop } from '../../engine/me/pending'
import { retire } from '../../engine/me/endings'
import { DIM_CN } from '../../engine/me/nodes'
import { fansCn } from '../../engine/me/fans'
import MatchPlay from './MatchPlay'
import { useNumbers } from './words'
import Poster from './Poster'
import ShareCard from './ShareCard'
import CeremonyModal from './Ceremony'
import HurtModal from './HurtModal'
import { injuryStatus } from '../../engine/me/injury'

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
    case 'released': return <ReleasedModal why={item.id} onDone={onDone} />
    case 'folding': return <FoldingModal onDone={onDone} />
    case 'ending': return <EndingModal onDone={onDone} />
    case 'ceremony': return <CeremonyModal onDone={onDone} />
    case 'hurt': return <HurtModal fixtureId={item.id!} onDone={onDone} />
  }
  return null
}

// ------------------------------------------------------------------ cup
function CupModal({ cupKey, onDone }: { cupKey: string; onDone: () => void }) {
  const { game, commit, toast } = useGame()
  const me = game.me!
  const cup = cupFor(game, cupKey)!
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
        <p className="small muted" style={{ marginTop: 0 }}>你的车队：{run.mates.map((m) => `${m.ign}（${m.role}）`).join('、')}，还有你。</p>
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
        {cup.rounds.length} 轮 · 报名费 {cup.fee ? `$${cup.fee}` : '免费'} · 奖金最高 ${cup.prize[cup.prize.length - 1].toLocaleString()}
        {cup.minFans ? ` · 邀请制（粉丝过 ${fansCn(cup.minFans)}）` : ''}
      </p>
      <p className="small muted">走得越远，越可能有俱乐部的人记下你的名字。你会抽到四个路人队友。</p>
      {injuryStatus(game) && <p className="small" style={{ color: 'var(--loss)' }}>你带着伤：{injuryStatus(game)!.line}。硬打发挥打折扣，伤可能加重。</p>}
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
  const [nums] = useNumbers()
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
          <div className="tiny muted">他们{via}</div>
        </div>
      </div>
      <p className="small" style={{ margin: '12px 0 4px' }}>
        你的水平：<b>{skill >= expect + 8 ? '绰绰有余' : skill >= expect ? '够格' : skill >= expect - 6 ? '差一点，试训里能补回来' : '差得不少'}</b>
        {nums ? `（他们要 ${Math.round(expect)}，你现在 ${Math.round(skill)}）` : ''}
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
      <p className="tiny faint">{inv.direct ? '他们看够了，免试训直接谈合同。' : '四天试训，每天一个选择。'}{inv.expires - game.day} 天内答复；回绝了今年不会再来。</p>
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
  const [nums] = useNumbers()
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
      <p className="small">目前的印象：<b>{t.score >= 8 ? '不错' : t.score >= 0 ? '还行' : '不太好'}</b>{pen > 0 ? '，连着几天有点累了' : ''}{nums ? `（评估分 ${t.score > 0 ? '+' : ''}${t.score.toFixed(1)}${pen > 0 ? `，体质拖累 −${pen.toFixed(1)}` : ''}）` : ''}</p>
      <div className="node-opt">
        {day.opts.map((o, i) => {
          const v = o.dim === 'mental' ? me.mental : p.attrs[o.dim]
          const chance = Math.round(Math.max(0.08, Math.min(0.92, 0.22 + (v - pen) / 100 * 0.62)) * 100)
          return (
            <button key={i} onClick={() => {
              const e = tryoutChoose(game, i)
              setLast(`${e.pick} —— ${e.ok ? '成了' : '没成'}`)
              commit()
              if (!game.me!.tryout) onDone()
            }}>
              <span>{o.t}</span>
              {/* the bet, in words — a choice between three attribute names
                  is a dice roll with extra steps */}
              <span className="m">{o.why}</span>
              <span className="m mech">看{DIM_CN[o.dim]}{nums ? ` · 成功率 ${chance}%` : ''} · {o.risk >= 1.1 ? '高风险高回报' : o.risk >= 0.7 ? '中等' : '稳健'}{i === day.rec ? ' · 稳妥的选法' : ''}</span>
            </button>
          )
        })}
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>
        C 以下一级俱乐部不签。连着几天下来会累，<b>体质就是在这种时候才看得出来</b>。
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
          <div className="tiny muted">评级 {d.grade}</div>
        </div>
      </div>
      <table style={{ margin: '12px 0' }}>
        <tbody>
          <tr><td className="muted">身份</td><td><b>{ROLE_CN[d.role]}</b></td><td className="muted">年限</td><td><b>{d.years} 年</b></td></tr>
          <tr><td className="muted">年薪</td><td><b>{money(d.salary)}</b></td><td className="muted">签字费</td><td><b>{money(d.signBonus)}</b></td></tr>
          <tr><td className="muted">违约金</td><td><b>{money(d.buyout)}</b></td><td /><td /></tr>
        </tbody>
      </table>
      {last && <div className="node-line">{last}</div>}
      <p className="tiny faint" style={{ margin: '6px 0' }}>每还一次价都更难，第二次被拒就撤回。</p>
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
      <p className="small" style={{ marginTop: 0 }}>{o.platform} 想签你的独家。{pro ? `俱乐部的合作平台是 ${o.clubPlatform}。` : ''}</p>
      <div className="node-opt">
        {pro && (
          <button onClick={() => pick('club')}>
            <span>签俱乐部的合作平台 {o.clubPlatform}</span>
            <span className="m">签字费 {money(o.sign * 0.8)} · 每场保底 {money(o.guarantee)} · 俱乐部抽 20% · 经理满意</span>
          </button>
        )}
        <button onClick={() => pick('rival')}>
          <span>签 {o.platform}</span>
          <span className="m">签字费 {money(o.sign * 1.4)} · 每场保底 {money(o.guarantee * 1.15)}{pro ? ' · 俱乐部抽 40% · 经理不满' : ''}</span>
        </button>
        <button onClick={() => pick('none')}>
          <span>不签</span>
          <span className="m">收入随粉丝和热度浮动，上限最高，下限也最低</span>
        </button>
      </div>
      <p className="tiny faint" style={{ marginBottom: 0 }}>签了独家每个赛段至少播 2 次，做不到扣 $2,000；平台推流让粉丝涨得更快。</p>
    </Modal>
  )
}

// ------------------------------------------------------------------ event
function EventModal({ eventId, onDone }: { eventId: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const [result, setResult] = useState<{ pick: string; lines: string[] } | null>(null)
  // what the card echoes and which chain step it is, read once: the answer moves the chain on
  const [tags] = useState(() => { const e = eventOf(eventId); return e ? storyTag(game, e) : [] })
  const ev = eventOf(eventId)
  if (!ev) { pop(game, 'event', eventId); onDone(); return null }
  // the question stays on screen after the choice, with what it did right
  // under the option you took — a popup that closes on click teaches nothing
  return (
    <Modal title="事件" onClose={result ? onDone : () => {}} onBgClose={result ? onDone : () => {}}>
      {tags.map((line) => <p key={line} className="tiny muted" style={{ margin: '0 0 4px' }}>{line}</p>)}
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
                <span className="m">{[describeEffect(o.e), storyHint(o)].filter(Boolean).join(' · ') || '看情况'} · {AXIS_CN[o.g]}{i === ev.rec ? ' · 按推荐' : ''}</span>
              </button>
            ))}
          </div>
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
          {s.team}{s.tier ? `（${s.tier === 1 ? 'VCT' : 'Challengers'}）` : ''} · 出场 {s.starts}/{s.matches} · 综合 {s.overallFrom} → {s.overallTo}
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

/** History is closing my club: two or three weeks' notice. */
function FoldingModal({ onDone }: { onDone: () => void }) {
  const { game, commit } = useGame()
  const n = game.foldNotice
  const club = n ? game.teams[n.club] : undefined
  const close = () => { pop(game, 'folding'); commit(); onDone() }
  return (
    <Modal title={`${club?.name ?? '俱乐部'} 要解散了`} onClose={close} onBgClose={() => {}}>
      <p className="small" style={{ marginTop: 0 }}>管理层把全队叫到一起：{n?.reason ?? '赛季结束后不再保留职业队'}。</p>
      <p className="small">离解散还有 <b>{n ? Math.max(0, n.day - game.day) : 0}</b> 天。之后合同作废，你会成为自由人——从现在起就可以留意别的队了。</p>
      <p className="tiny faint">真实历史里，这家俱乐部这个赛季之后就没有再参加 Riot 的赛事。这不是一名选手能改变的。</p>
      <div className="row" style={{ justifyContent: 'center' }}><button className="primary" onClick={close}>知道了</button></div>
    </Modal>
  )
}

function ReleasedModal({ why, onDone }: { why?: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const close = () => { pop(game, 'released'); commit(); onDone() }
  return (
    <Modal title="自由人" onClose={close} onBgClose={close}>
      <p className="small" style={{ marginTop: 0 }}>{why === 'fold' ? '俱乐部解散了，合同随之作废。' : '俱乐部没有续约。'}你回到了市场上：天梯、杯赛、跟着别的队打训练赛，等电话。两年没人打来，就是退役。</p>
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
