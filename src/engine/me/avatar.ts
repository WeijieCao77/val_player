/** One normalized image per career, never copied into undo or hall records.
 * Header validation bounds imported images; the browser still verifies raster decoding.
 */
export const AVATAR_MAX_CHARS = 28000
export const AVATAR_SIZE = 128
const SOFS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/** Bounded marker walk, including stuffed entropy bytes and progressive scans.
 * `exact` demands the file end at the first EOI, as our own normalized avatars do; an imported
 * photo may carry a gain map, a camera trailer or a chat app's appendix after it and passes with
 * `exact` off, because only the main image the browser decodes ever reaches the canvas. */
export function jpegDimensions(bytes: Uint8Array, exact = true): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) return
  let at = 2, scanned = false
  let dims: { width: number; height: number } | undefined
  while (at < bytes.length) {
    if (bytes[at++] !== 255) return
    while (bytes[at] === 255) at++
    const marker = bytes[at++]
    if (marker === 217) return scanned && (!exact || at === bytes.length) ? dims : undefined
    if (!marker || marker === 216 || marker === undefined || (marker >= 208 && marker <= 215)) return
    if (marker === 1) continue
    if (at + 2 > bytes.length) return
    const length = bytes[at] * 256 + bytes[at + 1]
    if (length < 2 || at + length > bytes.length) return
    if (SOFS.has(marker)) {
      if (dims || (marker !== 192 && marker !== 194) || length < 11 || bytes[at + 2] !== 8) return
      const components = bytes[at + 7]
      if (components < 1 || components > 4 || length !== 8 + components * 3) return
      const height = bytes[at + 3] * 256 + bytes[at + 4], width = bytes[at + 5] * 256 + bytes[at + 6]
      if (!width || !height) return
      dims = { width, height }
    }
    if (marker === 218) {
      if (!dims || length < 6 || length !== 6 + 2 * bytes[at + 2]) return
      scanned = true
    }
    at += length
    if (marker === 218) {
      // Entropy-coded data is not length-delimited. Skip FF00 and restart markers;
      // hand the next real marker back to the bounded segment walker.
      while (at < bytes.length) {
        if (bytes[at] !== 255) { at++; continue }
        let next = at + 1
        while (bytes[next] === 255) next++
        if (bytes[next] === 0 || (bytes[next] >= 208 && bytes[next] <= 215)) { at = next + 1; continue }
        break
      }
    }
  }
}

export function avatarData(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > AVATAR_MAX_CHARS || !value.startsWith('data:image/jpeg;base64,')) return
  const b64 = value.slice(23)
  if (!b64 || b64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) return
  try {
    const decoded = atob(b64)
    if (btoa(decoded) !== b64) return
    const dims = jpegDimensions(Uint8Array.from(decoded, c => c.charCodeAt(0)))
    if (dims?.width === AVATAR_SIZE && dims.height === AVATAR_SIZE) return value
  } catch { /* Invalid imports lose only their avatar, not the career. */ }
}
