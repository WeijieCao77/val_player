/**
 * What plays under the game.
 *
 * The career's own copy of Val Manager's track list (作者 2026-09-18：「我需要仿照
 * val manager加入音乐功能，音乐直接使用他的，音乐功能浮窗也直接照抄」), taken from
 * Val_Manager dc8e60c src/data/music.ts. The same six songs, the same files
 * (copied into this repo's public/music), the same order and versions.
 *
 * Riot's own VALORANT releases, which their fan-content policy lets a
 * non-commercial project like this one use. The files live in public/music
 * as 96k AAC (m4a) — about the quality of a 160k mp3 at half the bytes, after
 * the mp3s were reported as stuttering on a phone — and the server hands
 * them out in byte ranges so Safari will play them at all.
 *
 * Order is play order. `file` is relative to the site root and carries a
 * version so a replaced file is a new URL under the week-long cache.
 */
export interface Track {
  id: string
  title: string
  artist: string
  file: string
}

export const TRACKS: Track[] = [
  { id: 'die-for-you', title: 'Die For You', artist: 'VALORANT · Grabbitz', file: 'music/die-for-you.m4a?v=2' },
  { id: 'when-the-world-ends', title: 'When the World Ends', artist: 'VALORANT · Raiden · jeonghyeon', file: 'music/when-the-world-ends.m4a?v=2' },
  { id: 'ticking-away', title: 'Ticking Away', artist: 'VALORANT · Grabbitz · bbno$', file: 'music/ticking-away.m4a?v=2' },
  { id: 'superpower', title: 'SUPERPOWER', artist: 'VALORANT · KISS OF LIFE · 段宜恩', file: 'music/superpower.m4a?v=2' },
  { id: 'la-lumiere', title: 'La Lumière', artist: 'VALORANT · WILLIM缪维霖 · 贺仙人', file: 'music/la-lumiere.m4a?v=2' },
  { id: 'break-in', title: 'Break In (Strings Remix)', artist: 'Layla', file: 'music/break-in.m4a?v=1' },
]
