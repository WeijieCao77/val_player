"""Boil 45,000 statlines down to one row per player per year.

`fetch_stats.py` writes every player's line at every event — 13.5 MB, and far
more detail than anything needs. What deriving attributes actually wants is a
career shape: how many rounds this person played that year and what their
numbers looked like across all of them.

Everything here is **round-weighted**, not a mean of means. A player with one
brilliant map and forty ordinary ones is an ordinary player, and averaging the
per-event averages would say otherwise.

Nothing here decides what an attribute *is* — that is a design question. This
only puts the evidence in one place.

    python scripts/build_stats.py
    python scripts/build_stats.py --min-rounds 100
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'src', 'data', 'stats_history.json')
HISTORY = os.path.join(ROOT, 'src', 'data', 'history.json')

# the columns worth carrying forward, all round-weighted
MEANS = ['rating', 'acs', 'kd', 'kast', 'adr', 'kpr', 'apr', 'fkpr', 'fdpr', 'hs', 'clp']
SUMS = ['k', 'd', 'a', 'fk', 'fd', 'cl', 'maps']


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--min-rounds', type=int, default=0)
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'data', 'stats_players.json'))
    a = ap.parse_args()

    with open(RAW, encoding='utf-8') as f:
        raw = json.load(f)
    with open(HISTORY, encoding='utf-8') as f:
        history = json.load(f)
    on_roster = {p['id'] for e in history.values() for t in e['teams'] for p in t['players']}

    # (pid, year) -> accumulator
    acc: dict = collections.defaultdict(lambda: {
        'rnd': 0.0, 'events': 0, 'ign': None,
        'w': collections.defaultdict(float), 'wt': collections.defaultdict(float),
        's': collections.defaultdict(float),
        'teams': set(), 'agents': collections.Counter(),
    })
    for ev in raw.values():
        year = ev['year']
        for r in ev['rows']:
            rnd = r.get('rnd') or 0
            if not rnd:
                continue
            d = acc[(r['id'], year)]
            d['ign'] = r['ign'] or d['ign']
            d['rnd'] += rnd
            d['events'] += 1
            if r.get('team'):
                d['teams'].add(r['team'])
            for ag in r.get('agents') or []:
                d['agents'][ag] += 1
            for k in MEANS:
                v = r.get(k)
                if v is not None:
                    d['w'][k] += v * rnd
                    d['wt'][k] += rnd
            for k in SUMS:
                v = r.get(k)
                if v is not None:
                    d['s'][k] += v

    out: dict = {}
    for (pid, year), d in acc.items():
        if d['rnd'] < a.min_rounds:
            continue
        row = {
            'ign': d['ign'], 'year': year,
            'rnd': int(d['rnd']), 'events': d['events'],
            'onRoster': pid in on_roster,
            'teams': sorted(d['teams']),
            'agents': [ag for ag, _ in d['agents'].most_common(6)],
        }
        for k in MEANS:
            row[k] = round(d['w'][k] / d['wt'][k], 3) if d['wt'][k] else None
        for k in SUMS:
            row[k] = int(d['s'][k])
        out.setdefault(pid, []).append(row)
    for pid in out:
        out[pid].sort(key=lambda r: r['year'])

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))

    rows = sum(len(v) for v in out.values())
    ros = sum(1 for pid in out if pid in on_roster)
    size = os.path.getsize(a.out) / 1e6
    print(f'写入 {a.out}  {size:.1f} MB')
    print(f'  {len(out)} 名选手 · {rows} 条（人 × 年）· 其中在名单上的 {ros} 人')
    return 0


if __name__ == '__main__':
    sys.exit(main())
