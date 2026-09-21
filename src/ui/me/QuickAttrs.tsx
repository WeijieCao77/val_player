import { ATTR_CN, ATTR_KEYS } from '../../engine/types'
import type { Player } from '../../engine/types'
import { attrWord } from './words'
import './growth-week.css'

export default function QuickAttrs({ player, nums }: { player: Player; nums: boolean }) {
  return <div id="quick-eight-attrs" className="quick-eight" aria-label="八项属性">
    {ATTR_KEYS.map(k => <div className="quick-attr" key={k}><span>{ATTR_CN[k]}</span><b>{nums ? player.attrs[k] : attrWord(player.attrs[k])}</b></div>)}
  </div>
}
