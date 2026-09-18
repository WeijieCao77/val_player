/**
 * The career, and everything it reads: the one module the home page
 * (src/App.tsx) fetches when a career is opened — 开始生涯, 继续 — and never
 * before. Behind it are the engine and every dataset it reads: the roster books
 * of 2021 and after, every circuit's calendar, the 2026 world.
 *
 * Reported 2026-09-18 (an outside audit of 6d128ed, finding 05): the home page
 * imported the save module to set a name, the save module reached the engine,
 * and the engine reached every dataset, so the page fetched 6.7 MB (1.4 MB
 * gzipped) before anyone had opened a career. The home page now imports
 * nothing that reaches the world (scripts/check_boundary.ts checks it), and what
 * the new-career screen reads off the world is worked out as the site is built
 * (engine/me/startSheet.ts).
 *
 * One entry, so the build keeps it all in one chunk; the career's screens are
 * one component (PlayerGame.tsx) so that editing them keeps its state under the
 * dev server.
 */
export { default as Career } from './PlayerGame'
export { createCareer } from './engine/me/career'
export { importBackupCareer, openSavedCareer, readBackupCareer, seedHallFromSave } from './engine/me/opening'
