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

/**
 * An event whose point is to send its winner on to another one: an open
 * qualifier (a cup's 公开资格赛, the kickoff's 揭幕赛公开资格赛), a league cup's
 * 公开季后赛, a Last Chance or any other qualifier. Winning it is 出线, not a
 * title (2026-09-12): counted as titles, doors made up most of a career's shelf.
 * Ascension (晋级赛) and Promotion are not qualifiers — winning them is the
 * league seat itself — and Challengers stages and finals are titles too.
 */
export function isQualifier(name: string): boolean {
  const n = (name ?? '').trim()
  if (/晋级赛|Ascension|Promotion/i.test(n) && !/资格赛/.test(n)) return false
  return /资格赛|公开季后赛|Qualifier|Last Chance|Open Playoffs/i.test(n)
}
