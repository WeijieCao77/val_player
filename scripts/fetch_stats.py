"""Per-player, per-event statlines — the raw material for attributes.

`fetch_history.py` gives who was on which roster. This gives how they played:
vlr's `/event/stats/<id>/` table carries, for every player at an event,

    Agents · Maps · Rounds · Rating · ACS · K:D · KAST · ADR · KPR · APR
    FK:FD · FKPR · FDPR · HS% · CL% · CL · KMAX · K · D · A · FK · FD

which is enough to derive the eight the game actually uses, rather than
inventing them. Without it a 2021 world would have TenZ and a third-string
Challengers player rated the same, and the whole point of the era would be
gone.

Usage
-----
    python scripts/fetch_stats.py --years 2021,2022,2023
    python scripts/fetch_stats.py --years 2021 --limit 5

Same manners as fetch_history: one page per event, cached to `.cache/vlr/`,
1.5 s apart. Re-running costs nothing.
"""
from __future__ import annotations

import argparse
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'vlr')
RECORDS = os.path.join(ROOT, 'src', 'data', 'records.json')

UA = ('val_player-dataset/0.1 (personal VALORANT career-sim project; '
      'contact yankejing711@gmail.com)')
DELAY = 1.5

KEEP = re.compile(
    r'champions tour|valorant champions|masters|last chance|lcq|ascension|'
    # the Chinese scene before VCT China existed: two streaming-platform
    # cups and an invitational were the entire 2021 calendar, and leaving
    # them out would make that year look emptier than it actually was
    r'fgc|china evolution|panghu|huya|challengers league|vct ', re.I)
DROP = re.compile(
    r'open \d|qualifier weekly|nerd street|college|university|academy|'
    r'contenders|showdown|invitational series', re.I)

# the column order of the stats table, after the player cell
COLS = ['agents', 'maps', 'rnd', 'rating', 'acs', 'kd', 'kast', 'adr', 'kpr',
        'apr', 'fkfd', 'fkpr', 'fdpr', 'hs', 'clp', 'cl', 'kmax', 'k', 'd',
        'a', 'fk', 'fd']

ROW = re.compile(r'<tr>(.*?)</tr>', re.S)
PLAYER = re.compile(
    r'href="/player/(\d+)/[^"]*".*?st-pl-name[^>]*>(.*?)</div>.*?'
    r'st-pl-country[^>]*>(.*?)</div>', re.S)
CELL = re.compile(r'<td[^>]*>(.*?)</td>', re.S)
AGENT = re.compile(r'/agents/([a-z0-9]+)\.png')


def fetch(url: str, cache_name: str) -> str:
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    os.makedirs(CACHE, exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=45) as r:
        body = r.read().decode('utf-8', errors='replace')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    time.sleep(DELAY)
    return body


def txt(s: str) -> str:
    return htmllib.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


def num(s: str):
    """'257' -> 257.0; '1.15' -> 1.15; '72%' -> 72.0; '' -> None."""
    t = txt(s).replace('%', '').strip()
    if not t or t == '-':
        return None
    m = re.match(r'-?\d+(?:\.\d+)?', t)
    return float(m.group(0)) if m else None


def parse_stats(html: str) -> list[dict]:
    out: list[dict] = []
    for row in ROW.findall(html):
        pm = PLAYER.search(row)
        if not pm:
            continue
        cells = CELL.findall(row)
        if len(cells) < 6:
            continue
        rec: dict = {
            'id': pm.group(1),
            'ign': txt(pm.group(2)),
            'team': txt(pm.group(3)),
            'agents': sorted(set(AGENT.findall(cells[1]))) if len(cells) > 1 else [],
        }
        # cells[0] is the player cell, cells[1] the agent icons; stats follow
        for i, key in enumerate(COLS[1:], start=2):
            if i >= len(cells):
                break
            rec[key] = num(cells[i])
        out.append(rec)
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='2021,2022,2023')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'data', 'stats_history.json'))
    a = ap.parse_args()
    years = {int(y) for y in a.years.split(',') if y.strip()}

    with open(RECORDS, encoding='utf-8') as f:
        index = json.load(f)['events']
    todo = sorted((int(k), v[0], v[1]) for k, v in index.items()
                  if v[1] in years and KEEP.search(v[0]) and not DROP.search(v[0]))
    if a.limit:
        todo = todo[:a.limit]
    print(f'{len(todo)} 场要抓 stats（{sorted(years)}）', flush=True)

    out: dict = {}
    fresh = 0
    for i, (eid, name, year) in enumerate(todo, 1):
        cache_name = f's{eid}.html'
        cached = os.path.exists(os.path.join(CACHE, cache_name))
        try:
            html = fetch(f'https://www.vlr.gg/event/stats/{eid}/', cache_name)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f'  ! {eid} {name}: {e}', flush=True)
            continue
        if not cached:
            fresh += 1
        rows = parse_stats(html)
        if rows:
            out[str(eid)] = {'year': year, 'name': name, 'rows': rows}
        if i % 20 == 0 or i == len(todo):
            n = sum(len(v['rows']) for v in out.values())
            print(f'  {i}/{len(todo)}  有数据 {len(out)} 场 · {n} 条  新抓 {fresh}', flush=True)

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    people = {r['id'] for v in out.values() for r in v['rows']}
    lines = sum(len(v['rows']) for v in out.values())
    print(f'\n写入 {a.out}\n  {len(out)} 场 · {lines} 条数据 · {len(people)} 名选手')
    return 0


if __name__ == '__main__':
    sys.exit(main())
