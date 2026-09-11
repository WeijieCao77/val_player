import type { EdgeBreakdown, MapScore } from '../../engine/types'
import { useNumbers } from './words'

/**
 * Why the map went the way it did, as a player reads it: which terms of the
 * engine's sum were ours and which were theirs, largest gap first — in words
 * by default, with the figures when the numbers switch is on.
 *
 * The career's own copy of the manager game's panel. A player has no coach to
 * replace and no sliders to move, so it carries none of the manager's
 * "how to fix it" advice.
 */
const FACTORS: { key: keyof EdgeBreakdown; label: string }[] = [
  { key: 'base', label: '选手个人能力' },
  { key: 'map', label: '地图熟练度' },
  { key: 'chem', label: '团队默契' },
  { key: 'comp', label: '阵容位置搭配' },
  { key: 'igl', label: '指挥（IGL）' },
  { key: 'shortHanded', label: '人数不足' },
  { key: 'coach', label: '教练与战术素养' },
  { key: 'utility', label: '道具运用' },
  { key: 'tacticsAtk', label: '战术设置（进攻端）' },
  { key: 'tacticsDef', label: '战术设置（防守端）' },
  { key: 'style', label: '阵容风格' },
  { key: 'matchup', label: '针对对手' },
  { key: 'familiarity', label: '阵容熟练度' },
]

export default function WhyPanel({ map, mineIsA }: { map: MapScore; mineIsA: boolean }) {
  const [nums] = useNumbers()
  if (!map.edge) {
    return (
      <div className="empty">这场比赛是在此功能上线前打的，没有记录当时的强弱分解。</div>
    )
  }
  const mine = mineIsA ? map.edge.a : map.edge.b
  const foe = mineIsA ? map.edge.b : map.edge.a

  // the newer rows are absent on maps played before they existed; absent is
  // zero, not a hole in the table
  const at = (side: EdgeBreakdown, k: keyof EdgeBreakdown): number => (side[k] as number | undefined) ?? 0
  const rows = FACTORS
    .map((f) => ({ ...f, diff: at(mine, f.key) - at(foe, f.key) }))
    .filter((r) => Math.abs(r.diff) >= 0.15)
    .sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))

  const total = (mine.atk + mine.def) / 2 - (foe.atk + foe.def) / 2
  const worst = rows.filter((r) => r.diff < 0).slice(0, 2)

  // Paper strength and the actual result are two different facts, and the
  // interesting cases are the ones where they disagree, so say which happened
  // before explaining it.
  const myScore = mineIsA ? map.scoreA : map.scoreB
  const foeScore = mineIsA ? map.scoreB : map.scoreA
  const won = myScore > foeScore
  const verdict = Math.abs(total) < 1.5
    ? (won
      ? '两队几乎势均力敌，这张图能拿下靠的是临场发挥'
      : '两队几乎势均力敌，这张图的胜负主要靠临场发挥和运气')
    : total >= 0
      ? (won
        ? '账面上我们更强，这张图也照着实力拿下了'
        : '账面上我们更强——这张图却输了，说明临场没打出来')
      : (won
        ? '账面上处于下风，这张图是硬啃下来的'
        : '账面上确实处于下风')

  return (
    <div>
      <div className="row wrap" style={{ gap: 10, alignItems: 'baseline', marginBottom: 10 }}>
        <b>综合实力差</b>
        {nums && (
          <span className="mono" style={{
            fontSize: 18,
            color: total >= 0 ? 'var(--win)' : 'var(--accent)',
          }}>
            {total >= 0 ? '+' : ''}{total.toFixed(1)}
          </span>
        )}
        <span className="small muted">{verdict}</span>
      </div>

      {worst.length > 0 && (
        <p className="small" style={{ marginTop: 0 }}>
          最吃亏的是 <b style={{ color: 'var(--accent)' }}>{worst.map((w) => w.label).join(' 和 ')}</b>
          。
        </p>
      )}

      <div className="why-me">
        {rows.map((r) => (
          <span key={r.key} className={r.diff >= 0 ? 'pos' : 'neg'}>
            {r.label}{nums ? ` ${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}` : r.diff >= 0 ? ' 占优' : ' 吃亏'}
          </span>
        ))}
      </div>
    </div>
  )
}
