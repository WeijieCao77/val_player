import { useRef, useState } from 'react'
import { useGame } from './ctx'
import { Panel } from './common'
import { useNumbers } from './words'
import { ConfirmCard } from './SaveCard'
import { SECONDARY_ROLES, chooseSecondary, chooseSecondaryBlock, secondaryMastery, secondarySwitchBlock, secondaryTrainingBlock, switchSecondaryRole, trainSecondary, setSecondaryAuto } from '../../engine/me/secondaryRole'
import type { Role, GameState } from '../../engine/types'

type ConfirmAction =
  | { type: 'chooseRole'; role: Role }
  | { type: 'train'; secondary: Role }
  | { type: 'switchRole'; target: Role }
  | { type: 'enableAuto'; secondary: Role }

export default function SecondaryRole() {
  const { game, commit, toast } = useGame()
  const [nums] = useNumbers()
  const me = game.me!
  const p = game.players[me.id]
  const training = me.positionTraining
  const home = training?.home ?? p.role
  const secondary = training?.secondary
  const mastery = secondaryMastery(game)
  const trainWhy = secondaryTrainingBlock(game)
  const target = p.role === home ? secondary : home
  const switchWhy = target ? secondarySwitchBlock(game, target) : '先选定副位置。'
  const pending = useRef<ConfirmAction | null>(null)
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)

  const openConfirm = (action: ConfirmAction) => {
    if (pending.current) return
    pending.current = action
    setConfirm(action)
  }

  const closeConfirm = () => {
    pending.current = null
    setConfirm(null)
  }

  const confirmAndRun = () => {
    if (!confirm || pending.current !== confirm) return
    pending.current = null
    const action = confirm
    setConfirm(null)
    switch (action.type) {
      case 'chooseRole': {
        const why = chooseSecondaryBlock(game, action.role)
        if (why) { toast(why); return }
        const res = chooseSecondary(game, action.role)
        if (res) toast(res)
        else commit()
        break
      }
      case 'train': {
        if (game.me?.positionTraining?.secondary !== action.secondary) {
          toast('副位置已改变，本次训练已取消')
          return
        }
        const why = secondaryTrainingBlock(game)
        if (why) { toast(why); return }
        const res = trainSecondary(game)
        if (res) toast(res)
        else commit()
        break
      }
      case 'switchRole': {
        const currentTarget = p.role === home ? game.me?.positionTraining?.secondary : home
        if (currentTarget !== action.target) {
          toast('主位置状态已改变，本次切换已取消')
          return
        }
        const why = currentTarget ? secondarySwitchBlock(game, currentTarget) : '先选定副位置。'
        if (why) { toast(why); return }
        const res = currentTarget ? switchSecondaryRole(game, currentTarget) : '先选定副位置。'
        if (res) toast(res)
        else commit()
        break
      }
      case 'enableAuto': {
        if (game.me?.positionTraining?.secondary !== action.secondary) {
          toast('副位置已改变，自动训练未开启')
          return
        }
        if (game.me.positionTraining?.autoTrain === true) {
          toast('每周自动训练已开启')
          return
        }
        const res = setSecondaryAuto(game, true)
        if (res) toast(res)
        else commit()
        break
      }
    }
  }

  const toggleAuto = (enabled: boolean) => {
    if (enabled) {
      if (!secondary) {
        toast('请先选定副位置')
        return
      }
      if (mastery >= 100) {
        toast('副位置已练成，无需自动训练')
        return
      }
      openConfirm({ type: 'enableAuto', secondary })
    } else {
      if (game.me?.positionTraining?.autoTrain === true) {
        pending.current = null
        const res = setSecondaryAuto(game, false)
        if (res) toast(res)
        else commit()
      }
    }
  }

  const secondariesNoTraining = (game: GameState): Role[] => {
    const me = game.me!
    const p = game.players[me.id]
    const training = me.positionTraining
    const home = training?.home ?? p.role
    const secondary = training?.secondary
    return SECONDARY_ROLES.filter((r) => r !== home && r !== secondary)
  }

  return (
    <Panel title="主位置与副位置">
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <span className="tag">主位置 · {home}</span>
        <span className="tag">当前岗位 · {p.role}</span>
      </div>
      {!secondary && (
        <p className="small muted">完成 26 周生涯后，可专门培养一个副位置。训练本身不增加八属性或上限。</p>
      )}
      {secondary ? (
        <>
          <p>
            副位置 · <b>{secondary}</b>　{nums ? `熟练度 ${mastery}/100` : mastery >= 100 ? '已练成' : mastery >= 70 ? '接近熟练' : mastery > 0 ? '学习中' : '尚未训练'}
          </p>
          {nums && (
            <progress
              aria-label="副位置熟练度"
              max={100}
              value={mastery}
              style={{ width: '100%', accentColor: 'var(--accent)' }}
            />
          )}
          <button disabled={!!trainWhy} title={trainWhy ?? ''} onClick={() => openConfirm({ type: 'train', secondary })}>
            训练副位置
          </button>
          {trainWhy && <p className="tiny muted">{trainWhy}</p>}
          {mastery < 100 && (
            <label className="row" style={{ gap: 8, alignItems: 'center', marginTop: 4 }}>
              <input
                type="checkbox"
                checked={game.me?.positionTraining?.autoTrain === true}
                onChange={(e) => toggleAuto(e.target.checked)}
              />
              每周自动训练 <span className="tiny muted">推进或按推荐时执行</span>
            </label>
          )}
          <details style={{ marginTop: 8 }}>
            <summary>规则与岗位切换</summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className="tiny muted">
                每周最多一次，2 点行动 + 4 点体力，增加 2 点熟练度。熟练度会逐步减轻临时补位惩罚，满 100 才能作为完整副位置兼任并切换岗位。
              </p>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {mastery === 0 && training?.trainedWeek === undefined && secondariesNoTraining(game).map((role) => (
                  <button
                    key={role}
                    disabled={!!chooseSecondaryBlock(game, role)}
                    onClick={() => openConfirm({ type: 'chooseRole', role })}
                  >
                    改选{role}
                  </button>
                ))}
              </div>
              <button disabled={!!switchWhy} title={switchWhy ?? ''} onClick={() => { if (target) openConfirm({ type: 'switchRole', target }) }}>
                切换至{target ?? home}
              </button>
              <p className="tiny muted">
                {switchWhy ?? '仅能在空白周初切换。切换后岗位判定立即生效，不保证获得首发。'}队伍仍会按阵容选择你已掌握位置的英雄，不保证每张图只承担当前岗位。
              </p>
            </div>
          </details>
        </>
      ) : (
        <>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SECONDARY_ROLES.filter((r) => r !== home).map((role) => {
              const why = chooseSecondaryBlock(game, role)
              return (
                <button key={role} disabled={!!why} title={why ?? ''} onClick={() => openConfirm({ type: 'chooseRole', role })}>
                  培养{role}
                </button>
              )
            })}
          </div>
          <details style={{ marginTop: 8 }}>
            <summary>规则</summary>
            <p className="tiny muted">
              {chooseSecondaryBlock(game, SECONDARY_ROLES.find((r) => r !== home)!) ??
                '首次训练前可重选，开始培养后不能更换；请根据希望争取的岗位选择。'}
            </p>
          </details>
        </>
      )}
      {confirm && (
        <ConfirmCard
          title={confirmTitle(confirm)}
          body={confirmBody(confirm)}
          ok="确认"
          onOk={confirmAndRun}
          onCancel={closeConfirm}
        />
      )}
    </Panel>
  )
}

function confirmTitle(action: ConfirmAction): string {
  switch (action.type) {
    case 'chooseRole':
      return `选定「${action.role}」作为副位置`
    case 'train':
      return '进行一次副位置训练'
    case 'switchRole':
      return `切换到「${action.target}」`
    case 'enableAuto':
      return '开启每周自动训练'
  }
}

function confirmBody(action: ConfirmAction): string {
  switch (action.type) {
    case 'chooseRole':
      return '首次投入训练后不能更换，尚未开始时可以重选。每周训练消耗 2 点行动、4 点体力，从零练成至少需要 50 周，不会直接增加八属性。'
    case 'train':
      return '消耗 2 点行动、4 点体力。本次不可撤回，也会锁定本周此前所有可撤回行动。'
    case 'switchRole':
      return '本周只能切换一次。八属性不变，综合、上限与身价按新岗位重新计算；旧岗位对位资本清零，首发仍由教练正常选拔。'
    case 'enableAuto':
      return '开启后，在按推荐做完前或推进生涯时，每周优先尝试一次副位置训练。每次2点行动4点体力；训练不可撤回，并锁定本周此前所有可撤回行动；不够或受阻时跳过，可随时关闭。开启本身不扣点，不自动切换岗位。'
  }
}
