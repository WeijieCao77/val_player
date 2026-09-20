import { useEffect, useRef } from 'react'
import { useGame } from './ctx'
import { Modal, money } from './common'
import { clubCupBlock, cupDateCn, cupLastDay, cupOf, cupOpensOn, cupStatus, cupView, roundDayAfter, CUP_ROUND_GAP } from '../../engine/me/cups'
import { fansCn } from '../../engine/me/fans'

/**
 * One of the year's cups, opened from the week page's 「今年的赛事」.
 *
 * Reported 2026-09-18: 「右边可以看到今年的赛事，比如网吧赛，但是没地方点进去看具体
 * 赛程或者比赛信息、报名信息」. Everything here is the cup as the engine runs it
 * (engine/me/cups.ts): the week its card comes up, a round a week from the next
 * weekend, the rounds and their BO, the fee and the invitation's line against
 * what I have today, the four pick-up team-mates, the prize by rounds won, and
 * what a run does after it — and, once played, each round as it went.
 *
 * A cup is one match a round against a five made up for it, so there is no
 * complete field to draw. Show the recorded personal path, never fabricated opponents.
 */
export default function CupDetail({ cupKey, onClose }: { cupKey: string; onClose: () => void }) {
  const { game } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const box = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose

  // Escape closes it, and the keyboard lands on the way out; the card (common.tsx Modal, layer.ts) keeps Tab
  // inside and gives the focus back to the row it came from
  useEffect(() => {
    box.current?.closest('.modal')?.querySelector<HTMLButtonElement>('.modal-head button')?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close.current() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const raw = cupOf(cupKey)
  if (!raw) return null
  const c = cupView(raw, game.year, p.region)
  const st = cupStatus(game, cupKey)
  const n = c.rounds.length
  const run = st.kind === 'running' ? me.pre.cup : undefined
  const done = st.kind === 'done' ? st.run : undefined
  const opens = cupOpensOn(game, raw)
  const first = roundDayAfter(game.year, opens)
  const md = (d: number) => {
    const x = new Date(Date.UTC(game.year, 0, 1 + d))
    return `${x.getUTCMonth() + 1}月${x.getUTCDate()}日`
  }
  const at = (i: number) => c.rounds[Math.min(i, n - 1)].label
  const top = c.prize[c.prize.length - 1] ?? 0

  // where it stands, in one line
  const head = (() => {
    switch (st.kind) {
      case 'ahead': return { cls: '', text: <><b>{st.weeks} 周后</b>开始报名</> }
      case 'now': return { cls: 'own', text: <><b>就是本周</b>{me.pending.some((x) => x.kind === 'cup' && x.id === cupKey) ? ' · 报名卡在等你回答' : ''}</> }
      case 'running': {
        const next = run?.next ?? game.day
        const left = next - game.day
        return { cls: 'own', text: <><b>已报名</b> · {at(run?.round ?? 0)} {cupDateCn(game, next)}{left > 0 ? `，还有 ${left} 天` : '，今天'}</> }
      }
      case 'done': {
        const d = st.run
        const what = d.won ? '冠军' : d.forfeit ? `${at(d.reached)}弃权` : `止步${at(d.reached)}`
        return { cls: d.won ? 'good' : '', text: <><b>{what}</b> · {d.prize ? `奖金 ${money(d.prize)}` : '没有奖金'}</> }
      }
      case 'skipped': return { cls: '', text: <><b>没参加</b> · 开打那周没报名</> }
      case 'missed': return { cls: '', text: <><b>错过了</b> · 这一届已经过去</> }
    }
  })()

  // the round's line on the ladder: its result, its day, or how far away it is
  const stepOf = (i: number): { cls: string; text: string } => {
    const line = (run?.results ?? done?.results)?.[i]
    const said = line ? line.slice(c.rounds[i].label.length + 1) : ''
    if (run) {
      if (i < run.round) return { cls: 'win', text: said || '胜' }
      const next = run.next ?? game.day
      if (i === run.round) return { cls: 'now', text: `${cupDateCn(game, next)}${next - game.day > 0 ? ` · 还有 ${next - game.day} 天` : ' · 今天'}` }
      return { cls: '', text: `约 ${md(next + (i - run.round) * CUP_ROUND_GAP)}` }
    }
    if (done) {
      if (i < done.reached) return { cls: 'win', text: said || '胜' }
      if (i === done.reached && !done.won) return { cls: 'lost', text: said || (done.forfeit ? '弃权' : '负') }
      return { cls: 'off', text: '没打到' }
    }
    if (st.kind === 'ahead' || st.kind === 'now') return { cls: '', text: `约 ${md(first + i * CUP_ROUND_GAP)}` }
    return { cls: 'off', text: '' }
  }

  // the two doors, against what I have today: greyed with the reason, never hidden
  const feeOk = me.money >= c.fee
  const fansOk = me.fans >= c.minFans
  const ahead = st.kind === 'ahead' || st.kind === 'now'
  // signed: the third door, my club's calendar until the cup is played out (engine/me/cups.ts clubCupBlock)
  const pro = me.phase === 'pro'
  const clubWhy = pro && ahead ? clubCupBlock(game, cupKey) : null
  const signedOut = cupKey === 'premier'

  return (
    <Modal
      title={<>{c.name} <span className={`tag${c.minFans ? ' warn' : ''}`}>{c.minFans ? '邀请制' : '公开报名'}</span></>}
      onClose={onClose}
    >
      <div ref={box}>
        <div className={`cup-state ${head.cls}`} role="status">{head.text}</div>
        <p className="small muted" style={{ margin: '10px 0 12px' }}>{c.blurb}</p>

        <dl className="cup-facts">
          <dt>时间</dt>
          <dd>
            {md(opens)}那一周报名，{n > 1 ? `第一轮约 ${cupDateCn(game, first)}，一周一轮，${n} 轮打完` : `约 ${cupDateCn(game, first)}打这一场`}。每年一届。
          </dd>

          <dt>赛制</dt>
          <dd>
            {n > 1 ? '单败淘汰：每轮一场，输了就出局，对手一轮比一轮强。' : '只打一场。'}
            <p className="small muted">你的晋级路线 · 左右滑动查看。杯赛只记录你的比赛，不保存其他队伍的完整签表。</p>
            <div className="career-bracket-scroll" tabIndex={0} role="region" aria-label="杯赛个人晋级路线，可横向滚动">
            <ol className="career-cup-route" aria-label="轮次">
              {c.rounds.map((r, i) => {
                const s = stepOf(i)
                const win = c.prize[i + 1] ?? 0
                return (
                  <li key={i} className={s.cls}>
                    <b>{r.label}</b>
                    <span className="bo">BO{r.bo}</span>
                    <span>{s.cls === 'off' ? '未晋级 · 未出场' : s.cls === 'win' || s.cls === 'lost'
                      ? '你的队伍 vs 本轮对手（未记录队名）' : i === 0 || s.cls === 'now' ? '你的队伍 vs 对手待定' : '晋级后 · 对手待定'}</span>
                    {s.text && <span className="st">{s.text}</span>}
                    <span className="pz">{win ? `${i === n - 1 ? '夺冠' : '赢下'} ${money(win)}` : ''}</span>
                  </li>
                )
              })}
            </ol>
            </div>
            <span className="tiny faint">比赛日弹卡开打；打不了可以弃权{n > 1 ? '，奖金按已赢的轮次给' : ''}。</span>
          </dd>

          <dt>报名</dt>
          <dd>
            {signedOut
              ? `${c.minFans ? '粉丝够了才有请柬' : '谁都能报'}，只要还没签俱乐部；同时只打一项杯赛。`
              : `${c.minFans ? '粉丝够了才有请柬' : '谁都能报'}：还没签俱乐部的，或者签了约、俱乐部到这项杯赛打完（${md(cupLastDay(game, raw))}）都没有比赛的；同时只打一项杯赛。`}
            <ul className="cup-gates">
              {pro && (
                <li className={ahead && (signedOut || clubWhy) ? 'no' : ''}>
                  <span>{signedOut ? '还没签俱乐部' : `俱乐部到 ${md(cupLastDay(game, raw))} 都没有比赛`}</span>
                  {ahead && (signedOut || clubWhy
                    ? <span className="tag">{signedOut ? (game.year <= 2022 ? '签了约，海选跟着俱乐部打' : '签了约不报') : clubWhy}</span>
                    : <span className="tag win">照现在的赛程，是</span>)}
                </li>
              )}
              <li className={ahead && !feeOk ? 'no' : ''}>
                <span>报名费 {c.fee ? money(c.fee) : '免费'}</span>
                {c.fee > 0 && ahead && (feeOk ? <span className="tag win">够</span> : <span className="tag">你只有 {money(Math.max(0, me.money))}</span>)}
                {c.fee > 0 && (run || done) && <span className="tag">已交</span>}
              </li>
              {c.minFans > 0 && (
                <li className={ahead && !fansOk ? 'no' : ''}>
                  <span>粉丝过 {fansCn(c.minFans)}</span>
                  {ahead && (fansOk ? <span className="tag win">够了</span> : <span className="tag">你现在 {fansCn(me.fans)}，还不够</span>)}
                </li>
              )}
            </ul>
            <span className="tiny faint">
              到了那一周会弹卡问你报不报名；打到一半签了俱乐部就退出{c.fee ? '，报名费不退' : ''}。
              {!signedOut && '签了约报的，俱乐部在下一轮之前排上正式比赛，那一轮就弃权，奖金按已赢的轮次给；俱乐部不会因为你去打杯赛有意见。'}
            </span>
          </dd>

          <dt>队友</dt>
          <dd>
            你和四个路人队友，报名时抽，补齐其他位置，水平跟着这项赛事走。
            {run && <span className="tiny muted" style={{ display: 'block', marginTop: 2 }}>这一届：{run.mates.map((m) => `${m.ign}（${m.role}）`).join('、')}</span>}
          </dd>

          <dt>打出来</dt>
          <dd>
            <ul className="cup-gets">
              <li>{n > 1 ? `奖金按赢下的轮数给一次${top ? `，冠军 ${money(top)}` : ''}。` : `赢了拿 ${money(top)}。`}</li>
              <li>走得越远，涨粉越快，战术素养涨得越多。</li>
              <li>打完越可能有俱乐部来电话；赢下一半以上的轮次，会有俱乐部记下你。{pro ? '签了约打的不算：只有奖金和人气。' : ''}</li>
              <li>夺冠的话，打来电话的 Challengers 俱乐部直接给报价，不用试训{pro ? '（同样只给还没签约的）' : ''}。</li>
            </ul>
          </dd>
        </dl>
      </div>
    </Modal>
  )
}
