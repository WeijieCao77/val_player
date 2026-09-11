import { useGame } from '../ctx'
import { Panel } from '../common'
import { ACHIEVEMENTS } from '../../engine/me/achievements'
import { ENDINGS_ME } from '../../engine/me/endings'

export default function AchievementsScreen() {
  const { game } = useGame()
  const me = game.me!
  const groups = Array.from(new Set(ACHIEVEMENTS.map((a) => a.group)))
  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)' }}>
      <Panel title={`成就 · ${me.achievements.length}/${ACHIEVEMENTS.length}`}>
        {groups.map((g) => (
          <div key={g} style={{ marginBottom: 10 }}>
            <div className="tiny muted" style={{ marginBottom: 4 }}>{g}</div>
            <div className="row wrap" style={{ gap: 6 }}>
              {ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
                const got = me.achievements.includes(a.key)
                return (
                  <span key={a.key} className={`tag${got ? ' win' : ''}`} title={got || !a.secret ? a.desc : '???'} style={{ opacity: got ? 1 : 0.5 }}>
                    {got || !a.secret ? a.name : '???'}
                  </span>
                )
              })}
            </div>
          </div>
        ))}
      </Panel>
      <Panel title="结局">
        <p className="tiny faint" style={{ marginTop: 0 }}>退役时判定，第一个成立的就是你的结局。</p>
        {ENDINGS_ME.map((e) => (
          <div key={e.key} className="small" style={{ padding: '4px 0', borderBottom: '1px solid var(--line-soft)', opacity: me.ending?.key === e.key ? 1 : 0.7 }}>
            <b>{e.title}</b>{me.ending?.key === e.key ? <span className="tag win" style={{ marginLeft: 6 }}>你的结局</span> : null}
          </div>
        ))}
      </Panel>
    </div>
  )
}
