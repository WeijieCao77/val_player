import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useGame } from './ctx'
import { useNumbers, attrWord } from './words'
import { Modal, Crest } from './common'
import { rosterOf } from './teamRead'
import { REGION_CN } from '../../engine/types'
import { CLUB_TIER_CN } from '../../engine/me/prepro'

/** Read-only card: local UI state, no commit, roster repair or recruitment. */
export default function TeamPeekButton({ id, label }: { id: string; label?: string }) {
  const { game } = useGame()
  const [nums] = useNumbers()
  const [open, setOpen] = useState(false)
  const team = game.teams[id]
  const name = team?.name ?? label ?? '未知俱乐部'
  // Do not scan every team's roster until its card is actually opened.
  const roster = open ? rosterOf(game, id) : []
  const groups = team ? [
    { title: '首发名单', ids: roster.filter(pid => team.starters.includes(pid)) },
    { title: '替补名单', ids: roster.filter(pid => !team.starters.includes(pid)) },
  ] : []
  return (
    <>
      <button type="button" className="team-peek-trigger" title={`查看${name}阵容`}
        onClick={e => { e.stopPropagation(); setOpen(true) }}>
        {label ?? name}
      </button>
      {open && createPortal(
        // Portal events still bubble through React's table-row ancestors.
        <div onClick={e => e.stopPropagation()}>
          <Modal title={<span className="team-peek-title">{team && <Crest id={id} size={24} />}<span>{name} · 阵容</span></span>}
            onClose={() => setOpen(false)}>
            <div className="team-peek-body">
              {!team ? <p className="muted">当前存档没有这家俱乐部的资料。</p> : <>
                <p className="team-peek-meta">{team.tag} · {REGION_CN[team.region] ?? team.region} · {team.tier === 1 ? '一级联赛' : '次级联赛'} · {CLUB_TIER_CN(team)} · {game.year} 赛季</p>
                {team.dormant && <p className="team-peek-dormant">该俱乐部本赛季没有参赛记录，不代表可以签约。</p>}
                <p className="team-peek-notice">这是当前存档的阵容，不是历史比赛出场名单。只读查看，不消耗行动点；能否签约仍以转会页面的条件为准。</p>
                {groups.map(group => <section className="team-peek-section" key={group.title} aria-label={group.title}>
                  <h4>{group.title} · {group.ids.length} 人</h4>
                  {!group.ids.length ? <p className="small muted">暂无有效名单。</p> : <ul className="team-peek-roster">
                    {group.ids.map(pid => {
                      const p = game.players[pid]
                      return <li key={pid} data-player={pid}>
                        <span className="team-peek-name" title={p.ign}>{p.ign}</span>
                        <span className="team-peek-role">{p.role}</span>
                        <span className="team-peek-ability" aria-label="综合能力">{nums ? Math.round(p.overall) : attrWord(p.overall)}</span>
                      </li>
                    })}
                  </ul>}
                </section>)}
              </>}
            </div>
          </Modal>
        </div>, document.querySelector('.app.career') ?? document.body,
      )}
    </>
  )
}

export function TeamSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const id = useId()
  return <div className="team-search">
    <label htmlFor={id} className="tiny muted">{label}</label>
    <input id={id} type="search" value={value} onChange={e => onChange(e.target.value)} placeholder="队名或缩写，支持中文" autoComplete="off" />
    {value && <button type="button" className="sm" onClick={() => onChange('')}>清除</button>}
  </div>
}
