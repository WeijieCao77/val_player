import { useGame } from './ctx'
import { Modal } from './common'
import { describeEffect } from '../../engine/me/events'
import { ivAnswer, ivCard } from '../../engine/me/interview'
import { pop } from '../../engine/me/pending'
import { Scene } from './art/scenes'
import { holdCard } from './hold'
import './moment.css'

/**
 * 赛前 / 赛后采访 on a key match (engine/me/interview.ts): the event card's own layout — the question, the
 * situation under it, three answers with what each does — and a real line from the same point of the same
 * event where history has one. The × is the first answer, the one that costs nothing, as 托管 answers it.
 */
export default function InterviewModal({ id, onDone }: { id: string; onDone: () => void }) {
  const { game, commit } = useGame()
  const card = ivCard(game, id)
  if (!card) { pop(game, 'interview', id); onDone(); return null }
  const choose = (i: number) => {
    const pick = card.opts[i] ?? card.opts[0]
    const lines = ivAnswer(game, card.id, i)
    const close = () => { holdCard(null); onDone() }
    holdCard(
      <Modal title={card.title} art={<Scene kind="media" />} onClose={close} onBgClose={close}>
        <p className="q ev-q">{card.q}</p>
        <div className="node-line ok">
          你说：「{pick.t}」
          {lines.length
            ? <div className="ev-chips">{lines.map((l, k) => <span key={k} className={`mo-chip${/[−-]\s?\d|掉粉|热度降|上火|远一点/.test(l) ? ' dn' : /\+\s?\d|涨粉|涨热度|近一点/.test(l) ? ' up' : ''}`}>{l}</span>)}</div>
            : <div className="small" style={{ marginTop: 4 }}>没有立刻的变化。</div>}
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}><button className="primary" onClick={close}>继续</button></div>
      </Modal>,
    )
    commit()
  }
  return (
    <Modal title={card.title} art={<Scene kind="media" />} onClose={() => choose(0)} onBgClose={() => {}}>
      <p className="tiny muted iv-kind" style={{ margin: '0 0 4px' }}>🎙️ {card.about}</p>
      <p className="q ev-q">{card.q}</p>
      {card.ctx.map((c) => <p key={c} className="muted small iv-ctx" style={{ margin: '0 0 4px' }}>{c}</p>)}
      {card.moment && <p className="iv-real">{card.moment}</p>}
      <div className="node-opt" style={{ marginTop: 10 }}>
        {card.opts.map((o, i) => (
          <button key={i} onClick={() => choose(i)}>
            <span>{o.t}</span>
            <span className="m">{[o.tag, describeEffect(o.e, game), ...o.notes].filter(Boolean).join(' · ')}{i === 0 ? ' · 按推荐' : ''}</span>
          </button>
        ))}
      </div>
      <p className="tiny faint" style={{ textAlign: 'center', margin: '10px 0 0' }}>不想说也行：关掉就按第一个回答，不花任何代价。</p>
    </Modal>
  )
}
