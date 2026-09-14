/**
 * One line icon per achievement route — the 18 groups of ACH_ROUTES in
 * engine/me/achievements.ts — for the unlock card and its list. 24×24, square
 * joins and currentColor: the broadcast look chosen on 2026-09-14, kept apart
 * from 破晓's rounded gold line art. Drawn in code, nothing official.
 */
import type { ReactNode } from 'react'
import type { AchRoute } from '../../../engine/me/achievements'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinejoin: 'miter' as const }

const DRAW: Record<AchRoute, ReactNode> = {
  // 天梯与杯赛: steps and an arrow up
  ladder: <path {...S} d="M3 21h5v-5h5v-5h5V6h3M15 3h6v6" />,
  // 试训与签约: a pen over the signature line
  sign: <path {...S} d="M5 19l1-4L17 4l3 3L9 18zM15 6l3 3M4 22h16" />,
  // 替补到首发: the bench, someone waiting
  bench: <><path {...S} d="M3 13h18M5 13v7M19 13v7M3 17h18" /><circle cx="9" cy="7" r="2.4" fill="currentColor" /></>,
  // 挑战者联赛: a pennant
  chal: <path {...S} d="M5 22V3M5 4h13l-3 4 3 4H5" />,
  // 晋级之路: two chevrons up
  promo: <path {...S} d="M5 13l7-6 7 6M5 20l7-6 7 6" />,
  // VCT 联赛: a two-handled cup
  league: <path {...S} d="M7 4h10v5a5 5 0 0 1-10 0zM7 6H4c0 3 1 5 3 5M17 6h3c0 3-1 5-3 5M12 14v4M8 21h8" />,
  // 大师赛与冠军赛: a crown
  crown: <path {...S} d="M3 18l2-11 5 5 2-7 2 7 5-5 2 11zM3 21h18" />,
  // 国际赛场: a globe
  world: <g {...S}><circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" /></g>,
  // 转会与出海: arrows both ways
  move: <path {...S} d="M4 8h14M14 4l4 4-4 4M20 16H6M10 12l-4 4 4 4" />,
  // 直播与人气: a signal going out
  fans: <><path {...S} d="M4 17a8 8 0 0 1 16 0M8 17a4 4 0 0 1 8 0" /><circle cx="12" cy="17" r="1.8" fill="currentColor" /></>,
  // 队友: two side by side
  bond: <g {...S}><circle cx="8" cy="8" r="3" /><circle cx="16" cy="8" r="3" /><path d="M2 20c0-4 3-6 6-6s6 2 6 6M10 20c0-4 3-6 6-6s6 2 6 6" /></g>,
  // 临场决策: the headset
  calls: <path {...S} d="M4 14v-2a8 8 0 0 1 16 0v2M4 14h3v6H4zM17 14h3v6h-3zM20 20c0 1.5-2 2-5 2" />,
  // 残局与数据: a crosshair
  stats: <><g {...S}><circle cx="12" cy="12" r="6" /><path d="M12 2v5M12 17v5M2 12h5M17 12h5" /></g><circle cx="12" cy="12" r="1.6" fill="currentColor" /></>,
  // 瓶颈与成长: a bar broken through
  break: <path {...S} d="M14 2v6M14 16v6M3 12h15M14 7l5 5-5 5" />,
  // 跌倒再起: coming back round
  back: <path {...S} d="M20 12a8 8 0 1 1-3-6.3M20 3v5h-5" />,
  // 老将与退役: an hourglass
  vet: <path {...S} d="M6 3h12M6 21h12M7 3c0 5 10 7 10 9s-10 4-10 9M17 3c0 5-10 7-10 9s10 4 10 9" />,
  // 失败与坚持: a flame
  grit: <path {...S} d="M12 22c-4 0-7-3-7-7 0-4 4-6 4-10 3 2 4 4 4 6 1-1 2-2 2-4 2 2 4 5 4 8 0 4-3 7-7 7z" />,
  // 场外: home
  life: <path {...S} d="M3 11l9-7 9 7M5 10v11h14V10M10 21v-6h4v6" />,
}

export function RouteGlyph({ route }: { route: AchRoute }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{DRAW[route] ?? DRAW.ladder}</svg>
}
