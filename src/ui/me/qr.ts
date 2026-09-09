/**
 * The QR on the career card: https://valplayer-production.up.railway.app
 *
 * Version 4, EC level M, 33x33. The page's CSP will not load an external
 * script, so this cannot be generated in the browser; and a base64 PNG would
 * go soft when scaled up on the canvas and is impossible to review in a diff.
 * So the matrix is generated once by a real QR library and committed as a
 * run-length string that share.ts expands into crisp squares.
 *
 * Regenerate with `python scripts/make_qr.py <url>` if the address changes —
 * the matrix *is* the URL, and a stale one sends people somewhere else.
 *
 * Scanned on a real phone on 2026-09-09; it opens the site. That was the one
 * check nobody could do from here — the drawn pixels were verified against
 * the library's own output bit for bit, but bits matching is not the same as
 * a camera reading them.
 */
export const QR_URL = 'https://valplayer-production.up.railway.app'
export const QR_SIZE = 33
export const QR_RUNS = '0,7,4,2,1,1,1,1,1,4,1,1,2,8,5,1,2,1,1,2,2,1,2,1,1,2,2,1,1,1,5,2,1,3,1,1,1,1,1,1,3,1,1,1,2,4,3,1,1,3,1,2,1,3,1,1,1,2,2,1,5,2,1,1,1,2,1,1,1,3,1,2,1,3,1,1,1,3,1,1,1,3,3,3,3,1,1,3,1,2,5,1,1,1,3,1,1,1,4,1,1,1,1,2,1,1,5,8,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,7,8,1,1,1,3,1,1,1,1,6,9,1,1,5,2,2,2,2,2,1,1,1,2,3,1,5,5,3,2,2,3,2,2,1,1,2,1,2,2,2,1,2,1,1,2,1,1,3,2,1,3,3,1,1,4,1,1,1,1,1,1,1,1,2,1,3,6,3,1,1,2,4,4,2,2,3,1,6,1,1,1,4,2,1,1,1,3,3,1,1,3,2,3,4,4,2,1,2,2,1,2,1,5,1,1,1,3,4,4,4,3,5,3,2,2,3,2,3,1,2,3,1,1,1,1,1,2,1,2,1,5,2,1,4,1,2,4,1,2,2,1,1,2,3,1,1,1,1,2,1,1,1,2,1,1,2,3,1,3,1,3,1,3,1,1,2,1,1,1,4,1,1,1,3,1,5,2,4,1,1,1,1,2,4,1,1,2,1,2,5,1,2,2,4,3,4,1,2,1,1,4,2,3,5,1,2,5,1,2,1,2,1,5,1,2,1,1,1,1,1,1,3,1,3,3,1,2,1,1,2,1,1,1,3,3,4,2,1,5,2,1,2,1,3,2,2,1,1,3,3,1,2,1,2,2,4,1,1,2,1,1,1,2,1,1,1,2,2,1,1,2,4,1,1,1,1,2,5,1,1,2,2,1,1,3,3,2,1,1,2,1,1,1,5,3,1,8,1,1,1,1,1,1,1,1,2,1,2,1,1,1,1,3,1,1,1,1,8,4,3,1,3,2,1,1,3,1,1,1,1,1,1,2,1,5,1,1,1,1,1,1,2,1,1,1,2,1,1,2,2,3,3,2,1,1,3,1,1,1,1,1,1,5,1,2,4,1,6,3,1,1,3,1,1,1,4,1,3,2,1,2,1,1,3,2,2,2,2,1,3,1,1,1,3,4,2,3,1,3,1,1,2,2,1,2,1,5,1,2,2,1,1,2,1,2,1,2,1,1,1,4,3,2,7,1,1,2,5,1,1,5,3,1,1,1,1,1,1,1'
