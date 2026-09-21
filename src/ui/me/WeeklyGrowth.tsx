import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import { growthNet, readGrowthWeek, validGrowthReport } from '../../engine/me/growthWeek'
import type { GrowthWeekResult } from '../../engine/me/types'
import type { Player } from '../../engine/types'
import { useGame } from './ctx'
import { attrWord, useNumbers } from './words'
import './growth-week.css'

const signed = (n: number) => `${n > 0 ? '+' : ''}${Number(n.toFixed(2))}`
function GrowthRows({ report, nums, player }: { report: GrowthWeekResult; nums: boolean; player?: Player }) {
  return <div className="growth-eight">{ATTR_KEYS.map(k => {
    const c = report.changes[k], net = growthNet(c)
    return <div className="growth-cell" key={k}>
      <span>{ATTR_CN[k]}{player ? ` · ${nums ? player.attrs[k] : attrWord(player.attrs[k])}` : ''}</span><b>{nums ? `净增 ${signed(net)} 点` : net > 0 ? '有所成长' : net < 0 ? '有所回落' : '暂无变化'}</b>
      <small>{nums && c.points !== 0 ? `属性 ${signed(c.points)} · ` : ''}{c.capped ? '已达当前上限' : '含未进位进度'}</small>
      {player && !c.capped && (nums ? <><progress max={100} value={Math.min(100, Math.max(0, player.xp[k] ?? 0))} aria-label={`${ATTR_CN[k]}升至下一点的进度`} /><small>下一点 {Number((player.xp[k] ?? 0).toFixed(1))} / 100</small></> : <small>下一点进度：{(player.xp[k] ?? 0) >= 70 ? '即将进位' : (player.xp[k] ?? 0) > 0 ? '积累中' : '尚未积累'}</small>)}
    </div>
  })}</div>
}

export default function WeeklyGrowth() {
  const { game } = useGame(), [nums] = useNumbers()
  const current = readGrowthWeek(game), stored = game.me?.lastGrowthWeek
  const last = validGrowthReport(stored) ? stored : undefined
  const player = game.me && game.players[game.me.id]
  const active = current && ATTR_KEYS.filter(k => growthNet(current.changes[k]) !== 0)
  return <details className="weekly-growth">
    <summary>本周成长 · {active?.length ? active.map(k => ATTR_CN[k]).join('、') : '暂无净变化'} <span className="muted">展开查看</span></summary>
    <p className="tiny muted">100 经验 = 1 属性点。下方是折算净增长，不是综合评分；包含训练、比赛、事件等影响，不是纯训练收益。达到上限清空的进度不计作退步。</p>
    {current ? <><p className="tiny">{current.complete ? '本周累计' : '旧档从本次开始记录，不代表整周'}</p><GrowthRows report={current} nums={nums} player={player}/></> : <p className="tiny muted">从下次行动开始记录。</p>}
    {last && <details className="growth-previous"><summary>上一周记录{last.complete ? '' : '（仅已记录部分）'}</summary><GrowthRows report={last} nums={nums}/></details>}
  </details>
}
