import { compCn } from '../../engine/me/compname'
import { careerLine, careerRewrites, partLine, retitledLine } from '../../engine/me/rewrites'
import type { MeRewrite, MeSeason } from '../../engine/me/types'
import './worldline.css'

/**
 * 「我改写了历史」 on the career's pages (the author's brief of 2026-09-18): what the seasons' rows kept of the
 * ledger (engine/me/worldline.ts), as a broadcast lower third in the 转播红 of the moment cards. Nothing is drawn
 * where nothing was kept — a season from before the ledger has no block at all, never a 「暂无」.
 */

/** The season card's block: its heaviest few, each with the event, what came out otherwise, and my part in it. */
export function SeasonRewrites({ rows }: { rows: MeRewrite[] }) {
  if (!rows.length) return null
  return (
    <section className="wl" aria-label="这个赛季改写的历史">
      <p className="wl-tag">这个赛季改写的历史</p>
      <div className="wl-body">
        {rows.map((r, i) => {
          const part = partLine(r)
          return (
            <div key={i} className="wl-row">
              <b className="wl-ev">{compCn(r.comp)}</b>
              {r.lines.map((l, j) => <p key={j} className="wl-l">{l}</p>)}
              {part && <p className="wl-you">{part}</p>}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * The career's block — the ending's card and the 生涯 table: how many trophies this world line took from their
 * real owners, and the heaviest rewrite I started in (else the heaviest I was on the roster for, said as such).
 */
export function CareerRewrites({ seasons, className }: { seasons: MeSeason[]; className?: string }) {
  const c = careerRewrites({ seasons })
  if (!c) return null
  // under the 「你的世界线」 strip: 「改写了 N 座奖杯的归属」
  const count = retitledLine(c, true)
  return (
    <section className={`wl wl-career${className ? ` ${className}` : ''}`} aria-label="你的世界线">
      <p className="wl-tag">你的世界线</p>
      <div className="wl-body">
        {count && <p className="wl-big">{count}</p>}
        {c.top && <p className="wl-l">{careerLine(c.top)}</p>}
      </div>
    </section>
  )
}
