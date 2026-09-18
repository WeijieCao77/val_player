/**
 * How a career's save is written as text: the packed JSON (engine/save.ts
 * packState) gzipped and set down as base64 behind `vpz1:`, every character
 * ASCII — why, and what it measured, is in me/save.ts. A save written raw (a
 * browser without CompressionStream, or from before this) is the JSON itself
 * and reads as it is.
 *
 * Kept apart from me/save.ts, which reaches the whole world: a backup is made
 * and checked on the home page (me/backup.ts), which must not fetch every
 * roster book to do it (reported 2026-09-18, an outside audit). me/save.ts
 * says all of this again.
 */

/** A stored save that is gzip + base64 starts with this; a raw one is JSON and starts with `{`. */
export const PACKED = 'vpz1:'
/** bytes turned into characters at a time: well under any engine's limit on a call's arguments */
const CHUNK = 0x2000

/** Can this browser gzip by itself? iOS Safari before 16.4 cannot: its saves are written raw, as before. */
export function canPack(): boolean {
  return typeof CompressionStream === 'function' && typeof Blob === 'function' && typeof Response === 'function' && typeof btoa === 'function'
}

/** The packed JSON as it goes into localStorage: `vpz1:` and the gzip as base64, every character ASCII. */
export async function packStored(json: string): Promise<string> {
  const zipped = new Uint8Array(await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
  let bin = ''
  for (let i = 0; i < zipped.length; i += CHUNK) bin += String.fromCharCode(...zipped.subarray(i, i + CHUNK))
  return PACKED + btoa(bin)
}

/** ...and back to the packed JSON, whichever way it was written. */
export async function readStored(raw: string): Promise<string> {
  if (!raw.startsWith(PACKED)) return raw
  const bin = atob(raw.slice(PACKED.length))
  const zipped = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) zipped[i] = bin.charCodeAt(i)
  return new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
}
