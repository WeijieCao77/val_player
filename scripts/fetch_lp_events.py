"""What Liquipedia knows about every VCT event page: its format, who came, and how they got in.

vlr.gg gives the matches and the rosters. It does not say *why* a team was at
an event, and the author's rule is that qualification works the way it really
did. Liquipedia's TeamCards say it outright — 「NA Circuit Points」,
「Masters Berlin」, 「Last Chance Qualifier」 — and each page's Format section
says what the rounds were: which groups were Bo2, how a level group was broken,
how many went through.

Pages are enumerated with `list=allpages` under each year's prefix, then read
fifty at a time (one request per fifty, two seconds apart, cached under
.cache/lp/ like fetch_bios.py). Statistics, bootcamp and Game Changers subpages
are skipped.

    python scripts/fetch_lp_events.py
    python scripts/fetch_lp_events.py --show "VALORANT Champions Tour/2021/Japan/Stage 1/Challengers 1"

Output: src/data/lp_events.json — title -> {info, format, teams}
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_bios import get  # noqa: E402  (same API manners and cache)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'lp_events.json')

PREFIXES = [
    ('VALORANT Champions Tour/2021/', 'vct2021'),
    ('VALORANT Champions Tour/2022/', 'vct2022a'),
    ('VCT/2022/', 'vct2022'),
    ('VCT/2023/', 'vct2023'),
    ('VCT/2024/', 'vct2024'),
    ('VCT/2025/', 'vct2025'),
    ('VCT/2026/', 'vct2026'),
]
SKIP = re.compile(r'/(Statistics|Player Information|Bootcamps|Additional Content|Broadcasts|Media)$|Game Changers', re.I)
INFO_KEYS = ('name', 'tickername', 'sdate', 'edate', 'format', 'team_number', 'prizepoolusd', 'liquipediatier', 'type', 'country', 'city')


def allpages(prefix: str, tag: str) -> list[str]:
    titles: list[str] = []
    cont = None
    n = 0
    while True:
        params = {'action': 'query', 'list': 'allpages', 'apprefix': prefix, 'aplimit': '500',
                  'format': 'json', 'formatversion': '2'}
        if cont:
            params['apcontinue'] = cont
        data = get(params, f'allpages_{tag}_{n}.json')
        n += 1
        titles += [p['title'] for p in data.get('query', {}).get('allpages', [])]
        cont = data.get('continue', {}).get('apcontinue')
        if not cont:
            return titles


def wikitexts(titles: list[str], tag: str) -> dict[str, str]:
    data = get({
        'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main',
        'format': 'json', 'formatversion': '2', 'titles': '|'.join(titles),
    }, f'events_{tag}.json')
    out: dict[str, str] = {}
    for p in data.get('query', {}).get('pages', []):
        if p.get('missing'):
            continue
        try:
            out[p['title']] = p['revisions'][0]['slots']['main']['content']
        except (KeyError, IndexError):
            pass
    return out


def plain(s: str) -> str:
    """Wiki markup to readable text: links to their labels, templates dropped or named."""
    s = re.sub(r'<ref[^>]*/>', '', s)
    s = re.sub(r'<ref[^>]*>.*?</ref>', '', s, flags=re.S)
    s = re.sub(r'\{\{Abbr/Bo(\d)\}\}', r'Bo\1', s)
    s = re.sub(r'\{\{Abbr/([^}|]+)\}\}', r'\1', s)
    s = re.sub(r'\{\{AgentIcon\|([^}|]+)[^}]*\}\}', r'\1', s)
    s = re.sub(r'\{\{(?:team|Team|TeamShort|player|Player)\|([^}|]+)[^}]*\}\}', r'\1', s)
    s = re.sub(r'\[\[(?:[^|\]]*\|)?([^\]]+)\]\]', r'\1', s)
    s = re.sub(r'\[https?://\S+ ([^\]]+)\]', r'\1', s)
    s = re.sub(r"'''?", '', s)
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    return htmllib.unescape(s).strip()


def infobox(text: str) -> dict:
    out = {}
    for k in INFO_KEYS:
        m = re.search(r'^\|\s*' + k + r'\s*=(.*)$', text, re.M)
        if m and m.group(1).strip():
            out[k] = plain(m.group(1))
    return out


def format_section(text: str) -> str | None:
    m = re.search(r'^(={2,4})\s*Format\s*\1\s*$', text, re.M)
    if not m:
        return None
    level = len(m.group(1))
    rest = text[m.end():]
    stop = re.search(r'^={2,%d}[^=].*$' % level, rest, re.M)
    body = rest[:stop.start()] if stop else rest
    lines = [plain(line) for line in body.splitlines()]
    return '\n'.join(line for line in lines if line and not line.startswith('{{') and not line.startswith('}}'))


def team_cards(text: str) -> list[dict]:
    """Every {{TeamCard}}: the team, its five, and the line saying how it qualified."""
    cards = []
    for m in re.finditer(r'\{\{TeamCard\s*\n(.*?)\n\}\}', text, re.S):
        block = m.group(1)
        card: dict = {}
        players = []
        for line in block.splitlines():
            km = re.match(r'^\|\s*([a-z0-9_]+)\s*=(.*)$', line)
            if not km:
                continue
            key, val = km.group(1), km.group(2).strip()
            if key == 'team' and '|' in val and '[[' not in val:
                # 「|team=X10 Esports|flag=apac」: several fields on one line
                head, *pairs = val.split('|')
                card['team'] = plain(head)
                for pair in pairs:
                    k2, _, v2 = pair.partition('=')
                    if k2.strip() in ('flag', 'class'):
                        card[k2.strip()] = plain(v2)
            elif key in ('team', 'flag', 'qualifier', 'c', 'class'):
                card[key] = plain(val)
            elif re.fullmatch(r'p\d', key):
                players.append(plain(val.split('|')[0]))
        if card.get('team'):
            card['players'] = players
            cards.append(card)
    return cards


def split_params(body: str) -> list[str]:
    """A template's parameters, split on the pipes that are not inside another template or link."""
    out, depth_t, depth_l, cur, i = [], 0, 0, [], 0
    while i < len(body):
        two = body[i:i + 2]
        if two == '{{':
            depth_t += 1
            cur.append(two)
            i += 2
            continue
        if two == '}}':
            depth_t -= 1
            cur.append(two)
            i += 2
            continue
        if two == '[[':
            depth_l += 1
            cur.append(two)
            i += 2
            continue
        if two == ']]':
            depth_l -= 1
            cur.append(two)
            i += 2
            continue
        if body[i] == '|' and depth_t == 0 and depth_l == 0:
            out.append(''.join(cur))
            cur = []
        else:
            cur.append(body[i])
        i += 1
    out.append(''.join(cur))
    return out


def prize_slots(text: str) -> list[dict]:
    """Every place range in the page's prize pools: what it paid in circuit points, and who took it.

    Two generations of template carry it — 2021's 「prize pool slot」 lists the
    teams as bare parameters, the newer 「Slot」 nests 「Opponent」 templates or
    leaves them to Liquipedia's database. A slot whose points are a logo, not a
    number, is a qualification (the Berlin winner went to Champions instead).
    """
    out = []
    for m in re.finditer(r'\{\{\s*(prize pool slot|Slot)\s*\|', text, re.I):
        depth, i = 0, m.start()
        while i < len(text):
            if text.startswith('{{', i):
                depth += 1
                i += 2
                continue
            if text.startswith('}}', i):
                depth -= 1
                i += 2
                if depth == 0:
                    break
                continue
            i += 1
        body = text[m.end():i - 2]
        named, positional = {}, []
        for part in split_params(body):
            k, eq, v = part.partition('=')
            if eq and re.fullmatch(r'\s*[a-z0-9_]+\s*', k):
                named[k.strip()] = v.strip()
            elif part.strip():
                positional.append(part.strip())
        if 'award' in named or not named.get('place'):
            continue
        pm = re.match(r'\s*(\d+)(?:\s*-\s*(\d+))?', named['place'])
        if not pm:
            continue
        raw = named.get('points', '')
        pts = int(raw.replace(',', '')) if re.fullmatch(r'\s*[\d,]+\s*', raw) else None
        teams = []
        for om in re.finditer(r'\{\{\s*(?:Opponent|TeamOpponent)\s*\|([^|}]+)', body, re.I):
            teams.append(plain(om.group(1)))
        for part in positional:
            if not part.startswith('{{') and not part.startswith('<') and not part.startswith('[['):
                teams.append(plain(part))
        out.append({'from': int(pm.group(1)), 'to': int(pm.group(2) or pm.group(1)), 'points': pts,
                    'qualifies': plain(raw) if raw and pts is None else None,
                    'teams': [t for t in teams if t]})
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', action='append', default=[])
    a = ap.parse_args()

    titles: list[str] = []
    for prefix, tag in PREFIXES:
        t = [x for x in allpages(prefix, tag) if not SKIP.search(x)]
        print(f'  {prefix}: {len(t)} 页', flush=True)
        titles += t

    out: dict[str, dict] = {}
    for i in range(0, len(titles), 50):
        chunk = titles[i:i + 50]
        for title, text in wikitexts(chunk, f'{i // 50:03d}').items():
            out[title] = {'info': infobox(text), 'format': format_section(text), 'teams': team_cards(text),
                          'prizes': prize_slots(text)}
        print(f'  {min(i + 50, len(titles))}/{len(titles)}', flush=True)

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    with_format = sum(1 for v in out.values() if v['format'])
    with_teams = sum(1 for v in out.values() if v['teams'])
    print(f'\n写入 {OUT}：{len(out)} 页 · 有赛制说明 {with_format} · 有参赛队卡 {with_teams}')

    for title in a.show:
        v = out.get(title)
        print(f'\n=== {title}')
        if not v:
            print('  （没有这一页）')
            continue
        print('  info:', v['info'])
        print('  format:\n' + '\n'.join('    ' + line for line in (v['format'] or '').splitlines()))
        for c in v['teams']:
            print(f"  · {c['team']} [{c.get('flag')}] 资格：{c.get('qualifier')} 阵容：{' '.join(c['players'])}")
        for s in v.get('prizes', []):
            print(f"  奖金表 {s['from']}-{s['to']}：{s['points'] if s['points'] is not None else s['qualifies']} · {'、'.join(s['teams'])}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
