/**
 * 玩家信箱: write the author a line, and see what everyone else asked for.
 *
 * The author, 2026-09-20: 「我考虑加一个玩家信箱，就是玩家可以直接在游戏里把意见发出来，
 * 然后展示到一个排行榜一样的地方，然后每个玩家都能看到别的玩家的建议并且点赞，我就可以
 * 按照点赞数量高的进行 bug 修改」. So it is read as a board, top down: position, the
 * suggestion, its votes, its state — the same 排行榜 table the standings and the
 * all-ten sheet are drawn with (table.box, src/me.css), not a style of its own.
 *
 * 先审后展示. A new suggestion is private until the author shows it: nobody else
 * sees it, and the one who sent it always sees their own with its state, so the
 * box never looks broken. That rule lives on the server (box.js); this page only
 * draws what it is handed.
 *
 * Everything on this page was typed by a stranger, so it is DATA: rendered as a
 * string, never through Rich, never near innerHTML. React escapes it, and the
 * author's dashboard escapes it again.
 *
 * It is an extra, never a gate. The list, the vote and the send each fail into a
 * sentence; the career is played offline exactly as before.
 */
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { boxList, boxNew, boxVote, STATE_CN } from './box'
import type { BoxItem } from './box'
import { Panel } from './common'
import { useLayer } from './layer'
import './mailbox.css'

type Tab = 'hot' | 'new' | 'mine'

const TABS: { key: Tab; label: string }[] = [
  { key: 'hot', label: '最热' },
  { key: 'new', label: '最新' },
  { key: 'mine', label: '我的' },
]

/** 已展示 needs no tag — being on the board says it; the two that moved on do */
const TAG: Partial<Record<BoxItem['state'], string>> = { taken: '已采纳', fixed: '已修复', merged: '已合并' }

function mergeProgress(it: BoxItem): string {
  if (it.merge?.target) return `合并后：${STATE_CN[it.merge.target.state]}`
  if (it.merge?.availability === 'private') return '合并目标暂未公开'
  if (it.merge?.availability === 'missing') return '合并目标暂不可查看'
  return '合并信息暂不可用'
}

function MergeReceipt({ item }: { item: BoxItem }) {
  const target = item.merge?.target
  return <section className="mbx-merge" aria-label="建议合并回执">
    <strong>你的建议已合并至同类建议</strong>
    <p>这条原文为你保留，支持票已合并并去重。谢谢你帮助作者发现这个问题。</p>
    {target ? <>
      <p>当前处理进度：<span className={`mbx-tag s-${target.state}`}>{STATE_CN[target.state]}</span> · {target.votes} 赞</p>
      <details>
        <summary>查看合并后的建议</summary>
        <p className="mbx-detail-meta">建议编号 #{target.id}</p>
        <p className="mbx-fulltext">{target.text}</p>
      </details>
      <p className="tiny faint">之后的采纳或修复状态会跟随这条建议更新，重新打开信箱或点击刷新即可查看。</p>
    </> : <p>{item.merge?.availability === 'private'
      ? '合并后的建议暂未公开，暂时不能查看正文；公开后可在这里继续查看处理进度。'
      : item.merge?.availability === 'missing'
        ? '合并后的建议已移除或暂时不可用，但你提交过的这条建议和合并回执仍然保留。'
        : '暂时无法读取合并去向，请稍后刷新。你的原建议仍在这里。'}</p>}
  </section>
}

const day = (t: number): string => {
  if (!t) return ''
  const d = new Date(t + 8 * 3600e3)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/**
 * The board and the box to write in, drawn the same in the corner card and on
 * the 信箱 page.
 */
function Board() {
  const [items, setItems] = useState<BoxItem[]>([])
  const [mine, setMine] = useState<BoxItem[]>([])
  const [max, setMax] = useState(200)
  const [full, setFull] = useState(false)
  const [tab, setTab] = useState<Tab>('hot')
  const [load, setLoad] = useState<'wait' | 'ok' | 'off'>('wait')
  const [note, setNote] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const detailId = useId()
  const detail = useRef<HTMLDivElement>(null)
  const detailOpener = useRef<HTMLButtonElement | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    if (!expanded) return
    detail.current?.focus({ preventScroll: true })
    detail.current?.scrollIntoView({ block: 'start' })
  }, [expanded])
  const closeDetail = () => {
    setExpanded(null)
    detailOpener.current?.focus()
  }

  const read = useCallback(async () => {
    const r = await boxList()
    if (!alive.current) return
    if (!r.ok) { setLoad('off'); setNote(r.why); return }
    // Receipts belong only under 我的, even if an older/proxy response mixes them into the public list.
    setItems(r.list.items.filter((it) => it.state !== 'merged'))
    setMine(r.list.mine)
    setMax(r.list.max)
    setFull(r.list.full)
    setLoad('ok')
    setNote('')
  }, [])

  useEffect(() => {
    alive.current = true
    void read()
    return () => { alive.current = false }
  }, [read])

  const rows = useMemo(() => {
    if (tab === 'mine') return mine
    if (tab === 'new') return [...items].sort((a, b) => b.t - a.t)
    return items
  }, [tab, items, mine])

  const send = async () => {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    setSent('')
    const r = await boxNew(t)
    if (!alive.current) return
    setSending(false)
    if (!r.ok) { setSent(r.why); return }
    setText('')
    setExpanded(null)
    setMine((old) => [r.item, ...old.filter((x) => x.id !== r.item.id)])
    setTab('mine')
    setSent('收到了。作者看过之后才会展示到榜上——在「我的」里能看到它到哪一步了。')
  }

  const vote = async (it: BoxItem) => {
    const on = !it.voted
    const move = (list: BoxItem[]): BoxItem[] =>
      list.map((x) => (x.id === it.id ? { ...x, voted: on, votes: Math.max(0, x.votes + (on ? 1 : -1)) } : x))
    setItems(move)
    setMine(move)
    const r = await boxVote(it.id, on)
    if (!alive.current) return
    if (!r.ok) {
      // put it back the way it was, and say why
      const back = (list: BoxItem[]): BoxItem[] => list.map((x) => (x.id === it.id ? { ...x, voted: it.voted, votes: it.votes } : x))
      setItems(back)
      setMine(back)
      setNote(r.why)
      return
    }
    const fix = (list: BoxItem[]): BoxItem[] => list.map((x) => (x.id === it.id ? { ...x, voted: r.on, votes: r.votes } : x))
    setItems(fix)
    setMine(fix)
    setNote('')
  }

  const left = max - [...text.trim()].length
  const over = left < 0

  return (
    <div className="mbx" onKeyDownCapture={(e) => {
      // Close only this disclosure, not the homepage's enclosing mailbox.
      if (e.key === 'Escape' && expanded) { e.preventDefault(); e.stopPropagation(); closeDetail() }
    }}>
      <div className="mbx-write">
        <label className="mbx-lbl" htmlFor="mbx-text">想让游戏变成什么样？一条说一件事</label>
        <textarea
          id="mbx-text"
          className="mbx-area"
          rows={3}
          value={text}
          maxLength={max * 2}
          placeholder="比如：买外设只能少受伤，能不能也加点强度？"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mbx-send">
          <span className={`tiny ${over ? 'mbx-warn' : 'faint'}`}>{over ? `超了 ${-left} 个字` : `还能写 ${left} 个字`}</span>
          <button className="sm primary" disabled={sending || over || [...text.trim()].length < 4} onClick={() => void send()}>
            {sending ? '正在发…' : '发给作者'}
          </button>
        </div>
        {/* what is kept, said where they type it — people write more when they know */}
        <p className="tiny faint mbx-priv">
          只会存下你写的这句话和一串随机的浏览器编号，别的什么都不记（不记 IP、不记你玩到哪、更没有账号）。
          作者先看过才会展示给别人，在这之前只有你自己看得见。
        </p>
        {sent && <p className={`tiny ${sent.startsWith('收到了') ? 'mbx-ok' : 'mbx-warn'} mbx-sent`}>{sent}</p>}
        {full && <p className="tiny mbx-warn mbx-sent">信箱暂时满了，作者清一清就好。先给下面的建议点个赞吧。</p>}
      </div>

      <div className="mbx-tabs" role="tablist" aria-label="信箱排行榜">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            className={`sm ${tab === t.key ? 'primary' : 'ghost'}`}
            onClick={() => { setExpanded(null); setTab(t.key) }}
          >
            {t.label}{t.key === 'mine' && mine.length ? ` ${mine.length}` : ''}
          </button>
        ))}
        <button className="sm ghost mbx-again" onClick={() => { setExpanded(null); setLoad('wait'); void read() }}>刷新</button>
      </div>

      {note && <p className="tiny mbx-warn mbx-note">{note}</p>}

      {load === 'wait' ? <p className="small muted mbx-empty">正在读作者的信箱…</p>
        : load === 'off' ? <p className="small muted mbx-empty">连不上作者的信箱，等会儿再来。游戏不受影响。</p>
          : rows.length === 0 ? (
            <p className="small muted mbx-empty">
              {tab === 'mine' ? '你还没写过。上面写一条，作者看过就会展示到榜上。' : '榜上还是空的，第一条就写给你了。'}
            </p>
          ) : (
            <div className="table-wrap">
              <table className="box mbx-table">
                <thead>
                  <tr>
                    <th className="num">#</th>
                    <th>建议</th>
                    <th className="num">赞</th>
                    <th className="num">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it, i) => (
                    <Fragment key={it.id}>
                    <tr className={it.mine ? 'mine' : ''}>
                      <td className="num muted">{tab === 'hot' ? i + 1 : '·'}</td>
                      <td className="mbx-text">
                        {/* 玩家写的字：当成字来渲染，一个标签都不解析 */}
                        <button className="mbx-preview" aria-expanded={expanded === it.id} aria-controls={expanded === it.id ? detailId : undefined}
                          onClick={(e) => {
                            if (expanded === it.id) { closeDetail(); return }
                            detailOpener.current = e.currentTarget
                            setExpanded(it.id)
                          }}>
                          <span className="mbx-excerpt">{it.text}</span>
                          <span className="mbx-read">{expanded === it.id ? '收起全文' : '查看全文'} ›</span>
                        </button>
                        <span className="mbx-when tiny faint">{day(it.t)}{it.mine ? ' · 你提的' : ''}{it.pin ? ' · 置顶' : ''}</span>
                        {it.state === 'merged' && <span className="mbx-when tiny muted">{mergeProgress(it)}</span>}
                      </td>
                      <td className="num">
                        {it.state === 'merged' ? <span className="tiny faint" title="支持票已合并至目标建议，不重复计票">已合票</span> : <button
                          className={`mbx-vote${it.voted ? ' on' : ''}`}
                          disabled={it.mine || it.state === 'pending' || it.state === 'hidden'}
                          title={it.mine ? '自己提的，已经算你一票了' : it.voted ? '取消这一票' : '赞同这条'}
                          onClick={() => void vote(it)}
                        >
                          <span aria-hidden="true">▲</span> {it.votes}
                        </button>}
                      </td>
                      <td className="num">
                        {it.mine && (it.state === 'pending' || it.state === 'hidden')
                          ? <span className={`mbx-tag s-${it.state}`}>{STATE_CN[it.state]}</span>
                          : TAG[it.state] ? <span className={`mbx-tag s-${it.state}`}>{TAG[it.state]}</span>
                            : <span className="tiny faint">—</span>}
                      </td>
                    </tr>
                    {expanded === it.id && <tr className="mbx-detail-row"><td colSpan={4}>
                      <div ref={detail} id={detailId} className="mbx-detail" role="region" aria-label="建议全文" tabIndex={-1}>
                        <div className="mbx-detail-head">
                          <strong>建议全文</strong>
                          <button className="sm ghost" onClick={closeDetail}>收起全文 ✕</button>
                        </div>
                        <p className="mbx-detail-meta">{day(it.t)} · {STATE_CN[it.state]}{it.state === 'merged' ? ' · 支持票已合并' : ` · ${it.votes} 赞`}{it.mine ? ' · 你提的' : ''}{it.pin ? ' · 置顶' : ''}</p>
                        <p className="mbx-fulltext">{it.text}</p>
                        {it.state === 'merged' && <MergeReceipt item={it} />}
                      </div>
                    </td></tr>}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

      <p className="tiny faint mbx-foot">
        一台设备一条一票，可以收回。作者照着赞多的往下改；改好了这条会写「已修复」。
        合并的建议会留在「我的」，点开可查看去向和处理进度。
        {mine.some((x) => x.state === 'pending') && ' 你有建议在等作者看，别急。'}
      </p>
    </div>
  )
}

/** 信箱, as a page of its own in a career — its own entry beside 帮助 (src/PlayerGame.tsx). */
export function MailboxScreen() {
  return (
    <Panel title="玩家信箱">
      <p className="small muted mbx-lead">
        大家想要什么都在这儿，按赞排。作者照着赞多的往下改——看到说中你的，点个赞就行。
      </p>
      <Board />
    </Panel>
  )
}

/**
 * The corner button on the home page, above 更新日志 and 支持作者 (src/App.tsx).
 * Only there: inside a career the mailbox is a page on the nav, and a phone's
 * corner already holds those two round buttons over the advance bar.
 */
export default function Mailbox() {
  const [open, setOpen] = useState(false)

  // Escape closes it, like every other panel in the game
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <button
        className={`support-fab mbx-fab${open ? ' on' : ''}`}
        onClick={() => setOpen((x) => !x)}
        aria-expanded={open}
        aria-label="玩家信箱"
        title="给作者提建议，也看看别人提了什么"
      >
        <span className="ico" aria-hidden="true">📮</span>
        <span className="lbl">玩家信箱</span>
      </button>
      {open && <MailSheet onClose={() => setOpen(false)} />}
    </>
  )
}

/** The card itself, in front of the page like the changelog's (ui/me/layer.ts). */
function MailSheet({ onClose }: { onClose: () => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  useLayer(wrap, { box: card })
  return (
    <div ref={wrap} style={{ display: 'contents' }}>
      <div className="support-veil" onClick={onClose} />
      <div ref={card} className="support-card mbx-card" role="dialog" aria-modal="true" aria-labelledby="mbx-card-t" tabIndex={-1}>
        <div className="support-head">
          <h3 id="mbx-card-t">玩家信箱</h3>
          <button className="sm ghost" onClick={onClose}>关闭 ✕</button>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          想让游戏变成什么样，写一条发给作者。大家的建议按赞排在下面，作者照着赞多的往下改。
        </p>
        <Board />
      </div>
    </div>
  )
}
