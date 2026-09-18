/**
 * The ladder's tiers as badges, drawn in code: nothing from the client's rank art (the author's rule — original,
 * code-drawn art only). Reported 2026-09-18: 「顶部栏目……连段位图标都不显示」. The rank had a picture only on its
 * first-arrival card, and there every tier was the same shield in another colour (design page, 2026-09-14).
 *
 * Now a silhouette of its own for each tier, one that still reads at 20px, climbing from a plain plate to a star:
 *   黑铁 an iron plate with its corners cut      青铜 a bronze coin with a chevron struck in it
 *   白银 a silver shield, split down the middle   黄金 a gold shield with a crown's three points and a star
 *   铂金 a teal crystal, lit on one side          钻石 a violet cut gem, its facets drawn
 *   超凡入圣 a green arrow rising on two wings      神话 a crimson flame, cut in straight lines
 *   辐能战魂 a pale-gold eight-rayed star on a glow
 * Each is two-toned, a bright face and a dark rim of its own hue, so it holds on the dark ground and on 浅 and 米
 * alike without a theme's help; no gradients and no ids, so any number can share a page. The divisions are one to
 * three small diamonds under the emblem. 辐能战魂 has none, and neither had 神话 before patch 3.05 — rankAt already
 * says so with div 0 (me/rank.ts rulesAt); an emblem with no diamonds stands lower, in the middle of its box.
 */
interface Tone { face: string; rim: string; lit: string }

const TONE: Record<string, Tone> = {
  黑铁: { face: '#8b949f', rim: '#3d444e', lit: '#c6ccd3' },
  青铜: { face: '#c47c45', rim: '#5f3314', lit: '#ecb487' },
  白银: { face: '#bfc9d4', rim: '#56626f', lit: '#f1f4f7' },
  黄金: { face: '#e9b42e', rim: '#7a5105', lit: '#ffe594' },
  铂金: { face: '#33b5ab', rim: '#0f4f4a', lit: '#9aede5' },
  钻石: { face: '#aa74ee', rim: '#482081', lit: '#dec6ff' },
  超凡入圣: { face: '#36c77a', rim: '#105a33', lit: '#a9f3ca' },
  神话: { face: '#d52b47', rim: '#5a0916', lit: '#ff8898' },
  辐能战魂: { face: '#ffe59a', rim: '#a3741a', lit: '#fffbea' },
}

/** 辐能战魂's light */
const GLOW = '#ffc93c'

/** a tier's colour, its badge's face */
export const tierColor = (tier: string): string => TONE[tier]?.face ?? 'currentColor'

/** the nine emblems in a 48-unit box, above the row of division diamonds (y 41.5–47.5) */
function Emblem({ tier, t }: { tier: string; t: Tone }) {
  const rim = { stroke: t.rim, strokeWidth: 1.8, strokeLinejoin: 'round' as const }
  const line = { fill: 'none', stroke: t.rim, strokeWidth: 1, strokeLinecap: 'round' as const, opacity: 0.55 }
  switch (tier) {
    case '黑铁':
      return (
        <>
          <path d="M14 5H34L41 12V30L34 37H14L7 30V12Z" fill={t.face} {...rim} />
          <path d="M14.6 6.4H33.4L38.6 11.6H9.4Z" fill={t.lit} />
          <path d="M9.4 30.4H38.6L33.4 35.6H14.6Z" fill={t.rim} opacity=".35" />
          <path d="M15.5 28L22 15H26.5L20 28ZM23.5 28L30 15H34.5L28 28Z" fill={t.lit} />
        </>
      )
    case '青铜':
      return (
        <>
          <circle cx="24" cy="21" r="16" fill={t.face} {...rim} />
          <circle cx="24" cy="21" r="11.5" fill="none" stroke={t.rim} strokeWidth="1.2" opacity=".6" />
          <path d="M16.5 26L24 16.5L31.5 26H27L24 22.2L21 26Z" fill={t.lit} />
        </>
      )
    case '白银':
      return (
        <>
          <path d="M8 6H40V19C40 29 33.5 35.5 24 40C14.5 35.5 8 29 8 19Z" fill={t.face} {...rim} />
          <path d="M24 7.4H9.4V19C9.4 28 15 34 24 38.4Z" fill={t.lit} />
        </>
      )
    case '黄金':
      return (
        <>
          <path d="M8 13L13.5 4L19 10.5L24 2L29 10.5L34.5 4L40 13V22C40 30.5 33.5 36 24 40C14.5 36 8 30.5 8 22Z" fill={t.face} {...rim} />
          <path d="M24 16L25.76 20.57L30.66 20.84L26.85 23.93L28.11 28.66L24 26L19.89 28.66L21.15 23.93L17.34 20.84L22.24 20.57Z" fill={t.lit} stroke={t.rim} strokeWidth=".8" strokeLinejoin="round" />
        </>
      )
    case '铂金':
      return (
        <>
          <path d="M24 3L38 11V29L24 39L10 29V11Z" fill={t.face} {...rim} />
          <path d="M24 4.7L11.4 11.8V28.2L24 21Z" fill={t.lit} />
          <path d="M24 21V37.3M24 21L36.6 11.8" {...line} />
        </>
      )
    case '钻石':
      return (
        <>
          <path d="M14 6H34L42 15L24 39L6 15Z" fill={t.face} {...rim} />
          <path d="M18 7.3H30L32.5 15H15.5Z" fill={t.lit} />
          <path d="M7.5 15H40.5M15.5 15L24 37M32.5 15L24 37M18 7.3L15.5 15M30 7.3L32.5 15" {...line} />
        </>
      )
    case '超凡入圣':
      return (
        <>
          <path d="M17 21L4 12L6.5 26L17 31ZM31 21L44 12L41.5 26L31 31Z" fill={t.lit} {...rim} />
          <path d="M24 2L37 17H30.5V38H17.5V17H11Z" fill={t.face} {...rim} />
          <path d="M24 4.3L13.9 15.9H19V36.6H24Z" fill={t.lit} />
        </>
      )
    case '神话':
      return (
        <>
          <path d="M24 2L32 13L37 9.5L39 25L32 37H16L9 25L11 9.5L16 13Z" fill={t.face} {...rim} />
          <path d="M24 13L30 22.5L27.5 32H20.5L18 22.5Z" fill={t.lit} />
        </>
      )
    case '辐能战魂':
      return (
        <>
          {/* the glow: warm rings fading outward, which read as light on the dark ground and as a halo on 浅 and 米 */}
          <circle cx="24" cy="21" r="19" fill={GLOW} opacity=".14" />
          <circle cx="24" cy="21" r="14" fill={GLOW} opacity=".2" />
          <circle cx="24" cy="21" r="9.5" fill={GLOW} opacity=".3" />
          <path d="M24 1.5L27.1 14.6L33.9 11.1L30.4 17.9L43.5 21L30.4 24.1L33.9 30.9L27.1 27.4L24 40.5L20.9 27.4L14.1 30.9L17.6 24.1L4.5 21L17.6 17.9L14.1 11.1L20.9 14.6Z" fill={t.face} {...rim} strokeWidth={1.3} />
          <circle cx="24" cy="21" r="5.6" fill={t.lit} stroke={t.rim} strokeWidth="1" />
        </>
      )
    default:
      return null
  }
}

/**
 * A tier's badge, `size` pixels square. Named for the rank it shows (aria-label 「段位：钻石 3」), since it stands
 * beside the words only on the screens that have room for them.
 */
export function RankBadge({ tier, div = 0, size = 32, className }: { tier: string; div?: number; size?: number; className?: string }) {
  const t = TONE[tier]
  if (!t) return null
  const pips = Math.max(0, Math.min(3, Math.floor(div)))
  const name = pips ? `${tier} ${pips}` : tier
  return (
    <svg
      className={`rank-badge${tier === '辐能战魂' ? ' radiant' : ''}${className ? ` ${className}` : ''}`}
      viewBox="0 0 48 48" width={size} height={size} role="img" aria-label={`段位：${name}`}
    >
      <g transform={pips ? 'translate(1.92 0) scale(.92)' : 'translate(0 3.5)'}>
        <Emblem tier={tier} t={t} />
      </g>
      {Array.from({ length: pips }, (_, i) => {
        const x = 24 + (i - (pips - 1) / 2) * 9.5
        return <path key={i} d={`M${x} 39.9l3.7 3.7-3.7 3.7-3.7-3.7z`} fill={t.face} stroke={t.rim} strokeWidth="1.2" strokeLinejoin="round" />
      })}
    </svg>
  )
}
