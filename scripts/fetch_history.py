"""Pull the historical world out of vlr.gg, one event page at a time.

Why this exists
---------------
`src/data/records.json` already holds 1676 events for 2020–2026 **and its event
ids are vlr.gg's own event ids** — so the index is already ours. What it does
*not* hold is who was on which roster back then: it only carries placements for
the 523 players who are in today's `world.json`. Reconstructing 2021 from it
gives eight complete rosters, and they are teams like SoaR and PUGSTARS, not
Sentinels and Gambit — because the people who defined 2021 have retired and are
therefore not in the current world at all.

A 2021 start mode cannot be built on that. This fetches the missing half.

What one event page gives
-------------------------
Everything needed, in a single request:

  * name, date range, prize pool
  * the final standings — placement, prize, team, country
  * **Participating Teams**, each with the five players it brought

So this is one page per event, cached to disk, at a deliberate crawl.

Usage
-----
    python scripts/fetch_history.py --years 2021,2022,2023
    python scripts/fetch_history.py --years 2021 --limit 5     # a taste first
    python scripts/fetch_history.py --years 2021,2022,2023 --out src/data/history.json

Every page is cached under `.cache/vlr/`, so a second run costs nothing and an
interrupted run resumes where it stopped. Be kind to vlr.gg: the delay below is
not a suggestion.
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

# The events that define a competitive year. Everything else on vlr is open
# ladders, university cups and third-party invitationals — real tournaments,
# but not the circuit a career is played on.
KEEP = re.compile(
    r'champions tour|valorant champions|masters|last chance|lcq|ascension|'
    r'fgc|china evolution|challengers league|vct ', re.I)
DROP = re.compile(
    r'open \d|qualifier weekly|nerd street|college|university|academy|'
    r'contenders|showdown|invitational series', re.I)


def fetch(url: str, cache_name: str) -> str:
    """Get a page, from disk if we already have it."""
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path) and os.path.getsize(path) > 2000:
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


def strip(s: str) -> str:
    return htmllib.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', '', s))).strip()


TEAM_BLOCK = re.compile(
    r'<div class="wf-card event-team">(.*?)(?=<div class="wf-card event-team">|'
    r'</div>\s*</div>\s*<!|\Z)', re.S)
TEAM_NAME = re.compile(r'event-team-name" href="/team/(\d+)/([^"]*)"[^>]*>(.*?)</a>', re.S)
TEAM_PLAYER = re.compile(
    r'<a href="/player/(\d+)/([^"]*)" class="[^"]*event-team-players-item"[^>]*>'
    r'(?:\s*<i class="flag mod-([a-z]{2})"[^>]*></i>)?\s*([^<]*)', re.S)
RE_PRIZE = r'Dates.{0,600}?Prize\s*</div>\s*<div class="value">\s*(\$[\d,]+)'
# The Region field carries no text at all, only a flag icon, so the value is
# the flag's class (`mod-us`, `mod-eu`...). Stripping tags off it, as the
# first pass did, leaves an empty string on every single event.
RE_REGION = r'Region\s*</div>\s*<div class="value"[^>]*>\s*<i class="flag mod-([a-z]+)'
TEAM_NOTE = re.compile(r'event-team-note[^>]*>(.*?)</div>', re.S)


def parse_event(html: str) -> dict:
    out: dict = {}
    m = re.search(r'<h1[^>]*>(.*?)</h1>', html, re.S)
    out['name'] = strip(m.group(1)) if m else None

    m = re.search(r'Dates.{0,300}?>\s*([A-Z][a-z]{2}\s+\d+[^<]{0,40}\d{4})\s*<', html, re.S)
    out['dates'] = strip(m.group(1)) if m else None
    # The header's own Prize field sits just after Dates. 「Prize Distribution」
    # further down is the per-place table and must not be mistaken for it, so
    # this is anchored on Dates rather than searched for on its own.
    m = re.search(RE_PRIZE, html, re.S)
    out['prize'] = strip(m.group(1)) if m else None
    # Region sits in the same header strip. For a 2021 world it matters more
    # than the money: that year the circuit was a dozen separate regions.
    m = re.search(RE_REGION, html, re.S)
    out['region'] = m.group(1) if m else None

    # Final standings. This is a `wf-ptable--standings` grid of <div class="row">,
    # not a <table> — matching on <td> found nothing at all the first time.
    out['standings'] = []
    tbl = re.search(r'wf-ptable--standings(.*?)(?:Participating Teams|\Z)', html, re.S)
    if tbl:
        for row in re.finditer(r'<div class="row ?" role="row">(.*?)(?=<div class="row ?" role="row">|\Z)',
                               tbl.group(1), re.S):
            seg = row.group(1)
            pl = re.search(r'>\s*(\d+)\s*<sup>', seg)
            tm = re.search(r'href="/team/(\d+)/([^"]*)"', seg)
            if not (pl and tm):
                continue
            prize = re.search(r'(\$[\d,]+)', seg)
            nm = re.search(r'class="text-of">\s*([^<]{1,60}?)\s*<', seg)
            cc = re.search(r'ge-text-light"[^>]*>\s*([^<]{2,40}?)\s*<', seg)
            out['standings'].append({
                'place': int(pl.group(1)), 'teamId': tm.group(1), 'slug': tm.group(2),
                'name': strip(nm.group(1)) if nm else None,
                'country': strip(cc.group(1)) if cc else None,
                'prize': prize.group(1) if prize else None,
            })

    # Participating teams, each with the five it brought
    out['teams'] = []
    body = html[html.find('Participating Teams'):] if 'Participating Teams' in html else ''
    for block in TEAM_BLOCK.findall(body):
        nm = TEAM_NAME.search(block)
        if not nm:
            continue
        note = TEAM_NOTE.search(block)
        players = [{'id': pid, 'slug': slug, 'country': cc, 'ign': ign.strip()}
                   for pid, slug, cc, ign in TEAM_PLAYER.findall(block)]
        out['teams'].append({
            'id': nm.group(1), 'slug': nm.group(2), 'name': strip(nm.group(3)),
            'note': strip(note.group(1)) if note else None,
            'players': players,
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--years', default='2021,2022,2023')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'data', 'history.json'))
    a = ap.parse_args()
    years = {int(y) for y in a.years.split(',') if y.strip()}

    with open(RECORDS, encoding='utf-8') as f:
        records = json.load(f)
    index = records['events']

    todo = sorted(
        (int(k), v[0], v[1]) for k, v in index.items()
        if v[1] in years and KEEP.search(v[0]) and not DROP.search(v[0]))
    if a.limit:
        todo = todo[:a.limit]
    print(f'{len(todo)} 场要抓（{sorted(years)}）', flush=True)

    out: dict = {}
    fresh = 0
    for i, (eid, name, year) in enumerate(todo, 1):
        cache_name = f'e{eid}.html'
        cached = os.path.exists(os.path.join(CACHE, cache_name))
        try:
            html = fetch(f'https://www.vlr.gg/event/{eid}/', cache_name)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f'  ! {eid} {name}: {e}', flush=True)
            continue
        if not cached:
            fresh += 1
        ev = parse_event(html)
        ev['id'] = str(eid)
        ev['year'] = year
        ev['indexName'] = name
        out[str(eid)] = ev
        if i % 20 == 0 or i == len(todo):
            got = sum(1 for e in out.values() if e['teams'])
            print(f'  {i}/{len(todo)}  有名单的 {got} 场  新抓 {fresh}', flush=True)

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    teams = {(e['year'], t['id']) for e in out.values() for t in e['teams']}
    players = {p['id'] for e in out.values() for t in e['teams'] for p in t['players']}
    full = sum(1 for e in out.values() for t in e['teams'] if len(t['players']) >= 5)
    print(f'\n写入 {a.out}')
    print(f'  {len(out)} 场 · {len(teams)} 个(年份,队伍) · {len(players)} 名选手 · {full} 份满编名单')
    return 0


if __name__ == '__main__':
    sys.exit(main())
