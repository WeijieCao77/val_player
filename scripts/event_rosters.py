"""Who each side brought to each event: vlr's team cards where it lists them, the statlines where it does not.

vlr's event page lists a side's players under 「Participating Teams」 — but not
always every side. The 2023 Americas League page shows the six that reached
the playoffs and none of the four that did not, so a book read off the cards
alone has no roster for Sentinels in the year Sentinels were in that league.
The event's stats table has every player who took the server, each with the
tag he played under. A side with no card gets the people who played under its
tag, and the tag is read back to its club by, in turn:

  1. people the cards already place — two or more on one club
  2. the tag against the names of the clubs still unplaced: 「100T」 is
     100 Thieves, 「EG」 is Evil Geniuses, 「MKOI」 is KOI
  3. the club three or more of its people were carded for that year
  4. when every side of the event is a club, the one tag left and the one
     club left are each other — 「M8」 is Gentle Mates

A card is kept exactly as vlr lists it; the statlines only fill sides that
have none. Used by build_circuit.py (each event's `rosters`) and, through
circuit.json, by build_timeline.py.
"""
from __future__ import annotations

import collections
import re

ROSTER_MAX = 7


def norm(s: str | None) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def tag_score(tag: str, name: str) -> float:
    t, n = norm(tag), norm(name)
    if not t or not n:
        return 0.0
    if t == n:
        return 3.0
    words = [norm(w) for w in re.split(r'[\s.\-]+', name) if norm(w)]
    if len(words) > 1 and t == ''.join(w[0] for w in words):
        return 2.5
    if n.startswith(t):
        return 2.0
    # a sponsor's letter in front of the club's own: MKOI for KOI
    if len(n) >= 3 and n in t:
        return 1.5
    rest = iter(n)
    if t[0] == n[0] and all(ch in rest for ch in t):
        return 1.0
    return 0.0


def carded_by_year(history: dict) -> dict[int, dict[str, collections.Counter]]:
    """year -> player -> the clubs vlr carded him for that year."""
    out: dict[int, dict[str, collections.Counter]] = collections.defaultdict(lambda: collections.defaultdict(collections.Counter))
    for ev in history.values():
        for t in ev.get('teams', []):
            for p in t.get('players', []):
                out[ev['year']][p['id']][t['id']] += 1
    return out


def rosters_for(clubs: dict[str, str], cards: dict[str, list[str]], rows: list[dict],
                carded: dict[str, collections.Counter]) -> dict[str, list[str]]:
    """clubs: every club side in the event, vlr id -> name; cards: vlr's team cards; rows: the event's statlines."""
    out = {tid: list(ids) for tid, ids in cards.items()}
    by_tag: dict[str, list[dict]] = collections.defaultdict(list)
    for r in rows:
        if r.get('team') and (r.get('rnd') or 0) > 0:
            by_tag[r['team']].append(r)
    tag_club: dict[str, str] = {}

    def placed() -> set[str]:
        return set(tag_club.values()) | {t for t, ids in out.items() if ids}

    for tag, rs in by_tag.items():
        votes = collections.Counter(tid for r in rs for tid, ids in cards.items() if r['id'] in ids)
        if votes and votes.most_common(1)[0][1] >= 2:
            tag_club[tag] = votes.most_common(1)[0][0]
    free = [tid for tid in clubs if tid not in placed()]
    pairs = sorted(((tag_score(tag, clubs[tid]), tag, tid) for tag in by_tag if tag not in tag_club for tid in free),
                   reverse=True)
    for score, tag, tid in pairs:
        if score >= 1 and tag not in tag_club and tid not in placed():
            tag_club[tag] = tid
    for tag, rs in by_tag.items():
        if tag in tag_club:
            continue
        votes = collections.Counter(tid for r in rs for tid in carded.get(r['id'], {})
                                    if tid in clubs and tid not in placed())
        if votes and votes.most_common(1)[0][1] >= 3:
            tag_club[tag] = votes.most_common(1)[0][0]
    left_tags = [t for t in by_tag if t not in tag_club]
    left_clubs = [t for t in clubs if t not in placed()]
    if len(left_tags) == 1 and len(left_clubs) == 1 and len(by_tag) == len(clubs):
        tag_club[left_tags[0]] = left_clubs[0]
    for tag, tid in tag_club.items():
        if out.get(tid):
            continue
        out[tid] = [r['id'] for r in sorted(by_tag[tag], key=lambda r: -(r.get('rnd') or 0))][:ROSTER_MAX]
    return out
