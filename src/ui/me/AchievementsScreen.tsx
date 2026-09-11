import { useGame } from '../ctx'
import { Panel } from '../common'
import { ACHIEVEMENTS, ACH_ROUTES, earnedTitles, rewardText, wearTitle, wornTitle } from '../../engine/me/achievements'
import { ENDINGS_ME } from '../../engine/me/endings'

export default function AchievementsScreen() {
  const { game, commit } = useGame()
  const me = game.me!
  const has = new Set(me.achievements)
  const got = ACHIEVEMENTS.filter((a) => has.has(a.key)).length
  const worn = wornTitle(me)
  const titles = earnedTitles(me)
  // a phone gets one column: the list first, the endings under it
  const narrow = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 720px)').matches
  return (
    <div className="grid" style={{ gridTemplateColumns: narrow ? 'minmax(0, 1fr)' : 'minmax(0, 1.6fr) minmax(0, 1fr)' }}>
      <Panel title={`成就 · ${got}/${ACHIEVEMENTS.length}`} actions={worn ? <span className="tag win" title="称号">{worn}</span> : undefined}>
        <p className="tiny faint" style={{ marginTop: 0 }}>解锁当周发奖励，每项只发一次。{titles.length > 1 ? '称号可以换着戴。' : ''}</p>
        {ACH_ROUTES.map((r) => {
          const rows = ACHIEVEMENTS.filter((a) => a.route === r.key)
          const done = rows.filter((a) => has.has(a.key)).length
          return (
            <div key={r.key} className="ach-group">
              <h3>{r.name} <em>{done}/{rows.length}</em></h3>
              <div className="ach-list">
                {rows.map((a) => {
                  const on = has.has(a.key)
                  const hide = !!a.secret && !on
                  const title = a.reward?.title
                  return (
                    <div key={a.key} className={`ach${on ? ' got' : ''}${a.secret ? ' hard' : ''}`}>
                      <span className="mark">{on ? '★' : '☆'}</span>
                      <div>
                        <b>{hide ? '???' : a.name}</b>
                        <span className="tiny muted">{hide ? '撞上才知道' : a.desc}</span>
                        {!hide && a.reward && (
                          <span className="tiny" style={{ color: on ? 'var(--win)' : 'var(--faint)' }}>
                            {rewardText(a.reward)}
                            {on && title && (title === worn
                              ? <span className="muted"> · 戴着</span>
                              : <button className="sm" style={{ marginLeft: 6, padding: '0 6px' }} onClick={() => { wearTitle(game, title); commit() }}>戴上</button>)}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
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
