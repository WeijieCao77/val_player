import { useMemo, useState } from 'react'
import { REGION_CN } from '../../engine/types'
import type { GameState, Region } from '../../engine/types'
import { useGame } from '../ctx'
import { Panel } from '../common'
import { ACHIEVEMENTS, ACH_ROUTES } from '../../engine/me/achievements'
import { compCn } from '../../engine/me/compname'
import { HALL_ORIGINS, originOf } from '../../engine/me/origins'
import {
  HALL_ORIGIN_NEEDS, MILESTONES, MILESTONE_BY_KEY, START_SHORT, exportHall, hallAchCount, hallRecords, hallTitle,
  importHall, isIntlClass, milestoneDone, originUnlocked, peekCareerId, readHall,
} from '../../engine/me/hall'
import type { HallCard, HallRecord } from '../../engine/me/hall'
import { attrWord, useNumbers } from './words'
import './hall.css'

/** Inside the career: 成就 → 成就殿堂, and back. */
export default function HallPage() {
  const { game, go } = useGame()
  return <HallView game={game} onBack={() => go('awards')} />
}

/** the newest careers shown before 「全部」 */
const CARDS_SHOWN = 8

const recValue = (r: HallRecord, nums: boolean): string =>
  r.key === 'titles' || r.key === 'intl' ? `${r.n} 座`
    : r.key === 'seasons' ? `${r.n} 季`
      : r.key === 'mvps' ? `${r.n} 次`
        : r.key === 'peak' && !nums ? attrWord(r.n)
          : String(r.n)

/**
 * The hall, the same page from the front door and from inside a career. With a
 * career open, its own card and its own unlocks are marked; from the front door
 * there is none. Locked things stay on the page, greyed, saying what opens them.
 */
export function HallView({ game, onBack }: { game?: GameState | null; onBack: () => void }) {
  const [tick, setTick] = useState(0)
  const [all, setAll] = useState(false)
  const [paste, setPaste] = useState('')
  const [msg, setMsg] = useState('')
  const [nums] = useNumbers()
  // read again after a merge
  const h = useMemo(() => readHall(), [tick])
  const text = useMemo(() => (h ? exportHall() ?? '' : ''), [h])
  const mineId = game?.me ? peekCareerId(game) : ''
  const mine = new Set(game?.me?.achievements ?? [])
  const title = hallTitle(h)

  const head = (
    <div className="hall-head">
      <button className="sm ghost" onClick={onBack}>← 返回</button>
      <h2>成就殿堂</h2>
      {title && <span className="tag win" title="殿堂称号">{title}</span>}
    </div>
  )
  if (!h) {
    return (
      <div className="hall-page">
        {head}
        <p className="small muted">这个浏览器存不下殿堂（隐私模式，或者关掉了网站存储）。生涯照常进行，只是不会被记下来。</p>
      </div>
    )
  }

  const achN = hallAchCount(h)
  const hxN = MILESTONES.filter((m) => h.hx[m.key]).length
  const cards = [...h.cards].reverse()
  const recs = hallRecords(h)
  const merge = () => {
    const r = importHall(paste.trim())
    setMsg(r === 'ok' ? '合并好了。' : r === 'bad' ? '这段不是殿堂。' : '这个浏览器存不下。')
    if (r === 'ok') { setPaste(''); setTick((t) => t + 1) }
  }

  return (
    <div className="hall-page">
      {head}
      <div className="hall-sum">
        <div><b>{h.cards.length}</b><small>打完的生涯</small></div>
        <div><b>{achN}<em>/{ACHIEVEMENTS.length}</em></b><small>成就</small></div>
        <div><b>{hxN}<em>/{MILESTONES.length}</em></b><small>殿堂成就</small></div>
      </div>
      <p className="tiny faint hall-note">记在这台设备上，开新生涯不会清。殿堂只给称号和出身卡，不加任何数值。</p>

      <Panel title="殿堂成就">
        {MILESTONES.map((m) => {
          const mark = h.hx[m.key]
          const parts = m.parts(h.cards)
          const apart = !mark && parts.every((p) => p.ok) && !milestoneDone(m, h.cards)
          return (
            <div key={m.key} className={`hall-row${mark ? ' got' : ' locked'}`}>
              <span className="mark">{mark ? '★' : '☆'}</span>
              <div>
                <b>{m.name}</b><span className="tiny muted desc">{m.desc}</span>
                <div className="parts">
                  {mark
                    ? <span className="tiny won">{mark.who} · {mark.year} 凑齐</span>
                    : parts.map((p) => <span key={p.label} className={`part${p.ok ? ' ok' : ''}`}>{p.label}</span>)}
                  {apart && <span className="tiny faint">要分在两局</span>}
                </div>
              </div>
            </div>
          )
        })}
      </Panel>

      <Panel title="纪录">
        {recs.length ? (
          <div className="hall-recs">
            {recs.map((r) => (
              <div key={r.key}>
                <small>{r.label}</small>
                <b>{recValue(r, nums)}</b>
                <span className="tiny faint who">{r.card.name} · {r.year}</span>
              </div>
            ))}
          </div>
        ) : <p className="tiny faint" style={{ margin: 0 }}>打完第一局生涯，这里开始有纪录。</p>}
      </Panel>

      {cards.length > 0 && (
        <Panel title={`生涯 · ${cards.length}`}>
          <div className="hall-cards">
            {(all ? cards : cards.slice(0, CARDS_SHOWN)).map((c) => <CareerCard key={c.id} c={c} mine={c.id === mineId} />)}
          </div>
          {!all && cards.length > CARDS_SHOWN && (
            <button className="sm ghost" style={{ marginTop: 8 }} onClick={() => setAll(true)}>全部 {cards.length} 局</button>
          )}
        </Panel>
      )}

      <Panel title="出身卡">
        {HALL_ORIGINS.map((o) => {
          const ok = originUnlocked(h, o.key)
          return (
            <div key={o.key} className={`hall-row${ok ? ' got' : ' locked'}`}>
              <span className="mark">{ok ? '◆' : '◇'}</span>
              <div><b>{o.name}</b><span className="tiny muted desc">{ok ? '开新生涯时可选' : HALL_ORIGIN_NEEDS[o.key]?.need}</span></div>
            </div>
          )
        })}
      </Panel>

      <Panel title={`成就 · ${achN}/${ACHIEVEMENTS.length}`}>
        {ACH_ROUTES.map((r) => {
          const rows = ACHIEVEMENTS.filter((a) => a.route === r.key)
          const done = rows.filter((a) => h.ach[a.key]).length
          return (
            <details key={r.key} className="hall-route">
              <summary>{r.name}<em>{done}/{rows.length}</em></summary>
              {rows.map((a) => {
                const rec = h.ach[a.key]
                const here = mine.has(a.key)
                const hide = !!a.secret && !rec && !here
                return (
                  <div key={a.key} className={`hall-ach${rec || here ? ' got' : ''}`}>
                    <b>{hide ? '???' : a.name}</b>
                    <span className="tiny faint">
                      {rec
                        ? `${rec.first.who} · ${rec.first.year}${rec.n > 1 ? ` · ${rec.n} 局` : ''}${here ? ' · 本局有' : ''}`
                        : here ? '本局有' : hide ? '撞上才知道' : a.desc}
                    </span>
                  </div>
                )
              })}
            </details>
          )
        })}
      </Panel>

      <details className="hall-move">
        <summary>换设备</summary>
        <p className="tiny faint">第一段是这台设备的殿堂；把另一台设备的那段粘进第二格合并，两边只增不减。</p>
        <textarea readOnly rows={2} value={text} onFocus={(e) => e.currentTarget.select()} aria-label="这台设备的殿堂" />
        <textarea rows={2} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="粘贴另一台设备的殿堂" />
        <div className="row" style={{ gap: 8 }}>
          <button className="sm" disabled={!paste.trim()} onClick={merge}>合并</button>
          {msg && <span className="tiny muted">{msg}</span>}
        </div>
      </details>
    </div>
  )
}

function CareerCard({ c, mine }: { c: HallCard; mine: boolean }) {
  const trophies = [...c.titles].sort((a, b) =>
    Number(isIntlClass(b.cls)) - Number(isIntlClass(a.cls)) || Number(b.started) - Number(a.started) || a.year - b.year)
  const shown = trophies.slice(0, 6)
  const hx = (c.hx ?? []).map((k) => MILESTONE_BY_KEY[k]?.name).filter(Boolean)
  return (
    <div className={`hall-card${mine ? ' mine' : ''}`}>
      <div className="hc-top">
        <b>{c.name || '无名'}</b>
        <span className="hc-end">{c.ending.title}</span>
        {mine && <span className="tag">本局</span>}
      </div>
      <div className="tiny muted">{REGION_CN[c.home as Region] ?? c.home} · {c.role} · {c.entry} {START_SHORT[c.start]}开局 · {originOf(c.origin).name}</div>
      <div className="tiny muted hc-clubs">
        {c.from}–{c.to}{c.seasons ? ` · ${c.seasons} 季` : ' · 没打上职业'}{c.clubs.length ? ` · ${c.clubs.join(' → ')}` : ''}
      </div>
      {shown.length > 0 && (
        <div className="hc-wall">
          {shown.map((t, i) => {
            // 「2029 全球冠军赛」 carries its year already
            const n = compCn(t.name)
            return <span key={i} className={`hc-t${isIntlClass(t.cls) ? ' intl' : ''}${t.started ? '' : ' ring'}`}>{n.includes(String(t.year)) ? n : `${t.year} ${n}`}</span>
          })}
          {trophies.length > shown.length && <span className="tiny faint">+{trophies.length - shown.length}</span>}
        </div>
      )}
      {c.best && (
        <div className="tiny faint">最好的一季 {c.best.year} · {c.best.team}{c.best.titles ? ` · ${c.best.titles} 冠` : ''}{c.best.acs ? ` · ACS ${c.best.acs}` : ''}</div>
      )}
      {hx.length > 0 && <div className="tiny hc-hx">殿堂 · 凑齐「{hx.join('」「')}」</div>}
    </div>
  )
}

/** Under the twelve on the new-career page: the hall's two, greyed with what opens them until the hall has it. */
export function HallOrigins({ pick, onPick }: { pick: string; onPick: (key: string) => void }) {
  const h = useMemo(() => readHall(), [])
  return (
    <div className="hall-origins">
      <div className="tiny faint" style={{ marginBottom: 6 }}>成就殿堂解锁</div>
      <div className="origin-grid">
        {HALL_ORIGINS.map((o) => {
          const ok = originUnlocked(h, o.key)
          return (
            <button key={o.key} className={`origin-pick${pick === o.key ? ' on' : ''}${ok ? '' : ' locked'}`} disabled={!ok} onClick={() => onPick(o.key)}>
              <b>{o.name}</b>
              <span>{ok ? o.blurb : HALL_ORIGIN_NEEDS[o.key]?.need}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
