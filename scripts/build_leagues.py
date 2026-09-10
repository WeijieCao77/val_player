"""Who held a league seat in each partnered year, 2023 to 2026, as Liquipedia records it.

2023 is the year the open road closed: thirty clubs were licensed into three
international leagues, and from 2024 China became the fourth. Who got a seat
was a commercial decision, not a result — Acend, the 2021 world champion, did
not get one — so it is history the game copies rather than simulates, with the
one exception the author chose (方案 C): the player's own club, judged on its
2022.

Liquipedia's 「VCT/<year>/Partnered Teams」 page lists every league's clubs with
the season each first and last held the seat; an Ascension winner appears the
year it was promoted. The columns are not the same every year — 2023 has an
Owner column, 2024 on does not, 2026 drops a cell here and there — so cells are
read by what they hold, not where they sit. This reads the pages
fetch_lp_events.py already cached — no requests.

    python scripts/build_leagues.py

Output: src/data/leagues.json
    pages   — year -> league -> [{team, type, first, last, note}]
    members — year -> league -> [team]   the clubs holding a seat that year
    notes   — year -> [footnote text]
"""
from __future__ import annotations

import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'leagues.json')
# a section header names its league after the icon; 2024's page calls China 「CN」
LEAGUE_OF = [(r'americas', 'Americas'), (r'emea', 'EMEA'), (r'pacific', 'Pacific'), (r'china|\bcn\b', 'China')]
CELL = re.compile(r'^\|(?![-}])[ \t]*(.*)$', re.M)
YEAR = re.compile(r'^(\d{4}|-)$')
KIND = re.compile(r'^(Partner|Ascended)\b')


def cached_pages() -> dict[str, str]:
    out = {}
    for f in glob.glob(os.path.join(ROOT, '.cache', 'lp', 'events_*.json')):
        with open(f, encoding='utf-8') as fh:
            for p in json.load(fh).get('query', {}).get('pages', []):
                if 'Partnered Teams' in p.get('title', '') and not p.get('missing'):
                    out[p['title']] = p['revisions'][0]['slots']['main']['content']
    return out


def league_of(header: str) -> str | None:
    h = re.sub(r'\[\[[^\]]*\]\]|\{\{[^}]*\}\}', ' ', header).lower()
    return next((lg for pat, lg in LEAGUE_OF if re.search(pat, h)), None)


def plain(s: str) -> str:
    s = re.sub(r'<ref[^>]*>.*?</ref>|<ref[^>]*/>', '', s)
    s = re.sub(r'\{\{Team\|([^}|]+)[^}]*\}\}', r'\1', s)
    s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', s)
    s = re.sub(r'<[^>]+>|\{\{[^}]*\}\}|\'\'+', '', s)
    return re.sub(r'\s+', ' ', s).strip()


def parse(text: str) -> tuple[dict[str, list[dict]], list[str]]:
    leagues: dict[str, list[dict]] = {}
    notes: list[str] = []
    # re.split keeps each captured header at the odd indexes
    sections = re.split(r'^===(.*?)===[ \t]*$', text, flags=re.M)
    for i in range(1, len(sections), 2):
        league = league_of(sections[i])
        body = sections[i + 1]
        for line in body.splitlines():
            if not line.startswith(('|', '!', '{|')) and re.search(r'<sup>\d+</sup>|^\s*\d+\.', line):
                notes.append(plain(line))
        if not league:
            continue
        rows = []
        for row in re.split(r'^\|-.*$', body, flags=re.M):
            team = re.search(r'\{\{Team\|([^}|]+)', row)
            if not team:
                continue
            cells = [c.strip() for c in CELL.findall(row)]
            at = next(k for k, c in enumerate(cells) if '{{Team|' in c)
            rest = cells[at + 1:]
            k = next((j for j, c in enumerate(rest) if KIND.match(c)), None)
            years = [c for c in rest[k + 1:] if YEAR.match(c)] if k is not None else []
            first = int(years[0]) if years and years[0] != '-' else None
            last = int(years[1]) if len(years) > 1 and years[1] != '-' else None
            note = re.search(r'<sup>(\d+)</sup>', cells[at])
            rows.append({'team': team.group(1).strip(), 'type': KIND.match(rest[k]).group(1) if k is not None else '',
                         'first': first, 'last': last, 'note': int(note.group(1)) if note else None})
        leagues[league] = rows
    return leagues, notes


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    pages: dict[str, dict] = {}
    notes: dict[str, list[str]] = {}
    for title, text in sorted(cached_pages().items()):
        m = re.search(r'VCT/(\d{4})/Partnered Teams$', title)
        if m:
            pages[m.group(1)], notes[m.group(1)] = parse(text)
    members = {
        year: {lg: [r['team'] for r in rows
                    if (r['first'] is None or r['first'] <= int(year)) and (r['last'] is None or r['last'] >= int(year))]
               for lg, rows in leagues.items()}
        for year, leagues in pages.items()}
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump({'pages': pages, 'members': members, 'notes': notes}, f, ensure_ascii=False, indent=1)
    print(f'写入 {OUT}')
    for year, leagues in members.items():
        print(f'  {year}：' + ' · '.join(f'{lg} {len(teams)}' for lg, teams in leagues.items()))
        for lg, rows in pages[year].items():
            odd = [r for r in rows if r['team'] not in leagues[lg] or r['note'] or r['type'] != 'Partner']
            if odd:
                print(f'    {lg}: ' + '、'.join(f"{r['team']}({r['type']} {r['first']}-{r['last'] or ''}"
                                              f"{' 注' + str(r['note']) if r['note'] else ''})" for r in odd))
        for n in notes[year]:
            print(f'    注：{n[:160]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
