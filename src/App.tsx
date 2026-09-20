import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { setCurrentRuleset } from './engine/ruleset'
import type { GameState } from './engine/types'
import type { CareerOpts } from './engine/me/career'
import { autosaveInfo } from './engine/me/saveInfo'
import { readSaveText } from './engine/me/saveStore'
import NewCareer from './ui/me/NewCareer'
import Changelog from './ui/me/Changelog'
import UpdateNudge from './ui/me/UpdateNudge'
import { takeReopen } from './ui/me/update'
import MusicPlayer from './ui/me/MusicPlayer'
import Support from './ui/me/Support'
import Mailbox from './ui/me/Mailbox'

/**
 * The site is the player career and nothing else. The manager game and the
 * card mode this project was forked from are no longer routed or built; their
 * sources stay in the repo only until the engine split is done. An old
 * /manager or /cards link opens the career (server.js sends it to /).
 *
 * The home page is drawn here, and the career behind it is fetched only when
 * one is opened (reported 2026-09-18, an outside audit of 6d128ed: this page
 * imported the save module to set its name, the save module reached the engine,
 * and the engine every dataset, so opening the home page fetched 6.7 MB — 1.4 MB
 * gzipped — before anyone had pressed a button). What this page imports reads
 * no roster book and no circuit: the save card is drawn from the summary beside
 * the save (engine/me/saveInfo.ts), the hall from its own record, the new-career
 * screen from a table worked out as the site is built (engine/me/startSheet.ts).
 * scripts/check_boundary.ts fails if that stops being so.
 */

/** the career and the world behind it (src/game.ts): fetched when a career is opened, never with this page */
const loadGame = () => import('./game')
type Game = Awaited<ReturnType<typeof loadGame>>

/** a career open: the shell that draws it, the career, and a count, so a career opened after 回到首页 gets a shell of its own */
interface Open { Career: Game['Career']; game: GameState; seq: number }

export default function App() {
  setCurrentRuleset('vct-2025')
  const [open, setOpen] = useState<Open | null>(null)
  const seq = useRef(0)
  // the game's files did not arrive when a career was opened: offline, or a new build went live and this page's are gone
  const [unloaded, setUnloaded] = useState(false)
  const [, redraw] = useReducer((x: number) => x + 1, 0)

  const fetchGame = useCallback(async (): Promise<Game | null> => {
    try {
      return await loadGame()
    } catch {
      setUnloaded(true)
      return null
    }
  }, [])
  const openCareer = useCallback((m: Game, game: GameState) => {
    setOpen({ Career: m.Career, game, seq: ++seq.current })
  }, [])
  const home = useCallback(() => setOpen(null), [])

  /** open the autosave: what 继续 does, and what a page that reloaded itself does on its own */
  const continueCareer = useCallback(async (): Promise<boolean | null> => {
    const m = await fetchGame()
    if (!m) return null
    const g = await m.openSavedCareer()
    if (!g) return false
    openCareer(m, g)
    return true
  }, [fetchGame, openCareer])

  // This page reloaded itself onto a new build (ui/me/UpdateNudge.tsx): the player pressed nothing, so put them back
  // where they were instead of on the cover, which would read as the game throwing them out (asked 2026-09-20). The
  // marker is taken once and gone: a save that will not open, or a plain reload after this one, lands here as usual.
  useEffect(() => {
    let live = true
    const reopen = takeReopen(window.sessionStorage)
    void (async () => {
      let info = autosaveInfo()
      // localStorage can be cleared while IndexedDB survives. The cover stays
      // light and synchronous, then asks the database once and redraws the card.
      if (!info && await readSaveText()) {
        if (!live) return
        redraw()
        info = autosaveInfo()
      }
      if (live && reopen && info) void continueCareer()
    })()
    return () => { live = false }
  }, [continueCareer])

  // Another page of the game wrote the save or took it (reported 2026-09-18, an outside audit): the card is drawn
  // again, so it shows what is there now. A career open here hears the same event itself (PlayerGame.tsx).
  useEffect(() => {
    if (open) return
    const heard = (e: StorageEvent) => { if (!e.storageArea || e.storageArea === window.localStorage) redraw() }
    window.addEventListener('storage', heard)
    return () => window.removeEventListener('storage', heard)
  }, [open])

  // 背景音乐 (ui/me/MusicPlayer.tsx, Val Manager's music window copied whole) sits beside the game, not inside either
  // of its pages — the way Val Manager mounts it under every page, so it keeps playing across them. The cover and the
  // career are two different trees; a window mounted in each would stop the song on 开始生涯 and on 回到首页.
  return (
    <>
      {open ? <open.Career key={open.seq} opened={open.game} onHome={home} /> : (
        <>
          {/* a build that went live while this page was open: the page takes it by itself (ui/me/UpdateNudge.tsx);
              nothing to save before it here. When the files did not arrive, 游戏没载入成功 below has this corner. */}
          <UpdateNudge hushed={unloaded} />
          {unloaded && <Unloaded />}
          {/* the same corner button as inside a career: 更新日志 belongs to the build, not to a career, so the
              cover page has it too — someone who has not started yet is exactly who wants to read what changed (me.css) */}
          <Changelog />
          {/* 玩家信箱 (ui/me/Mailbox.tsx): 提建议、给别人的建议点赞，按赞排成一张榜。
              首页才有这个角标；生涯里它是导航上的一栏 (src/PlayerGame.tsx)。 */}
          <Mailbox />
          <NewCareer
            // the home page's card is drawn from the summary beside the save (engine/me/saveMeta.ts), never from the save itself
            save={autosaveInfo()}
            // a press on its way (the pointer on 继续 or 开始生涯): the career starts arriving now
            onWarm={() => { loadGame().catch(() => { /* said when the press comes */ }) }}
            onStart={async (opts: CareerOpts) => {
              const m = await fetchGame()
              if (!m) return false
              // a club start is placed by the game, off the career's seed (engine/me/career.ts pickClub)
              openCareer(m, m.createCareer(opts))
              return true
            }}
            onContinue={continueCareer}
            onSeedHall={async () => {
              const m = await fetchGame()
              if (m) await m.seedHallFromSave()
            }}
            // 导入存档 (ui/me/Backup.tsx): the backup is checked on this page (engine/me/backup.ts parseBackup); decoding
            // it needs the career's files, which come now. What it holds is shown before anything is written; taken
            // in, it opens the way 继续 does
            onReadBackup={async (b) => {
              const m = await fetchGame()
              if (!m) return null
              const r = await m.readBackupCareer(b)
              if (!r.ok) return r
              return {
                ok: true,
                meta: r.meta,
                take: async () => {
                  if (await m.importBackupCareer(b, r.game) !== 'ok') return 'full'
                  const g = await m.openSavedCareer()
                  if (!g) return 'unopened'
                  openCareer(m, g)
                  return 'ok'
                },
              }
            }}
          />
        </>
      )}
      <MusicPlayer />
      {/* 支持作者: the same corner button Val Manager has, beside 更新日志 on both pages (me.css .me-support) */}
      <Support career={!!open} />
    </>
  )
}

/**
 * The career's files did not arrive. A build that went live after this page
 * was opened has replaced them, or the network is down: either way a reload
 * fetches what is there now. The save is untouched — nothing was opened.
 */
function Unloaded() {
  return (
    <div className="update-nudge" role="alert">
      <div className="update-body">
        <b>游戏没载入成功</b>
        <span>可能是游戏刚更新了，也可能是网络断了。刷新一下再试，存档不受影响。</span>
      </div>
      <div className="update-acts">
        <button className="primary sm" onClick={() => location.reload()}>刷新</button>
      </div>
    </div>
  )
}
