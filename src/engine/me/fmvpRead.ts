/** Lightweight readers: the home-page hall must not import the circuit/world books. */
import { isQualifier } from './compclass'
export interface FmvpTitle { year: number; title: string; started: boolean; fmvp?: boolean }
export const hasFMVP = (t: { started: boolean; fmvp?: boolean }): boolean => t.started && t.fmvp === true
export const fmvpTotals = (titles: readonly FmvpTitle[], year?: number) => {
  const rows = titles.filter(t => !isQualifier(t.title) && (year === undefined || t.year === year))
  return { confirmed: rows.filter(hasFMVP).length, unknown: rows.filter(t => t.started && t.fmvp === undefined).length }
}
