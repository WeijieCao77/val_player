"""Is world_2021.json a world the engine can load, and is it the real 2021?

Two kinds of check, kept apart on purpose.

**Shape** — the engine's createNewGame() spreads a raw player straight into a
Player and a raw team straight into a Team. Anything world.json has that this
file lacks is an undefined field in a live save, so the key sets are compared
directly against world.json rather than against a list typed in here.

**Truth** — the numbers have to point the right way. TenZ in January 2021 was
on Sentinels and one of the best in the world; if he comes out mid-table, the
ruler is broken no matter what the shape checks say. The distribution is also
printed next to the 2026 world's, because the whole point of copying
Val_Manager's formulas was that a 2021 player rated 80 means what a 2026 one
does.

    python scripts/check_world_2021.py
    python scripts/check_world_2021.py --file src/data/world_2021.json
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import statistics as st
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
REGIONS_2021 = {'North America', 'Europe', 'Turkey', 'CIS', 'Brazil', 'LATAM', 'Korea', 'Japan',
                'SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines',
                'Vietnam', 'Hong Kong & Taiwan', 'China'}
ATTRS = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl']


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--file', default=os.path.join(DATA, 'world_2021.json'))
    a = ap.parse_args()
    with open(a.file, encoding='utf-8') as f:
        w21 = json.load(f)
    with open(os.path.join(DATA, 'world.json'), encoding='utf-8') as f:
        w26 = json.load(f)

    bad = 0

    def fail(msg: str) -> None:
        nonlocal bad
        bad += 1
        print(f'✗ {msg}')

    teams, players = w21['teams'], w21['players']
    P = {p['id']: p for p in players}
    policy = w21['meta'].get('agePolicy')

    # ---------------------------------------------------------------- shape
    need_p = set(w26['players'][0].keys())
    need_t = set(w26['teams'][0].keys())
    miss_p = collections.Counter(k for p in players for k in need_p - set(p.keys()))
    miss_t = collections.Counter(k for t in teams for k in need_t - set(t.keys()))
    if miss_p:
        fail(f'选手记录缺字段（world.json 有而这里没有）：{dict(miss_p)}')
    if miss_t:
        fail(f'队伍记录缺字段：{dict(miss_t)}')
    if not miss_p and not miss_t:
        print(f'  形状：选手 {len(need_p)} 个字段、队伍 {len(need_t)} 个字段，与 world.json 一致')

    if len(P) != len(players):
        fail(f'选手 id 有重复（{len(players)} 条记录，{len(P)} 个不同 id）')
    clash = {p['id'] for p in w26['players']} & set(P)
    if clash:
        fail(f'id 和 2026 世界撞了：{sorted(clash)[:5]}')

    for t in teams:
        if t['region'] not in REGIONS_2021:
            fail(f"{t['name']} 的赛区「{t['region']}」不是 2021 的十六个之一")
        if not (5 <= len(t['roster']) <= 7):
            fail(f"{t['name']} 名单 {len(t['roster'])} 人，不在 5–7 之间")
        for pid in t['roster']:
            if pid not in P:
                fail(f"{t['name']} 名单上的 {pid} 不存在")
            elif P[pid]['teamId'] != t['id']:
                fail(f"{P[pid]['ign']} 在 {t['name']} 名单上，但 teamId 是 {P[pid]['teamId']}")
        top5 = sorted((P[i]['overall'] for i in t['roster'] if i in P), reverse=True)[:5]
        if top5 and t['rating'] != round(sum(top5) / 5):
            fail(f"{t['name']} 评分 {t['rating']}，前五人均值是 {round(sum(top5) / 5)}")
        if t.get('coach') is not None:
            fail(f"{t['name']} 署了教练名——2021 没有抓教练数据，不该有")
    print(f'  名单与评分：{len(teams)} 支队逐一核对')

    for p in players:
        for k in ATTRS:
            v = p['attrs'].get(k)
            if v is None or not (20 <= v <= 99):
                fail(f"{p['ign']} 的 {k}={v} 超出 20–99")
                break
        if not (30 <= p['overall'] <= 97):
            fail(f"{p['ign']} overall={p['overall']} 超出 30–97")
        if p['potential'] < p['overall']:
            fail(f"{p['ign']} 潜力 {p['potential']} 低于当前 {p['overall']}")

    # the author's instruction, enforced rather than trusted
    if policy == 'strict':
        est = [p['ign'] for p in players if p['ageEstimated'] or not p['birth']]
        if est:
            fail(f'strict 口径下仍有 {len(est)} 人没有真实生日：{est[:6]}')
        else:
            print(f'  年龄：strict 口径，{len(players)} 人全部是真实生日，没有一个是估的')
    else:
        est = sum(1 for p in players if p['ageEstimated'])
        shown = [p['ign'] for p in players if p['ageEstimated'] and p['birth']]
        if shown:
            fail(f'估算年龄的人不该有 birth 字段（会被当成生日展示）：{shown[:6]}')
        print(f'  年龄：debut 口径，{est}/{len(players)} 人按出道年份推算，均已标 ageEstimated 且不展示生日')

    # ---------------------------------------------------------------- truth
    by_ign = {p['ign'].lower(): p for p in players}
    T = {t['id']: t for t in teams}
    ranked = sorted(players, key=lambda p: -p['overall'])
    pos = {p['id']: i for i, p in enumerate(ranked)}

    def where(ign: str) -> str:
        p = by_ign.get(ign.lower())
        if not p:
            return '（不在这个世界里）'
        team = T.get(p['teamId'], {}).get('name', '自由人')
        pct = 100 - pos[p['id']] / max(1, len(ranked)) * 100
        return f"{team} · {p['role']} · overall {p['overall']}（前 {100 - pct:.0f}%）· {p['age']} 岁"

    print('\n  抽查（2021 年初真实的样子）：')
    for ign in ('TenZ', 'ShahZaM', 'cNed', 'nAts', 'Jinggg', 'Life', 'Haodong', 'ZmjjKK'):
        print(f'    {ign:<9} {where(ign)}')

    by_name = {t['name']: t for t in teams}
    print('\n  队伍简称抽查：' + ' · '.join(
        f"{n} {by_name[n]['tag']}" for n in ('Sentinels', 'EDward Gaming', 'Team Liquid', 'FNATIC', 'Gambit Esports')
        if n in by_name))
    if 'Sentinels' in by_name and by_name['Sentinels']['tag'] != 'SEN':
        fail(f"Sentinels 的简称应该是 SEN，实际是 {by_name['Sentinels']['tag']}")
    tenz = by_ign.get('tenz')
    if tenz:
        if T.get(tenz['teamId'], {}).get('name') != 'Sentinels':
            fail(f"TenZ 应该在 Sentinels，实际在 {T.get(tenz['teamId'], {}).get('name')}")
        if pos[tenz['id']] > len(ranked) * 0.10:
            fail('TenZ 不在前 10%——2021 年他是世界上最好的选手之一，尺子歪了')

    def dist(ps):
        o = [p['overall'] for p in ps]
        return (min(o), st.median(o), max(o)) if o else (0, 0, 0)

    print('\n  和 2026 世界放在一起看（两边用的是同一套公式）：')
    for label, ps21, ps26 in (
        ('一线队首发', [P[i] for t in teams if t['tier'] == 1 for i in t['roster'][:5]],
         [p for t in w26['teams'] if t['tier'] == 1 for p in w26['players'] if p['id'] in t['roster'][:5]]),
        ('二线队首发', [P[i] for t in teams if t['tier'] == 2 for i in t['roster'][:5]],
         [p for t in w26['teams'] if t['tier'] == 2 for p in w26['players'] if p['id'] in t['roster'][:5]]),
    ):
        a21, a26 = dist(ps21), dist(ps26)
        print(f'    {label}  2021：{a21[0]}/{a21[1]:.0f}/{a21[2]}   2026：{a26[0]}/{a26[1]:.0f}/{a26[2]}（最低/中位/最高）')

    tiers = collections.Counter(t['tier'] for t in teams)
    reg = collections.Counter(t['region'] for t in teams)
    empty = sorted(REGIONS_2021 - set(reg))
    print(f'\n  {len(teams)} 支队（一线 {tiers[1]} / 二线 {tiers[2]}）· {len(players)} 名选手')
    if empty:
        print(f'  ⚠ 这些赛区一支队都没有：{"、".join(empty)}')

    print('\n' + ('✓ 2021 世界形状正确、数据指向真实历史。' if not bad else f'✗ {bad} 项不对。'))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
