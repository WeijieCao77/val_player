# val_player · 无畏契约选手生涯模拟器

单人文字生涯模拟：你是一名虚构的无畏契约新人选手，在由真实 VCT 选手和俱乐部构成的世界里，
从替补打到首发、从 Challengers 打到 Champions。

- 引擎与真实数据来自 [Val_Manager](https://github.com/WeijieCao77/Val_Manager)（无畏契约电竞经理）——逐回合比赛模拟、VCT 日历、524 名真实选手。
- 选手视角的玩法与赛场外系统来自 [LOL_breaker](https://github.com/WeijieCao77/LOL_breaker)（破晓 · LoL 选手生涯模拟器）——周与行动点、临场决策、首发竞争。

总体方案见 [策划稿-总体方案-v0.md](./策划稿-总体方案-v0.md)。

## 当前状态：完整 demo

从天梯到退役的整条路都能玩，机制路径与数值见 [总结-完整demo.md](./总结-完整demo.md)，方案见 [策划稿-总体方案-v0.md](./策划稿-总体方案-v0.md)。

网站上只有选手生涯这一个游戏。这个项目是从经理游戏分出来的，经理模式和卡牌模式已经不再构建、也不再有入口：
旧的 `/manager`、`/cards` 链接（连同下面的子路径）一律 302 回 `/`，打开的就是选手生涯。它们的源码暂时还留在仓库里，
`scripts/check_boundary.ts` 保证选手生涯一行都不引用它们。

- **开局**：两个入场年份（2021 · 改变历史 / 2026 · 创造未来）、三种起点（从天梯开始 / Challengers 青训 / VCT 替补）、12 张出身卡、20 点天赋。
- **加入联赛前**：辐能天梯（打排位爬分，前 500 显示名次）、五项杯赛（抽路人队友，用引擎真打）、三条被看见的通道、四天试训、合同四问、拒签。
- **加入联赛后**：8 行动点的周循环、教练每周重排名单、对位挑战与试用期、逐回合比赛与临场决策、转会窗与低谷退路、续约与被裁、俱乐部自己的经理 AI。
- **赛场外**：粉丝/热度两层、直播分成与独家三选一、外设课程理疗经纪人、32 条事件、气质轴与四个特质、待办、四档托管。
- **收尾**：94 项成就、14 种结局、退役与生涯名片。
- **存档**：浏览器自动存档。

## 本地运行

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # 产物在 dist/，纯静态
npm start          # node server.js：发 dist/ 里的文件，外加后台统计；端口取 PORT，默认 3000
```

`npm start` 之前要先 `npm run build`：没有 `dist/index.html` 时首页和 `/healthz` 都回 503。
本地（localhost、file://）打开的页面不上报统计。

## 上线（Railway）与后台统计

`railway.json` 里写着：启动命令 `node server.js`，探活地址 `/healthz`——`dist/index.html` 在就回 200，
不在回 503，页面没构建出来的部署不会被当成上线。

游戏会匿名上报怎么玩的（事件契约见 `src/engine/me/telemetry.ts` 和它的服务端镜像 `stats-contract.js`）：
不记 IP、不记 User-Agent、不记玩家打进去的任何文字，身份只是浏览器自己生成的随机 id。
`server.js` 在 `/api/e` 收（回 204；超了限流回 429），在 `/dash` 出看板。

| 环境变量 | 作用 |
|---|---|
| `STATS_KEY` | 看板 `/dash` 的密码。没配：`/dash` 一律 404（事件照收）。配了：浏览器弹密码框，**用户名留空**、密码填这个值；不带或填错 401，同一来源十分钟里错满 30 次，这十分钟剩下的时间一律 429。只配在 Railway 的服务变量里，不要写进仓库。 |
| `DATA_DIR` | 统计数据放哪儿。没设就用 `RAILWAY_VOLUME_MOUNT_PATH`（Railway 挂了 Volume 会自动给），都没有就落在本机主目录下的 `.val_player-stats`——这时看板顶上亮红条：容器磁盘上的数据重新部署就没了。线上一定要挂一个 Volume。 |
| `PORT` | Railway 自己注入；本地默认 3000。 |
| `STATS_WINDOW` | 看板的统计窗口天数，默认 30。 |
| `STATS_RATE_IP` / `STATS_RATE_ALL` | 上报限流：每个来源每分钟 / 全站每分钟，默认 120 / 6000。 |
| `TRUST_PROXY` | 本机跑在反向代理后面时设上，限流才看 `X-Forwarded-For` 的最后一段（Railway 上自动认）。 |

数据目录里的文件：

- `ev-YYYY-MM-DD.jsonl`：按北京时间一天一个，每行一条事件，**这是事实源**。只追加、不改写，留 90 天。
- `devices.log`：每行「首见日 设备 id」。**行号就是设备号**，`stats.json` 里存的是号——不要手改、不要排序、不要删行。
- `stats.json`（和上一版 `stats.json.bak`）：按天的聚合缓存，每 30 秒和退出时落一次。里面记着每天算到了 JSONL 的第几个字节；
  启动时字节数对不上的那天会从 JSONL 重算；整个删掉，启动时也会从 JSONL 把 90 天重算回来。但 90 天之前的 JSONL 已经清掉了，
  那些天的聚合只在 `stats.json` 里——所以它也要一起备份。

备份：把整个数据目录原样拷走。卷快照一次拍下全部最省事；服务开着一个个文件拷也行，按 `stats.json` → `devices.log` →
`ev-*.jsonl` 的顺序拷——缓存里引用的设备号一定已经在登记簿里；拷完登记簿之后才来的新设备，恢复后启动重放 JSONL 时按顺序补登。
拷到写了一半的最后一行也没关系，恢复后启动会把半行隔开跳过。

恢复：停掉服务，把目录原样放回去再启动。`devices.log` 必须和 JSONL、`stats.json` 来自同一次备份（设备号是它的行号）；
`stats.json` 旧一点、缺了、坏了都没事，启动时会按 JSONL 补齐（坏了先退回 `.bak`）。

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
