/**
 * What money may buy, read off the constants and the source, no careers run (2026-09-26).
 *
 * The rule (me/shop.ts, me/crew.ts): money only speeds reaching a ceiling or slows a ceiling's fall; it never
 * raises one. scripts/check_buy.ts measures what that comes to over paired careers; this holds the pieces to the
 * sizes the author agreed, so a constant cannot drift past them between measurements:
 *
 *  一 外设上手: for every role, the kits' points together — one on each kit's attribute, a second on the main kit's —
 *     come to at most KIT_BUDGET (1.0) of 综合, and each lands only under the ceiling (kitSession asks for room)
 *  二 私人教练: ×COACH_MUL ≤ 1.1, on 枪法训练, 复盘 and 道具与跑图 only
 *  三 康复与体能团队: ×HEALTH_LOSS_MUL ≥ 0.8 of the winter's loss, from 24 to hire; 训练营: a week counted CAMP_MUL ≤ 2
 *     times, and the pool a practice path opens, MECH_VALUE_MAX, still 1.2
 *  四 nothing that sells any of it writes a ceiling or 上限: no `caps`, `potential` or `stageBonus` written in
 *     me/shop.ts, me/crew.ts or me/outlets.ts
 *  五 the prices follow the wage as agreed, and the recurring outlets together are 32–47% of it a year
 *  六 every model on sale is a real brand's
 *
 *   npx tsx scripts/check_shop_budget.ts
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GEAR_CHOICES, KITS, KIT_BUDGET, KIT_MORE, KIT_SESSIONS, gearPrice } from '../src/engine/me/shop'
import {
  CAMP_CAP, CAMP_FLOOR, CAMP_SHARE, COACH_ACTIONS, COACH_FLOOR, COACH_MUL, COACH_SHARE,
  HEALTH_AGE, HEALTH_CAP, HEALTH_FLOOR, HEALTH_LOSS_MUL, HEALTH_SHARE,
} from '../src/engine/me/crew'
import { CAMP_MUL, MECH_VALUE_MAX } from '../src/engine/me/bottleneck'
import { CARS, FLATS, GIFTS } from '../src/engine/me/outlets'
import { ROLE_WEIGHT } from '../src/engine/player'
import type { Role } from '../src/engine/types'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const facts: [string, boolean][] = []

// 一
{
  const per: string[] = []
  let worst = 0
  for (const role of Object.keys(ROLE_WEIGHT) as Role[]) {
    const w = ROLE_WEIGHT[role]
    const main = KITS.reduce((best, k) => (w[k.attr] > w[best.attr] ? k : best), KITS[0])
    const sum = KITS.reduce((s, k) => s + w[k.attr], 0) + w[main.attr]
    worst = Math.max(worst, sum)
    per.push(`${role} ${sum.toFixed(2)}`)
  }
  facts.push([`外设上手每个位置最多加综合 ${KIT_BUDGET}：${per.join('、')}`, worst <= KIT_BUDGET + 1e-9])
  facts.push([`上手要配合练：第一点 ${KIT_SESSIONS} 次，第二点再 ${KIT_MORE} 次`, KIT_SESSIONS >= 4 && KIT_MORE >= 8])
  const src = readFileSync(resolve(ROOT, 'src/engine/me/shop.ts'), 'utf8')
  const body = src.slice(src.indexOf('export function kitSession'), src.indexOf('\n}\n', src.indexOf('export function kitSession')))
  facts.push(['上手只在瓶颈以内：kitSession 先问有没有空间（kitRoom）才加点', /!kitRoom\(p, kit\.attr\)/.test(body) && /p\.attrs\[k\] \+= 1/.test(body)])
}

// 二、三
facts.push([`私教 ×${COACH_MUL}（≤ 1.1），只管 ${COACH_ACTIONS.join('、')}`, COACH_MUL <= 1.1 && COACH_MUL > 1 && [...COACH_ACTIONS].sort().join() === 'aim,util,vod'])
facts.push([`康复与体能团队：冬天掉点 ×${HEALTH_LOSS_MUL}（≥ 0.8），${HEALTH_AGE} 岁起才请`, HEALTH_LOSS_MUL >= 0.8 && HEALTH_LOSS_MUL < 1 && HEALTH_AGE >= 24])
facts.push([`训练营那一周按 ${CAMP_MUL} 份计（≤ 2）；练出来的突破总额 MECH_VALUE_MAX 仍是 ${MECH_VALUE_MAX}`, CAMP_MUL <= 2 && MECH_VALUE_MAX === 1.2])

// 四
{
  const writes: string[] = []
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  for (const f of ['src/engine/me/shop.ts', 'src/engine/me/crew.ts', 'src/engine/me/outlets.ts']) {
    const lines = strip(readFileSync(resolve(ROOT, f), 'utf8')).split('\n')
    lines.forEach((l, i) => {
      // an assignment straight onto caps, caps[k] or caps.k (a comparison like `>= p.caps[k]` is a read)
      if (/\bcaps(?:!?\??\.\w+|!?\[[^\]]*\])*\s*[+-]?=(?!=)|\.potential\s*[+-]?=(?!=)|stageBonus\s*[+-]?=(?!=)|MECH_VALUE_MAX\s*=/.test(l)) writes.push(`${f}:${i + 1} ${l.trim().slice(0, 80)}`)
    })
  }
  facts.push([`商城、教练与团队、钱的出口里没有一行写瓶颈或上限${writes.length ? `（${writes.join(' | ')}）` : ''}`, writes.length === 0])
}

// 五
{
  const W = 1_000_000
  const coach = Math.max(COACH_FLOOR, Math.round((W * COACH_SHARE) / 52)) * 52 / W
  const camp = Math.min(CAMP_CAP, Math.max(CAMP_FLOOR, W * CAMP_SHARE)) / W
  const health = Math.min(HEALTH_CAP, Math.max(HEALTH_FLOOR, W * HEALTH_SHARE)) / W
  const flat = FLATS[FLATS.length - 1].share
  const lo = coach + camp + health + flat + Math.min(...GIFTS.map((g) => g.share))
  const hi = coach + camp + health + flat + Math.max(...GIFTS.map((g) => g.share))
  facts.push([`年薪 ¥100 万时：私教 ${(coach * 100).toFixed(1)}%、训练营 ${(camp * 100).toFixed(0)}%、康复团队 ${(health * 100).toFixed(0)}%、大平层 ${(flat * 100).toFixed(0)}%、公益 ${GIFTS.map((g) => g.share * 100).join('/')}%，一年合计 ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%（约定 32–47%）`,
    Math.abs(lo - 0.32) < 0.006 && Math.abs(hi - 0.47) < 0.006])
  facts.push([`定价按约定：私教每周至少 ¥${COACH_FLOOR}、年薪 6%；训练营 8%（¥1.5 万–25 万）；康复团队 10%（¥3 万–30 万）`,
    COACH_SHARE === 0.06 && COACH_FLOOR === 500 && CAMP_SHARE === 0.08 && CAMP_FLOOR === 15000 && CAMP_CAP === 250000 && HEALTH_SHARE === 0.1 && HEALTH_FLOOR === 30000 && HEALTH_CAP === 300000])
  facts.push([`车是真车真价：${CARS.map((c) => `${c.name} ¥${c.price / 10000} 万`).join('、')}`, CARS.some((c) => c.name.includes('比亚迪')) && CARS.some((c) => c.name.includes('特斯拉')) && CARS.some((c) => c.name.includes('保时捷'))])
  facts.push([`鼠标垫按真价：职业级 ¥${gearPrice('pad', 1)}、旗舰 ¥${gearPrice('pad', 2)}`, gearPrice('pad', 2) <= 1000 && gearPrice('pad', 1) < gearPrice('pad', 2)])
}

// 六
{
  const BRANDS = ['罗技', '雷蛇', 'ZOWIE', 'Pulsar', 'Finalmouse', 'Artisan', 'Lethal Gaming Gear', '雷柏', 'HyperX', 'Wooting', '赛睿', 'AOC', '华硕', 'Secretlab', 'AndaSeat', '西昊', 'Herman Miller']
  const odd: string[] = []
  let choices = 0
  for (const [slot, tiers] of Object.entries(GEAR_CHOICES)) {
    tiers.forEach((models, t) => {
      if (t > 0 && (models.length < 2 || models.length > 3)) odd.push(`${slot} ${t} 档 ${models.length} 款`)
      for (const m of models) { choices++; if (!BRANDS.some((b) => m.startsWith(b))) odd.push(m) }
    })
  }
  facts.push([`六个位置 ${choices} 款外设都是真实品牌，买得到的每档 2–3 款${odd.length ? `（${odd.join('、')}）` : ''}`, odd.length === 0 && Object.keys(GEAR_CHOICES).includes('pad')])
}

for (const [what, ok] of facts) console.log(`${ok ? '✓' : '✗'} ${what}`)
if (facts.some(([, ok]) => !ok)) {
  console.log('\n✗ 钱能买的那一点变大了：看上面哪一条没过。')
  process.exit(1)
}
console.log('\n✓ 外设上手、私教、训练营、康复团队都在约定的大小里，没有一样抬瓶颈。')
