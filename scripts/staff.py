"""Who was on a club's staff, not in its five, on a given day (src/data/staff_stints.json).

To the builders anyone who took the server at a Riot event is a player: a coach
who stood in for two maps gets a roster seat, a rating and a place in the roster
book like anyone else. Reported 2026-09-14: Muggle, EDward Gaming's coach since
2022, played matches in the game as one of EDG's five — his only record is two
maps at the 2025 China Evolution Series: Act 1.

staff_stints.json holds the people checked seat by seat against their vlr team
history, with the stints vlr lists them on a staff. Inside one a person is not
a player. His statlines stay in the raw data as what happened
(stats_history.json, stats_players.json) and give the book nothing: no roster
seat at an event (event_rosters.py, through build_circuit.py), no rating and no
year on record (build_timeline.py), no place in January 2021's world
(build_world_2021.py). engine/staff.ts reads the same file for a save already
under way.

A month is whole: 「March 2022 – June 2024」 is 1 March 2022 to 30 June 2024, and
an end vlr does not give (「joined in」, 「left in」) is open.
"""
from __future__ import annotations

import calendar
import datetime as dt
import json
import os
from collections.abc import Iterable

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'src', 'data', 'staff_stints.json')


def _first(ym: str | None) -> dt.date:
    if not ym:
        return dt.date.min
    y, m = (int(x) for x in ym.split('-'))
    return dt.date(y, m, 1)


def _last(ym: str | None) -> dt.date:
    if not ym:
        return dt.date.max
    y, m = (int(x) for x in ym.split('-'))
    return dt.date(y, m, calendar.monthrange(y, m)[1])


class Staff:
    """The stints, by vlr id. `path` 'none' (or a file that is not there) is nobody: the book as it was built before."""

    def __init__(self, path: str | None = PATH):
        self.spans: dict[str, list[tuple[dt.date, dt.date]]] = {}
        self.ign: dict[str, str] = {}
        #: vlr id -> was he ever a professional player at all
        self.played: dict[str, bool] = {}
        #: vlr id -> the day he went to a staff for good, where the record pins it down
        self.coach_from: dict[str, dt.date] = {}
        if not path or path == 'none' or not os.path.exists(path):
            return
        with open(path, encoding='utf-8') as f:
            raw = json.load(f)
        for s in raw['stints']:
            self.spans.setdefault(s['vlr'], []).append((_first(s['from']), _last(s['to'])))
            self.ign[s['vlr']] = s['ign']
        for p in raw.get('people', ()):
            self.played[p['vlr']] = bool(p['played'])
            if p.get('coachFrom'):
                self.coach_from[p['vlr']] = _first(p['coachFrom'])

    def __bool__(self) -> bool:
        return bool(self.spans)

    def on(self, pid: str, day: dt.date | None) -> bool:
        """On a staff that day. A day nobody knows is nobody's."""
        if day is None:
            return False
        return any(a <= day <= b for a, b in self.spans.get(pid, ()))

    def among(self, ids: Iterable[str], day: dt.date | None) -> frozenset[str]:
        return frozenset(p for p in ids if self.on(p, day))

    def off_pool(self, pid: str, day: dt.date | None) -> bool:
        """Not a player that day — the same question src/engine/staffStints.ts offPoolOn asks.

        Three ways, in the order they settle it: he never played professionally at
        all, so no day is his; he had already gone to a staff for good; or a stint
        covers the day. Wider than `on`, which only knows the stints: after Apeks
        let oderus go in October 2025 no stint covers him, and he is still a coach.

        The builders ask `on`, and on today's data the two agree over every seat the
        book gives out — scripts/check_staff.ts proves it, person by person, so the
        shipped book already holds nobody on or after the month he stopped playing.
        A rebuild that wants the stronger rule enforced at build time asks this one.
        """
        if self.played.get(pid) is False:
            return True
        start = self.coach_from.get(pid)
        if start is not None and day is not None and day >= start:
            return True
        return self.on(pid, day)


def day_of(year: int, offset: int | None) -> dt.date | None:
    """circuit.json's day numbers: days after 1 January of the year the event is filed under."""
    return None if offset is None else dt.date(year, 1, 1) + dt.timedelta(days=offset)
