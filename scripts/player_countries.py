"""Normalize source country values, never infer a country from a name or team.

VLR roster cards use codes; Liquipedia bios use names. Taking the first two
letters silently turned Poland into PO and both United States and UAE into UN.
Keep unknown / international / neutral flags unknown, not a guessed nationality.
"""
import json
from pathlib import Path

_FIX_FILE = Path(__file__).resolve().parents[1] / 'src' / 'data' / 'player_country_fixes.json'
VERIFIED_COUNTRIES = {row['pid']: row['to'] for row in json.loads(_FIX_FILE.read_text(encoding='utf-8'))['fixes']}

ISO_CODES = set(('ad ae af ag ai al am ao aq ar as at au aw ax az ba bb bd be bf bg bh bi bj bl bm bn bo bq br bs bt bv bw by bz '
                'ca cc cd cf cg ch ci ck cl cm cn co cr cu cv cw cx cy cz de dj dk dm do dz ec ee eg eh er es et fi fj fk fm fo fr '
                'ga gb gd ge gf gg gh gi gl gm gn gp gq gr gs gt gu gw gy hk hm hn hr ht hu id ie il im in io iq ir is it je jm jo jp '
                'ke kg kh ki km kn kp kr kw ky kz la lb lc li lk lr ls lt lu lv ly ma mc md me mf mg mh mk ml mm mn mo mp mq mr ms mt '
                'mu mv mw mx my mz na nc ne nf ng ni nl no np nr nu nz om pa pe pf pg ph pk pl pm pn pr ps pt pw py qa re ro rs ru rw '
                'sa sb sc sd se sg sh si sj sk sl sm sn so sr ss st sv sx sy sz tc td tf tg th tj tk tl tm tn to tr tt tv tw tz '
                'ua ug um us uy uz va vc ve vg vi vn vu wf ws ye yt za zm zw').split())

# Only names actually declared by a source are translated. Unknown text fails
# closed. These are spellings, not evidence about any individual player's home.
COUNTRY_NAMES = {
    'United States': 'us', 'USA': 'us', 'United Kingdom': 'gb', 'England': 'gb', 'Wales': 'gb',
    'Scotland': 'gb', 'Northern Ireland': 'gb', 'Sweden': 'se', 'Canada': 'ca', 'Norway': 'no',
    'Belgium': 'be', 'Spain': 'es', 'Latvia': 'lv', 'Lithuania': 'lt', 'Ukraine': 'ua',
    'Russia': 'ru', 'France': 'fr', 'Germany': 'de', 'Finland': 'fi', 'Denmark': 'dk',
    'Tunisia': 'tn', 'Egypt': 'eg', 'Poland': 'pl', 'Czech Republic': 'cz', 'Czechia': 'cz',
    'Kazakhstan': 'kz', 'Belarus': 'by', 'Slovenia': 'si', 'Slovakia': 'sk', 'Mongolia': 'mn',
    'Japan': 'jp', 'South Korea': 'kr', 'Korea': 'kr', 'Portugal': 'pt', 'Turkey': 'tr', 'Türkiye': 'tr',
    'Mexico': 'mx', 'Colombia': 'co', 'Brazil': 'br', 'Chile': 'cl', 'Argentina': 'ar',
    'Australia': 'au', 'Iceland': 'is', 'Hong Kong': 'hk', 'New Zealand': 'nz', 'Iran': 'ir',
    'Morocco': 'ma', 'Guatemala': 'gt', 'Croatia': 'hr', 'Israel': 'il', 'Vietnam': 'vn',
    'Jordan': 'jo', 'Lebanon': 'lb', 'Indonesia': 'id', 'Serbia': 'rs', 'Estonia': 'ee',
    'Taiwan': 'tw', 'Thailand': 'th', 'Italy': 'it', 'Hungary': 'hu', 'Greece': 'gr',
    'Philippines': 'ph', 'Singapore': 'sg', 'Malaysia': 'my', 'Puerto Rico': 'pr',
    'Dominican Republic': 'do', 'North Macedonia': 'mk', 'China': 'cn', 'India': 'in',
    'Romania': 'ro', 'Bulgaria': 'bg', 'Netherlands': 'nl', 'Venezuela': 've',
    'Saudi Arabia': 'sa', 'Bahrain': 'bh', 'United Arab Emirates': 'ae', 'Kuwait': 'kw',
    'Qatar': 'qa', 'Ireland': 'ie', 'Syria': 'sy', 'Costa Rica': 'cr', 'Switzerland': 'ch',
    'Brunei': 'bn', 'Palestine': 'ps', 'Cambodia': 'kh', 'Cyprus': 'cy', 'Algeria': 'dz',
    'Macao': 'mo', 'Macau': 'mo', 'Austria': 'at', 'Uzbekistan': 'uz',
    'Bosnia and Herzegovina': 'ba',
}
NAMES = {name.casefold(): code for name, code in COUNTRY_NAMES.items()}


def country_code(value):
    if not isinstance(value, str):
        return None
    value = value.strip().casefold()
    if value == 'uk':
        return 'gb'
    return value if value in ISO_CODES else NAMES.get(value)


def player_country(raw_country, bio, pid):
    """A roster code wins; a bio fallback must be joined by the same VLR id.

    A frozen exact-ID correction is independent evidence when the event card
    has no usable flag; this survives quarantine of a wrongly matched bio.
    `matchedBy=search` and bios attached by nickname alone are not safe identity
    matches. Do not propagate their country into the simulation.
    """
    # VLR flag codes are not strictly ISO: sx is Scotland, wa Wales, en
    # England. Keep these source-specific aliases out of the ISO decoder.
    vlr_code = raw_country.strip().casefold() if isinstance(raw_country, str) else ''
    raw = {'wa': 'gb', 'en': 'gb', 'sx': 'gb'}.get(vlr_code) or country_code(raw_country)
    if raw:
        return raw
    if str(pid) in VERIFIED_COUNTRIES:
        return VERIFIED_COUNTRIES[str(pid)]
    if bio.get('matchedBy') == 'vlr' and str(bio.get('vlr')) == str(pid):
        return country_code(bio.get('country'))
    return None
