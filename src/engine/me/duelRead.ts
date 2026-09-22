import type { GameState, Player } from '../types'

/** Presentation only: the coach's target, ratings and IGL protection are unchanged. */
export interface DuelRelation {
  kind: 'same' | 'secondary' | 'cross'
  tag: string
  label: string
  explanation: string
}

/** DeepSeek draft, reviewed against the current-role/secondary-role save contract. */
export function duelRelation(state: GameState, target: Player): DuelRelation {
  const mine = state.me && state.players[state.me.id]
  if (!mine) return { kind: 'cross', tag: '首发名额竞争', label: '首发名额挑战', explanation: '当前没有你的岗位资料，无法判断是否同位置。' }
  if (target.role === mine.role) return {
    kind: 'same', tag: '同位置对位', label: '对位挑战',
    explanation: `${target.ign} 当前也打${mine.role}，与你竞争同一岗位的首发。`,
  }
  if (target.roles?.includes(mine.role)) return {
    kind: 'secondary', tag: '兼任岗位对位', label: '对位挑战',
    explanation: `${target.ign} 当前打${target.role}，同时能兼任你的${mine.role}岗位，因此也是岗位竞争者。`,
  }
  return {
    kind: 'cross', tag: '首发名额竞争', label: '首发名额挑战',
    explanation: `${target.ign} 打${target.role}，不兼任你当前的${mine.role}岗位。这是跨岗位争取首发名额，不是同位置对位；没有可挑战的同岗位非指挥首发时，教练会安排这种选拔。`,
  }
}
