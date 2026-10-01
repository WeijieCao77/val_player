/** Display names for the provisional 2027+ Cups. Event IDs and save keys stay numbered. */
export const FUTURE_CUP_NAME = { 1: '春季杯', 2: '夏季杯' } as const

/** Old saves may still hold a numbered title or match name. */
export function sameFutureCupName(year: number, a: string, b: string): boolean {
  if (a === b) return true
  if (year < 2027) return false
  const current = (name: string) => name
    .replace(/杯赛 ([12]) ?公开/g, (_whole, cup: string) => `${FUTURE_CUP_NAME[Number(cup) as 1 | 2]}公开`)
    .replace(/杯赛 1/g, FUTURE_CUP_NAME[1])
    .replace(/杯赛 2/g, FUTURE_CUP_NAME[2])
  return current(a) === current(b)
}
