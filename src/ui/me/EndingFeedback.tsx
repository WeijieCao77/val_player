import { useEffect, useState } from 'react'
import type { GameState } from '../../engine/types'
import { ENDING_FEEDBACK_FLAG, endingFeedbackReady, noteEndingFeedbackShown } from '../../engine/me/endingFeedback'
import { useGame } from './ctx'
import { Modal } from './common'

/** A voluntary follow-up, after the verdict and all of the career's queued cards. */
export default function EndingFeedback({ blocked }: { blocked: boolean }) {
  const { game, commit, go } = useGame()
  const [openFor, setOpenFor] = useState<GameState | null>(null)
  const waiting = endingFeedbackReady(game)
  const mark = game.me?.flags[ENDING_FEEDBACK_FLAG]
  const open = openFor === game && !blocked

  useEffect(() => {
    if (!blocked && waiting) setOpenFor(game)
  }, [game, blocked, waiting])

  useEffect(() => {
    if (open && noteEndingFeedbackShown(game)) commit()
  }, [game, open, mark, commit])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenFor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const close = () => setOpenFor(null)
  return <Modal title="这段生涯，有什么想告诉作者？" onClose={close}>
    <p className="small" style={{ marginTop: 0 }}>结局已经留在你的生涯里。如果有哪里让你开心、困惑，或觉得还能改进，欢迎留一条建议。</p>
    <p className="small muted">你可以通过侧栏的「信箱」填写建议、查看其他玩家的建议和处理状态。现在不写也没关系，之后随时可以进去。</p>
    <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
      <button onClick={close}>稍后再说</button>
      <button className="primary" onClick={() => { close(); go('box') }}>前往信箱</button>
    </div>
  </Modal>
}
