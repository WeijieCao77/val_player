import type { Origin } from '../../engine/me/origins'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'

export default function OriginDetails({ origin, nums }: { origin: Origin; nums: boolean }) {
  const rows: { label: string; value: string }[] = []

  const sign = (n: number) => `${n > 0 ? '+' : ''}${n}`

  if (origin.money !== undefined) rows.push({ label: '额外资金', value: nums ? `${sign(origin.money)} 元` : origin.money > 0 ? '有一笔钱' : '有一笔欠款' })
  if (origin.fans !== undefined) rows.push({ label: '初始粉丝', value: nums ? sign(origin.fans) : origin.fans > 0 ? '有一些粉丝' : origin.fans < 0 ? '没什么人关注' : '粉丝不多不少' })
  if (origin.mental !== undefined) rows.push({ label: '心态修正', value: nums ? sign(origin.mental) : origin.mental > 0 ? '更稳' : origin.mental < 0 ? '更容易慌' : '一般' })
  if (origin.body !== undefined) rows.push({ label: '体质修正', value: nums ? sign(origin.body) : origin.body > 0 ? '更好' : origin.body < 0 ? '更容易累' : '一般' })
  if (origin.upkeep !== undefined) rows.push({ label: '每周支出', value: nums ? `${origin.upkeep} 元/周` : origin.upkeep > 0 ? '需要寄钱回家' : '没有额外支出' })
  if (origin.trainMul !== undefined) rows.push({ label: '训练速度', value: nums ? `×${origin.trainMul}` : origin.trainMul > 1 ? '练得比别人快' : origin.trainMul < 1 ? '练得比别人慢' : '正常' })
  if (origin.ladder !== undefined) rows.push({ label: '天梯起点', value: nums ? sign(origin.ladder) : origin.ladder > 0 ? '排名较高' : '排名较低' })
  if (origin.tac !== undefined) rows.push({ label: '战术素养', value: nums ? sign(origin.tac) : origin.tac > 0 ? '有些底子' : '从零开始' })
  if (origin.scoutSeen !== undefined) rows.push({ label: '球探初始印象', value: nums ? sign(origin.scoutSeen) : origin.scoutSeen > 0 ? '已经有人认识' : '无人知晓' })

  if (origin.attrs) {
    for (const k of ATTR_KEYS) {
      const v = origin.attrs[k]
      if (v === undefined || v === 0) continue
      rows.push({ label: ATTR_CN[k], value: nums ? sign(v) : v > 0 ? '更强' : '更弱' })
    }
  }

  if (origin.flags?.streamer) rows.push({ label: '直播', value: '收入与热度增长更快' })
  if (origin.flags?.lang) rows.push({ label: '语言', value: '已具备语言课程基础' })
  if (origin.flags?.late) rows.push({ label: '大龄新人', value: '上限略低，但心态更稳' })

  if (origin.needsClub) rows.push({ label: '仅限', value: '俱乐部开局' })

  return (
    <details style={{ margin: '4px 0 0' }}>
      <summary className="tiny muted" style={{ cursor: 'pointer', userSelect: 'none' }}>查看影响</summary>
      <div style={{ margin: '6px 0 0', padding: '8px', border: '1px solid var(--line-soft)', borderRadius: 6, background: 'var(--panel-2)' }}>
        {rows.length === 0 ? (
          <p className="tiny muted">没有额外修正。</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }} className="tiny">
            {rows.map((r, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span>{r.label}</span>
                <span style={{ fontWeight: 600 }}>{r.value}</span>
              </li>
            ))}
          </ul>
        )}
        <p style={{ margin: '8px 0 0' }} className="tiny faint">这些是出身卡带来的相对修正，不是最终数值。</p>
      </div>
    </details>
  )
}
