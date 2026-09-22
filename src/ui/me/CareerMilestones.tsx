import { useGame } from './ctx'
import { careerMilestones } from '../../engine/me/milestones'

export default function CareerMilestones() {
  const { game } = useGame()
  return <section aria-label="生涯里程碑" style={{ margin: '12px 0', minWidth: 0, overflowWrap: 'anywhere' }}>
    <h3>生涯里程碑</h3>
    {careerMilestones(game).map((m) => <div key={m.key} style={{ marginBottom: 10 }}>
      <div className="small" style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 }}>
        <b>{m.name}</b><span>{m.count.toLocaleString('en-US')} / {m.target.toLocaleString('en-US')} {m.unit}</span>
      </div>
      <progress aria-label={m.name} max={m.target} value={Math.min(m.count, m.target)} style={{ width: '100%', height: 10, accentColor: 'var(--win)' }} />
    </div>)}
    <p className="tiny faint">百场按职业正赛首发系列赛计算，一场 BO 系列赛可含多图；地图与击杀按正赛实际出场累计，训练赛、友谊赛和业余杯赛不计。累计跨年保留；旧档仅采用留存统计，不推算缺失历史。</p>
    <p className="tiny faint">千图、万杀仅解锁同名称号，不增加属性；百场保留原有奖励。</p>
  </section>
}
