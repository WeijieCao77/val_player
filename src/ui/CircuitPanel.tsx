import { useGame } from './ctx'
import { Crest, Panel, fmtDay } from './common'
import { eventOf, realPlacesOf, realResultOf } from '../engine/circuit'
import { REGION_CN } from '../engine/types'
import type { Competition, Region } from '../engine/types'

/**
 * One real 2021–2022 event on the standings page.
 *
 * The author's world-line rule is only worth having if the player can see it
 * working, so the panel says which of the two things the event is: played
 * (and why — his club is in it, it is his region's, or a result upstream
 * changed who got in) or replayed as it really went. A played event quotes
 * history beside every result and under its final placings; a replayed one
 * says plainly that it is out of reach.
 */

/** Which region tabs an event shows under: its region, the regions its layer draws on, or every tab. */
export function circuitShows(comp: Competition, region: string): boolean {
  const ev = comp.circuit && eventOf(comp.circuit.id)
  if (!ev) return false
  if (ev.layer) return ev.layer.includes(region)
  return !ev.region || ev.region === region
}

const WHY: Record<string, string> = { mine: '你们在打', home: '本赛区 · 模拟', ripple: '名额被改写 · 模拟' }

export default function CircuitPanel({ comp }: { comp: Competition }) {
  const { game, openMatch } = useGame()
  const c = comp.circuit!
  const ev = eventOf(c.id)
  const fixtures = game.fixtures.filter((f) => f.comp === comp.key).sort((a, b) => a.day - b.day)
  const scope = ev?.layer
    ? ev.layer.map((r) => REGION_CN[r as Region] ?? r).join('、')
    : ev?.region ? REGION_CN[ev.region as Region] ?? ev.region : '国际赛事'
  const badge = !c.mode ? `${fmtDay(c.start, game.year)} 开打` : c.mode === 'history' ? '照真实历史' : WHY[c.why ?? 'home']
  const champName = comp.champion ? game.teams[comp.champion]?.name : undefined
  const realChamp = realPlacesOf(comp).find((r) => r.place === 1)?.name

  return (
    <Panel
      title={`${comp.name}${champName ? ` · 冠军 ${champName}` : ''}`}
      actions={<span className={`tag${c.why === 'mine' ? ' t1' : ''}`}>{badge}</span>}
      flush
    >
      <div className="small" style={{ padding: '9px 13px' }}>
        <div className="tiny muted">{fmtDay(c.start, game.year)} – {fmtDay(c.end, game.year)} · {scope}{ev ? ` · ${ev.name}` : ''}</div>
        {!c.mode && (
          <p className="muted" style={{ margin: '6px 0 0' }}>名单开打前一天才定：上游赛事的名次、谁报了海选，都会改变它。</p>
        )}
        {c.mode === 'history' && (
          <p className="muted" style={{ margin: '6px 0 0' }}>
            你够不着这里，这场照真实历史进行{comp.champion || c.done ? '。' : `，${fmtDay(c.end, game.year)} 出结果。`}
          </p>
        )}
        {c.done && (
          <p className="muted" style={{ margin: '6px 0 0' }}>参赛的都是这一年才成立的俱乐部，这个世界里还没有它们，所以没有名次可记。</p>
        )}
        {!!c.swaps?.length && (
          <p style={{ margin: '6px 0 0' }}>
            和真实历史不一样的名额：
            {c.swaps.map((s, i) => (
              <span key={i}>
                {i ? '；' : ''}<b>{game.teams[s.now ?? '']?.name ?? '空缺'}</b> 拿走了原本属于 {ev?.names[s.real] ?? s.real} 的位置
                （{s.from.startsWith('pool:') ? `${s.from.slice(5)} 赛区积分排名变了` : `${game.comps[s.from]?.name ?? '上一站'} 的名次变了`}）
              </span>
            ))}
          </p>
        )}
      </div>
      {fixtures.length > 0 && (
        <div className="table-wrap">
          <table>
            <tbody>
              {fixtures.map((f) => {
                const r = f.result
                const aWon = r && r.mapsWonA > r.mapsWonB
                const line = f.played ? realResultOf(game, comp, f)?.line : undefined
                const mine = f.teamA === game.myTeam || f.teamB === game.myTeam
                return (
                  <tr key={f.id} className={`${mine ? 'me' : ''} ${f.played ? 'clickable' : ''}`} onClick={() => f.played && openMatch(f)}>
                    <td className="num muted mono">{fmtDay(f.day, game.year)}</td>
                    <td className="small muted">
                      {f.label.replace(/^KO:-?\d+:/, '')}
                      {line && <div className="tiny faint">{line}</div>}
                    </td>
                    <td style={{ textAlign: 'right' }} className={r && aWon ? 'pos' : ''} title={game.teams[f.teamA]?.name}>
                      <span className="club" style={{ justifyContent: 'flex-end' }}><span>{game.teams[f.teamA]?.tag}</span><Crest id={f.teamA} /></span>
                    </td>
                    <td className="center mono">{r ? <b>{r.mapsWonA} : {r.mapsWonB}</b> : <span className="muted">BO{f.bo}</span>}</td>
                    <td className={r && !aWon && r.mapsWonA !== r.mapsWonB ? 'pos' : ''} title={game.teams[f.teamB]?.name}>
                      <span className="club"><Crest id={f.teamB} /><span>{game.teams[f.teamB]?.tag}</span></span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {comp.champion && (
        <div className="small" style={{ padding: '9px 13px', borderTop: '1px solid var(--line)' }}>
          <div className="nav-group" style={{ padding: '0 0 6px' }}>最终名次</div>
          {comp.finished.slice(0, 8).map((id, i) => (
            <span key={id} className="tag" style={{ marginRight: 6, marginBottom: 4, display: 'inline-block' }}>
              {comp.places?.[i] ?? i + 1}. {game.teams[id]?.name}
            </span>
          ))}
          {c.mode === 'sim' && realChamp && realChamp !== champName && (
            <p className="tiny faint" style={{ margin: '6px 0 0' }}>真实历史里的冠军是 {realChamp}。在你的世界线里，是 {champName}。</p>
          )}
        </div>
      )}
    </Panel>
  )
}
