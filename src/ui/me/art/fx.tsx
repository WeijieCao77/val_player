/**
 * Art for the career's big moments, drawn in code (design page, 2026-09-14): no
 * official artwork, no photographs. Everything strokes and fills in currentColor,
 * so each theme colours it and a card sets it with `color`; no gradient ids, so
 * any number can share a page. The trophies are generic shapes, not replicas.
 */

const RAY_ANGLES = Array.from({ length: 16 }, (_, i) => i * 22.5)

/** The slow-turning rays behind a moment's art. */
export function Rays({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-100 -100 200 200" aria-hidden="true">
      <g fill="currentColor">
        {RAY_ANGLES.map((a, i) => (
          <polygon key={a} points={i % 2 ? '-3,-16 3,-16 0,-72' : '-4,-16 4,-16 0,-100'} transform={`rotate(${a})`} />
        ))}
      </g>
    </svg>
  )
}

/** A medal: ribbon, disc, star. Ceremony results and awards nights; its colour is the grade. */
export function Medal() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M19 3h9l7 21h-9zM45 3h-9l-7 21h9z" fill="currentColor" fillOpacity=".35" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="32" cy="41" r="17" fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2" />
      <circle cx="32" cy="41" r="11.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".7" />
      <path d="M32 33l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill="currentColor" />
    </svg>
  )
}

/** 冠军赛: a tall faceted cup on a long stem and a three-step base. */
export function TrophyChampions() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter">
        <path d="M19 5h26l-3 21-7 7h-6l-7-7z" />
        <path d="M29 33h6v11h-6z" />
        <path d="M24 44h16v4H24zM20 48h24v4H20zM16 52h32v6H16z" />
      </g>
      <path d="M25 12h14M26 18h12" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
    </svg>
  )
}

/** 大师赛: a disc with a four-point star, standing on its mount. */
export function TrophyMasters() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2">
        <circle cx="32" cy="23" r="17" />
        <path d="M28 41h8l6 16H22z" />
      </g>
      <path d="M32 10l3.5 9.5L45 23l-9.5 3.5L32 36l-3.5-9.5L19 23l9.5-3.5z" fill="currentColor" />
    </svg>
  )
}

/** 联赛 and 挑战者联赛: a two-handled cup on a square base. */
export function TrophyLeague() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="currentColor" fillOpacity=".16" stroke="currentColor" strokeWidth="2">
        <path d="M21 10h22l-2 19a9 9 0 0 1-18 0z" />
        <path d="M29 38h6v8h-6zM22 46h20v11H22z" />
      </g>
      <path d="M21 15h-6c0 8 3 12 8 12M43 15h6c0 8-3 12-8 12" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

/** 晋级赛: a shield with two chevrons pointing up. */
export function PromoBadge() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M32 4l22 8v18c0 14-9 24-22 30C19 54 10 44 10 30V12z" fill="currentColor" fillOpacity=".12" stroke="currentColor" strokeWidth="2" />
      <path d="M20 35l12-10 12 10M20 45l12-10 12 10" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinejoin="miter" />
    </svg>
  )
}
