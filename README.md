# val_player · 无畏契约选手生涯模拟器

单人文字生涯模拟：你是一名虚构的无畏契约新人选手，在由真实 VCT 选手和俱乐部构成的世界里，
从替补打到首发、从 Challengers 打到 Champions。

- 引擎与真实数据来自 [Val_Manager](https://github.com/WeijieCao77/Val_Manager)（无畏契约电竞经理）——逐回合比赛模拟、VCT 日历、524 名真实选手。
- 选手视角的玩法与赛场外系统来自 [LOL_breaker](https://github.com/WeijieCao77/LOL_breaker)（破晓 · LoL 选手生涯模拟器）——周与行动点、临场决策、首发竞争。

总体方案见 [策划稿-总体方案-v0.md](./策划稿-总体方案-v0.md)。

## 当前状态：完整 demo

从天梯到退役的整条路都能玩，机制路径与数值见 [总结-完整demo.md](./总结-完整demo.md)，方案见 [策划稿-总体方案-v0.md](./策划稿-总体方案-v0.md)。

- **开局**：三种起点（从天梯开始 / Challengers 青训 / VCT 替补）、12 张出身卡、20 点天赋。
- **加入联赛前**：辐能天梯（打排位爬分，前 500 显示名次）、五项杯赛（抽路人队友，用引擎真打）、三条被看见的通道、四天试训、合同四问、拒签。
- **加入联赛后**：8 行动点的周循环、教练每周重排名单、对位挑战与试用期、逐回合比赛与临场决策、转会窗与低谷退路、续约与被裁、俱乐部自己的经理 AI。
- **赛场外**：粉丝/热度两层、直播分成与独家三选一、外设课程理疗经纪人、32 条事件、气质轴与四个特质、待办、四档托管。
- **收尾**：39 项成就、13 种结局、退役与生涯名片。
- **存档**：浏览器自动存档。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，纯静态
```

`/manager` 与 `/cards` 仍然可以打开原来的经理模式和卡牌模式，存档互不干扰。

## 无头机器人与批测

```bash
npx tsx scripts/bot_me.ts [赛季数=10] [种子=7] [赛区=China] [位置=决斗者] [起点=pre|chal|t1] [出身=netcafe] [俱乐部id]
npx tsx scripts/batch_me.ts [局数=24] [赛季数=10] [起点=pre]
```

机器人走的是和界面完全一样的 `setPlan / doDuel / advanceWeek / MeMatch / autoResolve` 路径（托管四档全开 + 按推荐安排）。
批测打印签约年份、进入层级、首发率、冠军率、出海、粉丝档位、存款、事件、特质、结局分布。每加一段内容都要跑一次，看数字有没有漂。

## 代码结构

```
src/engine/            Val_Manager 的引擎（match / season / training / transfer / bonds / trust …），几乎未改
src/engine/me/         选手层
  career.ts / origins.ts      建档、三种起点、出身卡
  week.ts                     周循环：行动点、推进、周结算、赛季末、俱乐部经理 AI
  prepro.ts / cups.ts         天梯、邀请通道、杯赛与临时车队
  tryout.ts / contract.ts     四天试训、合同条款与四问、签约与离队
  transfer.ts                 市场评分、看台球探、转会窗、续约与被裁、挂牌
  growth.ts / coach.ts        训练收益、教练选人、对位挑战、试用期
  nodes.ts / matchplay.ts     临场决策、逐回合驱动一场比赛（含杯赛）
  fans.ts / stream.ts / shop.ts   粉丝与热度、直播、钱的出口
  events.ts / traits.ts / quests.ts / fx.ts   事件池、气质轴与特质、待办、效果结算
  achievements.ts / endings.ts    成就、结局、退役
  auto.ts / pending.ts        托管四档、推荐安排、待办队列
src/PlayerGame.tsx     壳子；src/ui/me/*  开档 / 本周 / 比赛 / 弹窗 / 我的 / 队伍 / 转会 / 经济 / 成就 / 托管 / 日志 / 名片
scripts/bot_me.ts      无头整局；scripts/batch_me.ts  批测
```

对引擎的改动只有四处：`match.ts` 的 `MapSim` 加了一个每回合衰减的 `nudge`（节点的摆动写在这里），
`types.ts` 的 `GameState` 加了 `me` 字段，AI 签自由人时跳过还没签约的我，十年结局交给选手层判定。
