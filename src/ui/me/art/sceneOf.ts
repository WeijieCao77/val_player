/**
 * Which scene strip a card lays along its top (art/scenes.tsx), and the word its
 * header says instead of 「事件」. Ceremonies by kind (engine/me/ceremony.ts,
 * nights.ts); events by id, then by the prefix a family of them shares.
 * A card about home or family gets no picture rather than a wrong one.
 */
import type { SceneKey } from './scenes'

export const CEREMONY_SCENE: Record<string, SceneKey> = {
  draw: 'stage', depart: 'airport', final: 'tunnel', media: 'media', rehab: 'clinic', farewell: 'stage',
  awards: 'stage', showmatch: 'stage', patch: 'board', tryout: 'room', retire: 'stage',
}

const EVENT_SCENE: Record<string, SceneKey | null> = {
  // events.ts
  family_call: null, old_friend: null, parents: null, car: null, bible: null,
  airport: 'airport', abroad: 'airport',
  insomnia: 'clinic', injury_scare: 'clinic',
  locker_blame: 'room', locker_dinner: 'room', rookie_help: 'room', cafe_coach: 'room', boost: 'room',
  hot_week: 'room', cold_week: 'room', after_skid: 'room', after_bench: 'room', teammate_ranked: 'room',
  gear_broke: 'room', ranked_flame: 'room',
  coach_talk: 'board', patch: 'board',
  mate_leaves: 'empty',
  ad: 'contract', scout_dm: 'contract', gear_deal: 'contract', after_sign: 'contract',
  rumor: 'media', caster: 'media', fan_letter: 'media', hater: 'media', interview: 'media',
  variety: 'stream',
  after_title: 'stage', after_upset: 'stage',
  // events_more.ts
  pre_vpn: 'room', cn_server: 'room', pre_fill: 'room', pre_five: 'room', pre_exam: null,
  pre_vod_roast: 'stream', cheat_accuse: 'media',
  chal_vct_scrim: 'room', chal_road: 'airport', chal_ascend: 'stage',
  vct_lights: 'stage', emea_english: 'room', amer_stream: 'stream', pac_cards: 'stage', cn_newyear: null,
  intl_dm: 'media', intl_crowd: 'stage',
  bench_stream: 'stream', contract_talk: 'contract', map_pool: 'board', crosshair: 'room', ranked_mate: 'room',
  igl_sick: 'clinic',
  echo_boost: 'room', echo_notes: 'room', echo_rookie_up: 'stage', echo_home: null,
}

const EVENT_PREFIX: [string, SceneKey][] = [
  ['stream_', 'stream'], ['intl_', 'airport'], ['bench_', 'room'], ['vet_', 'room'], ['locker_', 'room'],
  ['echo_cheat_', 'media'], ['echo_rookie_', 'room'],
  ['ch_show_', 'stage'], ['ch_abroad_', 'airport'], ['ch_storm_', 'media'], ['ch_rift_', 'room'],
  ['pre_', 'room'], ['chal_', 'room'], ['after_', 'room'],
]

export function sceneOfEvent(id: string): SceneKey | null {
  if (id in EVENT_SCENE) return EVENT_SCENE[id]
  return EVENT_PREFIX.find(([p]) => id.startsWith(p))?.[1] ?? null
}

/** The card's header, from its scene: what kind of week this is. */
export const SCENE_CN: Record<SceneKey, string> = {
  stage: '赛场', tunnel: '赛场', airport: '出征', room: '队里', board: '版本', media: '舆论',
  clinic: '身体', stream: '直播', contract: '合同与商务', bracket: '赛程', empty: '场外',
}
