"""Remove listed player IDs from structured data; audit by default, write with --apply.

Capture --seats before applying. Never match IDs in team/event namespaces or prose.
Remaining players' attributes stay intact; the engine fills rosters and appoints callers.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
from removed import Removed, FILES, DATA, dump


def scrub_world(world, removed):
    gone = {'V' + pid for pid in removed.ids}
    before = len(world.get('players', []))
    world['players'] = [p for p in world.get('players', []) if p.get('id') not in gone]
    n = before - len(world['players'])
    for team in world.get('teams', []):
        for key in ('roster', 'starters'):
            if key in team:
                old = team[key]
                team[key] = [p for p in old if p not in gone]
                n += len(old) - len(team[key])
        if team.get('igl') in gone:
            team['igl'] = None
            n += 1
    return n


def scrub_circuit(circuit, removed):
    n = 0
    for events in circuit.values():
        for ev in events:
            for tid, ids in ev.get('rosters', {}).items():
                left = [p for p in ids if p not in removed.ids]
                n += len(ids) - len(left)
                ev['rosters'][tid] = left
    return n


def scrub_timeline(book, removed):
    n = 0
    for year in book['years'].values():
        for tid, ids in year['rosters'].items():
            if not removed.ids.intersection(ids):
                continue
            left = [p for p in ids if p not in removed.ids]
            year['rosters'][tid] = left
            squad = sorted((year['ratings'][p]['o'] for p in left if p in year['ratings']), reverse=True)[:5]
            year['clubs'][tid]['o'] = round(sum(squad) / len(squad)) if squad else 50
            n += len(ids) - len(left)
        for key in ('ratings', 'debuts'):
            for pid in removed.ids.intersection(year[key]):
                del year[key][pid]
                n += 1
    for pid in removed.ids.intersection(book['last']):
        del book['last'][pid]
        n += 1
    return n


def scrub_calibration(cal, removed):
    n = 0
    for section in ('worlds', 'years'):
        for table in cal.get(section, {}).values():
            for pid in removed.ids.intersection(table):
                del table[pid]
                n += 1
    # Counts describe the retained overlay. Other audit totals describe its source build.
    summary = cal.get('summary', {})
    counts = [(summary.get('world'), sum(len(t) for t in cal.get('worlds', {}).values()))]
    counts += [(summary.get('years', {}).get(y), len(t)) for y, t in cal.get('years', {}).items()]
    for item, count in counts:
        if item is not None and item.get('changed') != count:
            item['changed'] = count
            n += 1
    return n


def seats_from_circuit(removed):
    with open(os.path.join(DATA, 'circuit.json'), encoding='utf-8') as f:
        circuit = json.load(f)
    seats = {pid: [] for pid in removed.ids}
    for y, events in circuit.items():
        for ev in events:
            for tid, ids in ev.get('rosters', {}).items():
                for pid in removed.ids.intersection(ids):
                    seats[pid].append(dict(year=int(y), event=ev['id'], eventName=ev['name'], team=tid, club=ev['names'].get(tid, tid)))
    return seats


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--seats', action='store_true')
    args = parser.parse_args()
    removed = Removed()
    if args.seats:
        print(json.dumps(seats_from_circuit(removed), ensure_ascii=False, indent=1))
        return
    jobs = [(name, getattr(removed, method), how) for name, method, how in FILES]
    for name, scrub in [('world.json', scrub_world), ('world_2021.json', scrub_world),
                        ('circuit.json', scrub_circuit), ('timeline.json', scrub_timeline),
                        ('npc_role_calibration.json', scrub_calibration)]:
        jobs.append((name, lambda obj, fn=scrub: fn(obj, removed), {'separators': (',', ':')}))
    total = 0
    for name, scrub, how in jobs:
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            continue
        with open(path, encoding='utf-8') as f:
            obj = json.load(f)
        n = scrub(obj)
        total += n
        if n and args.apply:
            dump(obj, path, how)
        print(f'{name}: {n}')
    print(f'{"Applied" if args.apply else "Audit only"}: {total} changes')


if __name__ == '__main__':
    main()
