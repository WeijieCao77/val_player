import { useGame } from './ctx'
import { fansCn, fanTier } from '../../engine/me/fans'
import { traitOf } from '../../engine/me/traits'
import { bondCardLines } from '../../engine/me/bond'
import { compCn } from '../../engine/me/compname'
import { hallLine } from '../../engine/me/hall'

/** The career on one card, made to be screenshotted. */
export default function Poster() {
  const { game } = useGame()
  const me = game.me!
  const p = game.players[me.id]
  const starts = me.seasons.reduce((s, x) => s + x.starts, 0)
  const matches = me.seasons.reduce((s, x) => s + x.matches, 0)
  const wins = me.seasons.reduce((s, x) => s + x.wins, 0)
  const clubs = Array.from(new Set((p.clubHist ?? []).map((h) => game.teams[h.team]?.tag ?? h.team)))
  const titles = me.titles.slice().sort((a, b) => {
    const w = (t: string) => /Champions/.test(t) ? 3 : /Masters/.test(t) ? 2 : 1
    return w(b.title) - w(a.title) || a.year - b.year
  })
  return (
    <div className="poster-me">
      <div className="eyebrow">{p.ign} · {p.role} · {me.seasons[0]?.year ?? game.year}–{game.year}</div>
      <h1>{me.ending?.title ?? '生涯'}</h1>
      <p className="txt">{me.ending?.text}</p>
      <div className="wall">
        {titles.length ? titles.map((t, i) => (
          <span key={i} className={`trophy ${/Champions/.test(t.title) ? 'c' : /Masters/.test(t.title) ? 'm' : 'r'}${t.started ? '' : ' ring'}`}>
            {t.year} {compCn(t.title)}{t.started ? '' : '（随队）'}
          </span>
        )) : <span className="faint">没有奖杯</span>}
      </div>
      <table className="years">
        <tbody>
          {me.seasons.map((s) => (
            <tr key={s.year}>
              <td>{s.year}</td><td>{s.team}</td><td className="num">{s.tier ? `${s.starts}/${s.matches}` : `天梯 ${Math.round(me.pre.ladderPeak)}`}</td>
              <td className="num">{s.acs || ''}</td><td className="num">{s.overallTo}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="nums">
        <div><b>{starts}</b><span>首发场次 / {matches}</span></div>
        <div><b>{wins}</b><span>首发胜场</span></div>
        <div><b>{p.overall}</b><span>最终综合</span></div>
        <div><b>{fansCn(me.fans)}</b><span>粉丝 · {fanTier(me.fans).name}</span></div>
        <div><b>{clubs.length}</b><span>效力俱乐部 · {clubs.join(' ')}</span></div>
      </div>
      {/* the people, by name — the ledger exists so this line is not "your teammates" */}
      {(() => {
        const lines = bondCardLines(game)
        return lines.length ? <div className="mates">{lines.map((l, i) => <p key={i}>{l}</p>)}</div> : null
      })()}
      <div className="sig">{me.traits.map((k) => traitOf(k)?.name).filter(Boolean).join(' · ') || '没有形成特质'} · 成就 {me.achievements.length} · 事件 {me.eventsSeen}</div>
      {/* the 成就殿堂's line: what this career completed there, or the hall's 称号 (me/hall.ts) */}
      {(() => { const l = hallLine(game); return l ? <div className="hall-sig">{l}</div> : null })()}
    </div>
  )
}
