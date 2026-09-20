import { useGame } from './ctx'
import { Panel } from './common'
import { nextCardWindow, openTour, pageNotes, setNextHidden, setToursOff, useNextHidden, useToursOff, weekTourOf } from './guide'
import { TIER_LADDER } from './words'
import { AP_HURT, AP_SEASON } from '../../engine/me/actions'
import { ABROAD_CAP, AP_PRE, LANG_EXTRA, MATE_SHARE } from '../../engine/me/prepro'
import { WEEK_END_FATIGUE } from '../../engine/me/auto'
import { RELIEF_FLOOR } from '../../engine/me/shop'
import { windowRuleLines } from '../../engine/me/window'
import { CONTACT_TRUST, NEVPRO_TOP, PITCH_AP, PITCH_LEAD, PITCH_MAX, REPLY_MAX, REPLY_MIN } from '../../engine/me/selfpitch'
import { WORLD_END } from '../../engine/era'
import { PROMISE_FLOOR } from '../../engine/me/coach'
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
    // the one word on each start card (engine/me/career.ts START_CN tag), said in full here: what the
    // door gives you on day one, and what it costs in time. The ceiling is the same through all three
    // — 天赋 and 出身 decide it — so what differs is how soon you stand on which stage.
    title: '开局怎么选',
    lines: [
      '「从天梯开始」（挑战）：三扇门里唯一没有俱乐部、也没有工资的一个。杯赛、排位、粉丝换来试训，第一份合同多半在第一个赛季里，打进 VCT 联赛还要再等好几个赛季。',
      '「Challengers 二队」（中等，2021 年叫二线队首发）：第一天就有俱乐部，而且是二队首发，打的是二级赛事。上一线队要先在二队打出名堂，奖杯也从二级赛事拿起。',
      '「VCT 替补」（轻松，2021 年叫强队替补）：第一天就在一线队名单上，第一年就可能跟着队伍站上国际赛。代价是首发位置得自己抢，教练不认你就一直坐着。',
      '三扇门的天花板一样：属性上限由天赋和出身决定，开局决定的是你多快站上哪种舞台、多早碰到奖杯。',
    ],
  },
  {
    title: '一周怎么过',
    lines: [
      `每周有一把行动点：没有队伍 ${AP_PRE} 点，签约后 ${AP_SEASON} 点，受伤时 ${AP_HURT} 点。`,
      '在「本周」点卡片，点一下当场就做：属性、天梯、钱、体力立刻就动，卡片上面会留一行结果。',
      '按「推进一周」过完这一周：工资、伤病、瓶颈判定和身体自己回的那点体力在这里结；没用完的点作废。',
      '点错了不要紧：卡上的「−」把这一次退回去，属性、体力、钱和天梯都回到没点之前，推进一周才定下来。灰掉的卡会写明为什么。',
      '「重复上一周」照你上一周点过的顺序再来一遍，点数、体力不够的会告诉你；「按推荐做完」把剩下的点按稳妥的路子做完。',
      '你队一周有两场以上比赛时，改成一天一推，比赛日当天开打。',
      '「快进到…」一次推几周，接下来四周没有你的比赛时可以推一个月：没排的周按推荐来，事件这类小事按稳妥的选法定，最后给你一份总结。',
      '合同、试训邀请、转会、直播独家、杯赛报名，快进遇到会停下来等你；在「托管」里交出去的除外。',
    ],
  },
  {
    title: '体力和休息',
    lines: [
      '训练、排位、直播、比赛都耗体力，点下去当场就扣。休息当场补回来，体质越好补得越多；一周过去，身体自己也回一些。',
      '疲劳到「累」，训练收益打折；到「透支」，容易受伤。体力低于四成，状态和比赛发挥明显下滑。',
      `「按推荐做完」会算上这周的比赛，让周末体力留在 ${100 - WEEK_END_FATIGUE} 上下。`,
      '「按推荐做完」和快进、托管做训练时，天赋点得和均衡型不一样的，每周三节练习里会有一节跟着天赋走：比均衡型多点的那几项，多得越多越常练到（沟通是和关系最差的队友双排；只多一两点的，几周才轮到一次）。让出来的是那一周对综合最不值的一节，正在冲的瓶颈不让；均衡型照旧。',
      `理疗、短途旅行和电竞公寓不占行动点，但只把体力补到 ${100 - RELIEF_FLOOR} 为止：把人从一场硬仗里拉回来，替不了平常的休息。花钱买的是舒服、少受伤、心态，不是训练量。`,
    ],
  },
  {
    title: '俱乐部怎么注意到你',
    lines: [
      '没有队伍时有三条路让俱乐部来找你：杯赛走得远、天梯打进辐能战魂前 500（国服的名次；人少的服务器要排得更靠前）、粉丝到「有固定观众」。越往上，来找你的越勤。不想干等，还可以自己挑一家发自荐（见「转会」）。',
      '天梯段位和游戏里一样：每个小段 100 RR；神话起胜点不封顶，按名次上本服排行榜；辐能战魂要两条一起够——排进本服排行榜前 500 名，胜点也要到本服的门槛（国服、欧服、亚服、北美服 300，巴西服 200，韩服、拉美服 100）。人少的巴西服门槛咬得早，前 500 名里也会有人还显示神话。你在「来自」的服务器打排位。',
      '不打排位，分数和 RR 都不会掉。只是神话起名次是和还在打的人比：你停下来，榜上的人还在涨分，你的名次往后掉，辐能战魂掉出前 500 名就按 RR 显示神话几，RR 不变；停得越久掉得越多，只是越掉越慢。回来打，要把 RR 打过涨上去的榜单，名次才回得来。俱乐部看的是你现在的名次。',
      '第一年的前两个月，天梯和粉丝还不会带来电话，只有杯赛会。',
      '天梯站上线之后别掉下去：站住的周数越多，俱乐部越可能打给你，掉下线一周就少记一周。',
      `本赛区和外赛区的俱乐部都可能来找你，各看各的门槛；不会外语时，外赛区的邀请加起来平均不超过本赛区的 ${Math.round(ABROAD_CAP * 10)} 成（本赛区一家都够不着的时候除外）。2023 年起按 VCT 联赛分赛区：同一个联赛里别的国家的俱乐部也算本赛区，比如北美选手看巴西、拉美的俱乐部，卡片上标「国外俱乐部」，每家来找你的机会大约是本国俱乐部的 ${Math.round(MATE_SHARE * 10)} 成；别的联赛的俱乐部才标「外赛区」。签去国外俱乐部和去外赛区一样算出海。会外语的，本赛区的邀请和报价照常来，有俱乐部来找你时另有 ${Math.round(LANG_EXTRA * 10)} 成机会多来一家外赛区的。回绝过的俱乐部，今年不会再来。`,
      '签约以后，赛段里打得好，别队教练会来看你的比赛。',
    ],
  },
  {
    title: '试训',
    lines: [
      '四天：岗位专项、训练赛、复盘会、经理面谈，每天选一种打法。决斗者展示突破，先锋与控场展示道具配合，哨卫展示防守阅读，自由人展示综合阅读；已经开始的旧试训保持原题。',
      '稳的选项加减都小，冒险的成败都摆得大。连着几天会累，体质差的人后面几天吃亏。',
      '评级 A+、A、B 拿到合同；C 一级俱乐部不签（打过职业的例外）；D 没有合同。',
      '水平高出一截，俱乐部会免试训直接谈合同；打过职业的人不再考枪法。',
    ],
  },
  {
    title: '合同',
    lines: [
      `合同写着身份（核心、首发、轮换、替补）、年薪、签字费、年限和违约金。写明核心或首发，俱乐部接下来 ${PROMISE_FLOOR} 场比赛写死是你首发；写明替补，先坐满 ${PROMISE_FLOOR} 场替补。这 ${PROMISE_FLOOR} 场打完，谁上谁不上教练说了算；轮换不设保底，从第一场起就归教练排。`,
      '可以还价，每多问一条成功率更低；问崩一次对方压价，问崩两次就撤回。',
      '底气来自试训评级、粉丝、天梯、履历和经纪人。',
      '合同到期的那个冬天，俱乐部看水平、教练信任和冠军决定续不续；不续，或者你拒绝了续约，当场成为自由人。',
    ],
  },
  {
    title: '比赛和临场决定',
    lines: [
      '推进到你队的比赛、杯赛的比赛日会停下来。你首发的每张图，会问你几次怎么打。',
      '每个选项看一项属性或心态，越冒险，输赢摆得越大；快进按稳妥的选法替你打完。',
      '坐替补、推到赛段末或赛季末途中的比赛不问你。赛后拆解写清赢在哪、输在哪。',
      '坐替补想上场，就打跟队训练赛、发起对位挑战。新对位按你的岗位考三项不同的核心能力，手动和托管使用同一标准。以首发打满 8 场、教练信任到「信任」以上，或者以首发拿下冠军，就是他认定的首发。新比赛里，输球且队内末位还要贡献不足，才累计表现不佳；连着三场会换下两周，刚以首发夺冠的保护场次不算。',
      '新比赛的贡献评分同时看击杀、助攻、死亡、首杀差和残局，不按位置白送分；教练评价、赛后排名和 MVP 使用同一贡献口径。MVP 另有小幅胜方加成，多图按实际总回合汇总，ACS 不再独自决定奖项。旧比赛记录与已颁奖项保留原判定。',
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
      '没有队伍时打的比赛。本周页「今年的赛事」写着每项第几周报名，邀请制的要粉丝够多。',
      '到了那一周会弹卡片问你报不报名。报了名抽四个路人队友，下一周的周末打首轮，之后一周一轮，一轮比一轮强。',
      '比赛日当天弹卡开打；两轮之间是平常的日子，照常训练、休息、买理疗和外设。打不了可以在比赛卡上弃权，奖金按已赢的轮次算。',
      '走得越远，奖金、热度和战术素养涨得越多，也越可能被俱乐部记住。签约以后不再打杯赛，没打完的就此退出。',
    ],
  },
  {
    title: '转会',
    lines: [
      // the year's window rules go in front of these, read off the save (engine/me/window.ts windowRuleLines)
      '也只有窗口开着才能主动挂牌、要求签人。',
      '买走你的俱乐部要付违约金。刚签约又在首发，这一季没人来挖。',
      '主动挂牌一年一次，经理会不高兴。「转会」页写着市场怎么看你、离下一级还差多少。',
      `没有合同时可以自荐：在「转会」页点名一家，每次 ${PITCH_AP} 行动点，一个转会期最多 ${PITCH_MAX} 次，同一家一次。${REPLY_MIN}–${REPLY_MAX} 天后回复：成了是一份试训邀请，之后照常试训、评级、谈合同；没成写明原因，那家本赛季不再收你的自荐。`,
      `自荐的把握看俱乐部的档次（二队和弱队最容易，VCT 最难）、你离他们的门槛差多少、他们缺不缺你这个位置、天梯段位、粉丝和打没打过职业；按钮上的数就是结算用的数。没打过职业的人投 VCT 最多 ${NEVPRO_TOP}%。关掉「数值」时写成文字。`,
      `有合同时可以主动接触一家：两边的窗口都开着、名单没锁，一个转会期一次。你的经理会知道，信任 −${CONTACT_TRUST}。成了由对方和你的俱乐部谈转会费，离他们要求近的先请你去试训；他们的预算付不起你的违约金，把握会低很多。`,
      `自荐和接触都要目标俱乐部的窗口至少还开 ${PITCH_LEAD} 天；这个转会期刚签约、手上有试训邀请或正在试训、谈妥了下一家、上一份还没回复，都发不了。等回复时签了别家，这一份作废。托管不会替你发。`,
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
  {
    // the save is this browser's alone (engine/me/save.ts); a copy is made and brought back on the home page (ui/me/Backup.tsx)
    title: '存档',
    lines: [
      '每做一件事都会自动存档，但存档只在这个浏览器里：清了网站数据、换了手机或浏览器，存档就不在了。',
      '回到首页，在「上次的存档」上点「导出存档」，存成一个文件，或者复制存档码（微信里下载不了文件时用它）。到另一台设备的首页点「导入存档」，选这个文件或者粘贴存档码，就能接着玩；成就殿堂也跟着过去，和那边原来的殿堂合在一起。',
    ],
  },
]

export default function HelpScreen() {
  const { game, go } = useGame()
  const off = useToursOff()
  const me = game.me!
  const retired = me.phase === 'retired'
  const pro = me.phase === 'pro'
  // the 下一步 card put away for this phase (ui/me/NextStep.tsx): brought back here, and the week page shows it
  const goal = nextCardWindow(game)
  const hidden = useNextHidden(goal?.phase ?? 'pre')
  // a greyed tour says why, and what opens it
  const why = retired ? '生涯已经结束，没有本周页可讲。'
    : !pro ? '签约后的导览讲新目标、首发之争、对位挑战、比赛里的决定和转会窗，签下一支队以后才能看。' : ''
  return (
    <div>
      <Panel title="导览">
        <div className="help-tours">
          <button className="sm primary" disabled={retired} onClick={() => openTour(weekTourOf(game))}>重看本周页导览</button>
          <button className="sm" disabled={!pro} onClick={() => openTour('season')}>重看签约后的导览</button>
          {off && <button className="sm ghost" onClick={() => setToursOff(false)}>恢复自动弹出</button>}
          {goal && hidden && <button className="sm ghost" onClick={() => { setNextHidden(goal.phase, false); go('week') }}>恢复「下一步」卡片</button>}
        </div>
        {(why || off || (goal && hidden)) && (
          <p className="tiny faint" style={{ margin: '8px 0 0' }}>
            {why}{off ? '你选过「不再显示」：新生涯和第一次签约时不会自动弹出。' : ''}
            {goal && hidden ? `「下一步」卡片收起了；恢复以后，本周页最上面会写着「${goal.title}」和这周最值得做的一件事。` : ''}
          </p>
        )}
      </Panel>
      {/* what each region of the week page is — the steps the tour walked before it went goal first (ui/me/guide.ts pageNotes) */}
      {!retired && (
        <Panel title="本周页上有什么">
          <ul className="help-list">{pageNotes(game).map((n) => <li key={n.title}><b>{n.title}</b>：{n.body}</li>)}</ul>
        </Panel>
      )}
      <div className="help-grid">
        {SECTIONS.map((s) => {
          // the transfer rules are the save's year's (engine/me/window.ts), not written once for every year
          const lines = s.title === '转会' ? [...windowRuleLines(game), ...s.lines] : s.lines
          return (
            <Panel key={s.title} title={s.title}>
              <ul className="help-list">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </Panel>
          )
        })}
      </div>
    </div>
  )
}
