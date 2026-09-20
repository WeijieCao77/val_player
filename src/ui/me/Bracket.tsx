import { useGame } from './ctx'
import { Crest, fmtDay } from './common'
import { CARD_H, CARD_W, circuitTrees, layoutTree, legacyTrees } from './bracketModel'
import type { TreeSection } from './bracketModel'
import type { Competition } from '../../engine/types'

/** Career-owned renderer. Only the scheduling engine supplies pairings and progression edges. */
export default function Bracket({ comp }: { comp: Competition }) {
  const { game } = useGame()
  const sections = comp.circuit ? circuitTrees(game, comp) : legacyTrees(game, comp)
  if (!sections.length) return null
  return <details className="career-brackets" open={comp.circuit ? !!comp.circuit.mode && !comp.champion : !comp.champion}>
    <summary className="career-bracket-toggle">对阵图 · {comp.champion ? '已结束' : comp.circuit && !comp.circuit.mode ? '赛前签表' : '赛程与晋级路线'}（点击展开/收起）</summary>
    <p className="small muted career-bracket-help">对阵图 · 可左右滑动。实线为胜者去向，虚线为败者去向；未确定的队伍显示待定。</p>
    {sections.map(s => <details key={s.id} open={s.tree} className="career-bracket-section">
      <summary>{s.title} · {s.tree ? '晋级路线' : '轮次对阵'}（{s.matches.length} 场）</summary>
      {!s.tree && <p className="small muted">循环赛/瑞士轮按轮次展示，不连淘汰线；后续配对以实际抽签为准。</p>}
      <MatchTree section={s} />
    </details>)}
  </details>
}

export function MatchTree({ section }: { section: TreeSection }) {
  const { game, openMatch } = useGame()
  const layout = layoutTree(section)
  return <div className="career-bracket-scroll" tabIndex={0} role="region" aria-label={`${section.title}对阵图，可横向滚动`}>
    <div className="career-bracket-canvas" style={{ width: layout.width, height: layout.height }}>
      <svg width={layout.width} height={layout.height} aria-hidden="true" className="career-bracket-links">
        {section.matches.flatMap(m => m.sides.map((s, k) => {
          const a = s.from && layout.positions.get(s.from), b = layout.positions.get(m.id)
          if (!a || !b || a.x >= b.x) return null
          const x = a.x + CARD_W, y = a.y + CARD_H / 2, end = b.y + 52 + k * 30
          const mid = b.x - 26 - k * 9
          return <path key={`${m.id}:${k}`} data-outcome={s.outcome} className={s.outcome === 'l' ? 'loss' : ''}
            d={`M${x},${y} H${mid} V${end} H${b.x}`} />
        }))}
      </svg>
      {section.matches.map((m, index) => {
        const pos = layout.positions.get(m.id)!
        const clickable = !!m.fixture?.result
        return <button key={m.id} type="button" disabled={!clickable} onClick={() => m.fixture?.result && openMatch(m.fixture)}
          className={`career-bracket-match${m.sides.some(s => s.id === game.myTeam) ? ' own' : ''}`}
          style={{ left: pos.x, top: pos.y, width: CARD_W, height: CARD_H }}
          aria-label={`${m.round} 第 ${index + 1} 场${clickable ? '，查看赛报' : ''}`}>
          <span className="career-bracket-round" title={m.round}>#{index + 1} · {m.round}</span>
          {m.sides.map((s, i) => {
            const team = s.id ? game.teams[s.id] : undefined
            const name = team?.tag ?? s.name ?? (s.id === null ? '空缺 / 轮空' : '待定')
            return <span key={i} className={`career-bracket-side${s.id && s.id === m.winner ? ' win' : ''}`} title={`${team?.name ?? name} · ${s.source}`}>
              {team && <Crest id={team.id} size={15} />}<span className="career-bracket-name">{name}</span>
              <b>{m.scores?.[i] ?? '–'}</b>
              {!s.id && <small>{s.source}</small>}
            </span>
          })}
          <span className="career-bracket-time">{m.walk ? '轮空 / 无对手' : m.scores ? '已结束' : m.day != null ? fmtDay(m.day, game.year) : '日期待定'} · BO{m.bo}{clickable ? ' · 赛报 ↗' : ''}</span>
        </button>
      })}
    </div>
  </div>
}
