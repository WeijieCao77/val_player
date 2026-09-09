import { REGION_CN } from '../types'
import type { Region } from '../types'

/**
 * Competition names, in the words Chinese esports actually uses.
 *
 * The author's note was 「master I 这种表达不好，要写 xx 大师赛」, and the
 * achievement and ending text was rewritten for it. The competition's *name*
 * was not — so 「Masters I」 still reached the screen anywhere a competition
 * was printed by name: the trophy shelf, the prize line, the ceremony header.
 *
 * Renaming the constants themselves is not safe. `Masters I` is the identity
 * string: it is written into every player's `titles`, it is what
 * engine/endings.ts matches on to decide an ending, and it is sitting in the
 * save files of anyone already playing the demo. Rename it and every trophy
 * already won stops counting.
 *
 * So the translation happens at the display boundary and nowhere else. The
 * stored name never changes; only what the player reads does.
 */

const EXACT: Record<string, string> = {
  'Masters I': '第一站大师赛',
  'Masters II': '第二站大师赛',
  'VALORANT Champions': '冠军赛',
  Champions: '冠军赛',
}

const regionCn = (en: string): string => REGION_CN[en as Region] ?? en

export function compCn(name: string): string {
  if (!name) return name
  const hit = EXACT[name.trim()]
  if (hit) return hit
  // 「VCT China · Stage 1」 -> 「VCT 中国 第一赛段」
  const stage = name.match(/^VCT\s+(\S+)\s*·\s*Stage\s*(\d)$/i)
  if (stage) return `VCT${regionCn(stage[1])} 第${stage[2] === '1' ? '一' : '二'}赛段`
  // 「China Kickoff」 -> 「中国揭幕赛」
  const kick = name.match(/^(\S+)\s+Kickoff$/i)
  if (kick) return `${regionCn(kick[1])}揭幕赛`
  // 「Challengers China · 第一赛段」 -> 「中国挑战者联赛 第一赛段」
  const chal = name.match(/^Challengers\s+(\S+)\s*·\s*(.+)$/i)
  if (chal) return `${regionCn(chal[1])}挑战者联赛 ${chal[2]}`
  // 「晋级 VCT China」 -> 「晋级 VCT中国」
  const asc = name.match(/^晋级\s+VCT\s+(\S+)$/i)
  if (asc) return `晋级 VCT${regionCn(asc[1])}`
  return name
}
