"""What a given year's world actually looks like, assembled from the scraped data.

This is a viewer, not a builder: it joins `history.json` (who was on which
roster), `stats_players.json` (how they played) and `bios.json` (how old they
were) and prints the world a career would be dropped into. The point is to
answer 「能做什么」 with real numbers instead of guesses, before anyone writes
engine code against it.

Strength here is a **rough sort key, not a game attribute** — round-weighted
ACS and K:D, nothing more. Deriving the eight is a design decision and this
script deliberately does not make it.

    python scripts/show_world.py --year 2021
    python scripts/show_world.py --year 2021 --region "North America"
    python scripts/show_world.py --year 2021 --region China --deep
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
D = os.path.join(ROOT, 'src', 'data')

# How a year's events map onto the region a player would sign into. 2021 had no
# leagues at all — sixteen separate circuits, and which one you were in decided
# how many doors were above you.
REGION_OF = re.compile(r'Champions Tour ([A-Za-z& ]+?) Stage', re.I)
ALIAS = {'Hong Kong and Taiwan': 'Hong Kong & Taiwan'}
CN_EVENT = re.compile(
    r'\bFGC\b|China Evolution|China: Ascension|Champions China|PangHu|Huya', re.I)

# Which regions had a way out in 2021, and where it led.
DOORS_2021 = {
    'North America': 'NA Challengers Finals → 雷克雅未克 / 柏林 / 冠军赛',
    'Europe': 'EMEA Challengers Playoffs → 雷克雅未克 / 柏林 / 冠军赛',
    'Turkey': '并入 EMEA Playoffs 争名额',
    'CIS': '并入 EMEA Playoffs 争名额',
    'Brazil': 'BR Challengers Finals → 雷克雅未克 / 柏林',
    'LATAM': 'LATAM Challengers Finals → 雷克雅未克 / 柏林',
    'Korea': 'KR Challengers Finals → 雷克雅未克 / 柏林',
    'Japan': 'JP Challengers Finals → 雷克雅未克 / 柏林',
    'SEA': 'SEA Challengers Finals → 雷克雅未克 / 柏林',
    'Malaysia & Singapore': '先打进 SEA 区域赛，才谈国际赛',
    'Indonesia': '先打进 SEA 区域赛，才谈国际赛',
    'Thailand': '先打进 SEA 区域赛，才谈国际赛',
    'Philippines': '先打进 SEA 区域赛，才谈国际赛',
    'Vietnam': '先打进 SEA 区域赛，才谈国际赛',
    'Hong Kong & Taiwan': '先打进 SEA 区域赛，才谈国际赛',
    'China': '没有。全年只有虎牙胖虎杯春/夏两站和 FGC 邀请赛，一扇国际赛的门都没有',
}


def load(name: str):
    with io.open(os.path.join(D, name), encoding='utf-8') as f:
        return json.load(f)


def region_of(event_name: str) -> str | None:
    if CN_EVENT.search(event_name):
        return 'China'
    m = REGION_OF.search(event_name)
    if not m:
        return None
    return ALIAS.get(m.group(1).strip(), m.group(1).strip())


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--year', type=int, default=2021)
    ap.add_argument('--region')
    ap.add_argument('--deep', action='store_true')
    ap.add_argument('--top', type=int, default=6)
    a = ap.parse_args()

    history = load('history.json')
    stats = load('stats_players.json')
    bios = load('bios.json')

    # player -> that year's line
    year_stat = {}
    for pid, rows in stats.items():
        for r in rows:
            if r['year'] == a.year:
                year_stat[pid] = r

    # region -> team -> roster
    world: dict = collections.defaultdict(lambda: collections.defaultdict(dict))
    for e in history.values():
        if e['year'] != a.year:
            continue
        reg = region_of(e['name'])
        if not reg:
            continue
        for t in e['teams']:
            for p in t['players']:
                world[reg][t['name']][p['id']] = p['ign']

    def strength(pid: str):
        s = year_stat.get(pid)
        if not s or not s.get('acs'):
            return None
        # a blunt sort key, nothing more: ACS carries the firepower, K:D the
        # survival. Not an attribute, and deliberately not called one.
        return s['acs'] * 0.5 + (s['kd'] or 1) * 60

    def team_rating(roster: dict):
        vs = [v for v in (strength(p) for p in roster) if v is not None]
        return sum(vs) / len(vs) if vs else 0

    regions = [a.region] if a.region else sorted(world, key=lambda r: -len(world[r]))
    if a.region and a.region not in world:
        print(f'{a.year} 年没有「{a.region}」这个赛区。有的是：')
        print('  ' + '、'.join(sorted(world)))
        return 1

    if not a.region:
        print(f'=== {a.year} 年的世界 ===\n')
        print(f'{"赛区":<22} {"队伍":>4} {"选手":>5}   头顶有几扇门')
        for r in regions:
            n_p = len({p for ros in world[r].values() for p in ros})
            print(f'{r:<22} {len(world[r]):4d} {n_p:5d}   {DOORS_2021.get(r, "—")}')
        tot_t = sum(len(world[r]) for r in world)
        tot_p = len({p for r in world for ros in world[r].values() for p in ros})
        print(f'\n合计 {len(world)} 个赛区 · {tot_t} 支队 · {tot_p} 名选手')
        print('（当前 world.json 是 78 支队 / 524 人，作为对照）')
        return 0

    for r in regions:
        teams = sorted(world[r].items(), key=lambda kv: -team_rating(kv[1]))
        print(f'=== {a.year} · {r} ===')
        print(f'出路：{DOORS_2021.get(r, "—")}')
        print(f'{len(teams)} 支队 · {len({p for ros in world[r].values() for p in ros})} 名选手\n')
        for name, roster in teams[:a.top if not a.deep else len(teams)]:
            rat = team_rating(roster)
            print(f'  {name[:26]:<28} 强度 {rat:5.0f}')
            for pid, ign in sorted(roster.items(), key=lambda kv: -(strength(kv[0]) or 0)):
                s = year_stat.get(pid)
                b = bios.get(pid) or {}
                age = ''
                if b.get('birth_date'):
                    y = int(str(b['birth_date'])[:4])
                    age = f'{a.year - y} 岁'
                if s:
                    print(f'      {ign[:14]:<15} {age:<6} {s["rnd"]:5d}回合  ACS {s["acs"] or 0:5.0f}  '
                          f'K:D {s["kd"] or 0:4.2f}  FKPR {s["fkpr"] or 0:4.2f}  {"/".join((s["agents"] or [])[:3])}')
                else:
                    print(f'      {ign[:14]:<15} {age:<6} （这一年没有数据）')
            print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
