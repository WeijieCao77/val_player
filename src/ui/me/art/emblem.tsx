/**
 * The ladder's tiers as the client draws them: VALORANT's own rank icons, one per division, in public/ranks.
 *
 * The author, 2026-09-18: 「段位用真实的图，不要自己造」 — the code-drawn badges that stood here for a day gave way
 * to the real ones, as the agents' portraits already are (public/agents). Fetched from valorant-api.com, Episode 5's
 * tier table (03621f52…, 黑铁 1 to 辐能战魂), as webp. 神话 before patch 3.05 was one rank with no division
 * (me/rank.ts rulesAt, div 0): its icon is Episode 2's single 神话, immortal.webp.
 */
const KEY: Record<string, string> = {
  黑铁: 'iron', 青铜: 'bronze', 白银: 'silver', 黄金: 'gold', 铂金: 'platinum',
  钻石: 'diamond', 超凡入圣: 'ascendant', 神话: 'immortal', 辐能战魂: 'radiant',
}

const BASE = typeof import.meta.env !== 'undefined' ? import.meta.env.BASE_URL : './'

/** the file of a tier and division: 「神话 2」 immortal-2.webp, 辐能战魂 radiant.webp, 神话 with no division immortal.webp */
export const rankIconSrc = (tier: string, div = 0): string | null => {
  const k = KEY[tier]
  if (!k) return null
  const d = Math.max(0, Math.min(3, Math.floor(div)))
  return `${BASE}ranks/${k}${k === 'radiant' || !d ? '' : `-${d}`}.webp`
}

export function RankBadge({ tier, div = 0, size = 32, className }: { tier: string; div?: number; size?: number; className?: string }) {
  let src = rankIconSrc(tier, div)
  if (!src) return null
  // every tier below 辐能战魂 has divisions; only 神话 was ever without them
  if (!div && tier !== '神话' && tier !== '辐能战魂') src = rankIconSrc(tier, 1)!
  const d = Math.max(0, Math.min(3, Math.floor(div)))
  const name = d && tier !== '辐能战魂' ? `${tier} ${d}` : tier
  return (
    <img
      className={`rank-badge${className ? ` ${className}` : ''}`}
      src={src} width={size} height={size} alt={`段位：${name}`} title={name}
      loading="lazy" decoding="async" draggable={false}
    />
  )
}
