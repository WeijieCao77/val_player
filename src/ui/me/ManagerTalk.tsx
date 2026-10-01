import { useRef, useState } from 'react'
import { useGame } from './ctx'
import { ConfirmCard } from './SaveCard'
import { useNumbers, trustLabel } from './words'
import { SIGN_GATE } from '../../engine/me/clout'
import { managerTalkBlock, managerTalkWait, talkToManager, MANAGER_TALK_AP, MANAGER_TALK_GAIN, MANAGER_TALK_WEEKS, MANAGER_TALK_CAP } from '../../engine/me/gmTrust'

export default function ManagerTalk() {
  const { game, commit, toast } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const block = managerTalkBlock(game)
  const wait = managerTalkWait(game)
  const gmTrust = Math.round(me.gmTrust)
  const signReached = gmTrust >= SIGN_GATE.gm
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pending = useRef<{ game: typeof game; team: string; week: number; year: number; id: string } | null>(null)
  const closeConfirm = () => { pending.current = null; setConfirmOpen(false) }

  const handleTalk = () => {
    if (pending.current) return
    const currentBlock = managerTalkBlock(game)
    if (currentBlock) {
      toast(currentBlock)
      return
    }
    pending.current = { game, team: game.myTeam, week: me.week, year: game.year, id: me.id }
    setConfirmOpen(true)
  }

  const confirmTalk = () => {
    const captured = pending.current
    if (!captured) return
    closeConfirm()
    if (captured.game !== game || captured.team !== game.myTeam || captured.week !== me.week || captured.year !== game.year || captured.id !== me.id) {
      toast('生涯状态已变化，请重新确认沟通。')
      return
    }
    const afterConfirmBlock = managerTalkBlock(game)
    if (afterConfirmBlock) {
      toast(afterConfirmBlock)
      return
    }
    const err = talkToManager(game)
    if (err) {
      toast(err)
      return
    }
    toast('与经理的沟通很顺利。')
    commit()
  }

  const trustDisplay = nums ? `当前经理信任 ${gmTrust}` : `当前经理信任：${trustLabel(me.gmTrust)}`
  const signTargetDisplay = nums ? `引援信任门槛 ${SIGN_GATE.gm}` : '经理的引援信任门槛'
  const gainCapDisplay = nums ? `每次经理信任最多 +${MANAGER_TALK_GAIN}，此渠道最高 ${MANAGER_TALK_CAP}` : '信任会有所提升，此沟通渠道有提升上限'
  const signConditionDisplay = nums ? `需 ${SIGN_GATE.clout} 点威望` : '需足够威望'

  return (
    <section className="manager-talk" aria-label="经理沟通" style={{ marginTop: 12 }}>
      <p className="small" style={{ margin: '0 0 6px' }}>
        {trustDisplay} · {signTargetDisplay}{signReached ? '（已达标）' : '（未达标）'}
      </p>
      <p className="tiny muted" style={{ margin: '0 0 6px' }}>
        每个赛段结束，经理会按这段的战绩、拿没拿冠军和你的人气重新看你一次；时间久了，好感和不满都会慢慢淡下来。也可以主动沟通。
      </p>
      <p className="tiny muted" style={{ margin: '0 0 6px' }}>
        每次沟通消耗 {MANAGER_TALK_AP} 点行动。{gainCapDisplay}。两次沟通之间需要等待 {MANAGER_TALK_WEEKS} 个生涯周。
      </p>
      <p className="tiny muted" style={{ margin: '0 0 6px' }}>
        引援条件：{signConditionDisplay}，还需转会窗口、俱乐部预算及引援冷却，不保证签下人。
      </p>
      <p className="tiny muted" style={{ margin: '0 0 6px' }}>
        不会托管自动沟通，各年龄可用。
      </p>
      <button className="sm" disabled={!!block} onClick={handleTalk}>
        与经理沟通
      </button>
      {block && <p className="tiny muted" style={{ margin: '6px 0 0' }}>{block}</p>}
      {wait > 0 && <p className="tiny muted" style={{ margin: '6px 0 0' }}>还需等待 {wait} 周才能再次沟通。</p>}
      {confirmOpen && <ConfirmCard
        title="与经理沟通一次？"
        body={`本次将消耗 ${MANAGER_TALK_AP} 点行动且不可撤回，并锁定本周此前所有可撤回行动。`}
        ok="确认沟通"
        onOk={confirmTalk}
        onCancel={closeConfirm}
      />}
    </section>
  )
}
