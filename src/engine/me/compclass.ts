/**
 * What kind of event a competition is, read from its name. Its own module with
 * no imports: endings, fans, clout, transfer, bottleneck and the week all ask
 * it, and achievements imports several of those — kept in achievements.ts it
 * closed an import cycle that left CAP_EXP_MAX uninitialised at load.
 */
export type CompClass = 'champions' | 'masters' | 'lockin' | 'qual' | 'chal' | 'league'

/**
 * On the timeline a competition is stored under its Chinese name (circuit.ts
 * books `ev.cn`: 「东京大师赛」「2024 全球冠军赛」「中国 · 晋级赛」), in older
 * worlds under the English one (「Masters I」「Champions」). Order matters: a
 * qualifier for Champions is a qualifier, a Challengers event that calls itself
 * Masters is Challengers, and 2021's regional 「欧洲 · 第一赛段 大师赛」 carries
 * a 「·」 that no international event's name does.
 */
export function compClass(name: string): CompClass {
  const n = (name ?? '').trim()
  if (/资格赛|晋级赛|公开季后赛|Ascension|Qualifier|Last Chance|Open Playoffs|Promotion/i.test(n)) return 'qual'
  if (/挑战者|Challengers|进化系列赛/i.test(n)) return 'chal'
  if (/全球冠军赛/.test(n) || /^(VALORANT |Valorant )?Champions( 20\d\d)?$/.test(n)) return 'champions'
  if (/LOCK\/\/IN/i.test(n)) return 'lockin'
  if (!n.includes('·') && /大师赛|^Masters I{1,2}$|^Valorant Masters|Masters (Reykjav|Berlin|Copenhagen|Tokyo|Madrid|Shanghai|Bangkok|Toronto|Santiago|London)/i.test(n)) return 'masters'
  return 'league'
}

export const isIntlComp = (name: string): boolean => {
  const c = compClass(name)
  return c === 'champions' || c === 'masters' || c === 'lockin'
}
