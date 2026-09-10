"""The real circuit / championship point standings, team by team and event by event.

The author's rule for qualification is 「现实里怎么做的我们就怎么做」. Champions
2021's direct places went to the top of each region's circuit points, the Last
Chance Qualifiers took the next eight, and from 2023 the same idea returns as
Championship Points. A table typed from memory would be wrong somewhere; the
standings Liquipedia keeps are the record, including the corrections Riot made
(Rise losing 10 points for releasing its roster, Bonkers' Stage 1 points voided
when it no longer held a core of three).

The wikitext only lists overrides — the points themselves are filled in from
each event's prize pool when the page renders — so this reads the rendered
page (`action=parse`) and the wikitext side by side: the wikitext for the
column order (tournaments, and the deduction columns between them), the HTML
for the numbers.

Liquipedia allows one `action=parse` every 30 seconds, and says so; the first
run of this script used the two-second query pace and was answered with 429.
Rendered pages are therefore fetched thirty seconds apart, every result is
written as soon as it arrives, and a re-run starts where the last one stopped.

    python scripts/fetch_lp_points.py
    python scripts/fetch_lp_points.py --show "VALORANT Champions Tour/2021/Circuit Points/North America"

Output: src/data/lp_points.json — title -> {columns, rows[{rank, team, total, points[], status}]}
"""
from __future__ import annotations

import argparse
import glob
import html as htmllib
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_bios import CACHE, get as _get  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'src', 'data', 'lp_points.json')
TITLES = os.path.join(ROOT, '.cache', 'lp_titles.json')
POINT_PAGE = re.compile(r'/(Circuit|Championship) Points/[^/]+$')
PARSE_DELAY = 30


def get(params: dict, cache_name: str) -> dict:
    """fetch_bios.get with Liquipedia's parse pace, and patience when it says 429."""
    cached = os.path.exists(os.path.join(CACHE, cache_name))
    for attempt in range(6):
        try:
            data = _get(params, cache_name)
            if not cached and params.get('action') == 'parse':
                time.sleep(PARSE_DELAY)
            return data
        except OSError as e:
            if attempt == 5:
                raise
            wait = 60 * (attempt + 1)
            print(f'    （{e}；{wait} 秒后再试）', flush=True)
            time.sleep(wait)
    raise RuntimeError('unreachable')


def wikitext_of(title: str) -> str | None:
    """From the batches fetch_lp_events.py already cached."""
    for f in glob.glob(os.path.join(ROOT, '.cache', 'lp', 'events_*.json')):
        with open(f, encoding='utf-8') as fh:
            data = json.load(fh)
        for p in data.get('query', {}).get('pages', []):
            if p.get('title') == title and not p.get('missing'):
                return p['revisions'][0]['slots']['main']['content']
    return None


def columns(wikitext: str) -> list[dict]:
    """The table's per-event columns in order: each tournament, then its deduction column if it has one."""
    cols = []
    n = 1
    while True:
        t = re.search(r'^\|tournament%d=(.*)$' % n, wikitext, re.M)
        if not t:
            break
        label = re.search(r'^\|tournament%dname=\[\[(?:[^|\]]*\|)?([^\]]+)\]\]' % n, wikitext, re.M)
        link = re.search(r'^\|tournament%dname=\[\[([^|\]]+)' % n, wikitext, re.M)
        cols.append({'kind': 'event', 'name': t.group(1).strip(),
                     'label': label.group(1).strip() if label else t.group(1).strip(),
                     'page': link.group(1).strip().replace('_', ' ') if link else None})
        if re.search(r'^\|deductions%d=' % n, wikitext, re.M):
            cols.append({'kind': 'deduction', 'after': t.group(1).strip()})
        n += 1
    return cols


def cell_text(td: str) -> str:
    return htmllib.unescape(re.sub(r'<[^>]+>', ' ', td)).strip()


def parse_table(html: str, cols: list[dict]) -> list[dict]:
    rows = re.findall(r'<tr[^>]*data-toggle-area-content="(\d+)"[^>]*>(.*?)</tr>', html, re.S)
    if not rows:
        return []
    final = max(int(k) for k, _ in rows)
    out = []
    for key, body in rows:
        if int(key) != final:
            continue
        tds = re.findall(r'<td([^>]*)>(.*?)</td>', body, re.S)
        team = re.search(r'team-template-text"><a[^>]*title="([^"]+)"', body)
        if not team or len(tds) < 4:
            continue
        rank = re.match(r'(\d+)', cell_text(tds[0][1]))
        status = re.search(r'class="bg-([a-z]+)"', tds[0][0])
        values = [cell_text(td[1]) for td in tds[4:4 + len(cols)]]
        pts = []
        for v in values:
            m = re.match(r'-?\d+', v.replace(',', ''))
            pts.append(int(m.group(0)) if m else 0)
        total = re.match(r'-?\d+', cell_text(tds[3][1]).replace(',', ''))
        out.append({
            'rank': int(rank.group(1)) if rank else None,
            'team': htmllib.unescape(team.group(1)),
            'total': int(total.group(0)) if total else 0,
            'points': pts,
            'status': status.group(1) if status else None,
        })
    return out


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--show', action='append', default=[])
    a = ap.parse_args()
    with open(TITLES, encoding='utf-8') as f:
        titles = sorted({t for ts in json.load(f).values() for t in ts if POINT_PAGE.search(t)})
    out: dict[str, dict] = {}
    if os.path.exists(OUT):
        with open(OUT, encoding='utf-8') as f:
            out = json.load(f)
    print(f'{len(titles)} 张积分表，已有 {len(out)}', flush=True)

    for title in titles:
        if title in out and out[title]['rows']:
            continue
        wt = wikitext_of(title)
        if wt is None:
            data = get({'action': 'query', 'prop': 'revisions', 'rvprop': 'content', 'rvslots': 'main',
                        'format': 'json', 'formatversion': '2', 'titles': title},
                       'ptswt_' + re.sub(r'[^A-Za-z0-9]+', '_', title) + '.json')
            pages = data.get('query', {}).get('pages', [])
            wt = pages[0]['revisions'][0]['slots']['main']['content'] if pages and not pages[0].get('missing') else ''
        cols = columns(wt)
        rendered = get({'action': 'parse', 'page': title, 'prop': 'text', 'format': 'json',
                        'formatversion': '2', 'disablelimitreport': '1'},
                       'ptsrender_' + re.sub(r'[^A-Za-z0-9]+', '_', title) + '.json')
        out[title] = {'columns': cols, 'rows': parse_table(rendered.get('parse', {}).get('text', ''), cols)}
        with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
            json.dump(out, f, ensure_ascii=False, indent=1)
        print(f'  {title}: {len(cols)} 列 · {len(out[title]["rows"])} 队', flush=True)

    print(f'写入 {OUT}：{len(out)} 张')
    for title in a.show:
        v = out.get(title)
        if not v:
            continue
        print(f'\n=== {title}')
        print('  列：', [c.get('label') or ('扣分·' + c['after']) for c in v['columns']])
        for r in v['rows']:
            print(f"  {r['rank']:>2} {r['team']:<22} 合计 {r['total']:>4}  {r['points']}  [{r['status']}]")
    return 0


if __name__ == '__main__':
    sys.exit(main())
