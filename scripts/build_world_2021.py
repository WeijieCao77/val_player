"""Build the 2021 world: real rosters, real numbers, the same ruler as 2026.

Why a second builder
--------------------
The game is one timeline with two entrances. The 2026 entrance reads
`src/data/world.json`, built by Val_Manager's `scripts/build_world.py`. The
2021 entrance needs the same kind of file for a world that no longer exists:
of the 1773 people on a 2021 roster, 191 are still in the 2026 world. It cannot
be derived from world.json. It has to be built from 2021's own evidence —
which is what fetch_history.py / fetch_stats.py / fetch_bios.py collected.

The ruler is Val_Manager's, not a new one
-----------------------------------------
Every formula below is lifted from Val_Manager `scripts/build_world.py` and
marked with where it came from. The point is that a 2021 player and a 2026
player rated 80 mean the same thing. In particular:

  * attributes are **percentile-mapped**, not regressed. A linear fit of the
    2026 attributes on rating + ACS explains only 25–40% of the variance,
    because the original ranks and blends; copying the ranking is the only way
    to reproduce the spread.
  * each axis is `0.58 * its own evidence + 0.42 * the rating percentile`,
    or eight independent percentiles average everyone toward the middle.
  * thin samples shrink toward the **30th** percentile, not the mean: a man we
    have barely seen is unproven, not average.
  * sub-tier lines are translated by SUBTIER_TO_VCT before ranking, and a
    player at a tier-two club without 600 top-tier rounds is pulled toward 60.

What "tier one" means in 2021
-----------------------------
There were no leagues. The events that played the role VCT plays in 2026 —
the region's best eight, or better — are the regional Masters, the Challengers
Finals / Playoffs, the Last Chance Qualifiers and the internationals. Open
Challengers qualifiers are the sub-tier. For China, the FGC Invitational is the
top tier and the Huya cups are not. This is the same line Val_Manager draws
between VCT and Challengers, placed where 2021 actually had it.

Decisions taken here, not by the author (each is reversible)
-----------------------------------------------------------
  * the starting world is every club that played a 2021 event on or before
    START_CUTOFF (30 June). Cutting at January would leave China and Vietnam
    with no clubs at all — their circuits began in April — though the clubs
    existed before their first match.
  * ability comes from 2021's full-year numbers. When the game opens the pro
    scene is six months old; there is no earlier sample to use.
  * no coach is named for any 2021 club. None was scraped, and Val_Manager's
    rule is that Liquipedia names a coach or nobody does.
  * players who first appear in 2022 or 2023 are left out of this file. They
    should arrive in the year they really debuted; that is the next step.

The one decision that is the author's
-------------------------------------
The author's instruction was 「年龄不要估计」. Val_Manager itself estimates
missing ages from debut year. On 2021 rosters, real birthdates cover 94% of
players at clubs that reached an international, 75% at clubs that reached a
regional decider, and 40% at clubs that only ever played open qualifiers.

So the policy is a flag, and it defaults to the author's instruction:

    --ages strict   only people with a real, full birthdate are in the world;
                    a club left with fewer than five dissolves    (default)
    --ages debut    everyone is in; a missing age is taken from debut year,
                    flagged ageEstimated, and never shown as a birthdate

Usage
-----
    python scripts/build_world_2021.py
    python scripts/build_world_2021.py --ages debut
    python scripts/build_world_2021.py --out src/data/world_2021.json
"""
from __future__ import annotations

import argparse
import collections
import hashlib
import json
import math
import os
import random
import re
import sys
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')

SEASON_YEAR = 2021
START_CUTOFF = date(2021, 6, 30)

# ---------------------------------------------------------------- the ruler
# Mirrors ATTR_WEIGHT / ROLE_WEIGHT in src/engine/player.ts, which in turn
# mirror Val_Manager build_world.py. All three must stay identical.
ATTRS = ['aim', 'reaction', 'awareness', 'utility', 'clutch', 'teamwork', 'communication', 'igl']
ATTR_WEIGHT = {'aim': 0.20, 'reaction': 0.15, 'awareness': 0.17, 'utility': 0.14,
               'clutch': 0.12, 'teamwork': 0.10, 'communication': 0.08, 'igl': 0.04}
ROLE_WEIGHT = {
    '决斗者': {'aim': 0.28, 'reaction': 0.22, 'clutch': 0.16, 'awareness': 0.12,
            'utility': 0.08, 'teamwork': 0.07, 'communication': 0.05, 'igl': 0.02},
    '先锋': {'aim': 0.17, 'reaction': 0.15, 'awareness': 0.20, 'utility': 0.20,
           'clutch': 0.09, 'teamwork': 0.10, 'communication': 0.07, 'igl': 0.02},
    '控场': {'aim': 0.15, 'reaction': 0.11, 'awareness': 0.20, 'utility': 0.22,
           'clutch': 0.09, 'teamwork': 0.13, 'communication': 0.08, 'igl': 0.02},
    '哨卫': {'aim': 0.19, 'reaction': 0.12, 'awareness': 0.22, 'utility': 0.15,
           'clutch': 0.15, 'teamwork': 0.10, 'communication': 0.05, 'igl': 0.02},
    '自由人': dict(ATTR_WEIGHT),
}
# Val_Manager build_world.py, inside main()
ROLE_UTIL = {'控场': 1.0, '先锋': 0.95, '哨卫': 0.7, '自由人': 0.55, '决斗者': 0.25}
ROLE_COMM = {'控场': 0.8, '先锋': 0.85, '哨卫': 0.6, '自由人': 0.7, '决斗者': 0.4}
SHRINK_ROUNDS = 400
TIER1_SAMPLE = 600.0
# Val_Manager build_world.py — measured by its calibrate_tier.py, not chosen
SUBTIER_TO_VCT = {'rating': 0.831, 'acs': 0.850, 'kd': 0.773, 'kast': 0.938,
                  'adr': 0.867, 'kpr': 0.844, 'apr': 0.981, 'fdpr': 1.119}
SALARY_BASE = 33000
TIER2_WAGE = 0.14
DEBUT_AGE = {2020: 19, 2021: 18, 2022: 17, 2023: 17}
ROSTER_MIN, ROSTER_MAX = 5, 7

STAT_KEYS = ('rating', 'acs', 'kd', 'kast', 'adr', 'kpr', 'apr', 'fkpr', 'fdpr', 'hs')

# Val_Manager build_world.py TRAITS — read straight off the percentiles
TRAITS = [
    ('entry', '突破手', True, lambda g: g('fkpr') >= 0.86),
    ('carry', '核心火力', True, lambda g: g('acs') >= 0.88),
    ('headshot', '爆头机器', True, lambda g: g('hs') >= 0.88),
    ('anchor', '定海神针', True, lambda g: g('kast') >= 0.88),
    ('survivor', '生存大师', True, lambda g: g('fdpr') >= 0.88),
    ('enabler', '串联核心', True, lambda g: g('apr') >= 0.86),
    ('clutch', '残局王', True, lambda g: g('clutch_pct') >= 0.88),
    ('consistent', '稳定输出', True,
     lambda g: g('kast') >= 0.7 and g('fdpr') >= 0.7 and g('acs') >= 0.6),
    ('baiter', '苟', False,
     lambda g: g('fkpr') <= 0.2 and g('fdpr') >= 0.75 and g('acs') <= 0.45),
    ('glass', '玻璃大炮', False, lambda g: g('acs') >= 0.72 and g('fdpr') <= 0.15),
]

# src/engine/content.ts AGENTS. The key rule is canonAgent's: lowercase, letters
# only — so vlr's slug 'kayo' meets the proper name 'KAY/O'. Val_Manager keys by
# plain lowercase, which would miss exactly that case.
AGENTS = {
    '决斗者': ['Jett', 'Raze', 'Phoenix', 'Reyna', 'Yoru', 'Neon', 'Iso', 'Waylay'],
    '先锋': ['Sova', 'Breach', 'Skye', 'KAY/O', 'Fade', 'Gekko', 'Tejo'],
    '控场': ['Brimstone', 'Viper', 'Omen', 'Astra', 'Harbor', 'Clove'],
    '哨卫': ['Sage', 'Cypher', 'Killjoy', 'Chamber', 'Deadlock', 'Vyse'],
}
agent_key = lambda a: re.sub(r'[^a-z]', '', str(a).lower())  # noqa: E731
AGENT_ROLE = {agent_key(n): role for role, names in AGENTS.items() for n in names}
AGENT_NAME = {agent_key(n): n for names in AGENTS.values() for n in names}

# ---------------------------------------------------------------- the calendar
REGION_OF = re.compile(r'Champions Tour ([A-Za-z& ]+?) Stage', re.I)
CHINA = re.compile(r'\bFGC\b|PangHu|Huya', re.I)
INTL = re.compile(r'Masters Reykjav|Masters Berlin|Valorant Champions 2021', re.I)
TOP = re.compile(r'Stage \d: Masters|Challengers Finals|Challengers Playoffs|Last Chance|\bFGC\b', re.I)
MONTH = {m: i for i, m in enumerate(
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], 1)}
REGIONS_2021 = ['North America', 'Europe', 'Turkey', 'CIS', 'Brazil', 'LATAM', 'Korea', 'Japan',
                'SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines',
                'Vietnam', 'Hong Kong & Taiwan', 'China']


def seed_of(s: str) -> int:
    return int(hashlib.sha1(s.encode('utf-8')).hexdigest()[:12], 16)


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def start_of(dates: str | None) -> date | None:
    m = re.match(r'([A-Z][a-z]{2})\s+(\d+)', dates or '')
    y = re.search(r'(20\d\d)', dates or '')
    if not (m and y):
        return None
    return date(int(y.group(1)), MONTH.get(m.group(1), 1), int(m.group(2)))


def region_of(name: str) -> str | None:
    if CHINA.search(name):
        return 'China'
    m = REGION_OF.search(name)
    if not m:
        return None
    r = m.group(1).strip().replace('Hong Kong and Taiwan', 'Hong Kong & Taiwan')
    return r if r in REGIONS_2021 else None


def tier_of(name: str) -> str:
    return 'intl' if INTL.search(name) else 'top' if TOP.search(name) else 'open'


def pctiles(rows: list[dict], key: str, invert: bool = False) -> dict[str, float]:
    """Val_Manager build_world.py pctiles(), unchanged."""
    vals = sorted(r[key] for r in rows if r.get(key) is not None)
    out: dict[str, float] = {}
    if not vals:
        return out
    n = len(vals)
    for r in rows:
        v = r.get(key)
        if v is None:
            out[r['id']] = 0.5
            continue
        lo, hi = 0, n
        while lo < hi:
            mid = (lo + hi) // 2
            if vals[mid] < v:
                lo = mid + 1
            else:
                hi = mid
        p = lo / max(1, n - 1)
        out[r['id']] = (1 - p) if invert else p
    return out


def age_on(birth: str | None, ref: date) -> int | None:
    if not birth or not re.match(r'^\d{4}-\d{2}-\d{2}$', str(birth)):
        return None
    y, m, d = (int(x) for x in str(birth).split('-'))
    return ref.year - y - ((ref.month, ref.day) < (m, d))


def salary_for(ovr: int, tier: int) -> int:
    base = SALARY_BASE * math.exp((ovr - 55) / 12.0)
    if tier == 2:
        base *= TIER2_WAGE
    return int(round(base / 1000.0) * 1000)


def value_for(ovr: int, age: int, pot: int) -> int:
    v = 20000 * math.exp((ovr - 55) / 10.5)
    if age <= 21:
        v *= 1.45
    elif age <= 24:
        v *= 1.15
    elif age >= 28:
        v *= 0.55
    elif age >= 26:
        v *= 0.8
    v *= 1 + (pot - ovr) / 100.0
    return int(round(v / 1000.0) * 1000)


def load(name: str):
    with open(os.path.join(DATA, name), encoding='utf-8') as f:
        return json.load(f)


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--ages', choices=['strict', 'debut'], default='strict')
    ap.add_argument('--out', default=os.path.join(DATA, 'world_2021.json'))
    a = ap.parse_args()

    history = load('history.json')
    bios = load('bios.json')
    raw_stats = load('stats_history.json')

    # ---- 1. the 2021 events, in order, with the tier each one played at
    events = []
    for eid, e in history.items():
        if e['year'] != SEASON_YEAR:
            continue
        region, when = region_of(e['name']), start_of(e.get('dates'))
        if region and when:
            events.append((when, eid, region, tier_of(e['name']), e))
    events.sort(key=lambda x: x[0])
    ev_tier = {eid: tier for _, eid, _, tier, _ in events}

    # ---- 2. who was where: each person's first club, each club's best level
    first_club: dict[str, tuple] = {}
    club_best = collections.defaultdict(lambda: 'open')
    # who played for which club at each event, so the stats rows (which carry
    # only a tag) can be tied back to a club id and give it its real tag
    club_in_event = collections.defaultdict(dict)
    club_tags = collections.defaultdict(collections.Counter)
    club_meta: dict[str, dict] = {}
    rank = {'open': 0, 'top': 1, 'intl': 2}
    for when, eid, region, tier, e in events:
        for t in e['teams']:
            club_meta.setdefault(t['id'], {'name': t['name'], 'region': region, 'first': when})
            if rank[tier] > rank[club_best[t['id']]]:
                club_best[t['id']] = tier
            for p in t['players']:
                first_club.setdefault(p['id'], (t['id'], when, p))
                club_in_event[eid][p['id']] = t['id']

    # ---- 3. each person's 2021 line, split into top-tier and sub-tier halves
    line = collections.defaultdict(lambda: {'top': collections.defaultdict(float),
                                            'topw': collections.defaultdict(float),
                                            'sub': collections.defaultdict(float),
                                            'subw': collections.defaultdict(float),
                                            'top_rnd': 0.0, 'rnd': 0.0,
                                            'clw': 0.0, 'clt': 0.0,
                                            'agents': collections.Counter()})
    for eid, ev in raw_stats.items():
        if ev['year'] != SEASON_YEAR or eid not in ev_tier:
            continue
        half = 'sub' if ev_tier[eid] == 'open' else 'top'
        for r in ev['rows']:
            # the real tag: history says which club this man played for at this
            # event, the stats row says what tag he played under. The first pass
            # made tags from the first four letters of the name (SENT, EDWA).
            cid = club_in_event.get(eid, {}).get(r['id'])
            if cid and r.get('team'):
                club_tags[cid][r['team']] += 1
            rnd = r.get('rnd') or 0
            if not rnd:
                continue
            L = line[r['id']]
            L['rnd'] += rnd
            if half == 'top':
                L['top_rnd'] += rnd
            for k in STAT_KEYS:
                v = r.get(k)
                if v is not None:
                    L[half][k] += v * rnd
                    L[half + 'w'][k] += rnd
            # clutches: vlr gives won and a rounded rate, so attempts are
            # reconstructed as won / rate. The rate is whole-percent, so the
            # count carries ±1–3 of error — small against a prior of 20.
            if r.get('cl') and r.get('clp'):
                L['clw'] += r['cl']
                L['clt'] += r['cl'] / (r['clp'] / 100.0)
            for ag in r.get('agents') or []:
                L['agents'][agent_key(ag)] += 1

    def merged_line(pid: str) -> dict:
        """Val_Manager's blend: trust the top-tier half by how much of it there is."""
        L = line.get(pid)
        out = {'id': pid, 'rnd': 0.0}
        if not L:
            return out
        kp = clamp(L['top_rnd'] / TIER1_SAMPLE, 0.0, 1.0)
        for k in STAT_KEYS:
            top = L['top'][k] / L['topw'][k] if L['topw'][k] else None
            sub = L['sub'][k] / L['subw'][k] if L['subw'][k] else None
            if sub is not None and k in SUBTIER_TO_VCT:
                sub *= SUBTIER_TO_VCT[k]
            if top is not None and sub is not None:
                out[k] = top * kp + sub * (1 - kp)
            else:
                out[k] = top if top is not None else sub
        out['rnd'] = L['rnd']
        out['top_rnd'] = L['top_rnd']
        return out

    # ---- 4. the starting world and its pool
    in_world = {pid: fc for pid, fc in first_club.items() if fc[1] <= START_CUTOFF}
    lines = {pid: merged_line(pid) for pid in in_world}

    # roles from the agents actually played
    def roles_for(pid: str) -> list[str]:
        L = line.get(pid)
        out: list[str] = []
        for ag, _ in (L['agents'].most_common() if L else []):
            role = AGENT_ROLE.get(ag)
            if role and role not in out:
                out.append(role)
        return out or ['自由人']

    role_of = {pid: roles_for(pid)[0] for pid in in_world}

    # shrink toward the 30th percentile of the pool (Val_Manager)
    anchor = {}
    for k in STAT_KEYS:
        vals = sorted(ln[k] for ln in lines.values() if ln.get(k) is not None)
        anchor[k] = vals[int(len(vals) * 0.3)] if vals else None
    rows = []
    for pid, ln in lines.items():
        r = dict(ln)
        r['role'] = role_of[pid]
        trust = r['rnd'] / (r['rnd'] + SHRINK_ROUNDS)
        for k in STAT_KEYS:
            if r.get(k) is not None and anchor[k] is not None:
                r[k] = r[k] * trust + anchor[k] * (1 - trust)
        rows.append(r)

    P = {k: pctiles(rows, k) for k in ('acs', 'adr', 'hs', 'kpr', 'fkpr', 'kast', 'apr', 'kd')}
    P['fdpr'] = pctiles(rows, 'fdpr', invert=True)
    # rating scored within role (Val_Manager): duelists rate lower by the nature of entering
    P['rating'] = {}
    for role in set(r['role'] for r in rows):
        peers = [r for r in rows if r['role'] == role]
        P['rating'].update(pctiles(peers if len(peers) >= 12 else rows, 'rating'))
    # clutch rate with a prior of 20 situations toward the pool mean
    tot_w = sum(line[p]['clw'] for p in in_world if p in line)
    tot_t = sum(line[p]['clt'] for p in in_world if p in line)
    mean_cl = tot_w / tot_t if tot_t else 0.15
    cl_rows = [{'id': p, 'clutch_pct': (line[p]['clw'] + 20 * mean_cl) / (line[p]['clt'] + 20)}
               for p in in_world if p in line and line[p]['clt'] > 0]
    have_cl = {r['id'] for r in cl_rows}
    P['clutch_pct'] = pctiles(cl_rows, 'clutch_pct') if cl_rows else {}

    scale = lambda p, lo=44, hi=98: int(round(clamp(lo + (hi - lo) * p, 20, 99)))  # noqa: E731
    axis = lambda specific, q: 0.58 * specific + 0.42 * q  # noqa: E731

    # ---- 5. the people
    ref_day = date(SEASON_YEAR, 1, 1)
    people: dict[str, dict] = {}
    dropped_no_birth = 0
    for pid, (club, when, raw) in in_world.items():
        bio = bios.get(pid) or {}
        birth = bio.get('birth_date')
        age = age_on(birth, ref_day)
        estimated = age is None
        if estimated:
            if a.ages == 'strict':
                dropped_no_birth += 1
                continue
            age = DEBUT_AGE.get(when.year, 18)
            birth = None
        age = int(clamp(age, 15, 40))

        rng = random.Random(seed_of('p21:' + pid))
        g = lambda k, _pid=pid: P[k].get(_pid, 0.5)  # noqa: E731
        q = g('rating')
        role = role_of[pid]
        at = {
            'aim': scale(axis(0.5 * g('acs') + 0.3 * g('adr') + 0.2 * g('hs'), q)),
            'reaction': scale(axis(0.55 * g('fkpr') + 0.3 * g('kpr') + 0.15 * g('acs'), q)),
            'awareness': scale(axis(0.5 * g('kast') + 0.35 * g('fdpr') + 0.15 * q, q)),
            'utility': scale(axis(0.55 * g('apr') + 0.45 * ROLE_UTIL[role], q)),
            'clutch': scale(axis(0.5 * g('clutch_pct') + 0.3 * q + 0.2 * g('kd'), q))
            if pid in have_cl else scale(axis(0.6 * q + 0.4 * g('kd'), q)),
            'teamwork': scale(axis(0.5 * g('kast') + 0.5 * g('apr'), q)),
            'communication': scale(axis(0.55 * g('kast') + 0.45 * ROLE_COMM[role], q)),
            'igl': scale(axis(0.4 * g('apr') + 0.3 * g('kast') + 0.3 * ROLE_COMM[role], q), 35, 84),
        }
        # the sub-tier pull (Val_Manager): no top-tier evidence to speak of and
        # a club that never reached a regional decider — toward 60 by a quarter
        top_club = club_best[club] in ('top', 'intl')
        if not top_club and (line[pid]['top_rnd'] if pid in line else 0) < TIER1_SAMPLE:
            at = {k: int(clamp(round(60 + (v - 60) * 0.75), 20, 99)) for k, v in at.items()}

        head = (rng.uniform(7, 16) if age <= 20 else rng.uniform(3, 10) if age <= 23
                else rng.uniform(1, 5) if age <= 26 else rng.uniform(0, 2))
        roles = roles_for(pid)
        traits = [{'key': k, 'label': lb, 'good': good}
                  for k, lb, good, pred in TRAITS
                  if (lambda: pred(g))()]
        L = line.get(pid)
        people[pid] = {
            'id': f'V{pid}', 'ign': raw['ign'], 'club': club, 'region': club_meta[club]['region'],
            'nat': (raw.get('country') or bio.get('country') or '')[:2].lower() or None,
            'realName': bio.get('name') if str(bio.get('name') or '').lower() != raw['ign'].lower() else None,
            'birth': birth, 'joined': None,
            'rounds': int(L['rnd']) if L else 0,
            'role': role, 'roles': roles, 'flex': len(roles) > 1,
            'traits': traits,
            'agentPool': [AGENT_NAME[k] for k, _ in (L['agents'].most_common(4) if L else []) if k in AGENT_NAME],
            'roleSource': 'agents' if L and L['agents'] else 'vlr-primary',
            'age': age, 'ageEstimated': estimated,
            'isIgl': False, 'attrs': at, 'stageBonus': 0.0, 'head': head,
            'form': int(clamp(round(rng.gauss(70, 8)), 45, 95)),
            'morale': int(clamp(round(rng.gauss(75, 8)), 45, 98)),
            'fatigue': int(clamp(round(rng.uniform(0, 20)), 0, 100)),
            'loyalty': int(clamp(round(rng.gauss(60, 16)), 15, 95)),
            'ambition': int(clamp(round(rng.gauss(62, 15)), 15, 98)),
            'vlr': {'rating': (merged_line(pid).get('rating')), 'acs': merged_line(pid).get('acs'),
                    'rounds': int(L['rnd']) if L else 0},
        }

    def overall_of(p: dict) -> int:
        w = ROLE_WEIGHT.get(p['role'], ATTR_WEIGHT)
        return int(round(clamp(sum(p['attrs'][k] * w[k] for k in ATTRS) + p['stageBonus'], 30, 97)))

    for p in people.values():
        p['overall'] = overall_of(p)
        p['potential'] = int(clamp(round(p['overall'] + p.pop('head')), p['overall'], 99))

    # ---- 6. the clubs
    by_club = collections.defaultdict(list)
    for p in people.values():
        by_club[p['club']].append(p)

    teams, players, free = [], [], []
    dissolved = 0
    for club, squad in sorted(by_club.items(), key=lambda kv: kv[1][0]['region']):
        meta = club_meta[club]
        squad.sort(key=lambda p: -p['rounds'])
        if len(squad) > ROSTER_MAX:
            free.extend(squad[ROSTER_MAX:])
            squad = squad[:ROSTER_MAX]
        if len(squad) < ROSTER_MIN:
            dissolved += 1
            free.extend(squad)
            continue
        tier = 1 if club_best[club] in ('top', 'intl') else 2
        rng = random.Random(seed_of('t21:' + club))

        # the caller: nothing was scraped naming one, so it is inferred the way
        # Val_Manager does when Liquipedia is silent — the most support-shaped man
        igl = max(squad, key=lambda p: p['attrs']['igl'] + (7 if p['role'] in ('控场', '哨卫', '先锋') else 0))
        igl['isIgl'] = True
        igl['iglSource'] = 'inferred'
        igl['attrs']['igl'] = int(clamp(igl['attrs']['igl'] + 12, 40, 99))
        top5 = sorted((q['overall'] for q in squad), reverse=True)[:5]
        igl['attrs']['igl'] = int(clamp(max(igl['attrs']['igl'], round(sum(top5) / len(top5))), 40, 96))
        igl['attrs']['communication'] = int(clamp(igl['attrs']['communication'] + 4, 25, 99))
        igl['overall'] = overall_of(igl)
        for p in squad:
            p['potential'] = int(clamp(max(p['potential'], p['overall']), 30, 99))

        # contract lengths dealt across the squad (Val_Manager deal_contract_years)
        jitter = random.Random(seed_of('y21:' + club))
        start = jitter.randint(0, 3)
        pool = sorted(([4, 3, 2, 1] * 3)[start:start + len(squad)], reverse=True)
        tie = lambda p: max(0, 27 - p['age']) + (p['potential'] - p['overall']) * 0.8 \
            + p['overall'] * 0.1 + jitter.uniform(-2, 2)  # noqa: E731
        for p, years in zip(sorted(squad, key=tie, reverse=True), pool):
            p['contractYears'] = years

        rating = int(round(sum(sorted((q['overall'] for q in squad), reverse=True)[:5]) / 5))
        tid = f'V21T{club}'
        teams.append({
            'id': tid, 'name': meta['name'],
            'tag': (club_tags[club].most_common(1)[0][0] if club_tags[club]
                    else meta['name'][:4].upper()),
            'region': meta['region'], 'tier': tier,
            'league': f"Challengers {meta['region']}",
            'rating': rating,
            'budget': int(rng.uniform(2_000_000, 8_500_000) if tier == 1 else rng.uniform(240_000, 900_000)),
            'reputation': int(clamp(round(rating * (1.0 if tier == 1 else 0.72)), 20, 99)),
            'roster': [p['id'] for p in squad],
            'coach': None,
            'facilities': int(clamp(round(rng.gauss(rating - (5 if tier == 1 else 18), 8)), 20, 94)),
            'firstSeen': meta['first'].isoformat(),
            'bestLevel2021': club_best[club],
        })
        for p in squad:
            players.append(_emit(p, tid, tier))

    for p in free:
        rec = _emit(p, None, 2)
        rec['contractYears'] = 0
        players.append(rec)

    world = {
        'meta': {
            'season': SEASON_YEAR,
            'entry': '2021 · 改变历史',
            'sources': {
                'vlr.gg': 'teams, rosters, nationalities, agents and all performance stats (2021 events)',
                'liquipedia': 'birthdates and real names',
            },
            'derived': 'attributes percentile-mapped from real per-round statistics, '
                       "using Val_Manager build_world.py's formulas unchanged",
            'estimated': ('contracts, salaries, budgets, facilities'
                          + ('' if a.ages == 'strict' else '; ages from debut year where Liquipedia '
                             'has no birthdate (flagged per player via ageEstimated)')),
            'agePolicy': a.ages,
            'startCutoff': START_CUTOFF.isoformat(),
            'everyoneReal': True,
            'regions': REGIONS_2021,
        },
        'teams': teams,
        'players': players,
    }
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(world, f, ensure_ascii=False, separators=(',', ':'))

    reg = collections.Counter(t['region'] for t in teams)
    print(f'写入 {a.out}（年龄口径 {a.ages}）')
    print(f'  {len(teams)} 支队 · {len(players)} 名选手（其中自由人 {len(free)}）')
    print(f'  名单少于 {ROSTER_MIN} 人而解散的队 {dissolved} 支；因没有真实生日被排除的人 {dropped_no_birth}')
    print('  各赛区：' + ' · '.join(f'{r} {reg[r]}' for r in REGIONS_2021))
    return 0


def _emit(p: dict, team_id: str | None, tier: int) -> dict:
    return {
        'id': p['id'], 'ign': p['ign'], 'teamId': team_id, 'region': p['region'],
        'nat': p['nat'], 'realName': p['realName'], 'birth': p['birth'], 'joined': p['joined'],
        'rounds': p['rounds'], 'role': p['role'], 'roles': p['roles'], 'flex': p['flex'],
        'traits': p['traits'], 'agentPool': p['agentPool'], 'roleSource': p['roleSource'],
        'age': p['age'], 'ageEstimated': p['ageEstimated'], 'isIgl': p['isIgl'],
        **({'iglSource': p['iglSource']} if p.get('iglSource') else {}),
        'attrs': dict(p['attrs']), 'overall': p['overall'], 'stageBonus': p['stageBonus'],
        'potential': p['potential'], 'form': p['form'], 'morale': p['morale'],
        'fatigue': p['fatigue'], 'salary': salary_for(p['overall'], tier),
        'value': value_for(p['overall'], p['age'], p['potential']),
        'contractYears': p.get('contractYears', 0),
        'loyalty': p['loyalty'], 'ambition': p['ambition'], 'vlr': p['vlr'],
    }


if __name__ == '__main__':
    sys.exit(main())
