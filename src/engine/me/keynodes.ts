import type { HlOpt, NodeDef } from './nodes'

/**
 * The key-round nodes, written by where in the round the call happens
 * (2026-09-12, 策划稿 §6.2: 按回合阶段写节点). Every line is original.
 *
 * Each node says what it claims about its round as a premise — which side we
 * are on, what was bought, whether the Spike is down, who is standing — and is
 * asked only where the round, played out every way the call can go, agrees
 * (me/keyround.ts). Each says which facts on the screen favour which option
 * (me/hints.ts). Each option has its four lines — landed or not, round taken or
 * not — and a line that says I killed somebody is picked by how many I really
 * killed in that round: `k0` none, `k1` one (at least one when there is no
 * `k2`), `k2` two or more. No line says how the round ended or claims that I
 * fell; the round record says the first, and nothing checks the second.
 */

export const KEY_NODES: NodeDef[] = [
  // ---------------------------------------------------------------- entry: before the plant
  { id: 'atk_open', phase: 'entry', q: '开局三十秒，你们还没拿到任何信息。', ctx: '先抢中路的控制，还是直接挑一个点打，指挥让你来定。',
    premise: { side: 'atk' }, rec: 0,
    lean: { theirBroke: 1, theirSaved: 0, streakUs: 1, streakThem: 0, threeSites: 0, teamUp: 0, teamDown: 1 },
    a: [{ t: '带着技能去抢中路', dim: 'utility', risk: 0.55 }, { t: '不绕了，直接顶一个点', dim: 'reaction', risk: 0.85 }] },
  { id: 'atk_exec', phase: 'entry', q: '烟已经封住了枪位，指挥喊了进点。', ctx: '五个人贴着烟往里压，你站在哪个位置，决定这波能不能打开。',
    premise: { side: 'atk', buyMine: ['full', 'force'] }, rec: 2,
    lean: { duelUp: 0, duelDown: 1, meHot: 0, theyHot: 2, theirBroke: 0, theirSaved: 1, threeSites: 0, teleporter: 2 },
    a: [
      { t: '第一个冲进去清近点', dim: 'reaction', risk: 0.9 },
      { t: '交技能把架枪的人逼出来', dim: 'utility', risk: 0.6 },
      { t: '留在后面，看住回防的路', dim: 'awareness', risk: 0.45 },
    ] },
  { id: 'def_contact', phase: 'entry', q: '防守开局，你守的这条路上传来了脚步声。', ctx: '是一个人来探，还是整队要压过来，现在还说不准。',
    premise: { side: 'def' }, rec: 1,
    lean: { duelUp: 0, duelDown: 1, theirBroke: 0, theirSaved: 1, meHot: 0, meCold: 1, theyHot: 1 },
    a: [{ t: '探出去先打一枪', dim: 'reaction', risk: 0.85 }, { t: '退回点里，等队友来补', dim: 'teamwork', risk: 0.45 }] },
  { id: 'def_execute', phase: 'entry', q: '对面的烟和闪光砸进了你守的点。', ctx: '是真打，还是把技能交在这里骗你们转点。',
    premise: { side: 'def' }, rec: 1,
    lean: { duelUp: 0, duelDown: 1, teamUp: 2, teamDown: 1, theirBroke: 0, theirSaved: 1, threeSites: 0, teleporter: 1 },
    a: [
      { t: '顶着技能守住位置', dim: 'clutch', risk: 0.85 },
      { t: '先让出来，等回防一起打', dim: 'teamwork', risk: 0.5 },
      { t: '交自己的技能拖住他们', dim: 'utility', risk: 0.6 },
    ] },

  // ---------------------------------------------------------------- mid: rotating, regrouping, the count after the first fights
  { id: 'mid_fake', phase: 'mid', q: '你们在一个点做了假打，对面已经有人往这边转了。', ctx: '另一个点现在人少，可转过去要时间。',
    premise: { side: 'atk' }, rec: 1,
    lean: { threeSites: 0, teleporter: 1, teamUp: 0, teamDown: 1, theirBroke: 0, streakThem: 1 },
    a: [{ t: '立刻带人转去另一个点', dim: 'communication', risk: 0.7 }, { t: '把假打做足，再多拖他们一会', dim: 'utility', risk: 0.5 }] },
  { id: 'mid_rotate', phase: 'mid', q: '另一个点传来了技能声，队友喊那边人多。', ctx: '转过去，你这边就空了。',
    premise: { side: 'def' }, rec: 1,
    lean: { threeSites: 0, teleporter: 1, teamUp: 0, teamDown: 1, theirSaved: 0, streakThem: 0 },
    a: [{ t: '马上转过去', dim: 'teamwork', risk: 0.7 }, { t: '再等一秒，确认不是假打', dim: 'awareness', risk: 0.5 }] },
  { id: 'mid_trade', phase: 'mid', q: '刚才那一波双方各倒了一个，四打四。', ctx: '人数一样，接下来就看谁先抢到位置。',
    premise: { alive: { mine: 4, theirs: [4, 4] } }, rec: 1,
    lean: { duelUp: 0, duelDown: 1, teamUp: 1, teamDown: 0, meHot: 0, meCold: 1, theyHot: 1, streakUs: 0, streakThem: 1 },
    a: [{ t: '趁乱往前压一步', dim: 'reaction', risk: 0.8 }, { t: '先收拢，和队友站到一起', dim: 'teamwork', risk: 0.45 }] },
  { id: 'mid_up', phase: 'mid', q: '交火之后你们多一个人，四打三。', ctx: '多一个人的时候，最怕的是一个一个送上去。',
    premise: { alive: { mine: 4, theirs: [3, 3] } }, rec: 1,
    lean: { duelUp: 0, duelDown: 1, theirBroke: 0, meHot: 0, theyHot: 1, streakThem: 1, longLines: 1 },
    a: [{ t: '趁人多马上压上去', dim: 'reaction', risk: 0.75 }, { t: '慢慢挤，逼他们先动', dim: 'teamwork', risk: 0.4 }] },
  { id: 'mid_down', phase: 'mid', q: '交火之后你们少一个人，三打四。', ctx: '硬碰硬打不过，得想别的办法。',
    premise: { alive: { mine: 3, theirs: [4, 4] } }, rec: 0,
    lean: { teamUp: 0, teamDown: 1, duelUp: 1, duelDown: 0, meHot: 1, theyHot: 0, threeSites: 1 },
    a: [{ t: '三个人抱在一起打一个点', dim: 'teamwork', risk: 0.55 }, { t: '你一个人绕去侧面找机会', dim: 'clutch', risk: 0.9 }] },
]

export const KEY_HL: Record<string, HlOpt[]> = {
  atk_open: [
    {
      okWin: '你们用技能把中路抢到手，从两边一起压进点，这回合拿下。',
      okLoss: '中路的控制是你们的，可进点的时候对面回防到得更快，这回合丢了。',
      failWin: '技能交在中路没换到什么，队友硬是从正面把点打开，这回合拿下。',
      failLoss: '技能在中路交空了，进点的时候手里什么都没剩，这回合丢了。',
    },
    {
      okWin: { k0: '你带头顶进点，对面还没站稳就被逼退，这回合拿下。', k1: '你带头顶进点，放倒一个守点的，队友跟着涌了进来，这回合拿下。', k2: '你带头顶进点，连着放倒两个，这回合拿下。' },
      okLoss: { k0: '你顶进点逼退了第一个人，可身后的人没跟上，这回合丢了。', k1: '你顶进点放倒一个，可身后的人没跟上，这回合丢了。' },
      failWin: '你顶上去就被架住，只能退回来，队友换了个方向把点打开，这回合拿下。',
      failLoss: '你顶上去就被架住，进点的节奏断在了门口，这回合丢了。',
    },
  ],
  atk_exec: [
    {
      okWin: { k0: '你第一个冲进去，把近点的人逼得往后缩，队友顺势占满了点，这回合拿下。', k1: '你第一个冲进去，放倒近点的人，队友顺势占满了点，这回合拿下。', k2: '你第一个冲进去连着放倒两个，点几乎是空着让出来的，这回合拿下。' },
      okLoss: { k0: '你第一个冲进去逼退了近点的人，可后面的枪位没人补，这回合丢了。', k1: '你第一个冲进去放倒一个，可后面的枪位没人补，这回合丢了。' },
      failWin: '你冲进去被逼了回来，队友从另一侧把点打开，这回合拿下。',
      failLoss: '你冲进去被逼了回来，这波进点就这么散了，这回合丢了。',
    },
    {
      okWin: '你的技能把架枪的位置逼了出来，队友一步一步清过去，这回合拿下。',
      okLoss: '你的技能把架枪的位置逼了出来，可对面补位太快，这回合丢了。',
      failWin: '你的技能交偏了，架枪的人还在，好在队友的枪更快，这回合拿下。',
      failLoss: '你的技能交偏了，架枪的人纹丝不动，这回合丢了。',
    },
    {
      okWin: { k0: '你守在后面，回防的人一露头就被你报了出来，这回合拿下。', k1: '你守在后面，回防的第一个人刚露头就被你放倒，这回合拿下。' },
      okLoss: { k0: '你把回防的路看得很死，可点里的对枪输了，这回合丢了。', k1: '你在后面放倒了回防的人，可点里的对枪输了，这回合丢了。' },
      failWin: '你守的那条路没人来，回防从另一边绕了进去，好在点里顶住了，这回合拿下。',
      failLoss: '你守的那条路没人来，回防从另一边绕了进去，这回合丢了。',
    },
  ],
  def_contact: [
    {
      okWin: { k0: '你探出去一枪逼退了来人，这条路再没人敢走，这回合拿下。', k1: '你探出去放倒了来探路的人，对面只能换方向，这回合拿下。', k2: '你探出去连着放倒两个，这条路被你一个人堵死，这回合拿下。' },
      okLoss: { k0: '你探出去逼退了来人，可对面整队转去了另一个点，这回合丢了。', k1: '你探出去放倒一个，可对面整队转去了另一个点，这回合丢了。' },
      failWin: '你探出去没打中，缩回来的时候队友已经补到了位置，这回合拿下。',
      failLoss: '你探出去没打中，对面顺着这条路压进了点，这回合丢了。',
    },
    {
      okWin: '你退回点里和队友站成交叉，对面压进来正撞上枪口，这回合拿下。',
      okLoss: '你退回点里和队友站好了位置，可对面的技能太多，这回合丢了。',
      failWin: '你退得太早，这条路被对面白白拿走，好在回防打得干净，这回合拿下。',
      failLoss: '你退得太早，这条路被对面白白拿走，这回合丢了。',
    },
  ],
  def_execute: [
    {
      okWin: { k0: '你顶着技能没挪一步，拖到了队友回来，这回合拿下。', k1: '你顶着技能没挪一步，放倒第一个冲进来的人，这回合拿下。', k2: '你顶着技能守住位置，连着放倒两个，这回合拿下。' },
      okLoss: { k0: '你顶着技能拖了很久，可冲进来的人太多，这回合丢了。', k1: '你顶着技能放倒一个，可冲进来的人太多，这回合丢了。' },
      failWin: '技能里什么都看不见，你没守住位置，好在回防把点抢回来，这回合拿下。',
      failLoss: '技能里什么都看不见，你没守住位置，这回合丢了。',
    },
    {
      okWin: '你把点让了出来，和队友从三个方向一起回防，这回合拿下。',
      okLoss: '你把点让了出来，回防的人也到齐了，可这一波没打进去，这回合丢了。',
      failWin: '你让得太早，回防的人还没到齐，好在对面自己乱了阵脚，这回合拿下。',
      failLoss: '你让得太早，回防的人还没到齐，这回合丢了。',
    },
    {
      okWin: '你的技能把他们卡在门口多站了几秒，队友赶到，这回合拿下。',
      okLoss: '你的技能拖住了几秒，可对面第二波技能跟着就到，这回合丢了。',
      failWin: '你的技能交早了，他们等烟散了才进，好在队友已经转到，这回合拿下。',
      failLoss: '你的技能交早了，他们等烟散了才进，这回合丢了。',
    },
  ],
  mid_fake: [
    {
      okWin: '你在语音里一喊，五个人同时转向，另一个点只剩一个人在守，这回合拿下。',
      okLoss: '你们转点转得很快，可对面留下的那个人拖住了时间，这回合丢了。',
      failWin: '转点的时候队伍拉得太长，前后脱了节，好在另一个点真的空着，这回合拿下。',
      failLoss: '转点的时候队伍拉得太长，前后脱了节，这回合丢了。',
    },
    {
      okWin: '你的技能把假打做得像真的一样，对面的人都转了过来，另一边轻松打开，这回合拿下。',
      okLoss: '假打骗走了对面的人，可真打的那一波没能打开，这回合丢了。',
      failWin: '假打没骗到人，对面一个都没动，好在正面硬打也打开了，这回合拿下。',
      failLoss: '假打没骗到人，对面一个都没动，这回合丢了。',
    },
  ],
  mid_rotate: [
    {
      okWin: '你第一时间转了过去，补上了那边的人数，这回合拿下。',
      okLoss: '你转得很快，那边的人数也够了，可对面的技能更多，这回合丢了。',
      failWin: '你刚转走，对面就从你原来的点压了进来，好在队友回头补住，这回合拿下。',
      failLoss: '你刚转走，对面就从你原来的点压了进来，这回合丢了。',
    },
    {
      okWin: '你多等了一秒，果然是假打，真正的人冲进了你守着的点，这回合拿下。',
      okLoss: '你等到确切的信息才动，位置没错，可对面这一波打得更好，这回合丢了。',
      failWin: '你多等的这一秒让那边少了一个人，好在队友硬是撑住，这回合拿下。',
      failLoss: '你多等的这一秒让那边少了一个人，这回合丢了。',
    },
  ],
  mid_trade: [
    {
      okWin: { k0: '你往前压了一步，把对面的站位挤乱了，这回合拿下。', k1: '你往前压了一步，放倒一个，四打三被你们打穿，这回合拿下。', k2: '你往前压了一步，连着放倒两个，这回合拿下。' },
      okLoss: { k0: '你往前压占到了位置，可对面反应过来补了枪，这回合丢了。', k1: '你往前压放倒一个，可对面反应过来补了枪，这回合丢了。' },
      failWin: '你往前压早了一步，被逼了回来，好在队友稳住了阵型，这回合拿下。',
      failLoss: '你往前压早了一步，被逼了回来，阵型也散了，这回合丢了。',
    },
    {
      okWin: '你收拢回来和队友站成一排，对面一个一个撞了上来，这回合拿下。',
      okLoss: '你们收拢站好了位置，可对面把技能一口气砸了下来，这回合丢了。',
      failWin: '收拢的时候慢了半拍，位置被对面抢走，好在枪还是更准，这回合拿下。',
      failLoss: '收拢的时候慢了半拍，位置被对面抢走，这回合丢了。',
    },
  ],
  mid_up: [
    {
      okWin: { k0: '你们趁着人多一起压上去，对面三个人根本站不住，这回合拿下。', k1: '你们趁着人多压上去，你放倒一个，这回合拿下。', k2: '你们趁着人多压上去，你连着放倒两个，这回合拿下。' },
      okLoss: { k0: '你们压上去占住了位置，可对面的交叉火力等着你们，这回合丢了。', k1: '你压上去放倒一个，可对面的交叉火力等着你们，这回合丢了。' },
      failWin: '压得太急，你被逼退了一步，好在人数还在，这回合拿下。',
      failLoss: '压得太急，你们一个一个撞进了对面的枪口，这回合丢了。',
    },
    {
      okWin: '你们一步一步往里挤，对面忍不住先出来，这回合拿下。',
      okLoss: '你们挤得很稳，可对面一波技能把人数追平，这回合丢了。',
      failWin: '挤得太慢，对面把位置都站好了，好在人多，这回合还是拿下。',
      failLoss: '挤得太慢，对面把位置都站好了，这回合丢了。',
    },
  ],
  mid_down: [
    {
      okWin: '你们三个人抱成一团，一个角落一个角落清过去，这回合拿下。',
      okLoss: '你们三个人抱得很紧，可对面还是多出一个人，这回合丢了。',
      failWin: '三个人挤在一起反而被技能砸中，好在最后的枪没掉链子，这回合拿下。',
      failLoss: '三个人挤在一起，被一波技能砸散，这回合丢了。',
    },
    {
      okWin: { k0: '你绕到了侧面，对面回头找你的时候，队友正好压了进去，这回合拿下。', k1: '你绕到侧面，从背后放倒一个，人数一下被扳平，这回合拿下。', k2: '你绕到侧面，从背后连着放倒两个，这回合拿下。' },
      okLoss: { k0: '你绕到侧面牵制住了对面，可正面的队友没撑住，这回合丢了。', k1: '你绕到侧面放倒一个，可正面的队友没撑住，这回合丢了。' },
      failWin: '你绕的那条路被对面看住，只能退回来，好在队友正面打得漂亮，这回合拿下。',
      failLoss: '你绕的那条路被对面看住，三打四变得更难打，这回合丢了。',
    },
  ],
}

/** Pool lines, for a call where none of the facts a node reads is true: KEY_HINTS[id][i] favour option i. */
export const KEY_HINTS: Record<string, string[][]> = {
  atk_open: [['对面这张图习惯把人放在点里，中路常常空着。'], ['对面开局喜欢往中路前压，点里的人反而少。']],
  atk_exec: [['对面守这个点的人习惯站在近处，冲进去就是贴脸。'], ['对面这个点喜欢留一个人在后面架枪，不逼出来进不去。'], ['对面回防总是来得很快，后面没人看会被夹。']],
  def_contact: [['来探路的多半是一个人，他身边没有技能跟着。'], ['脚步声很密，不像是一个人。']],
  def_execute: [['技能来得很散，后面跟着的人不多。'], ['烟和闪光一起到，这是整队的真打。'], ['对面进点前总要在门口等技能，拖住就是时间。']],
  mid_fake: [['转过来的是对面的两个人，另一个点只剩一个。'], ['对面还没拿定主意，只转过来一个人在看。']],
  mid_rotate: [['技能声后面紧跟着很密的脚步。'], ['那边只有技能声，听不到脚步。']],
  mid_trade: [['对面倒下的是指挥，剩下的人还在等口令。'], ['对面剩下的四个人都在往一起靠。']],
  mid_up: [['对面剩下的三个人分在三个地方。'], ['对面剩下的人抱在一起，正等你们冲。']],
  mid_down: [['对面四个人分成了两边，中间隔得很远。'], ['对面四个人都盯着正面，侧面没人看。']],
}
