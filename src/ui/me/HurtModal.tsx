import { useGame } from '../ctx'
import { Modal } from '../common'
import { answerHurt, hurtAsk } from '../../engine/me/hurtplay'

/**
 * Hurt, on a day my club plays and the coach would start me: play through it or
 * sit it out (engine/me/hurtplay.ts). What it is, what it risks, two buttons.
 * The × sits it out, the safe answer.
 */
export default function HurtModal({ fixtureId, onDone }: { fixtureId: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const ask = hurtAsk(game, fixtureId)
  const answer = (play: boolean) => { answerHurt(game, fixtureId, play); commit(); onDone() }
  if (!ask) {
    return (
      <Modal title="伤已经好了" onClose={() => answer(false)} onBgClose={() => {}}>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="primary" onClick={() => answer(false)}>知道了</button>
        </div>
      </Modal>
    )
  }
  return (
    <Modal title="带伤上吗" onClose={() => answer(false)} onBgClose={() => {}}>
      <p className="small" style={{ marginTop: 0 }}><b>{ask.line}</b></p>
      <p className="small muted" style={{ margin: '0 0 6px' }}>{ask.vs}</p>
      <p className="small" style={{ margin: '0 0 14px', color: 'var(--loss)' }}>{ask.risk}</p>
      <div className="row wrap" style={{ gap: 10, justifyContent: 'center' }}>
        <button onClick={() => answer(true)}>带伤上</button>
        <button className="primary" onClick={() => answer(false)}>养好再上</button>
      </div>
      <p className="tiny faint" style={{ textAlign: 'center', margin: '10px 0 0' }}>选养伤，这次伤好之前教练不会再问。</p>
    </Modal>
  )
}
