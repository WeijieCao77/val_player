"""The people the author took out of the game for good (src/data/removed_players.json).

Decided 2026-09-25, after players reported what KovaQ had said: 「把这个选手直接
踢出游戏」. He is not retired, not a coach, not a free agent: he is not in the
game. Not in a roster, a rating, a year on record, a statline board or a bio.

Everything that writes the data the game reads goes through here, so a rebuild
or a fresh fetch keeps him out:

  - the fetchers drop him from what they write (fetch_history.py, fetch_bios.py,
    fetch_stats.py, fetch_lp_events.py) and build_stats.py from stats_players.json
  - the builders drop him from what they read (build_world_2021.load, which
    build_timeline.py reads through too, and build_circuit.py), so a raw file
    fetched before this, like the gitignored stats_history.json, gives him nothing
  - `python scripts/removed.py` takes him out of the committed raw files in place
    (history.json, bios.json, stats_players.json, lp_events.json, and
    stats_history.json where it is there), each written back the way its own
    writer writes it; run again it changes nothing

A seat he took still had a man in it. His side at an event took the field with
five, and build_timeline.py asks whether a club fielded five that year before it
gives the club a roster: without him on the card the side would look like four
and drop out of the book for the year. `seats` keeps, per circuit event, how many
seats of which side were his — read once off the files before he was taken out
(`--seats`) — and build_circuit.seats_to_staff counts them the way it counts a
coach who stood in. The club opens that year one short, and the engine fills the
seat from the free agents at the turn (season.ts ensureMinimumRosters), exactly
as it does for the coaches staff_stints.json took out.

src/engine/removedPlayers.ts reads the same file for a save already under way.

    python scripts/removed.py            # take them out of the committed raw files
    python scripts/removed.py --check    # say what is still there, write nothing
    python scripts/removed.py --seats    # the seats they held, off files not yet scrubbed
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
PATH = os.path.join(DATA, 'removed_players.json')


class Removed:
    """The removed people, by vlr id. A file that is not there is nobody."""

    def __init__(self, path: str = PATH):
        self.ids: frozenset[str] = frozenset()
        self.ign: dict[str, str] = {}
        #: circuit event id -> side id -> seats his
        self.seats_by_event: dict[str, dict[str, int]] = {}
        if not os.path.exists(path):
            return
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
        ids = []
        for p in raw['players']:
            ids.append(p['vlr'])
            self.ign[p['vlr']] = p['ign']
            for s in p.get('seats', ()):
                side = self.seats_by_event.setdefault(s['event'], {})
                side[s['team']] = side.get(s['team'], 0) + 1
        self.ids = frozenset(ids)
        words = '|'.join(re.escape(n) for n in self.ign.values())
        self._name = re.compile(rf'(?i)(?<![a-z0-9])(?:{words})(?![a-z0-9])') if words else None

    def __bool__(self) -> bool:
        return bool(self.ids)

    def named(self, name: str | None) -> bool:
        """A handle that is one of theirs, in any case: lp_events.json names people, it does not number them."""
        return bool(self._name and name and self._name.fullmatch(name.strip()))

    def seats(self, eid: str) -> dict[str, int]:
        return dict(self.seats_by_event.get(eid, {}))

    # ---- the raw files, each in its own shape; every one changes its argument in place and says how many it took

    def scrub_history(self, history: dict) -> int:
        """history.json: event id -> {teams: [{players: [{id, ign}]}]}."""
        n = 0
        for ev in history.values():
            for t in ev.get('teams', []):
                keep = [p for p in t.get('players', []) if p.get('id') not in self.ids]
                n += len(t.get('players', [])) - len(keep)
                if 'players' in t:
                    t['players'] = keep
        return n

    def scrub_stats_history(self, raw: dict) -> int:
        """stats_history.json: event id -> {rows: [{id, ign, …}]}."""
        n = 0
        for ev in raw.values():
            keep = [r for r in ev.get('rows', []) if r.get('id') not in self.ids]
            n += len(ev.get('rows', [])) - len(keep)
            if 'rows' in ev:
                ev['rows'] = keep
        return n

    def scrub_by_id(self, table: dict) -> int:
        """bios.json and stats_players.json: vlr id -> his entry."""
        gone = [k for k in table if k in self.ids]
        for k in gone:
            del table[k]
        return len(gone)

    def scrub_lp_events(self, lp: dict) -> int:
        """lp_events.json: title -> {teams: [{players: [handle]}]}; Liquipedia names people, so by handle."""
        n = 0
        for ev in lp.values():
            for t in (ev or {}).get('teams') or []:
                ps = t.get('players')
                if not isinstance(ps, list):
                    continue
                keep = [p for p in ps if not (isinstance(p, str) and self.named(p))]
                n += len(ps) - len(keep)
                t['players'] = keep
        return n


# each committed raw file, the scrub for it, and how its writer writes it
FILES = (
    ('history.json', 'scrub_history', {'separators': (',', ':')}),                # fetch_history.py
    ('bios.json', 'scrub_by_id', {'indent': 0}),                                  # fetch_bios.py
    ('stats_players.json', 'scrub_by_id', {'separators': (',', ':')}),            # build_stats.py
    ('lp_events.json', 'scrub_lp_events', {'separators': (',', ':')}),            # fetch_lp_events.py
    ('stats_history.json', 'scrub_stats_history', {'separators': (',', ':')}),    # fetch_stats.py, gitignored
)


def dump(obj, path: str, how: dict) -> None:
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, **how)


def seats_held(removed: Removed) -> list[dict]:
    """Per circuit event, the seats of each side that were theirs: the side's roster as build_circuit.py reads it
    with them in, less the roster without them — the count seats_to_staff gives a coach who stood in."""
    import build_circuit as bc  # noqa: E402  (here, not at the top: build_circuit imports this module)
    import event_rosters

    def load(name: str):
        with open(os.path.join(DATA, name), encoding='utf-8') as f:
            return json.load(f)

    history, stats, circuit = load('history.json'), load('stats_history.json'), load('circuit.json')
    if not any(p.get('id') in removed.ids for ev in history.values() for t in ev.get('teams', []) for p in t.get('players', [])):
        raise SystemExit('history.json 里已经没有这些人：--seats 要在拿掉之前读')
    carded = event_rosters.carded_by_year(history)
    out = []
    for y, evs in circuit.items():
        for e in evs:
            hev = history.get(e['id'])
            if not hev:
                continue
            cards, clubs = bc.event_sides(e, hev)
            rows = stats.get(e['id'], {}).get('rows', [])
            full = event_rosters.rosters_for(clubs, cards, rows, carded[int(y)])
            kept = event_rosters.rosters_for(clubs, cards, rows, carded[int(y)], removed.ids)
            for tid, ids in full.items():
                for pid in ids:
                    if pid in removed.ids and len(ids) > len(kept.get(tid, [])):
                        out.append({'event': e['id'], 'team': tid, 'vlr': pid, 'year': int(y),
                                    'eventName': e['name'], 'club': e['names'].get(tid, tid)})
    return out


def out_of_book(removed: Removed, path: str = os.path.join(DATA, 'timeline.json')) -> int:
    """Take them out of the committed roster book in place, touching nobody else.

    A full build_timeline.py does take them out, but it does not reproduce today's book: the book
    carries reviewed edits made after its last build (fix_player_bios.py, apply_player_country_fixes.py),
    and a build from today's inputs moves some 1,600 fields that have nothing to do with them. And
    the ratings are percentiles over each year's pool, so one man fewer nudges a few hundred others
    by a point. This is the edit a build makes that is theirs and nobody else's (checked 2026-09-25
    against a build with and a build without them): their ratings, debuts and last year on record go,
    they leave the opening rosters, and a club that lost one has its rating ('o', the mean of its
    best five) read again off the squad that is left. A caller among them at a club still five
    strong would need the caller picked again — that is a build's job, so it stops there.
    """
    with open(path, encoding='utf-8') as f:
        book = json.load(f)
    n = 0
    for y, Y in book['years'].items():
        for pid in removed.ids:
            for sec in ('ratings', 'debuts'):
                if pid in Y[sec]:
                    was_igl = sec == 'ratings' and Y[sec][pid].get('i')
                    for tid, ids in Y['rosters'].items():
                        if pid in ids and was_igl and len(ids) - 1 >= 5:
                            raise SystemExit(f'{y} {Y["clubs"][tid]["n"]}：{removed.ign[pid]} 是指挥，队里还有五人，要重新选指挥——跑一次完整的 build_timeline.py')
        for tid, ids in Y['rosters'].items():
            if not removed.ids & set(ids):
                continue
            left = [p for p in ids if p not in removed.ids]
            Y['rosters'][tid] = left
            squad = sorted((Y['ratings'][p]['o'] for p in left if p in Y['ratings']), reverse=True)[:5]
            was = Y['clubs'][tid]['o']
            Y['clubs'][tid]['o'] = round(sum(squad) / len(squad)) if squad else 50
            print(f'  {y} {Y["clubs"][tid]["n"]}：开季名单 {len(ids)} → {len(left)} 人，评分 {was} → {Y["clubs"][tid]["o"]}')
            n += 1
        for pid in removed.ids:
            for sec in ('ratings', 'debuts'):
                if pid in Y[sec]:
                    del Y[sec][pid]
                    n += 1
    for pid in removed.ids:
        if pid in book['last']:
            del book['last'][pid]
            n += 1
    if n:
        dump(book, path, {'separators': (',', ':')})
    print(f'  timeline.json：{n} 处')
    return 0


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='say what is still there; write nothing')
    ap.add_argument('--seats', action='store_true', help='print the seats they held, off files not yet scrubbed')
    ap.add_argument('--book', action='store_true', help='take them out of the committed timeline.json, touching nobody else')
    a = ap.parse_args()
    removed = Removed()
    if not removed:
        print('removed_players.json 里没有人')
        return 0
    if a.book:
        return out_of_book(removed)
    if a.seats:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        print(json.dumps(seats_held(removed), ensure_ascii=False, indent=1))
        return 0
    left = 0
    for name, scrub, how in FILES:
        path = os.path.join(DATA, name)
        if not os.path.exists(path):
            print(f'  {name}：不在（gitignored，只在主目录里）')
            continue
        with open(path, encoding='utf-8') as f:
            obj = json.load(f)
        n = getattr(removed, scrub)(obj)
        left += n
        if n and not a.check:
            dump(obj, path, how)
        print(f'  {name}：{"还有" if a.check else "拿掉"} {n} 处')
    return 1 if a.check and left else 0


if __name__ == '__main__':
    sys.exit(main())
