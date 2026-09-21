import type { GameState } from '../types'

export interface CareerMark { id: string; title: string; text: string }
interface MarkDef extends CareerMark { cond: (s: GameState) => boolean }

/** These are remembered facts, not a replacement for trophies or the main ending. */
export const CAREER_MARKS: MarkDef[] = [
  { id: 'peak_cut_short', title: '高开低走', text: '站上职业巅峰后，重病让你提前告别赛场。病痛终止了比赛，没有抹掉你到过的高度。',
    cond: (s) => s.me?.careerEvents?.medicalRetirement?.atPeak === true },
  { id: 'core_exile', title: '臭名昭著', text: '与至少三位不同的队内核心公开决裂，并因此被俱乐部解约。每一次关上的门，都留下了名字。',
    cond: (s) => new Set((s.me?.careerEvents?.disputes ?? []).filter((d) => d.wasCore === true && d.dismissed === true && !!d.mateId).map((d) => d.mateId)).size >= 3 },
  { id: 'final_absence', title: '空悲切', text: '队伍走到了大师赛或冠军赛的总决赛，你却因伤病无法上场。那一晚，你的位置留在了赛场之外。',
    cond: (s) => (s.me?.careerEvents?.missedFinals ?? []).some((f) => ['surgery', 'illness', 'injury'].includes(f.reason)) },
]

export const careerMarksFor = (s: GameState): CareerMark[] => CAREER_MARKS.filter((m) => m.cond(s)).map(({ id, title, text }) => ({ id, title, text }))

/** Hall exports carry keys and use canonical copy; malformed/imported text never becomes a new mark. */
export function cleanCareerMarks(raw: unknown): CareerMark[] {
  if (!Array.isArray(raw)) return []
  const ids = new Set(raw.flatMap((x) => x && typeof x === 'object' && typeof x.id === 'string' ? [x.id] : []))
  return CAREER_MARKS.filter((m) => ids.has(m.id)).map(({ id, title, text }) => ({ id, title, text }))
}
