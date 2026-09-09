"""What the scraped history actually contains, without opening a 900 KB file.

    python scripts/show_history.py            # the whole shape
    python scripts/show_history.py --cn       # just the Chinese circuit
    python scripts/show_history.py --event 1664
"""
from __future__ import annotations

import argparse
import collections
import io
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'src', 'data', 'history.json')
CN = re.compile(r'fgc|china', re.I)


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--cn', action='store_true')
    ap.add_argument('--event')
    a = ap.parse_args()
    with io.open(PATH, encoding='utf-8') as f:
        h = json.load(f)

    if a.event:
        e = h.get(a.event)
        if not e:
            print(f'没有 {a.event} 这场')
            return 1
        print(f"{e['name']}  [{e['dates']}]  {e['prize']}  区 {e['region']}")
        for s in e['standings']:
            print(f"  {s['place']:>2}. {s['name'] or s['slug']:<26} {s['country'] or '':<16} {s['prize'] or ''}")
        print()
        for t in e['teams']:
            print(f"  {t['name'][:24]:<26} {t['note'] or '':<22} {', '.join(p['ign'] for p in t['players'])}")
        return 0

    rows = [e for e in h.values() if not a.cn or CN.search(e['name'])]
    per: dict[int, list] = collections.defaultdict(lambda: [set(), set(), 0, 0])
    for e in rows:
        y = e['year']
        per[y][3] += 1
        for t in e['teams']:
            per[y][0].add(t['id'])
            for p in t['players']:
                per[y][1].add(p['id'])
            if len(t['players']) >= 5:
                per[y][2] += 1
    print('年份   场次   队伍   选手   满编名单')
    for y in sorted(per):
        t, p, full, n = per[y]
        print(f'{y}  {n:5d}  {len(t):5d}  {len(p):5d}   {full:6d}')

    if a.cn:
        print()
        for e in sorted(rows, key=lambda x: int(x['id'])):
            print(f"{e['year']}  {e['name'][:50]:<52} 队 {len(e['teams']):2d}  [{e['dates']}]")
    return 0


if __name__ == '__main__':
    sys.exit(main())
