/**
 * What the new-career screen reads off the world, worked out as the site is
 * built (vite.config.ts runs engine/me/startSheet.ts buildStartSheet) so the
 * home page does not fetch the world to draw it.
 */
declare module 'virtual:start-sheet' {
  const sheet: import('./engine/me/startSheet').StartSheet
  export default sheet
}
