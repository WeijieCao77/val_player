import type { Attrs } from '../types'
import type { MeAction } from './types'

export const AP_SEASON = 8
export const AP_HURT = 4
export const DUELS_PER_WEEK = 2

export interface ActionDef {
  key: MeAction
  label: string
  cost: number
  desc: string
  /** which attributes the extra hours go into */
  attrs?: (keyof Attrs)[]
  /** condition cost (negative restores) */
  fatigue: number
  /** which block of the week board it sits in: my own practice, things that
      need a club, or the hours outside the game */
  group: 'train' | 'team' | 'life'
}

export const ACTION_GROUP_CN: Record<ActionDef['group'], string> = {
  train: '个人训练', team: '战队', life: '赛场外与恢复',
}

/**
 * Priced by real time and energy, as 破晓 prices them: 1 = a few games in the
 * evening, 2 = half a day, 3 = a whole afternoon with the team.
 */
export const ACTIONS: ActionDef[] = [
  { key: 'aim', label: '枪法训练', cost: 2, desc: '练枪软件与死斗，练枪法与反应', attrs: ['aim', 'reaction'], fatigue: 8, group: 'train' },
  { key: 'vod', label: '复盘', cost: 2, desc: '看录像，练意识与残局判断', attrs: ['awareness', 'clutch'], fatigue: 3, group: 'train' },
  { key: 'util', label: '道具与跑图', cost: 2, desc: '点位与配合，练道具、协同、沟通', attrs: ['utility', 'teamwork', 'communication'], fatigue: 6, group: 'train' },
  { key: 'ranked', label: '打排位', cost: 1, desc: '保持手感，本位置几项小涨，状态回中', fatigue: 4, group: 'train' },
  { key: 'scrim', label: '跟队训练赛', cost: 3, desc: '教练看得见你，出场回合算进履历；涨协同与沟通', fatigue: 9, group: 'team' },
  { key: 'duo', label: '队友双排', cost: 1, desc: '和一名队友双排，涨羁绊', fatigue: 2, group: 'team' },
  { key: 'stream', label: '直播', cost: 2, desc: '涨热度，赚礼物', fatigue: 5, group: 'life' },
  { key: 'content', label: '做内容', cost: 2, desc: '剪辑、日常视频、采访；涨热度，粉丝多了也有点钱', fatigue: 4, group: 'life' },
  { key: 'rest', label: '休息', cost: 1, desc: '回体力，泄压；心态与体质慢慢涨', fatigue: -14, group: 'life' },
  { key: 'duel', label: '对位挑战', cost: 2, desc: '替补时向同位置首发发起训练赛对位，赢够三次教练给你试用期（每周最多 2 次）', fatigue: 7, group: 'team' },
]

export const ACTION_BY_KEY: Record<MeAction, ActionDef> = Object.fromEntries(
  ACTIONS.map((a) => [a.key, a]),
) as Record<MeAction, ActionDef>
