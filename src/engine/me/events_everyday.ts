import type { GameState, Role } from '../types'
import type { EventDef } from './events'
import { activeAbsence } from './absence'
import { ensureCareerEvents, recordCareerEvent } from './eventState'

// Draft themes supplied by DeepSeek v4 Pro; prerequisites, choices and effects reviewed locally.
const pro = (s: GameState) => s.me!.phase === 'pro' && !activeAbsence(s)
const role = (r: Role) => (s: GameState) => pro(s) && s.players[s.me!.id].role === r
const support = (text: string, helpsTeammate = false) => (s: GameState, i: number): string[] => {
  if (helpsTeammate && i === 0) ensureCareerEvents(s).supportChoices++
  recordCareerEvent(s, 'support', text)
  return []
}

export const EVERYDAY_EVENTS: EventDef[] = [
  { id: 'career_info_partner', w: 5, max: 4, rec: 0, when: role('先锋'),
    q: '队友说，你报的信息很准，但进点时还是慢了半拍。', ctx: '复盘里，两个人对“现在进”的理解差了一秒。你们决定把信号说得更具体。',
    a: [{ t: '一起约定报点和跟进口令', g: 'warm', e: { xp: { communication: 12, teamwork: 8 }, fatigue: 3 } },
      { t: '整理一套自己的信息时序笔记', g: 'grind', e: { xp: { awareness: 12, utility: 8 }, fatigue: 3 } }],
    onResolve: support('把先锋的信息转化成了队友能跟进的信号。', true) },
  { id: 'career_watch_flank', w: 5, max: 4, rec: 0, when: role('哨卫'),
    q: '你看住了侧翼，但队友没意识到这条路一直是安全的。', ctx: '数据面板没写这一轮的耐心。复盘时，你把防绕后的时间线拿了出来。',
    a: [{ t: '约定转点前的安全确认', g: 'warm', e: { xp: { communication: 10, teamwork: 10 }, fatigue: 3 } },
      { t: '研究一个能更早预警的布防', g: 'grind', e: { xp: { utility: 12, awareness: 8 }, fatigue: 3 } }],
    onResolve: support('与队友约定了侧翼警戒和转点交接。', true) },
  { id: 'career_smoke_timing', w: 5, max: 4, rec: 0, when: role('控场'),
    q: '烟散的那一秒，队友才刚走到入口。', ctx: '不是谁故意慢了，是你们没有对齐时间。训练结束后还有一点讨论的余地。',
    a: [{ t: '和突破手对齐倒数口令', g: 'warm', e: { xp: { teamwork: 12, communication: 8 }, fatigue: 3 } },
      { t: '和指挥画一套备用烟位', g: 'grind', e: { xp: { utility: 12, igl: 8 }, fatigue: 3 } }],
    onResolve: support('让烟位的落点和队伍进攻的时机对上了。', true) },
  { id: 'career_entry_followup', w: 5, max: 4, rec: 0, when: role('决斗者'),
    q: '你撕开了缺口，但第二个人没跟上。', ctx: '队友把录像倒回进点前：“给我一个信号，我就能补到。”',
    a: [{ t: '一起练进点和补枪节奏', g: 'warm', e: { xp: { teamwork: 12, communication: 8 }, fatigue: 3 } },
      { t: '复盘更适合自己的突破路线', g: 'grind', e: { xp: { aim: 10, awareness: 10 }, fatigue: 3 } }],
    onResolve: support('突破不只是一人的击杀，还包括队友接得上的下一枪。', true) },
  { id: 'career_ladder_encouragement', w: 5, max: 3, rec: 0, when: s => s.me!.phase === 'pre',
    q: '排位结束后，一位路人给你发来了一段鼓励。', ctx: '“我记得你那次补枪，打职业不只看今天这几把。”你还没有合同，但有人认真看过你的表现。',
    a: [{ t: '道谢，把今天的失误列出来', g: 'warm', e: { mental: 1, xp: { awareness: 12 } } },
      { t: '关掉排位，休息一个晚上', g: 'grind', e: { fatigue: -8, tilt: -5 } }],
    onResolve: support('尚未签约的日子里，收到过一个路人的认真鼓励。') },
  { id: 'career_challenger_mentor', w: 5, max: 3, rec: 0, when: s => pro(s) && s.teams[s.myTeam]?.tier === 2,
    q: '一位次级联赛前辈问你，要不要聊聊试训时最容易被忽略的事。', ctx: '他说，先把自己的位置打明白，再让别人看见。建议很具体，没有承诺一条直通顶级联赛的捷径。',
    a: [{ t: '请他看一段自己的录像', g: 'warm', e: { xp: { awareness: 14, communication: 6 }, fatigue: 3 } },
      { t: '整理自己的角色贡献给教练看', g: 'show', e: { coachTrust: 3, xp: { teamwork: 10 } } }],
    onResolve: support('次级联赛前辈帮你把下一步拆成了可以练习的小事。') },
  { id: 'career_recovery_support', w: 7, max: 3, rec: 0, allowDuringAbsence: true,
    when: s => s.me!.phase === 'pro' && !!activeAbsence(s) && activeAbsence(s)!.reason !== 'family',
    q: '康复期间，队友把整理好的复盘笔记发给了你。', ctx: '“不用赶进度，也不用证明什么。等你好了，我们再一起打。”这些支持不会缩短必要的休养期。',
    a: [{ t: '道谢，安心按计划休养', g: 'warm', e: { mental: 2, tilt: -6 } },
      { t: '告诉大家自己想安静休息几天', g: 'grind', e: { fatigue: -10, tilt: -4 } }],
    onResolve: support('休养时得到队友支持，也可以坦然保留自己的休息空间。') },
  { id: 'career_family_return', w: 8, max: 2, rec: 0,
    when: s => pro(s) && (s.me!.careerEvents?.familyReturns ?? 0) > (s.me!.eventCounts.career_family_return ?? 0),
    q: '聊起处理家事后归队的那段日子，队友拿出了为你整理的战术笔记。', ctx: '那时大家没有要求你立刻补回所有进度。现在回头再看，也能整理出适合自己的节奏。',
    a: [{ t: '和队友一起把变化过一遍', g: 'warm', e: { xp: { teamwork: 12 }, mental: 1 } },
      { t: '先与教练约定恢复计划', g: 'grind', e: { coachTrust: 3, fatigue: -6 } }],
    onResolve: support('处理好家庭事务后，在队伍帮助下重新进入职业节奏。') },
  { id: 'career_good_talk', w: 5, max: 4, rec: 0, when: pro,
    q: '战术讨论出现了分歧，但这次大家愿意把话说完。', ctx: '意见不同不必变成站队。你们还有一块白板，也还有时间。',
    a: [{ t: '先复述对方的想法，再谈自己的', g: 'warm', e: { xp: { communication: 12 }, bond: 5 } },
      { t: '把两套方案交给教练做对照', g: 'grind', e: { xp: { awareness: 10, igl: 8 }, coachTrust: 1 } }],
    onResolve: support('一次战术分歧最终变成了清楚的讨论，而不是队内争执。', true) },
  { id: 'career_veteran_teaches', w: 5, max: 3, rec: 0,
    when: s => pro(s) && s.players[s.me!.id].age >= 25 && s.teams[s.myTeam].roster.some(id => id !== s.me!.id && s.players[id]?.age <= 21),
    q: '年轻队友问你，第一次坐上职业替补席时是怎么熬过来的。', ctx: '你已经不是刚来基地的那个人了。对方没有要一个成功秘诀，只是想听一点真实经历。',
    a: [{ t: '陪他聊聊自己的低谷', g: 'warm', e: { bond: 8, mental: 1 } },
      { t: '给他写一份具体训练清单', g: 'grind', e: { xp: { communication: 10, igl: 10 }, fatigue: 3 } }],
    onResolve: support('以老将的身份，把走过弯路的经验交给了年轻队友。', true) },
  { id: 'career_quiet_evening', w: 5, max: 4, rec: 0, allowDuringAbsence: true, when: s => s.me!.phase !== 'retired',
    q: '今晚没有必须回应的消息，也没有一定要追的排名。', ctx: '手机安静了下来。给自己一点与输赢无关的时间，也是一种安排。',
    a: [{ t: '读一会儿喜欢的书', g: 'warm', e: { mental: 1, tilt: -8 } },
      { t: '早点睡觉', g: 'grind', e: { fatigue: -12 } }],
    onResolve: support('留了一个与排名和输赢无关的安静夜晚。') },
  { id: 'career_fan_after_loss', w: 5, max: 3, rec: 0, when: s => pro(s) && s.me!.fans >= 100 && s.players[s.me!.id].morale < 65,
    q: '情绪低落时，你收到一封没有责备的来信。', ctx: '对方记得你为队伍做过的那些小事，也说会等下一场。支持不只在顺利的时候出现。',
    a: [{ t: '认真回信，感谢这份耐心', g: 'warm', e: { mental: 1, fans: 10 } },
      { t: '把信收好，等心情平静再回应', g: 'grind', e: { tilt: -8, morale: 3 } }],
    onResolve: support('情绪低落的时候，仍然有人愿意等待你的下一场。') },
]
