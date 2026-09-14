/**
 * A ladder tier's emblem for the rank card, drawn in code (design page,
 * 2026-09-14): one shield, a notch for each division, wings for 神话, a crown of
 * rays for 辐能战魂. The colours are this game's own, not the client's rank art.
 */
const TIER_COLOR: Record<string, string> = {
  黑铁: '#7d8794', 青铜: '#b9824f', 白银: '#c3ccd6', 黄金: '#e8b23a', 铂金: '#3fb8b3', 钻石: '#c08cf5',
  超凡入圣: '#3dd68c', 神话: '#ff4655', 辐能战魂: '#ffe28a',
}

export const tierColor = (tier: string): string => TIER_COLOR[tier] ?? 'currentColor'

export function RankEmblem({ tier, div = 0 }: { tier: string; div?: number }) {
  const c = tierColor(tier)
  const pips = Math.max(0, Math.min(3, div))
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      {tier === '神话' && <path d="M14 20L3 16l3 9-3 7 11-2M50 20l11-4-3 9 3 7-11-2" fill="none" stroke={c} strokeWidth="2" />}
      {tier === '辐能战魂' && <path d="M22 8l3-7 3 7M29 7l3-7 3 7M36 8l3-7 3 7" fill="none" stroke={c} strokeWidth="1.8" />}
      <path d="M32 8l18 7v16c0 12-7 20-18 25-11-5-18-13-18-25V15z" fill={c} fillOpacity=".18" stroke={c} strokeWidth="2.2" />
      <path d="M32 18l8 3v9c0 6-3.5 10-8 12.5-4.5-2.5-8-6.5-8-12.5v-9z" fill={c} fillOpacity=".6" />
      {Array.from({ length: pips }, (_, i) => {
        const x = 32 + (i - (pips - 1) / 2) * 7
        return <path key={i} d={`M${x} 45l3 3-3 3-3-3z`} fill={c} />
      })}
    </svg>
  )
}
