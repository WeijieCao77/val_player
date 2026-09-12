"""The circuit events vlr.gg's index never listed — found by name, so they can be fetched like the rest.

build_routes.py matches every Liquipedia page to a vlr event and says which
points columns it could not place. Some of those events are simply absent from
records.json, the event index everything else was fetched from: Turkey's
Stage 1 Masters, LATAM's North and South Stage 1 Masters, the LAN and LAS
Stage 3 playoffs. Their points are real — Oxygen's 120 in 2021 includes 45 from
Turkey's Masters — so a pool without them is wrong in exactly the teams that
played there, and the Last Chance Qualifier draws from that pool.

This asks vlr's own search for each missing page's name, scores the events it
returns against that name and year, and prints the ids with the commands that
fetch them into history.json and history_matches.json.

    python scripts/find_vlr_events.py
    python scripts/find_vlr_events.py --write     # also save .cache/missing_events.json

Same manners as fetch_history.py: a descriptive User-Agent, 1.5 s apart, cached.
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_routes as br  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
CACHE = os.path.join(ROOT, '.cache', 'vlrsearch')
UA = ('val_player-dataset/0.1 (personal VALORANT career-sim project; '
      'project page https://github.com/WeijieCao77/val_player)')
DELAY = 1.5


def fetch(url: str, name: str) -> str:
    path = os.path.join(CACHE, name)
    if os.path.exists(path) and os.path.getsize(path) > 500:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    os.makedirs(CACHE, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode('utf-8', errors='replace')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    time.sleep(DELAY)
    return body


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    a = ap.parse_args()
    routes = json.load(open(os.path.join(DATA, 'routes.json'), encoding='utf-8'))
    points = json.load(open(os.path.join(DATA, 'lp_points.json'), encoding='utf-8'))

    missing: dict[str, tuple[str, str]] = {}
    for title, table in points.items():
        m = re.search(r'/(2021|2022)/Circuit Points/(.+)$', title)
        if not m:
            continue
        year, pool_page = m.group(1), m.group(2)
        pool = next((k for k, v in br.POOL_PAGE.items() if v == pool_page), None)
        cols_r = routes['pools'].get(year, {}).get(pool, {}).get('columns', [])
        for c, cr in zip(table['columns'], cols_r):
            if c['kind'] == 'event' and c.get('page') and not cr.get('event'):
                missing[c['page'].replace('_', ' ')] = (year, c['name'])
    print(f'{len(missing)} 个积分列没有对应的 vlr 赛事')

    found = []
    for page, (year, name) in sorted(missing.items()):
        query = re.sub(r'^VCT \d{4}:\s*', '', name)
        want = br.tokens(query)
        # vlr's search wants fewer words than Liquipedia's titles carry: the full
        # name first, then without North/South, then LAN/LAS as LATAM
        attempts = [query, re.sub(r'\s*\b(North|South)\b', '', query), re.sub(r'^(LAN|LAS)\b', 'LATAM', query)]
        best = None
        for q in dict.fromkeys(attempts):
            url = 'https://www.vlr.gg/search/?q=' + urllib.parse.quote(q) + '&type=events'
            body = fetch(url, 'q_' + re.sub(r'[^A-Za-z0-9]+', '_', f'{year}_{q}') + '.html')
            # results link through /search/r/event/<id>/idx; the name is in search-item-title
            for mm in re.finditer(r'href="/search/r/event/(\d+)/idx"(.*?)</a>', body, re.S):
                eid, inner = mm.group(1), mm.group(2)
                tm = re.search(r'search-item-title">(.*?)</div>', inner, re.S)
                dm = re.search(r'search-item-desc[^>]*>(.*?)<', inner, re.S)
                title = re.sub(r'\s+', ' ', htmllib.unescape(tm.group(1) if tm else '')).strip()
                dates = re.sub(r'\s+', ' ', htmllib.unescape(dm.group(1) if dm else '')).strip()
                have = br.tokens(title)
                score = len(want & have) / max(1, len(want | have))
                if year in dates:
                    score += 0.3
                elif re.search(r'20\d\d', dates):
                    score -= 0.5
                if best is None or score > best[0]:
                    best = (score, eid, dates, title)
        if best and best[0] >= 0.5:
            found.append({'id': best[1], 'year': int(year), 'name': best[3], 'page': page, 'score': round(best[0], 2)})
            print(f'  {year} {query:<44} → vlr {best[1]} {best[3][:60]}（{best[0]:.2f}）')
        else:
            print(f'  {year} {query:<44} → 没找到（最好的 {best[3][:50] if best else "无"} {best[0]:.2f}）' if best else
                  f'  {year} {query:<44} → 没找到')

    by_year: dict[int, list[str]] = {}
    for f in found:
        by_year.setdefault(f['year'], []).append(f['id'])
    for y, ids in sorted(by_year.items()):
        print(f'\n  python scripts/fetch_history.py --year {y} --ids {",".join(ids)}')
    if found:
        print(f'  python scripts/fetch_matches.py --ids {",".join(f["id"] for f in found)}')
    if a.write:
        with open(os.path.join(ROOT, '.cache', 'missing_events.json'), 'w', encoding='utf-8') as f:
            json.dump(found, f, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
