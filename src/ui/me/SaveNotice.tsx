/**
 * 「最新进度没存进这个浏览器」: the career's latest save did not go in (engine/me/save.ts).
 *
 * A save that could not be written used to fail without a word: the game went
 * on in memory, and a refresh went back to the last save that had fit (a 2021
 * career 「卡在」 Masters Bangkok, 2026-09-14). This bar says so for as long as
 * it is true and goes the moment a save lands. The update nudge's shape and
 * corner (ui/me/UpdateNudge.tsx) in the warning amber; it blocks nothing, and
 * 收起 folds it into a small chip that stays on screen (base.css .save-chip).
 */
import { useState, useSyncExternalStore } from 'react'
import { onSaveTrouble, saveLost, saveTrouble } from '../../engine/me/save'
import type { SaveTrouble } from '../../engine/me/save'

/** The save's trouble, or null while the latest progress is on disk. */
export const useSaveTrouble = (): SaveTrouble | null => useSyncExternalStore(onSaveTrouble, saveTrouble, saveTrouble)

/** Another page holds the save now, and this one no longer writes it (engine/me/save.ts holds). */
export const useSaveLost = (): boolean => useSyncExternalStore(onSaveTrouble, saveLost, saveLost)

/**
 * 「这个存档已在另一个页面更新」 (reported 2026-09-18, an outside audit): another
 * tab opened a career into the save, a new one or this one, or saved over it,
 * and this page stopped writing so as not to put an older career back over it.
 * Up until a career is opened here again; 「载入最新存档」 opens the save as it
 * is now, the way 继续 does. Same corner and colour as the notice below, and the
 * same 收起 into a chip.
 */
export function SaveTakenNotice({ onLoad }: {
  /** read the save and open it here: false when it could not be read */
  onLoad: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [folded, setFolded] = useState(false)

  const load = async () => {
    setBusy(true)
    let ok = false
    try { ok = await onLoad() } catch { /* not read */ }
    // opened: this notice goes with the page's loss of the save
    if (!ok) { setBusy(false); setFailed(true) }
  }

  if (folded) {
    return (
      <button className="save-chip" onClick={() => setFolded(false)} title="这个存档已在另一个页面更新，点开看怎么办">
        这里不再自动保存
      </button>
    )
  }
  return (
    <div className="update-nudge save-nudge" role="alert">
      <div className="update-body">
        <b>这个存档已在另一个页面更新</b>
        <span>{failed ? '最新存档读不出来。可以回首页看看，或者刷新这个页面。' : '这里不再自动保存，在这个页面接着玩，进度存不下来。要接着玩，点「载入最新存档」。'}</span>
      </div>
      <div className="update-acts">
        <button className="primary sm" onClick={load} disabled={busy}>{busy ? '读取中…' : '载入最新存档'}</button>
        <button className="sm ghost" onClick={() => setFolded(true)}>收起</button>
      </div>
    </div>
  )
}

export default function SaveNotice({ trouble, onRetry }: {
  trouble: SaveTrouble
  /** save the career now and wait for the write: true when it went in */
  onRetry: () => Promise<boolean>
}) {
  const [trying, setTrying] = useState(false)
  const [again, setAgain] = useState(false)
  const [folded, setFolded] = useState(false)

  const retry = async () => {
    setTrying(true)
    let saved = false
    try { saved = await onRetry() } catch { /* still not in */ }
    // a save that went in takes this bar away with the trouble; one that did not says the try was made
    if (!saved) { setTrying(false); setAgain(true) }
  }

  if (folded) {
    return (
      <button className="save-chip" onClick={() => setFolded(false)} title="最新进度没存进这个浏览器，点开看怎么办">
        进度没存上
      </button>
    )
  }
  const text = `${again ? '刚才又试了一次，还是没存进去。' : ''}可以接着玩，但现在刷新或关掉页面，会回到${trouble.kept ? ` ${trouble.kept} ` : '上一次存上'}的进度。别用无痕（隐私）窗口；手机或电脑的存储空间快满了，先清出一点；然后点「再试一次」。`
  return (
    <div className="update-nudge save-nudge" role="alert">
      <div className="update-body">
        <b>最新进度没存进这个浏览器</b>
        <span>{text}</span>
      </div>
      <div className="update-acts">
        <button className="primary sm" onClick={retry} disabled={trying}>{trying ? '正在存…' : '再试一次'}</button>
        <button className="sm ghost" onClick={() => setFolded(true)}>收起</button>
      </div>
    </div>
  )
}
