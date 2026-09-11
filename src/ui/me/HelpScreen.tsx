import { useGame } from '../ctx'
import { Panel } from '../common'
import { openTour, setToursOff, useToursOff, weekTourOf } from './guide'
import { TIER_LADDER } from './words'
import { AP_HURT, AP_SEASON } from '../../engine/me/actions'
import { AP_PRE } from '../../engine/me/prepro'
import { WEEK_END_FATIGUE } from '../../engine/me/auto'
import { PLAYER_WINDOWS, windowLabel } from '../../engine/me/transfer'
import { WORLD_END } from '../../engine/era'
import './tour.css'

/**
 * 帮助: the rules in plain words, and the tours again.
 *
 * Written against the engine, not from memory: each line says what the code
 * does, in the words the screens already use (累 / 透支, 辐能战魂前 500, 有固定
 * 观众), and the few numbers left are read from the constants that decide
 * them. No formulas — those belong to the screens that act on them.
 */
const SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: '一周怎么过',
    lines: [
      `每周有一把行动点：没有队伍 ${AP_PRE} 点，签约后 ${AP_SEASON} 点，受伤时 ${AP_HURT} 点。`,
      '在「本周」点卡片排好这周做什么，按「推进一周」结算；没用完的点作废。',
      '你队一周有两场以上比赛时，改成一天一推，比赛日当天开打。',
      '一次推几周的按钮替你按推荐排，途中的事按稳妥的选法定，最后给你一份总结。',
    ],
  },
  {
    title: '体力和休息',
    lines: [
      '训练、排位、直播、比赛都耗体力。休息补回来，体质越好补得越多；一周过去，身体自己也回一些。',
      '疲劳到「累」，训练收益打折；到「透支」，容易受伤。体力低于四成，状态和比赛发挥明显下滑。',
      `「按推荐安排」会算上这周的比赛，让周末体力留在 ${100 - WEEK_END_FATIGUE} 上下。`,
    ],
  },
  {
    title: '俱乐部怎么注意到你',
    lines: [
      '没有队伍时有三条路：杯赛走得远、天梯打进辐能战魂前 500、粉丝到「有固定观众」。越往上，来找你的越勤。',
      '第一年的前三个月，天梯和粉丝还不会带来电话，只有杯赛会。',
      '本地俱乐部最先找你；外赛区的少，会外语的多一些。回绝过的俱乐部，今年不会再来。',
      '签约以后，赛段里打得好，别队教练会来看你的比赛。',
    ],
  },
  {
    title: '试训',
    lines: [
      '四天：枪法考核、训练赛、复盘会、经理面谈，每天选一种打法。',
      '稳的选项加减都小，冒险的成败都摆得大。连着几天会累，体质差的人后面几天吃亏。',
      '评级 A+、A、B 拿到合同；C 一级俱乐部不签（打过职业的例外）；D 没有合同。',
      '水平高出一截，俱乐部会免试训直接谈合同；打过职业的人不再考枪法。',
    ],
  },
  {
    title: '合同',
    lines: [
      '合同写着身份（核心、首发、轮换）、年薪、签字费、年限和违约金。写明首发，教练就让你首发。',
      '可以还价，每多问一条成功率更低；问崩一次对方压价，问崩两次就撤回。',
      '底气来自试训评级、粉丝、天梯、履历和经纪人。',
      '合同到期的那个冬天，俱乐部看水平、教练信任和冠军决定续不续；不续，你就成了自由人。',
    ],
  },
  {
    title: '比赛和临场决定',
    lines: [
      '推进到你队的比赛会停下来。你首发的每张图，会问你几次怎么打。',
      '每个选项看一项属性或心态，越冒险，输赢摆得越大；快进按稳妥的选法替你打完。',
      '坐替补、推到赛段末或赛季末途中的比赛不问你。赛后拆解写清赢在哪、输在哪。',
      '坐替补想上场，就打跟队训练赛、发起对位挑战。连着三场全队最差，教练会把你换下两周。',
    ],
  },
  {
    title: '瓶颈和属性用词',
    lines: [
      '八项属性各有瓶颈，就是「我的」页属性条上的竖线。练到那里就不涨，再练只攒条下的细线。',
      '每一项怎么破写在「我的」页，照着做就能破，不看运气；冠军这样的时刻、打完职业赛季，也会松开一些瓶颈。',
      `属性默认说文字：${TIER_LADDER}。职业级大约是 Challengers 首发，一流起够得上 VCT 联赛首发；右上角「数值」换成数字。`,
    ],
  },
  {
    title: '杯赛',
    lines: [
      '没有队伍时打的比赛。本周页「今年的赛事」写着每项第几周开打，邀请制的要粉丝够多。',
      '到了那一周会弹卡片问你报不报名。报了名抽四个路人队友，一轮比一轮强。',
      '走得越远，奖金、热度和战术素养涨得越多，也越可能被俱乐部记住。签约以后不再打杯赛。',
    ],
  },
  {
    title: '转会',
    lines: [
      `转会窗一年开两次：${PLAYER_WINDOWS.map(windowLabel).join('、')}。窗口一开，看上你的俱乐部来报价；也只有窗口开着才能主动挂牌。`,
      '买走你的俱乐部要付违约金。刚签约又在首发，这一季没人来挖。',
      '主动挂牌一年一次，经理会不高兴。「转会」页写着市场怎么看你、离下一级还差多少。',
    ],
  },
  {
    title: '退役',
    lines: [
      '还在打职业、过了 30 岁，每个冬天都有可能退役；33 岁一定退役。',
      '打满五个职业赛季以后，每个赛季结束时可以自己选择收官。',
      '没有队伍四年签不到合同，或当自由人两年没人来电话，生涯也会结束。',
      `这条世界线在 ${WORLD_END - 1} 赛季结束时走到头。结局按你这一路拿到的东西定。`,
    ],
  },
]

export default function HelpScreen() {
  const { game } = useGame()
  const off = useToursOff()
  const me = game.me!
  const retired = me.phase === 'retired'
  const pro = me.phase === 'pro'
  // a greyed tour says why, and what opens it
  const why = retired ? '生涯已经结束，没有本周页可讲。'
    : !pro ? '签约后的导览讲首发名单、对位挑战、比赛里的决定和转会窗，签下一支队以后才能看。' : ''
  return (
    <div>
      <Panel title="导览">
        <div className="help-tours">
          <button className="sm primary" disabled={retired} onClick={() => openTour(weekTourOf(game))}>重看本周页导览</button>
          <button className="sm" disabled={!pro} onClick={() => openTour('season')}>重看签约后的导览</button>
          {off && <button className="sm ghost" onClick={() => setToursOff(false)}>恢复自动弹出</button>}
        </div>
        {(why || off) && (
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>
            {why}{off ? '你选过「不再显示」：新生涯和第一次签约时不会自动弹出。' : ''}
          </p>
        )}
      </Panel>
      <div className="help-grid">
        {SECTIONS.map((s) => (
          <Panel key={s.title} title={s.title}>
            <ul className="help-list">{s.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          </Panel>
        ))}
      </div>
    </div>
  )
}
