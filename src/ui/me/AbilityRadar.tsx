import type { Attrs } from '../../engine/types'
import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import { useId } from 'react'
import './ability-radar.css'

/**
 * True eight-attribute radar for the career screen.
 *
 * When `showNumbers` is false, no value-driven SVG is rendered at all —
 * no polygon, no axis labels derived from data, no title/description containing
 * exact values. Instead a non-data-driven message and qualitative words appear.
 * This respects the existing narrative/values privacy switch.
 */
export default function AbilityRadar({ attrs, showNumbers }: { attrs: Attrs; showNumbers: boolean }) {
  const titleId = useId()
  const descId = useId()

  if (!showNumbers) {
    return (
      <div className="ability-radar-off" role="status">
        <p>数值已关闭，雷达图已隐藏</p>
        <p className="tiny muted">
          可通过「数值」开关恢复显示具体能力雷达图。
        </p>
      </div>
    )
  }

  // Show numbers: render the SVG radar with eight real dimensions.
  const values = ATTR_KEYS.map(k => {
    const raw = attrs[k]
    return Number.isFinite(raw) ? Math.max(0, Math.min(99, raw)) : 0
  })
  const n = values.length
  const size = 300
  const cx = 150
  const cy = 150
  const r = 96
  const pt = (i: number, mag: number): [number, number] => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2
    return [cx + Math.cos(angle) * r * mag, cy + Math.sin(angle) * r * mag]
  }
  const polygonPoints = values.map((v, i) => pt(i, v / 99).join(',')).join(' ')

  const exactDescriptions = ATTR_KEYS.map((key, i) => `${ATTR_CN[key]}：${Math.round(values[i])}`).join('，')

  return (
    <div className="ability-radar">
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="ability-radar-svg"
        role="img"
        aria-labelledby={titleId}
        aria-describedby={descId}
      >
        <title id={titleId}>能力雷达图（八项属性）</title>
        <desc id={descId}>
          显示八项属性：{exactDescriptions}。中心为 0，三圈由内向外代表 33、66、99 点。
        </desc>

        {/* rings at 33, 66, 99; the scale is stated below the chart */}
        {[33, 66, 99].map(scale => (
          <polygon
            key={scale}
            points={values.map((_, i) => pt(i, scale / 99).join(',')).join(' ')}
            fill="none"
            stroke="var(--muted)"
            strokeOpacity={0.35}
            strokeWidth={1}
            className="ability-radar-ring"
          />
        ))}

        {/* axes */}
        {values.map((_, i) => {
          const [x, y] = pt(i, 1)
          return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--muted)" strokeOpacity={0.25} strokeWidth={1} className="ability-radar-axis" />
        })}

        {/* data polygon */}
        <polygon
          points={polygonPoints}
          fill="rgba(255, 70, 85, 0.28)"
          stroke="var(--accent)"
          strokeWidth={2}
          className="ability-radar-data"
        />

        {/* data points */}
        {values.map((v, i) => {
          const [x, y] = pt(i, v / 99)
          return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--accent)" className="ability-radar-dot" />
        })}

        {/* axis labels: attribute name and numeric value */}
        {ATTR_KEYS.map((key, i) => {
          const [x, y] = pt(i, 1.2)
          return (
            <g key={key} className="ability-radar-label-group">
              <text
                x={x}
                y={y - 4}
                fill="var(--muted)"
                fontSize={14}
                fontWeight={600}
                textAnchor="middle"
                dominantBaseline="middle"
                className="ability-radar-label"
              >
                {ATTR_CN[key]}
              </text>
              <text
                x={x}
                y={y + 10}
                fill="var(--text)"
                fontSize={13}
                textAnchor="middle"
                dominantBaseline="middle"
                className="ability-radar-value-label"
              >
                {Math.round(values[i])}
              </text>
            </g>
          )
        })}
      </svg>

      <p className="tiny muted ability-radar-scale">八项同一尺度：中心 0 · 三圈 33 / 66 / 99</p>
    </div>
  )
}
