import { useGame } from './ctx'
import { Panel } from './common'
import { useNumbers } from './words'
import type { Role } from '../../engine/types'
import { SECONDARY_ROLES, chooseSecondary, chooseSecondaryBlock, secondaryMastery, secondarySwitchBlock, secondaryTrainingBlock, switchSecondaryRole, trainSecondary } from '../../engine/me/secondaryRole'

export default function SecondaryRole() {
  const { game, commit, toast } = useGame(), [nums] = useNumbers()
  const me = game.me!, p = game.players[me.id], training = me.positionTraining
  const home = training?.home ?? p.role, secondary = training?.secondary, mastery = secondaryMastery(game)
  const trainWhy = secondaryTrainingBlock(game)
  const target = p.role === home ? secondary : home
  const switchWhy = target ? secondarySwitchBlock(game, target) : '先选定副位置。'
  const done = (why: string | null) => { if (why) toast(why); else commit() }
  const choose = (role: Role) => {
    if (!window.confirm(`选定「${role}」作为唯一副位置？首次投入训练后不能更换，尚未开始时可以重选。每周训练消耗 2 点行动、4 点体力，从零练成至少需要 50 周，不会直接增加八属性。`)) return
    done(chooseSecondary(game, role))
  }
  return <Panel title="主位置与副位置">
    <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}><span className="tag">主位置 · {home}</span><span className="tag">当前岗位 · {p.role}</span></div>
    <p className="small muted">完成 26 周生涯后，可专门培养一个副位置。不自动消耗行动点；训练本身不增加八属性或上限。</p>
    {secondary ? <>
      <p>副位置 · <b>{secondary}</b>　{nums ? `熟练度 ${mastery}/100` : mastery >= 100 ? '已练成' : mastery >= 70 ? '接近熟练' : mastery > 0 ? '学习中' : '尚未训练'}</p>
      {nums && <progress aria-label="副位置熟练度" max={100} value={mastery} style={{ width: '100%', accentColor: 'var(--accent)' }} />}
      <p className="tiny muted">每周最多一次，2 点行动 + 4 点体力，增加 2 点熟练度。熟练度会逐步减轻临时补位惩罚，满 100 才能作为完整副位置兼任并切换岗位。</p>
      {mastery === 0 && training?.trainedWeek === undefined && <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{SECONDARY_ROLES.filter(r => r !== home && r !== secondary).map(role => <button key={role} disabled={!!chooseSecondaryBlock(game, role)} onClick={() => choose(role)}>改选{role}</button>)}</div>}
      <button disabled={!!trainWhy} title={trainWhy ?? ''} onClick={() => {
        if (window.confirm('进行一次副位置训练？消耗 2 点行动、4 点体力。本次不可撤回，也会锁定本周此前所有可撤回行动。')) done(trainSecondary(game))
      }}>训练副位置</button>
      {trainWhy && <p className="tiny muted">{trainWhy}</p>}
      <div style={{ marginTop: 12 }}>
        <button disabled={!!switchWhy} title={switchWhy ?? ''} onClick={() => {
          if (target && window.confirm(`切换到「${target}」？本周只能切换一次。八属性不变，综合、上限与身价按新岗位重新计算；旧岗位对位资本清零，首发仍由教练正常选拔。`)) done(switchSecondaryRole(game, target))
        }}>切换至{target ?? home}</button>
        <p className="tiny muted">{switchWhy ?? '仅能在空白周初切换。切换后岗位判定立即生效，不保证获得首发。'}队伍仍会按阵容选择你已掌握位置的英雄，不保证每张图只承担当前岗位。</p>
      </div>
    </> : <>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>{SECONDARY_ROLES.filter(r => r !== home).map(role => {
        const why = chooseSecondaryBlock(game, role)
        return <button key={role} disabled={!!why} title={why ?? ''} onClick={() => choose(role)}>培养{role}</button>
      })}</div>
      <p className="tiny muted">{chooseSecondaryBlock(game, SECONDARY_ROLES.find(r => r !== home)!) ?? '首次训练前可重选，开始培养后不能更换；请根据希望争取的岗位选择。'}</p>
    </>}
  </Panel>
}
