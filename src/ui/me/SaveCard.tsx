import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import type { AutosaveInfo } from '../../engine/me/saveInfo'
import type { SaveMeta } from '../../engine/me/saveMeta'
import { fanTier, fansCn } from '../../engine/me/fans'
import { compCn } from '../../engine/me/compname'
import { ACHIEVEMENTS } from '../../engine/me/achievements'
import { formatOf } from '../../engine/era'
import { Crest, money } from './common'
import { toCny } from '../../engine/me/currency'
import { attrWord, useNumbers } from './words'
import { useLayer } from './layer'

/**
 * A career's card on the home page, drawn from its summary (engine/me/saveMeta.ts) and never from the save itself:
 * 上次的存档, and a backup's career before 导入存档 takes it in (ui/me/Backup.tsx). Moved here from NewCareer.tsx so
 * both draw the same card.
 */

const pad = (n: number) => String(n).padStart(2, '0')
/** When, on this device's clock: how long ago, and the day and time — 「3 小时前 · 9月18日 13:02」. */
export function playedAt(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const m = Math.max(0, Math.round((now.getTime() - at) / 60000))
  const ago = m < 1 ? '刚刚' : m < 60 ? `${m} 分钟前` : m < 1440 ? `${Math.round(m / 60)} 小时前` : `${Math.round(m / 1440)} 天前`
  const day = `${d.getFullYear() !== now.getFullYear() ? `${d.getFullYear()}年` : ''}${d.getMonth() + 1}月${d.getDate()}日`
  return `${ago} · ${day} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
/** A season day as the game writes the date (engine/season.ts dateLabel), for a save known only by its day. */
const dayLabel = (year: number, day: number): string => {
  const d = new Date(Date.UTC(year, 0, 1))
  d.setUTCDate(d.getUTCDate() + day)
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}
/** the hero's words for a tier (PlayerGame): 一线 / 二线 before the leagues, VCT / 挑战者联赛 after */
const tierCn = (year: number, tier: 1 | 2): string =>
  (formatOf(year) === 'open' ? (tier === 1 ? '一线' : '二线') : tier === 1 ? 'VCT' : '挑战者联赛')
const SEAT_CN = { starter: '首发', bench: '替补', trial: '试用中' } as const
const RESULT_CN = { W: '胜', L: '负', D: '平' } as const
/** the summary already names the crest to draw; nothing to look up on a page with no game */
const NO_HEIRS: Record<string, string> = {}

function SaveWho({ meta }: { meta: SaveMeta }) {
  const c = meta.club
  return (
    <div className="save-id">
      <div className="save-who"><b>{meta.ign}</b><span className="muted">{meta.role} · {meta.age} 岁</span></div>
      <div className="save-club">
        {c ? (
          <>
            <Crest id={c.crest} size={20} heirs={NO_HEIRS} />
            <b>{c.name}</b>
            <span className={`tag${c.tier === 1 ? ' t1' : ''}`}>{c.league || tierCn(meta.year, c.tier)}</span>
            <span className="muted">{SEAT_CN[c.seat]}</span>
          </>
        ) : (
          <b>{meta.phase === 'retired' ? `已退役${meta.ending ? ` · ${meta.ending}` : ''}` : meta.phase === 'free' ? '自由人' : `天梯 · ${meta.ladder || '没有队伍'}`}</b>
        )}
      </div>
      <div className="save-when"><b>{meta.stage}</b><span className="muted">{meta.date}</span></div>
    </div>
  )
}

/**
 * The career, laid out like 破晓's cover card (its save.ts continueCard,
 * theme.css .savecont): who and where on the left with the buttons, the
 * numbers on the right; on a phone the essentials first, the buttons, then the rest.
 */
export function SaveCard({ label, at, info, hallNow, go }: {
  /** 上次的存档, 备份里的存档 */
  label: string
  /** when the save was written (or the backup made), in words (playedAt); null when not known */
  at: string | null
  info: AutosaveInfo
  /** the hall's count on the 成就 tile; null leaves it off */
  hallNow: number | null
  /** the buttons, and what they say under them */
  go: ReactNode
}) {
  const [nums] = useNumbers()
  const meta = info.meta
  const last = meta?.last
  return (
    <section className="save-card" aria-label={label}>
      <div className="save-head">
        <h2>{label}</h2>
        {at && <span className="save-at">{at}</span>}
      </div>
      <div className="save-grid">
        {meta ? <SaveWho meta={meta} /> : (
          <div className="save-id">
            <div className="save-who"><b>上次的生涯</b></div>
            <div className="save-when">
              {info.year !== null && info.day !== null && <b>{dayLabel(info.year, info.day)}</b>}
              <span className="muted">旧版本存下的档，继续一次之后这里会写出详细数据。</span>
            </div>
          </div>
        )}
        {meta && (
          <div className="save-key save-tiles">
            <div className="save-tile"><small>综合</small><b>{nums ? meta.overall : attrWord(meta.overall)}</b></div>
            <div className="save-tile wide">
              <small>上一场</small>
              {last ? (
                <>
                  <b><span className={last.result === 'W' ? 'w' : last.result === 'L' ? 'l' : ''}>{RESULT_CN[last.result]} {last.score}</span> vs {last.oppTag || last.opp}</b>
                  <em>{compCn(last.event)}{last.started ? '' : ' · 没出场'}</em>
                </>
              ) : <b className="muted">还没打过比赛</b>}
            </div>
          </div>
        )}
        <div className="save-go">{go}</div>
        {meta && (
          <div className="save-more save-tiles">
            <div className="save-tile"><small>冠军</small><b>{meta.titles}</b>{meta.intl > 0 && <em>国际赛 {meta.intl}</em>}</div>
            <div className="save-tile"><small>粉丝</small><b>{fanTier(meta.fans).name}</b><em>{fansCn(meta.fans)}</em></div>
            <div className="save-tile"><small>资金</small><b>{money(meta.cny ? meta.money : toCny(meta.money, 'USD', meta.year))}</b></div>
            <div className="save-tile"><small>成就</small><b>本局 {meta.ach}</b>{hallNow !== null && <em>殿堂 {hallNow}/{ACHIEVEMENTS.length}</em>}</div>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 破晓 asks before 重新开一局 overwrites the save (its main.ts askConfirm on #savenew); so does this, once — before a
 * new career, and before a backup is taken in over the save (导入存档).
 */
export function ConfirmCard({ title, body, ok, onOk, onCancel }: {
  title: string
  body: string
  /** the button that goes ahead */
  ok: string
  onOk: () => void
  onCancel: () => void
}) {
  // a card in front of the page like the career's own (layer.ts): 取消 has the focus — said to the layer, not only by
  // autoFocus, which the layer's own mount would otherwise leave behind — and Tab stays on the two buttons
  const bg = useRef<HTMLDivElement>(null)
  const no = useRef<HTMLButtonElement>(null)
  useLayer(bg, { first: () => no.current })
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onCancel])
  return (
    <div className="modal-bg nc-confirm" ref={bg} onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="nc-confirm-t" aria-describedby="nc-confirm-d" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body">
          <div className="nc-confirm-eyebrow">请确认</div>
          <h3 id="nc-confirm-t">{title}</h3>
          <p id="nc-confirm-d">{body}</p>
          <div className="row">
            <button className="primary" onClick={onOk}>{ok}</button>
            <button ref={no} autoFocus onClick={onCancel}>取消</button>
          </div>
        </div>
      </div>
    </div>
  )
}
