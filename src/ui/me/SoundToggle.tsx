import { useSound } from './sfx'

/**
 * 音效 on or off, beside the theme switch at the foot of the side bar. Off until
 * the player turns it on (decided 2026-09-14); turning it on plays the chime once,
 * so what it does is heard at once rather than described.
 */
export default function SoundToggle() {
  const [on, setOn] = useSound()
  return (
    <button
      type="button"
      className={`sm ghost sound-toggle${on ? ' on' : ''}`}
      aria-pressed={on}
      title={on ? '关掉大事卡弹出时的提示音' : '大事卡弹出时响一声提示音'}
      onClick={() => setOn(!on)}
    >
      音效 {on ? '开' : '关'}
    </button>
  )
}
