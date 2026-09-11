import { useGame } from '../ctx'
import { ACH_BY_KEY, rewardText } from '../../engine/me/achievements'

/**
 * The moment an achievement unlocks: a small card with what it paid, until it
 * is dismissed. It reads the save's own place (achState.seen), so a run of
 * weeks shows everything unlocked on the way, once — and a save from before
 * this card starts with nothing to show.
 */
export default function AchPop() {
  const { game, commit, go } = useGame()
  const me = game.me
  const book = me?.achState
  if (!me || !book) return null
  const fresh = me.achievements.slice(book.seen).map((k) => ACH_BY_KEY[k]).filter((a) => !!a)
  if (!fresh.length) return null
  const close = () => { book.seen = me.achievements.length; commit() }
  return (
    <div
      className="ach-pop"
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', left: '50%', bottom: 72, transform: 'translateX(-50%)', zIndex: 45,
        width: 'min(92vw, 360px)', background: 'var(--panel-2)', border: '1px solid var(--accent-line)',
        borderLeft: '2px solid var(--warn)', borderRadius: 'var(--radius)', padding: '10px 14px', boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="tiny muted">成就解锁{fresh.length > 1 ? ` · ${fresh.length} 项` : ''}</div>
      {fresh.slice(0, 3).map((a) => (
        <div key={a.key} className="small" style={{ marginTop: 4 }}>
          <b>★ {a.name}</b>
          {a.reward && <span className="tiny" style={{ color: 'var(--win)', marginLeft: 6 }}>{rewardText(a.reward)}</span>}
        </div>
      ))}
      {fresh.length > 3 && <div className="tiny muted" style={{ marginTop: 4 }}>还有 {fresh.length - 3} 项</div>}
      <div className="row" style={{ gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
        <button className="sm" onClick={() => { close(); go('awards') }}>去看看</button>
        <button className="sm primary" onClick={close}>好</button>
      </div>
    </div>
  )
}
