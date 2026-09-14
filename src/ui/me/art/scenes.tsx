/**
 * Scene strips for the event and ceremony cards (事件档, design page 2026-09-14):
 * 320×120 line drawings in currentColor, square joins, drawn in code — no
 * official artwork, no photographs. A card lays one along its top and may set a
 * crest or a face over its corner. Eleven places a career passes through.
 */
import type { ReactNode } from 'react'

export type SceneKey = 'stage' | 'tunnel' | 'airport' | 'room' | 'board' | 'media' | 'clinic' | 'stream' | 'contract' | 'bracket' | 'empty'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinejoin: 'miter' as const }
const F = { fill: 'currentColor' }

const DRAW: Record<SceneKey, ReactNode> = {
  // 舞台: the big screen, two side screens, the desks, lights coming down — draws, awards, show matches, farewells
  stage: (
    <>
      <path {...S} d="M0 118h320M58 118l26-34h152l26 34M84 84h152" />
      <path {...S} d="M104 16h112v52H104zM30 28h52v34H30zM238 28h52v34h-52z" />
      <path {...S} d="M138 84v-9h44v9M116 84v-6h14v6M190 84v-6h14v6" />
      <path {...S} d="M44 0l30 84M276 0l-30 84" opacity=".45" />
      <path {...F} d="M150 42l10-12 10 12-10 12z" opacity=".55" />
    </>
  ),
  // 选手通道: the corridor to the stage and the light at its end — walking out for a final
  tunnel: (
    <>
      <path {...S} d="M0 0l128 40M320 0L192 40M0 120l128-40M320 120L192 80M128 40h64v40h-64z" />
      <path {...S} d="M60 120l92-40M260 120l-92-40" opacity=".35" />
      <path d="M38 12l10 3M84 26l9 3M282 12l-10 3M236 26l-9 3" stroke="currentColor" strokeWidth="3" />
      <path {...F} d="M132 44h56v32h-56z" opacity=".24" />
    </>
  ),
  // 机场: the glass wall, a plane climbing, the departures board — flying out to an international event
  airport: (
    <>
      <path {...S} d="M10 8h300v96H10zM85 8v96M160 8v96M235 8v96M10 68h300M0 118h320" />
      <path {...S} d="M108 50L214 32M170 43l-14-16M170 43l18 16M208 33l6-9" />
      <path {...S} d="M22 78h48v20H22z" />
      <path d="M28 84h32M28 91h24" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
    </>
  ),
  // 训练室: five screens on one desk, the chairs, a board of plans — tryouts, the locker room
  room: (
    <>
      <path {...S} d="M0 118h320M16 78h288" />
      <path {...S} d="M28 50h42v26H28zM82 50h42v26H82zM136 50h48v26h-48zM196 50h42v26h-42zM250 50h42v26h-42z" />
      <path {...S} d="M49 78v10M103 78v10M160 78v10M217 78v10M271 78v10M110 6h100v32H110z" />
      <path {...S} d="M40 118l6-22h18l6 22M148 118l6-22h18l6 22M258 118l6-22h18l6 22" opacity=".5" />
      <path d="M122 26l18-8 18 10 22-12" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
    </>
  ),
  // 白板: a tactics board with a map's lanes and arrows — patch day, the pool question
  board: (
    <>
      <path {...S} d="M60 8h200v88H60zM150 96l-14 22M170 96l14 22M0 118h320" />
      <path {...S} d="M80 30h50v40H80zM190 30h50v40h-50zM130 50h60" opacity=".7" />
      <path {...S} d="M96 62c20-24 60-24 96-8M180 48l12 6-8 10" />
      <path {...F} d="M100 40l4 4-4 4-4-4zM220 58l4 4-4 4-4-4z" />
    </>
  ),
  // 媒体墙: the sponsor wall, a lectern with microphones, cameras in front — media days, press
  media: (
    <>
      <path {...S} d="M20 6h280v80H20zM0 118h320" />
      <path {...S} d="M20 33h280M20 60h280M113 6v80M206 6v80" opacity=".35" />
      <path {...S} d="M140 118V70h40v48M150 70l-6-14M170 70l6-14M160 70V52" />
      <path {...S} d="M36 118l10-24h26l10 24M58 94V84M248 118l10-24h26l10 24M270 94V84" />
      <circle cx="144" cy="54" r="3" fill="currentColor" />
      <circle cx="176" cy="54" r="3" fill="currentColor" />
      <circle cx="160" cy="50" r="3" fill="currentColor" />
    </>
  ),
  // 理疗室: the treatment bench, a lamp, a wall of resistance bands — injuries and rehab
  clinic: (
    <>
      <path {...S} d="M0 118h320M60 80h150v10H60zM70 90v28M200 90v28" />
      <path {...S} d="M60 80c0-8 6-12 14-12h20v12" />
      <path {...S} d="M246 118V30l40-14M286 16v14M276 30h20l-10 14z" />
      <path {...S} d="M22 10v56M34 10v48M46 10v60" opacity=".55" />
      <path d="M22 66a4 4 0 0 0 0 8M34 58a4 4 0 0 0 0 8M46 70a4 4 0 0 0 0 8" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
    </>
  ),
  // 直播间: one screen, a ring light, the camera, chat running up the side — streaming offers
  stream: (
    <>
      <path {...S} d="M0 118h320M90 20h140v80H90zM150 100v10M130 110h60" />
      <circle cx="54" cy="40" r="24" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="54" cy="40" r="15" fill="none" stroke="currentColor" strokeWidth="1.4" opacity=".5" />
      <path {...S} d="M54 64v54M42 118l12-14 12 14" />
      <path {...S} d="M256 24h44M256 40h36M256 56h44M256 72h28M256 88h40" opacity=".55" />
      <path {...F} d="M106 32h8v8h-8z" opacity=".8" />
    </>
  ),
  // 合同: two copies on a table and a pen — offers, contracts, renewals
  contract: (
    <>
      <path {...S} d="M0 118h320M30 96h260" />
      <path {...S} d="M78 20h84v76H78zM178 30h70v66h-70z" />
      <path {...S} d="M92 36h56M92 48h56M92 60h40M190 46h46M190 58h46M190 70h30" opacity=".6" />
      <path {...S} d="M96 84c8-8 14 4 22-4s10 2 16-2" />
      <path {...S} d="M250 90l40-52 6 5-40 52-9 4z" />
    </>
  ),
  // 对阵树: brackets closing to one slot — cup rounds, knockouts, qualification
  bracket: (
    <>
      <path {...S} d="M20 12h56v18H20zM20 42h56v18H20zM20 70h56v18H20zM20 98h56v18H20z" />
      <path {...S} d="M76 21h20v30H76M76 79h20v30H76M96 36h34M96 94h34" />
      <path {...S} d="M130 26h56v18h-56zM130 84h56v18h-56zM186 35h22v58h-22M208 64h30" />
      <path {...S} d="M238 52h62v24h-62z" />
      <path {...F} d="M262 58l6 6-6 6-6-6z" />
    </>
  ),
  // 空房间: a box of peripherals by the door and one chair left — a roster released, free agency
  empty: (
    <>
      <path {...S} d="M0 118h320M40 10v108M40 10h92v108" />
      <path {...S} d="M150 118V76h60v42M150 76l10-12h60l-10 12M220 64v42l-10 12" />
      <path {...S} d="M168 92h24" opacity=".6" />
      <path {...S} d="M252 118l6-26h24l6 26M258 92V58h24v34" />
      <path {...S} d="M58 40h56v40H58z" opacity=".35" />
      <circle cx="120" cy="66" r="3" fill="currentColor" />
    </>
  ),
}

export function Scene({ kind, className }: { kind: SceneKey; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 320 120" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      {DRAW[kind]}
    </svg>
  )
}
