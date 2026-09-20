import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { BACKUP_TAKE, BACKUP_WHY, exportBackup, parseBackup, readBackupFile } from '../../engine/me/backup'
import type { Backup, BackupPreview, BackupTake, ExportResult } from '../../engine/me/backup'
import type { AutosaveInfo } from '../../engine/me/saveInfo'
import type { SaveMeta } from '../../engine/me/saveMeta'
import { ConfirmCard, SaveCard, playedAt } from './SaveCard'

/**
 * 导出存档 and 导入存档 on the home page (engine/me/backup.ts: why, and the file).
 *
 * Export is a file (a Blob download) and, for a browser that will not download
 * — WeChat's, which says nothing when it refuses — the same text as a 存档码 to
 * copy; where the clipboard is refused too, the code is put in a box to copy by
 * hand. Import takes a file or a pasted code, says what the career is on the
 * same card as 上次的存档, and asks before it overwrites the save on this device.
 */

const inWeChat = (): boolean => typeof navigator !== 'undefined' && /MicroMessenger/i.test(navigator.userAgent)
const size = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** 导出存档, opened under the save card or as the escape hatch beside a failed autosave. */
export function ExportBox({ onClose, source = exportBackup, rescue = false }: {
  onClose: () => void
  /** defaults to the save on disk; a failed autosave passes the career still in memory */
  source?: () => Promise<ExportResult>
  rescue?: boolean
}) {
  const [out, setOut] = useState<ExportResult | null>(null)
  const [note, setNote] = useState('')
  // the clipboard was refused: the code in a box, to copy by hand
  const [byHand, setByHand] = useState(false)
  const box = useRef<HTMLTextAreaElement>(null)
  const wechat = inWeChat()
  useEffect(() => {
    let live = true
    source().then((r) => { if (live) setOut(r) }, () => { if (live) setOut({ ok: false, why: 'unreadable' }) })
    return () => { live = false }
  }, [source])
  useEffect(() => {
    if (!byHand || !box.current) return
    box.current.focus()
    box.current.select()
  }, [byHand])
  const ready = out?.ok ? out : null

  const download = () => {
    if (!ready) return
    try {
      const url = URL.createObjectURL(new Blob([ready.text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = ready.name
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setNote(`已下载 ${ready.name}。存到网盘或发给自己；换设备时，在首页点「导入存档」选这个文件。`)
    } catch {
      setNote('这个浏览器下载不了文件，用「复制存档码」。')
    }
  }
  const copy = async () => {
    if (!ready) return
    try {
      await navigator.clipboard.writeText(ready.text)
      setByHand(false)
      setNote(`存档码已复制（${size(ready.bytes)}）。粘到备忘录或发给自己；换设备时，在首页点「导入存档」粘贴进去。`)
    } catch {
      setByHand(true)
      setNote('浏览器不让直接复制：存档码在下面的框里，长按全选后复制。')
    }
  }

  return (
    <section className="backup-box" aria-label={rescue ? '导出当前进度' : '导出存档'}>
      <div className="backup-head">
        <b>{rescue ? '导出当前进度' : '导出存档'}</b>
        <button className="sm ghost" onClick={onClose}>收起</button>
      </div>
      <p className="tiny muted">{rescue
        ? '这里导出的是页面里还没丢的当前进度，不是浏览器里较早的那份。先把文件存好，再处理空间或刷新页面。'
        : '存档只在这个浏览器里。导出成一个文件，成就殿堂也在里面：换设备、换浏览器或者清了网站数据，在首页点「导入存档」就能接着玩。'}</p>
      {wechat && <p className="tiny backup-warn">微信里下载不了文件：用「复制存档码」，或者点右上角在浏览器里打开再下载。</p>}
      {out && !out.ok && <p className="small backup-warn" role="alert">{out.why === 'none' ? '这台设备上没有存档。' : '这个存档读不了，导不出来。'}</p>}
      <div className="row backup-acts">
        <button className={wechat ? '' : 'primary'} onClick={download} disabled={!ready}>{out ? '下载存档文件' : '准备中…'}</button>
        <button className={wechat ? 'primary' : ''} onClick={copy} disabled={!ready}>复制存档码</button>
        {ready && <span className="tiny faint">{size(ready.bytes)}</span>}
      </div>
      {note && <p className="small backup-note" role="status">{note}</p>}
      {byHand && ready && (
        <textarea ref={box} readOnly rows={3} value={ready.text} onFocus={(e) => e.currentTarget.select()} aria-label="存档码" />
      )}
    </section>
  )
}

/** 导入存档: its own page, like the 成就殿堂's, from the save card and from the new-career screen. */
export function ImportView({ save, onBack, onRead, onSeedHall }: {
  /** the save on this device, which taking the backup in overwrites; null when there is none */
  save: AutosaveInfo | null
  onBack: () => void
  /** decode the backup (App.tsx: the career's files come with it); null when those files did not arrive, which App says itself */
  onRead: (b: Backup) => Promise<BackupPreview | null>
  /** a save from before the summary: what it unlocked goes into the hall before the backup overwrites it */
  onSeedHall: () => Promise<void>
}) {
  const [paste, setPaste] = useState('')
  const [reading, setReading] = useState(false)
  const [err, setErr] = useState('')
  const [got, setGot] = useState<{ b: Backup; meta: SaveMeta; take: () => Promise<BackupTake> } | null>(null)
  const [asking, setAsking] = useState(false)
  const [taking, setTaking] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  useEffect(() => { window.scrollTo(0, 0) }, [])

  const read = async (text: string) => {
    setErr('')
    setGot(null)
    const p = parseBackup(text)
    if (!p.ok) { setErr(BACKUP_WHY[p.why]); return }
    setReading(true)
    try {
      const r = await onRead(p.backup)
      if (!r) return
      if (!r.ok) { setErr(BACKUP_WHY[r.why]); return }
      setGot({ b: p.backup, meta: r.meta, take: r.take })
    } catch {
      setErr(BACKUP_WHY.partial)
    } finally {
      setReading(false)
    }
  }
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    // the same file can be picked again after a failed read
    e.target.value = ''
    if (!f) return
    const r = await readBackupFile(f)
    if (!r.ok) { setErr(BACKUP_WHY[r.why]); setGot(null); return }
    await read(r.text)
  }
  const take = async () => {
    if (!got || taking) return
    setAsking(false)
    setTaking(true)
    setErr('')
    // a save from before the summary may never have been opened by a build with the hall: what it unlocked goes in
    // before the backup overwrites it, as before a new career (NewCareer.tsx confirmNew)
    if (save && !save.meta) await onSeedHall()
    let r: BackupTake
    try { r = await got.take() } catch { r = 'unopened' }
    // 'ok': the career is open, and this page is gone with the home page
    if (r === 'ok') return
    setTaking(false)
    setErr(BACKUP_TAKE[r])
  }
  const exported = got && Date.parse(got.b.exportedAt)
  const hallCards = got?.b.hall?.cards.length ?? 0
  const who = save?.meta?.ign

  return (
    <div className="backup-page">
      <div className="backup-top">
        <button className="sm ghost" onClick={onBack}>← 返回</button>
        <h2>导入存档</h2>
      </div>
      {!got && (
        <>
          <p className="small muted">选「导出存档」存下的文件，或者把复制的存档码粘贴进来。</p>
          <div className="row backup-acts">
            <button className="primary" onClick={() => file.current?.click()} disabled={reading}>{reading ? '读取中…' : '选择存档文件'}</button>
            <input ref={file} type="file" accept=".json,.txt,application/json,text/plain" hidden onChange={pick} />
          </div>
          <textarea className="backup-paste" rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="或者把存档码粘贴到这里" aria-label="存档码" />
          <div className="row backup-acts">
            <button onClick={() => read(paste)} disabled={reading || !paste.trim()}>{reading ? '读取中…' : '读取存档码'}</button>
          </div>
        </>
      )}
      {err && <p className="small backup-warn" role="alert">{err}</p>}
      {got && (
        <>
          <SaveCard
            label="备份里的存档"
            at={exported ? `导出于 ${playedAt(exported)}` : null}
            info={{ meta: got.meta, year: got.meta.year, day: got.meta.day }}
            hallNow={null}
            go={(
              <>
                <div className="row">
                  <button className="primary" onClick={() => (save ? setAsking(true) : take())} disabled={taking}>{taking ? '导入中…' : '导入并继续'}</button>
                  <button onClick={() => { setGot(null); setErr('') }} disabled={taking}>换一个</button>
                </div>
                <p className="tiny faint">{save ? '导入会覆盖这台设备上的存档。' : '这台设备上还没有存档。'}</p>
              </>
            )}
          />
          {/* the hall is never replaced: the backup's is folded into this device's (engine/me/hall.ts mergeHallFrom) */}
          <p className="nc-again">
            {hallCards ? `备份里的成就殿堂（${hallCards} 局生涯）` : '备份里的成就殿堂'}会并进这台设备的殿堂，两边的记录都留着，不会覆盖。
          </p>
        </>
      )}
      {asking && got && (
        <ConfirmCard
          title="导入存档"
          body={`${who ? `${who} 的存档` : '这台设备上的存档'}会被这份备份覆盖，回不来了。`}
          ok="导入"
          onOk={take}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  )
}
