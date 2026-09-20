/**
 * Nationality, in the player's words.
 *
 * One table for every screen that names a country and for the daily
 * challenge's 国籍 column, so a code can never leak out as two capital
 * letters somewhere the name was wanted — 「SpiritZ1 的国籍显示的是 TW」.
 *
 * vlr.gg files Taiwan, Hong Kong and Macau as separate two-letter codes. This
 * game shows all three under the PRC flag and names them 中国台湾 / 中国香港 /
 * 中国澳门 — the owner's call for a game made for a mainland audience — and
 * treats them as one country wherever nationality is compared for a hint.
 * The import rule already does (engine/imports.ts).
 */
export const NAT_CN: Record<string, string> = {
  cn: '中国', kr: '韩国', us: '美国', tr: '土耳其', br: '巴西', ru: '俄罗斯',
  tw: '中国台湾', pl: '波兰', cl: '智利', ca: '加拿大', ph: '菲律宾', jp: '日本',
  ar: '阿根廷', gb: '英国', fr: '法国', es: '西班牙', de: '德国', se: '瑞典',
  dk: '丹麦', fi: '芬兰', no: '挪威', nl: '荷兰', be: '比利时', pt: '葡萄牙',
  it: '意大利', ua: '乌克兰', lv: '拉脱维亚', lt: '立陶宛', ee: '爱沙尼亚',
  cz: '捷克', sk: '斯洛伐克', hu: '匈牙利', ro: '罗马尼亚', bg: '保加利亚',
  rs: '塞尔维亚', hr: '克罗地亚', si: '斯洛文尼亚', gr: '希腊', il: '以色列', sa: '沙特',
  ae: '阿联酋', eg: '埃及', ma: '摩洛哥', za: '南非', au: '澳大利亚',
  nz: '新西兰', id: '印度尼西亚', my: '马来西亚', sg: '新加坡', th: '泰国',
  vn: '越南', in: '印度', mn: '蒙古', kh: '柬埔寨', hk: '中国香港', mo: '中国澳门',
  mx: '墨西哥', co: '哥伦比亚', pe: '秘鲁', uy: '乌拉圭', ve: '委内瑞拉',
  ch: '瑞士', at: '奥地利', ie: '爱尔兰', is: '冰岛', by: '白俄罗斯', kz: '哈萨克斯坦',
  md: '摩尔多瓦', lb: '黎巴嫩', mk: '北马其顿', do: '多米尼加共和国', kg: '吉尔吉斯斯坦',
  pr: '波多黎各', gt: '危地马拉', pa: '巴拿马', ec: '厄瓜多尔', hn: '洪都拉斯',
  bn: '文莱', kw: '科威特', ge: '格鲁吉亚', la: '老挝', qa: '卡塔尔', cr: '哥斯达黎加',
  uz: '乌兹别克斯坦', cu: '古巴', tn: '突尼斯', jo: '约旦', pk: '巴基斯坦', ir: '伊朗',
  bh: '巴林', sy: '叙利亚', ps: '巴勒斯坦', dz: '阿尔及利亚', ba: '波黑', bm: '百慕大', bd: '孟加拉国',
  // VLR's own flag codes, not ISO country assignments: sx means Scotland
  // on player pages (e.g. /player/28480/marky), not ISO SX Sint Maarten.
  // Preserve the constituent-country detail under the game's UK wording.
  wa: '英国（威尔士）', en: '英国（英格兰）', sx: '英国（苏格兰）',
  // Source neutral / unspecified markers are not countries. Display only:
  // leave natCountry and the simulation's comparison rules unchanged.
  un: '国籍未知', xx: '国籍未知', eu: '国籍未知',
}

/** Codes that are shown under another flag. */
export const FLAG_AS: Record<string, string> = { tw: 'cn', hk: 'cn', mo: 'cn' }

export const natName = (nat: string | null | undefined): string =>
  (nat && NAT_CN[nat.toLowerCase()]) || '国籍未知'

/** The country a code belongs to, for comparing two players' nationality. */
export const natCountry = (nat: string | null | undefined): string | null => {
  const k = (nat ?? '').toLowerCase()
  return k ? (FLAG_AS[k] ?? k) : null
}
