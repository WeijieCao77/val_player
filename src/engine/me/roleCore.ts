import type { Attrs, Role } from '../types'

/** The three distinct jobs tested in a positional trial, not a bonus to the role label. */
const CORE: Record<Role, readonly (keyof Attrs)[]> = {
  决斗者: ['aim', 'reaction', 'clutch'],
  先锋: ['utility', 'awareness', 'teamwork'],
  控场: ['utility', 'awareness', 'teamwork'],
  哨卫: ['awareness', 'utility', 'clutch'],
  自由人: ['aim', 'awareness', 'utility'],
}

export const roleCoreDims = (role: Role): (keyof Attrs)[] => [...CORE[role]]
