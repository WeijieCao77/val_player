import { useGame } from './ctx'
import { Crest, Panel, fmtDay, moneyIn } from './common'
import Rich from './rich'
import { payOf } from '../../engine/me/paytable'
import { VCT_SEEN, listSelf, perfWord, proPerf, vctRead } from '../../engine/me/transfer'
import { absDay, dateCn, inviteBlock, listBlock, moveLifts, signedThisPeriod, windowLine } from '../../engine/me/window'
import { abroadClub, awayWord, clubBars, declinedNow, expectOf, reachableClubs, tryoutSkill, CLUB_TIER_CN, INVITE_FANS, INVITE_LADDER } from '../../engine/me/prepro'
import { rankBar } from '../../engine/me/rank'
import { ROLE_CN } from '../../engine/me/contract'
import { push } from '../../engine/me/pending'
import type { PendingItem } from '../../engine/me/types'
import { fansCn } from '../../engine/me/fans'
import {
  CONTACT_TRUST, PITCH_AP, PITCH_LEAD, PITCH_MAX, PITCH_SQUAD, REPLY_MAX, REPLY_MIN, ROSTER_FULL,
  groupCn, oddsLine, oddsWord, periodEndAbs, pitchBlock, pitchTargets, sendPitch,
} from '../../engine/me/selfpitch'
import type { PitchGroup, PitchRow } from '../../engine/me/selfpitch'
import { pitchBook } from '../../engine/me/pitchbook'
import { attrWord, gapWord, useNumbers } from './words'

/**
 * 转会: the contract, how the market reads me, what is on the table, every
 * transfer line of the season and the clubs I have played for. Reported
 * 2026-09-14: 「转会的信息以及对方报价只在本周栏目出现，而转会栏目反而没有…
 * 包括转会的历史应该也在转会栏目里有记录」 — the offers were one line of text,
 * the season's transfer news lived only in the week's diary, and no history was
 * kept anywhere on this page.
 *
 * And 自荐 (the same day: 「不只是被动的等待试训邀请而是加入自荐的机制」): without a
 * contract a panel at the top to write to a club; under one, 主动接触 beside 主动挂牌
 * (engine/me/selfpitch.ts). Every club says its chance, and a club that cannot be
 * written to today says why.
 */
export default function TransferScreen() {
  const { game, commit, toast } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const pro = me.phase === 'pro'
  const team = pro ? game.teams[game.myTeam] : null
  // my contract as signed, in its club's league currency (engine/me/paytable.ts)
  const pay = payOf(game)
  const skill = tryoutSkill(game)
  // my own 赛区's clubs first, as a call reads them (engine/me/prepro.ts abroadClub: from 2023 the whole VCT league):
  // with the language the rest of the world is listed below them, never in among them
  const away = new Set(Object.values(game.teams).filter((t) => abroadClub(game, t)).map((t) => t.id))
  const clubs = Object.values(game.teams)
    .filter((t) => t.id !== game.myTeam && (!away.has(t.id) || me.flags.lang))
    .sort((a, b) => Number(away.has(a.id)) - Number(away.has(b.id)) || expectOf(a) - expectOf(b))
  const reach = new Set(reachableClubs(game).map((t) => t.id))
  const declined = [...declinedNow(game)]
  const perf = pro ? proPerf(game) : 0
  // a Challengers man against his league's VCT starters: what brings the VCT clubs to the window (engine/me/transfer.ts vctApproach)
  const vct = pro ? vctRead(game) : null
  const top = game.year >= 2023 ? 'VCT' : '一线'

  // the card of an offer or an invite, brought to the front now rather than waiting its turn in the list
  const openCard = (kind: PendingItem['kind'], id: string) => {
    push(game, { kind, id })
    const i = me.pending.findIndex((x) => x.kind === kind && x.id === id)
    if (i > 0) me.pending.unshift(...me.pending.splice(i, 1))
    commit()
  }

  // every transfer line the career kept (me/log.ts, kind 'deal'): this season's first, the rest folded
  const dealLog = me.log.filter((l) => l.kind === 'deal')
  const seasonLines = dealLog.filter((l) => l.year === game.year).reverse()
  const earlierLines = dealLog.filter((l) => l.year !== game.year).reverse()

  // the clubs, from the player's own record — the log keeps its last 400 lines, this keeps every stint.
  // A stint ends where the next begins: a record's own `to` is not always moved on when he leaves.
  const stints = p.clubHist ?? []
  const history = stints.map((h, i) => {
    const next = stints[i + 1]
    const current = !next && pro && h.team === game.myTeam
    const end = next ? Math.max(h.to, next.from) : Math.max(h.to, h.from)
    return { ...h, current, span: current ? `${h.from} 至今` : end > h.from ? `${h.from}–${end}` : `${h.from}` }
  }).reverse()

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
      <div>
        {!pro && me.phase !== 'retired' && <PitchPanel />}
        {pro && team && pay && (
          <Panel title="合同">
            <p className="small" style={{ margin: 0 }}>
              <b>{team.name}</b> · {ROLE_CN[p.contract?.promisedRole ?? 'rotation']} · 年薪 <b>{moneyIn(pay.salary, pay.cur, game.year)}</b>
              <br />到 <b>{game.year + Math.max(0, p.contractYears - 1)} 赛季末</b> · <span title={`合同没到期时别的俱乐部要带走你，得付给 ${team.tag} 这个数。`}>违约金 {moneyIn(pay.buyout, pay.cur, game.year)}</span>
            </p>
          </Panel>
        )}
        {pro && (
          <Panel title="市场怎么看你" actions={nums ? <span className="tag">{perf.toFixed(1)}</span> : undefined}>
            <p className="small" style={{ marginTop: 0 }}><b>{perfWord(perf)}</b>。</p>
            <p className="tiny faint">评价够高，赛段结束时会有别队来看你的比赛；转会窗口开着的时候，报价随时可能来。</p>
            {vct && (
              <p className="small">
                本联赛 {top} 首发的水平：<b>{nums ? vct.median : attrWord(vct.median)}</b>。
                {vct.by
                  ? <>{vct.by === 'rating' ? '你的综合已经够到这条线' : vct.by === 'title' ? '你是 Challengers 冠军队的主力' : '你这个赛季的数据是联赛里最好的'}：转会窗口开着时，位置上用得着你的 {top} 俱乐部会先来找你{vct.starts < VCT_SEEN ? `（本赛季先打满 ${VCT_SEEN} 场正赛首发）` : ''}。</>
                  : <>综合够到{nums ? ` ${vct.bar}` : '这条线附近'}、打出联赛里最好的赛季数据，或者作为主力拿下 Challengers 冠军，转会窗口开着时位置上用得着你的 {top} 俱乐部就会来找你。</>}
              </p>
            )}
            {/* each club once: a save from before could hold one twice */}
            {me.intents.length > 0 && <p className="small">记下你名字的：{[...new Set(me.intents.map((i) => i.teamId))].map((id) => game.teams[id]?.tag).join('、')}</p>}
            {/* the window as it stands, greyed with its reason and its date, never hidden (engine/me/window.ts) */}
            <p className="small"><b>{windowLine(game)}</b></p>
            {signedThisPeriod(game) && <p className="tiny faint" style={{ margin: '4px 0 0' }}>{inviteBlock(game)}。</p>}
            {me.moveAfter && (
              <p className="small">已和 <b>{game.teams[me.moveAfter.deal.teamId]?.name}</b> 谈妥：{me.moveAfter.event} 期间名单锁定，{dateCn(moveLifts(game) ?? absDay(game.year, me.moveAfter.until), game.year)}后正式转会。</p>
            )}
            {(() => {
              // the engine's own gate, greyed with its line: an agreed move, the period I signed in, the window, this year's listing
              const why = listBlock(game)
              return (
                <>
                  <button className="sm" disabled={!!why} title={why ?? undefined} onClick={() => { toast(listSelf(game)); commit() }}>主动挂牌（经理会不高兴）</button>
                  {why && <p className="tiny faint" style={{ margin: '4px 0 0' }}>{why}。</p>}
                </>
              )
            })()}
            <ContactBlock />
          </Panel>
        )}
        <Panel title="桌上的报价">
          {me.deals.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>现在没有报价。来了会弹卡片，这里也会列着，过期之前随时可以回来谈。</p>
            : me.deals.map((d) => (
              <div key={d.id} className="tr-row">
                <Crest id={d.teamId} size={22} />
                <span className="tr-main">
                  <b>{game.teams[d.teamId]?.name ?? '俱乐部'}</b>
                  <small>{d.kind === 'renew' ? '续约' : d.kind === 'transfer' ? '转会' : '签约'}{d.via === 'contact' ? '（你主动接触的）' : ''} · {ROLE_CN[d.role]} · {moneyIn(d.salary, d.cur, game.year)} × {d.years} 年 · {Math.max(0, d.expires - game.day)} 天内答复</small>
                </span>
                <button className="sm primary" onClick={() => openCard('deal', d.id)}>去谈</button>
              </div>
            ))}
        </Panel>
        {!pro && (
          <Panel title="邀请">
            {me.pre.invites.length === 0 ? <p className="muted small" style={{ margin: 0 }}>还没有俱乐部来电话。杯赛走得远、天梯打到{rankBar(game, INVITE_LADDER)}、粉丝过 {fansCn(INVITE_FANS)}，都会有人注意到你；也可以在上面挑一家发自荐。</p>
              : me.pre.invites.map((i) => (
                <div key={i.id} className="tr-row">
                  <Crest id={i.teamId} size={22} />
                  <span className="tr-main"><b>{game.teams[i.teamId]?.name ?? '俱乐部'}</b><small>{i.via === 'self' ? '回复了你的自荐 · ' : ''}{i.direct ? '免试训，直接给合同' : '请你去试训'} · {Math.max(0, i.expires - game.day)} 天内答复</small></span>
                  <button className="sm primary" onClick={() => openCard('invite', i.id)}>去答复</button>
                </div>
              ))}
            {declined.length > 0 && <p className="tiny faint">今年回绝过：{declined.map((id) => game.teams[id]?.tag).join('、')}</p>}
            {me.moveAfter && (
              <p className="small">已和 <b>{game.teams[me.moveAfter.deal.teamId]?.name}</b> 谈妥：{me.moveAfter.event} 期间名单锁定，{dateCn(moveLifts(game) ?? absDay(game.year, me.moveAfter.until), game.year)}后正式签约。</p>
            )}
          </Panel>
        )}
        <Panel title={`转会动态 · ${game.year} 赛季`}>
          {seasonLines.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>这个赛季还没有转会消息。谁来找过你、谁开了价、试训怎么样、签了什么合同，都会记在这里。</p>
            : (
              <ul className="diary">
                {seasonLines.map((l, i) => <li key={i} className="deal"><span className="when">{fmtDay(l.day, l.year)}</span><span><Rich text={l.text} /></span></li>)}
              </ul>
            )}
          {earlierLines.length > 0 && (
            <details className="tr-more">
              <summary>更早的转会消息（{earlierLines.length} 条）</summary>
              <ul className="diary">
                {earlierLines.map((l, i) => <li key={i} className="deal"><span className="when">{l.year} {fmtDay(l.day, l.year)}</span><span><Rich text={l.text} /></span></li>)}
              </ul>
            </details>
          )}
        </Panel>
      </div>
      <div>
        <Panel title="转会历史">
          {history.length === 0
            ? <p className="muted small" style={{ margin: 0 }}>还没有效力过俱乐部。</p>
            : (
              <ul className="tr-hist">
                {history.map((h, i) => (
                  <li key={`${h.team}:${h.from}:${i}`} className={h.current ? 'now' : ''}>
                    <Crest id={h.team} size={22} />
                    <span className="tr-main"><b>{game.teams[h.team]?.name ?? h.team}</b><small>{h.span}{h.current ? ' · 现在的俱乐部' : ''}</small></span>
                  </li>
                ))}
              </ul>
            )}
          {history.length > 0 && <p className="tiny faint" style={{ margin: '8px 0 0' }}>每次签约的年限、年薪和违约金，在左边「转会动态」里。</p>}
        </Panel>
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
              // the word the cards put on a club: 「外赛区」 by league, 「国外俱乐部」 by country (engine/me/prepro.ts awayWord)
              const word = awayWord(game, t)
              return (
                <tr key={t.id} style={{ opacity: reach.has(t.id) ? 1 : 0.55 }}>
                  <td><span className="club"><Crest id={t.id} size={18} />{t.tag}</span></td>
                  <td className="tiny">{CLUB_TIER_CN(t)}{word ? ` · ${word}` : ''}</td>
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

const GROUPS: PitchGroup[] = ['vct', 'strong', 'mid', 'weak', 'academy']

/** The pitch or contact on its way, in one line: 「已发给 CGN Esports，6月17日前回复。」 */
function PitchSent() {
  const { game } = useGame()
  const out = pitchBook(game).out
  if (!out) return null
  return (
    <div className="sp-sent">
      {out.kind === 'contact' ? '已经接触了' : '已发给'} <b>{game.teams[out.teamId]?.name ?? '俱乐部'}</b>，{dateCn(out.due, game.year)}前回复。
    </div>
  )
}

/**
 * The clubs a 自荐 or a contact can go to, in their groups (engine/me/selfpitch.ts pitchTargets): each with
 * its roster, its need, its bar against mine, the chance and the button, or why not. The group holding
 * the best chance that can be sent today opens by itself; the rest fold.
 */
function PitchList({ contract }: { contract: boolean }) {
  const { game, commit, toast } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const role = game.players[me.id].role
  const book = pitchBook(game)
  const block = pitchBlock(game)
  const { rows, abroadShut } = pitchTargets(game)
  const home = rows.filter((r) => !r.abroad)
  const far = rows.filter((r) => r.abroad)
  const best = home.filter((r) => !r.why).sort((a, b) => b.odds.pct - a.odds.pct)[0]
  const send = (id: string) => {
    const why = sendPitch(game, id)
    if (why) { toast(`${why}。`); return }
    toast(contract ? `托人联系了 ${game.teams[id]?.name}。` : `自荐发给了 ${game.teams[id]?.name}。`)
    commit()
  }
  const need = (r: PitchRow): string => {
    const n = r.odds.need
    if (n.kind === 'hole') return ` · 缺${role}`
    if (n.kind === 'beat') return ` · 你比首发 ${n.mate?.ign} 强`
    if (n.kind === 'place') return ` · 名单不到 ${PITCH_SQUAD} 人`
    return n.mate ? ` · ${role}首发 ${n.mate.ign}` : ''
  }
  const row = (r: PitchRow) => {
    const o = r.odds
    const off = !!r.why
    const sent = book.out?.teamId === r.team.id || book.sent.includes(r.team.id) || book.contacted.includes(r.team.id)
    return (
      <div key={r.team.id} className={`sp-row${off ? ' off' : ''}`}>
        <Crest id={r.team.id} size={22} />
        <span className="tr-main">
          <b>{r.team.name}</b>
          <small>
            {groupCn(game, r.group)}{awayWord(game, r.team) ? ` · ${awayWord(game, r.team)}` : ''} · 名单 {r.team.roster.length}/{ROSTER_FULL}{need(r)} · {nums ? `要 ${o.expect}，你 ${o.skill}` : gapWord(-o.gap)}
            {contract && o.fee > 0 ? (o.short ? ' · 预算付不起你的违约金' : ' · 付得起你的违约金') : ''}
          </small>
        </span>
        <span className={`sp-odds${off ? '' : o.pct >= 50 ? ' hi' : o.pct < 10 ? ' lo' : ''}`}>
          {off ? '—' : nums ? `${o.pct}%` : null}
          {!off && <small>{oddsWord(o.pct)}</small>}
        </span>
        <button className="sm" disabled={off || !!block} title={r.why ?? block ?? undefined} onClick={() => send(r.team.id)}>
          {sent ? '已发' : contract ? '去接触' : '发自荐'}
        </button>
        {/* a greyed club says why; an open one, with 数值, the sum its chance is (the number the answer is drawn on) */}
        {off ? <span className="sp-why">{r.why}。</span>
          : nums ? <span className="sp-why faint">{oddsLine(game, o)}</span>
            : o.nevpro ? <span className="sp-why faint">{groupCn(game, 'vct')} 俱乐部基本只从打过职业比赛的人里挑。</span> : null}
      </div>
    )
  }
  return (
    <>
      {GROUPS.map((g) => {
        const list = home.filter((r) => r.group === g)
        if (!list.length) return null
        const top = list.find((r) => !r.why)
        return (
          <details key={g} className="sp-group" open={best?.group === g}>
            <summary>{groupCn(game, g)} · {list.length} 家{top ? ` · 最好的一家${nums ? ` ${top.odds.pct}%` : oddsWord(top.odds.pct)}` : ' · 现在都投不了'}</summary>
            {list.map(row)}
          </details>
        )
      })}
      {far.length > 0 && (
        <details className="sp-group">
          <summary>外赛区（你会外语）· {far.length} 家</summary>
          {far.map(row)}
        </details>
      )}
      {abroadShut > 0 && (
        <p className="tiny faint" style={{ margin: '6px 0 0' }}>外赛区的 {abroadShut} 家俱乐部：要会外语才投得了（「经济」页的语言课）。外语只多开外区，本赛区照常。</p>
      )}
    </>
  )
}

/** 自荐, without a contract: at the top of the page. */
function PitchPanel() {
  const { game } = useGame()
  const me = game.me!
  const book = pitchBook(game)
  const block = pitchBlock(game)
  const left = Math.max(0, PITCH_MAX - book.sent.length)
  const tally = me.pitch?.tally
  return (
    <Panel title="自荐" actions={<span className="tag">还能投 {left}/{PITCH_MAX}</span>}>
      <p className="small" style={{ marginTop: 0 }}>
        不想干等邀请，就挑一家发自荐：每次 {PITCH_AP} 行动点（本周剩 {me.ap}），这个转会期还能投 <b>{left}</b> 次，转会期到 {dateCn(periodEndAbs(game), game.year)}。
      </p>
      <PitchSent />
      {block && !book.out && <p className="tiny warn" style={{ margin: '4px 0' }}>{block}。</p>}
      <PitchList contract={false} />
      <p className="tiny faint" style={{ margin: '8px 0 0' }}>
        {REPLY_MIN}–{REPLY_MAX} 天后回复：成了是一份试训邀请（水平高出他们一截的免试训），没成写明原因，那家本赛季不再收你的自荐。
        同一家一个转会期只能投一次；俱乐部的窗口至少还要开 {PITCH_LEAD} 天；今年没有联赛可打的俱乐部不收人。托管不会替你发。
      </p>
      {tally && tally.sent > 0 && <p className="tiny faint" style={{ margin: '4px 0 0' }}>一共投过 {tally.sent} 次，回复 {tally.replied} 次，成了 {tally.ok} 次。</p>}
    </Panel>
  )
}

/** 主动接触, under a contract: beside 主动挂牌. */
function ContactBlock() {
  const { game } = useGame()
  const me = game.me!
  const team = game.teams[game.myTeam]
  const pay = payOf(game)
  const book = pitchBook(game)
  const block = pitchBlock(game)
  return (
    <div className="sp-contact">
      <p className="small" style={{ margin: '12px 0 4px' }}>
        <b>主动接触</b> · 这个转会期还能接触 {book.contacted.length ? 0 : 1} 家 · 每次 {PITCH_AP} 行动点（本周剩 {me.ap}）
      </p>
      <p className="tiny faint" style={{ margin: '0 0 4px' }}>
        点名一家托人联系。你的经理会知道你在找下家，信任 −{CONTACT_TRUST}。成了由他们和 {team?.tag ?? '你的俱乐部'} 谈转会{pay ? `，违约金 ${moneyIn(pay.buyout, pay.cur, game.year)} 他们来付` : ''}；离他们的要求近的，先请你去试训。{REPLY_MIN}–{REPLY_MAX} 天后回复，两边的窗口都要开着、名单没锁。
      </p>
      <PitchSent />
      {block && !book.out && <p className="tiny warn" style={{ margin: '4px 0' }}>{block}。</p>}
      <details className="sp-group">
        <summary>挑一家接触</summary>
        <PitchList contract />
      </details>
    </div>
  )
}
