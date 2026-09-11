import { Rng, hashStr } from './rng'
import type { GameState } from './types'

/**
 * Where the internationals are played.
 *
 * Three of these a year, drawn from the cities the circuit has actually
 * visited, none twice in a season and none the same as the year before —
 * 「每个大师赛可以加一个随机不重复的」举办地. Pure in seed and year, so the
 * poster can name the city before the event exists and the event agrees
 * with it when it does.
 */
const HOST_CITIES = [
  '雷克雅未克', '柏林', '哥本哈根', '东京', '马德里', '上海', '曼谷', '多伦多', '圣地亚哥', '伦敦',
  '伊斯坦布尔', '洛杉矶', '首尔', '巴黎', '圣保罗', '新加坡', '悉尼', '吉隆坡', '雅加达', '墨西哥城',
  '迪拜', '华沙', '慕尼黑', '里约热内卢',
]
type EventKey = 'masters1' | 'masters2' | 'champions'

export function hostCities(seed: number, year: number): Record<EventKey, string> {
  let prev: string[] = []
  let cur: string[] = []
  for (let y = 2026; y <= year; y++) {
    const rng = new Rng(hashStr(`host:${seed}:${y}`))
    const pool = HOST_CITIES.filter((c) => !prev.includes(c))
    cur = []
    for (let i = 0; i < 3; i++) {
      const left = pool.filter((c) => !cur.includes(c))
      cur.push(left[rng.int(0, left.length - 1)])
    }
    prev = cur
  }
  return { masters1: cur[0], masters2: cur[1], champions: cur[2] }
}

export const hostCity = (state: GameState, key: EventKey): string => hostCities(state.seed, state.year)[key]

/**
 * From 2027, on the one timeline: nobody has announced where the internationals
 * go, so each year's three are drawn from cities with the scene for it — three
 * different leagues' cities a year, none twice in a year and none the year
 * before's. Pure in the year, so every save's 2029 is played in the same
 * places. Champions 2027 is in the Americas, as Riot announced. The author's
 * call, 2026-09-11: 「在世界上随机抽取几个电竞氛围好的城市作为举办地点」.
 */
const SCENE_CITIES: Record<'Americas' | 'EMEA' | 'Pacific' | 'China', string[]> = {
  Americas: ['洛杉矶', '圣保罗', '墨西哥城', '纽约', '布宜诺斯艾利斯', '多伦多'],
  EMEA: ['柏林', '巴黎', '马德里', '伊斯坦布尔', '利雅得', '华沙', '科隆'],
  Pacific: ['首尔', '东京', '曼谷', '新加坡', '雅加达', '马尼拉', '悉尼'],
  China: ['上海', '北京', '成都', '深圳', '杭州'],
}
/** 2026's real three: Santiago, London, Shanghai. */
const HOSTS_2026 = ['圣地亚哥', '伦敦', '上海']
const AHEAD_HOSTS = new Map<number, Record<EventKey, string>>()

export function aheadHosts(year: number): Record<EventKey, string> {
  const hit = AHEAD_HOSTS.get(year)
  if (hit) return hit
  const prev = year <= 2027 ? HOSTS_2026 : Object.values(aheadHosts(year - 1))
  const rng = new Rng(hashStr(`ahead-host:${year}`))
  const order = Object.keys(SCENE_CITIES) as (keyof typeof SCENE_CITIES)[]
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    const swap = order[i]
    order[i] = order[j]
    order[j] = swap
  }
  const champs = year === 2027 ? 'Americas' : order[2]
  const [first, second] = order.filter((l) => l !== champs)
  const taken: string[] = []
  const pick = (league: keyof typeof SCENE_CITIES): string => {
    const fresh = SCENE_CITIES[league].filter((c) => !prev.includes(c) && !taken.includes(c))
    const list = fresh.length ? fresh : SCENE_CITIES[league].filter((c) => !taken.includes(c))
    const city = list[rng.int(0, list.length - 1)]
    taken.push(city)
    return city
  }
  const out = { masters1: pick(first), masters2: pick(second), champions: pick(champs) }
  AHEAD_HOSTS.set(year, out)
  return out
}

