"""Who the 2026 world file's people and clubs are in the timeline — so a 2021 career can arrive in today.

The two entrances were built by two builders. world.json (Val_Manager's) keys
the world of 2026 as P0…P523 and T0…T77; the timeline keys everyone by their
vlr.gg ids. A save that entered in 2021 reaches the end of 2025 holding the
timeline's ids, and the season it has to play next is 2026's — the world the
game already ships, with its coaches, photographs, logos and prospects all
keyed P and T.

The people are exact: dossier.json carries every P's vlr player id.
A club is itself if it kept its name, whoever it signed — GIANTX bought UCAM's
players for 2026 and is still GIANTX. A club with a new name is whoever its
players were: each T's roster, as vlr ids, votes for the club those people
played for in 2025 (timeline.json) and at 2026's events (history.json, counted
double). Neither, and it is a club the timeline never had: the bridge founds it.

    python scripts/build_bridge_2026.py

Output: src/data/bridge_2026.json   {players: {P: vlr}, teams: {T: vlr | null}}
"""
from __future__ import annotations

import collections
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')


def norm(s: str | None) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    load = lambda n: json.load(open(os.path.join(DATA, n), encoding='utf-8'))  # noqa: E731
    world, dossier, timeline, history = load('world.json'), load('dossier.json'), load('timeline.json'), load('history.json')

    players = {pid: rec['vlr'] for pid, rec in dossier['players'].items() if rec.get('vlr')}

    played_for: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    club_name: dict[str, str] = {}
    book = timeline['years']['2025']
    for tid, ids in book['rosters'].items():
        club_name[tid] = book['clubs'][tid]['n']
        for v in ids:
            played_for[v][tid] += 1
    for ev in history.values():
        if ev['year'] != 2026:
            continue
        for t in ev.get('teams', []):
            club_name.setdefault(t['id'], t['name'])
            for p in t.get('players', []):
                played_for[p['id']][t['id']] += 2

    votes: dict[str, collections.Counter] = {}
    for t in world['teams']:
        c = collections.Counter()
        for pid in t['roster']:
            for tid, n in played_for[players.get(pid, '')].items():
                c[tid] += n
        votes[t['id']] = c

    teams: dict[str, str | None] = {}
    by_name = collections.defaultdict(list)
    for tid, nm in club_name.items():
        by_name[norm(nm)].append(tid)
    # strongest claims first, so a club two Ts both vote for goes to the one that is it
    claims = sorted(((c.most_common(1)[0][1] if c else 0, t['id']) for t in world['teams'] for c in [votes[t['id']]]), reverse=True)
    taken: set[str] = set()
    report = collections.Counter()
    names = {t['id']: t['name'] for t in world['teams']}

    def named_for(T: str) -> list[str]:
        k = norm(names[T])
        exact = [tid for tid in by_name.get(k, []) if tid not in taken]
        if exact:
            return exact
        # a longer name that only starts with a shorter one: 「A Team」 is inside 「NINJA TEAM」
        # and is not it, so an ending does not count, and neither does a name under four letters
        def starts(a: str, b: str) -> bool:
            short, long = (a, b) if len(a) <= len(b) else (b, a)
            return len(short) >= 4 and long.startswith(short)
        return [tid for key, tids in by_name.items() if key and starts(key, k) for tid in tids if tid not in taken]

    # a club that kept its name is itself, whoever it signed: GIANTX bought UCAM's
    # players for 2026 and is still GIANTX; Team Secret took BOOM's and is still Team Secret
    for T in names:
        named = named_for(T)
        if len(named) == 1:
            teams[T] = named[0]
            taken.add(named[0])
            report['按队名'] += 1
    # a new name: the club whose people these are — an org that bought a roster whole
    for _, T in claims:
        if T in teams:
            continue
        top = [x for x in votes[T].most_common() if x[0] not in taken][:2]
        if top and top[0][1] >= 4 and (len(top) == 1 or top[0][1] > top[1][1]):
            teams[T] = top[0][0]
            taken.add(top[0][0])
            report['按阵容'] += 1
        else:
            teams[T] = None
            report['没有对应（新俱乐部）'] += 1

    out = {'players': players, 'teams': teams}
    with open(os.path.join(DATA, 'bridge_2026.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'写入 src/data/bridge_2026.json：选手 {len(players)}/{len(world["players"])}；俱乐部 ' + ' · '.join(f'{k} {v}' for k, v in report.items()))
    for T, v in teams.items():
        if v is None or norm(club_name.get(v)) != norm(names[T]):
            print(f'  {T} {names[T]} → {club_name.get(v, "—") if v else "—"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
