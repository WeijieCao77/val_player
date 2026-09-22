import { useGame } from './ctx'
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

  const handleTalk = () => {
    const currentBlock = managerTalkBlock(game)
    if (currentBlock) {
      toast(currentBlock)
      return
    }
    if (!window.confirm(`与经理沟通一次？本次将消耗 ${MANAGER_TALK_AP} 点行动且不可撤回，并锁定本周此前所有可撤回行动。`)) return
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
        比赛胜利和夺冠主要影响教练信任与威望；经理关系另有判定，也可主动沟通恢复。
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
    </section>
  )
}
