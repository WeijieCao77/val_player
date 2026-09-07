import type { GameState } from '../types'
import type { Quest } from './types'
import { pushLog } from './log'
import { applyEffect } from './fx'

/**
 * Something an event left me to do, with a date on it. Progress comes from
 * the week's plan and the matches; it changes how this week's points get
 * spent, which is the whole point.
 */
export const QUEST_DEFS: Record<string, (state: GameState) => Quest> = {
  ad: (s) => ({ id: 'ad', title: '广告尾款：3 周内直播 2 次', kind: 'stream', need: 2, done: 0, deadline: s.day + 21,
    rewardText: '尾款 $4,000', penaltyText: '赔 $3,000，经理信任 −3',
    reward: { money: 4000 }, penalty: { money: -3000, gmTrust: -3 } }),
  rumor: (s) => ({ id: 'rumor', title: '用比赛说话：3 周内赢 2 场', kind: 'win', need: 2, done: 0, deadline: s.day + 21,
    rewardText: '粉丝 +60，经理信任 +6', penaltyText: '掉粉 70',
    reward: { fans: 60, gmTrust: 6 }, penalty: { fans: -70 } }),
  bible: (s) => ({ id: 'bible', title: '闷头训练：3 周内练 6 次', kind: 'train', need: 6, done: 0, deadline: s.day + 21,
    rewardText: '粉丝 +40，心态 +1', penaltyText: '掉粉 35',
    reward: { fans: 40, mental: 1 }, penalty: { fans: -35 } }),
  ladder: (s) => ({ id: 'ladder', title: '直播冲分：2 周内打 4 次排位', kind: 'ranked', need: 4, done: 0, deadline: s.day + 14,
    rewardText: '热度 +30，$1,500', penaltyText: '热度 −15',
    reward: { heat: 30, money: 1500 }, penalty: { heat: -15 } }),
  scrim: (s) => ({ id: 'scrim', title: '教练的要求：3 周内跟队训练赛 3 次', kind: 'scrim', need: 3, done: 0, deadline: s.day + 21,
    rewardText: '教练信任 +8', penaltyText: '教练信任 −6',
    reward: { coachTrust: 8 }, penalty: { coachTrust: -6 } }),
}

export function addQuest(state: GameState, key: string): void {
  const me = state.me!
  const mk = QUEST_DEFS[key]
  if (!mk || me.quests.some((q) => q.id === key)) return
  const q = mk(state)
  me.quests.push(q)
  pushLog(state, 'event', `待办：${q.title}。做到 → ${q.rewardText}；做不到 → ${q.penaltyText}。`)
}

export function questProgress(state: GameState, kind: Quest['kind'], n: number): void {
  const me = state.me
  if (!me || !n) return
  for (const q of me.quests) {
    if (q.kind !== kind || q.done >= q.need) continue
    q.done = Math.min(q.need, q.done + n)
    if (q.done >= q.need) {
      const lines = applyEffect(state, q.reward)
      pushLog(state, 'good', `做到了：${q.title} → ${lines.join('，')}。`)
    }
  }
  me.quests = me.quests.filter((q) => q.done < q.need)
}

export function questWeek(state: GameState): void {
  const me = state.me!
  for (const q of me.quests.slice()) {
    if (q.done >= q.need) continue
    if (state.day >= q.deadline) {
      const lines = applyEffect(state, q.penalty)
      pushLog(state, 'bad', `没做到：${q.title}（${q.done}/${q.need}）→ ${lines.join('，')}。`)
      me.quests = me.quests.filter((x) => x.id !== q.id)
    }
  }
}
