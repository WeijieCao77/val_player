import type { GameState } from '../types'
import { pushLog } from './log'

/**
 * What being hurt feels like.
 *
 * The mechanic is already there and it already bites: the engine rolls for an
 * injury every week and after every match, sets `injuredUntil`, forces rest,
 * and week.ts drops the week to AP_HURT action points. It even picks a named
 * complaint. Nothing in the player layer has ever read that name.
 *
 * So this adds no rule. It gives each complaint a sentence, and puts it in
 * front of the player at the two moments it matters: the day it happens, and
 * every week it is still costing them a week.
 *
 * Ported from 破晓's injury.ts, which had the better line for the one that is
 * not a physical injury at all.
 */

const TEXT: Record<string, string> = {
  手腕劳损: '腱鞘发炎。医生说必须停，不然会变慢性。',
  腱鞘炎复发: '同一只手腕，第二次了。这回没人敢让你硬扛。',
  颈椎不适: '低头太久，手会发麻。',
  重感冒: '不严重，但坐满一局就撑不住。',
  '心理疲劳 / 需要休息': '不是身体的问题。你已经很久没有一天是真正休息的了。',
  肩部拉伤: '抬手就疼。鼠标能握住，但架不了枪。',
}

export interface InjuryStatus {
  note: string
  text: string
  daysLeft: number
  weeksLeft: number
}

/** What is wrong with me right now, if anything. */
export function injuryStatus(state: GameState): InjuryStatus | null {
  const me = state.me
  if (!me) return null
  const p = state.players[me.id]
  if (!p || p.injuredUntil <= state.day) return null
  const note = p.injuryNote ?? '伤病'
  const daysLeft = p.injuredUntil - state.day
  return {
    note,
    text: TEXT[note] ?? '医生让你先停下来。',
    daysLeft,
    weeksLeft: Math.max(1, Math.ceil(daysLeft / 7)),
  }
}

/**
 * Say it once, on the week it starts. Called from the weekly settle, which is
 * the only place that sees every week go by.
 */
export function injuryTick(state: GameState): void {
  const me = state.me
  if (!me) return
  const cur = injuryStatus(state)
  const said = me.flags.injurySaid ?? 0
  const p = state.players[me.id]
  if (cur) {
    // one line per injury, keyed on the day it ends so a new one always speaks
    if (said !== p.injuredUntil) {
      me.flags.injurySaid = p.injuredUntil
      pushLog(state, 'bad', `${cur.note}。${cur.text}预计还要 ${cur.weeksLeft} 周，这期间行动点会少很多。`)
    }
    return
  }
  if (said) {
    me.flags.injurySaid = 0
    pushLog(state, 'good', '伤好了，这周可以正常练了。')
  }
}
