import { useGame } from './ctx'
import { qualificationMode, setQualificationMode } from '../../engine/me/qualifyAlerts'
import type { QualifyAlertMode } from '../../engine/me/qualifyAlerts'

export default function QualifyAlertSettings() {
  const { game, commit } = useGame()
  return <div className="qualify-alert-settings" style={{ margin: '12px 0', minWidth: 0, overflowWrap: 'anywhere' }}>
    <label className="small" style={{ display: 'block' }}>国际赛出线提醒
      <select value={qualificationMode(game)} style={{ display: 'block', width: '100%', maxWidth: 340, boxSizing: 'border-box', margin: '6px auto' }}
        onChange={(e) => { setQualificationMode(game, e.target.value as QualifyAlertMode); commit() }}>
        <option value="all">每次出线都提醒</option>
        <option value="yearly">减少：每年每类首次</option>
        <option value="first">关闭重复：生涯每类首次</option>
      </select>
    </label>
    <p className="tiny faint" style={{ margin: '6px 0' }}>大师赛、全球冠军赛、LOCK//IN 分别计算；保留首次出线，冠军、签约等大事不受影响，出线日志照常记录。旧档从已记录或下一次出线起计算。</p>
  </div>
}
