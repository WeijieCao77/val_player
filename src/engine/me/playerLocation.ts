import { regionIn } from '../era'
import { natName } from '../nat'
import { REGION_CN } from '../types'
import type { Player, Team } from '../types'

/** Identity and current competition are different facts. `p.region` may be
 * the first club's historical circuit (ZmjjKK started at CBT in HK/TW), and
 * must not be presented as either nationality or the player's current league.
 * Read current save data without rewriting simulated transfers or old saves.
 */
export function playerLocation(p: Pick<Player, 'nat'>, team: Pick<Team, 'region'> | null, year: number) {
  return {
    nationality: `国籍/地区：${natName(p.nat)}`,
    competition: team ? `当前赛区：${REGION_CN[regionIn(team.region, year)]}` : null,
  }
}
