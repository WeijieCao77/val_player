"""The rest of the roster book: who was where, and how good, every year after the summer of 2021.

The 2021 entrance opens on world_2021.json — the clubs and people of the first
half of 2021. From there the game is one timeline, and the author's rule for it
is that everything is real except the player: 「除了玩家创造的选手之外，所有的
都是真实的」. A world that only ages its 2021 roster book has no G2 in the
Americas league, no EDward Gaming in China's, no Gentle Mates, and nobody who
debuted after that summer — and its 2023 season would be thirty empty seats.

This writes the book forward, a year at a time, from the same evidence and with
the same ruler as build_world_2021.py:

  clubs    every club that fielded five at a Riot event that year: name, tag,
           region, tier, the league it held a seat in, the Challengers scene it
           played, the day it first played, its rating
  rosters  the five to seven it opened the year with. Changes within the year
           are circuit.json's, one roster per event
  ratings  everyone on a roster that year, rated off that year's numbers with
           build_world_2021's formulas — percentile-mapped, shrunk toward the
           30th percentile on thin samples, the sub-tier pull, the inferred caller
  debuts   who someone is, the first year the book meets him
  last     the last year each person was on any roster, 2026 included

Rosters and fields come from circuit.json, which already joined vlr's team
cards to the statlines (scripts/event_rosters.py) — so build that first. A
league seat is read off who played the league's own events that year, and
checked against Liquipedia's Partnered Teams pages (leagues.json).

2021 is here too, but only for what world_2021.json does not have: the clubs
and people who first played after its 30 June cut-off.

The engine (engine/timeline.ts) brings a world up to each year at the season
turn, and each club up to its real roster before each event — for every club
and person out of the player's reach. Inside that reach the world is his.

    python scripts/build_circuit.py --years 2021,2022,2023,2024,2025
    python scripts/build_timeline.py
"""
from __future__ import annotations

import argparse
import collections
import json
import os
import random
import re
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_circuit as bc  # noqa: E402  names, regions, stages, scenes
import build_world_2021 as bw  # noqa: E402  the ruler

DATA = bw.DATA
YEARS = (2021, 2022, 2023, 2024, 2025)
LEAGUES = ('Americas', 'EMEA', 'Pacific', 'China')
CLUB_REGIONS = set(bw.REGIONS_2021) | {'MENA', 'South Asia', 'Oceania'}

# a club seen only at league events and internationals takes the region most
# of its people come from
COUNTRY_REGION: dict[str, str] = {}
for _region, _codes in {
    'North America': 'us ca',
    'Brazil': 'br',
    'LATAM': 'mx ar cl co pe uy py bo ec ve cr pa gt sv hn ni do pr cu',
    'Europe': 'gb uk de fr es it pt nl be se no dk fi pl cz sk at ch ie is ee lv lt hu ro bg gr hr rs si ba mk al me '
              'cy lu mt md xk il',
    'CIS': 'ru ua by kz uz kg am az ge mn tj tm',
    'Turkey': 'tr',
    'MENA': 'sa ae eg ma dz tn jo kw qa bh om iq lb sy ps ly ye ir',
    'South Asia': 'in pk bd lk np',
    'Oceania': 'au nz',
    'Korea': 'kr',
    'Japan': 'jp',
    'China': 'cn',
    'Hong Kong & Taiwan': 'tw hk mo',
    'Vietnam': 'vn',
    'Thailand': 'th',
    'Philippines': 'ph',
    'Indonesia': 'id',
    'Malaysia & Singapore': 'my sg',
    'SEA': 'kh mm la bn',
}.items():
    for _c in _codes.split():
        COUNTRY_REGION[_c] = _region
LEAGUE_HOME = {'Americas': 'North America', 'EMEA': 'Europe', 'Pacific': 'Korea', 'China': 'China'}


def event_tier(ev: dict) -> str | None:
    """intl, top or open — the line Val_Manager draws between VCT and Challengers, placed where each year had it."""
    name = ev['name']
    if bc.THIRD_PARTY.search(name):
        return None
    if bc.INTERNATIONAL.search(name):
        return 'intl'
    if ev['year'] <= 2021:
        return bw.tier_of(name)
    if ev['year'] == 2022:
        # 2022's regional Challengers were the top flight, their qualifiers the sub-tier
        if re.search(r'Qualifier', name) and not re.search(r'Last Chance', name):
            return 'open'
        return 'top' if re.search(r'Champions Tour|FGC', name) else 'open'
    if bc.CHALLENGERS.search(name):
        return 'open'
    return 'top' if bc.stage_of(name, ev['year'], None) in ('kickoff', 'stage1', 'stage2', 'lcq') else 'open'


def rate(year: int, ev_tier: dict[str, str], raw_stats: dict, pool: set[str], club_of: dict[str, str],
         club_best: dict[str, str], age_of: dict[str, int], prev_role: dict[str, str]) -> dict[str, dict]:
    """build_world_2021.py main() steps 3–5 for one year's pool, unchanged but for the year."""
    line: dict[str, dict] = {}
    for eid, ev in raw_stats.items():
        if ev['year'] != year or eid not in ev_tier:
            continue
        half = 'sub' if ev_tier[eid] == 'open' else 'top'
        for r in ev['rows']:
            rnd = r.get('rnd') or 0
            if not rnd or r['id'] not in pool:
                continue
            L = line.setdefault(r['id'], {'top': collections.defaultdict(float), 'topw': collections.defaultdict(float),
                                          'sub': collections.defaultdict(float), 'subw': collections.defaultdict(float),
                                          'top_rnd': 0.0, 'rnd': 0.0, 'clw': 0.0, 'clt': 0.0,
                                          'agents': collections.Counter()})
            L['rnd'] += rnd
            if half == 'top':
                L['top_rnd'] += rnd
            for k in bw.STAT_KEYS:
                v = r.get(k)
                if v is not None:
                    L[half][k] += v * rnd
                    L[half + 'w'][k] += rnd
            if r.get('cl') and r.get('clp'):
                L['clw'] += r['cl']
                L['clt'] += r['cl'] / (r['clp'] / 100.0)
            for ag in r.get('agents') or []:
                L['agents'][bw.agent_key(ag)] += 1

    def merged(pid: str) -> dict:
        L = line.get(pid)
        out = {'id': pid, 'rnd': 0.0, 'top_rnd': 0.0}
        if not L:
            return out
        kp = bw.clamp(L['top_rnd'] / bw.TIER1_SAMPLE, 0.0, 1.0)
        for k in bw.STAT_KEYS:
            top = L['top'][k] / L['topw'][k] if L['topw'][k] else None
            sub = L['sub'][k] / L['subw'][k] if L['subw'][k] else None
            if sub is not None and k in bw.SUBTIER_TO_VCT:
                sub *= bw.SUBTIER_TO_VCT[k]
            out[k] = top * kp + sub * (1 - kp) if top is not None and sub is not None else (top if top is not None else sub)
        out['rnd'] = L['rnd']
        out['top_rnd'] = L['top_rnd']
        return out

    def roles_for(pid: str) -> list[str]:
        L = line.get(pid)
        out: list[str] = []
        for ag, _ in (L['agents'].most_common() if L else []):
            role = bw.AGENT_ROLE.get(ag)
            if role and role not in out:
                out.append(role)
        # no agents on record this year: the role he was last seen in, not a guess
        return out or [prev_role.get(pid, '自由人')]

    lines = {pid: merged(pid) for pid in pool}
    role_of = {pid: roles_for(pid)[0] for pid in pool}
    anchor = {}
    for k in bw.STAT_KEYS:
        vals = sorted(ln[k] for ln in lines.values() if ln.get(k) is not None)
        anchor[k] = vals[int(len(vals) * 0.3)] if vals else None
    rows = []
    for pid, ln in lines.items():
        r = dict(ln)
        r['role'] = role_of[pid]
        trust = r['rnd'] / (r['rnd'] + bw.SHRINK_ROUNDS)
        for k in bw.STAT_KEYS:
            if r.get(k) is not None and anchor[k] is not None:
                r[k] = r[k] * trust + anchor[k] * (1 - trust)
        rows.append(r)
    P = {k: bw.pctiles(rows, k) for k in ('acs', 'adr', 'hs', 'kpr', 'fkpr', 'kast', 'apr', 'kd')}
    P['fdpr'] = bw.pctiles(rows, 'fdpr', invert=True)
    P['rating'] = {}
    for role in set(r['role'] for r in rows):
        peers = [r for r in rows if r['role'] == role]
        P['rating'].update(bw.pctiles(peers if len(peers) >= 12 else rows, 'rating'))
    tot_w = sum(L['clw'] for L in line.values())
    tot_t = sum(L['clt'] for L in line.values())
    mean_cl = tot_w / tot_t if tot_t else 0.15
    cl_rows = [{'id': p, 'clutch_pct': (L['clw'] + 20 * mean_cl) / (L['clt'] + 20)} for p, L in line.items() if L['clt'] > 0]
    have_cl = {r['id'] for r in cl_rows}
    P['clutch_pct'] = bw.pctiles(cl_rows, 'clutch_pct') if cl_rows else {}
    scale = lambda p, lo=44, hi=98: int(round(bw.clamp(lo + (hi - lo) * p, 20, 99)))  # noqa: E731
    axis = lambda specific, q: 0.58 * specific + 0.42 * q  # noqa: E731

    people: dict[str, dict] = {}
    for pid in pool:
        g = lambda k, _pid=pid: P[k].get(_pid, 0.5)  # noqa: E731
        q = g('rating')
        role = role_of[pid]
        at = {
            'aim': scale(axis(0.5 * g('acs') + 0.3 * g('adr') + 0.2 * g('hs'), q)),
            'reaction': scale(axis(0.55 * g('fkpr') + 0.3 * g('kpr') + 0.15 * g('acs'), q)),
            'awareness': scale(axis(0.5 * g('kast') + 0.35 * g('fdpr') + 0.15 * q, q)),
            'utility': scale(axis(0.55 * g('apr') + 0.45 * bw.ROLE_UTIL[role], q)),
            'clutch': scale(axis(0.5 * g('clutch_pct') + 0.3 * q + 0.2 * g('kd'), q))
            if pid in have_cl else scale(axis(0.6 * q + 0.4 * g('kd'), q)),
            'teamwork': scale(axis(0.5 * g('kast') + 0.5 * g('apr'), q)),
            'communication': scale(axis(0.55 * g('kast') + 0.45 * bw.ROLE_COMM[role], q)),
            'igl': scale(axis(0.4 * g('apr') + 0.3 * g('kast') + 0.3 * bw.ROLE_COMM[role], q), 35, 84),
        }
        top_club = club_best.get(club_of.get(pid, ''), 'open') in ('top', 'intl')
        if not top_club and lines[pid]['top_rnd'] < bw.TIER1_SAMPLE:
            at = {k: int(bw.clamp(round(60 + (v - 60) * 0.75), 20, 99)) for k, v in at.items()}
        L = line.get(pid)
        age = age_of[pid]
        rng = random.Random(bw.seed_of(f'tl{year}:' + pid))
        head = (rng.uniform(7, 16) if age <= 20 else rng.uniform(3, 10) if age <= 23
                else rng.uniform(1, 5) if age <= 26 else rng.uniform(0, 2))
        people[pid] = {
            'role': role, 'roles': roles_for(pid), 'attrs': at, 'head': head,
            'traits': [k for k, _lb, _good, pred in bw.TRAITS if pred(g)],
            'agents': [bw.AGENT_NAME[k] for k, _ in (L['agents'].most_common(4) if L else []) if k in bw.AGENT_NAME],
            'rounds': int(L['rnd']) if L else 0,
            'vlr': [round(lines[pid]['rating'], 3) if lines[pid].get('rating') is not None else None,
                    round(lines[pid]['acs'], 1) if lines[pid].get('acs') is not None else None],
            'isIgl': False,
        }
    for p in people.values():
        w = bw.ROLE_WEIGHT.get(p['role'], bw.ATTR_WEIGHT)
        p['overall'] = int(round(bw.clamp(sum(p['attrs'][k] * w[k] for k in bw.ATTRS), 30, 97)))
        p['potential'] = int(bw.clamp(round(p['overall'] + p.pop('head')), p['overall'], 99))
    return people


def call_the_shots(people: dict[str, dict], squad_ids: list[str]) -> None:
    """build_world_2021.py step 6: nobody was scraped as the caller, so the most support-shaped man is."""
    squad = [people[p] for p in squad_ids if p in people]
    if len(squad) < 5 or any(p['isIgl'] for p in squad):
        return
    igl = max(squad, key=lambda p: p['attrs']['igl'] + (7 if p['role'] in ('控场', '哨卫', '先锋') else 0))
    igl['isIgl'] = True
    igl['attrs']['igl'] = int(bw.clamp(igl['attrs']['igl'] + 12, 40, 99))
    top5 = sorted((q['overall'] for q in squad), reverse=True)[:5]
    igl['attrs']['igl'] = int(bw.clamp(max(igl['attrs']['igl'], round(sum(top5) / len(top5))), 40, 96))
    igl['attrs']['communication'] = int(bw.clamp(igl['attrs']['communication'] + 4, 25, 99))
    w = bw.ROLE_WEIGHT.get(igl['role'], bw.ATTR_WEIGHT)
    igl['overall'] = int(round(bw.clamp(sum(igl['attrs'][k] * w[k] for k in bw.ATTRS), 30, 97)))
    igl['potential'] = max(igl['potential'], igl['overall'])


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--circuit', default=os.path.join(DATA, 'circuit.json'))
    ap.add_argument('--out', default=os.path.join(DATA, 'timeline.json'))
    a = ap.parse_args()

    history = bw.load('history.json')
    bios = bw.load('bios.json')
    raw_stats = bw.load('stats_history.json')
    world = bw.load('world_2021.json')
    leagues = bw.load('leagues.json')
    with open(a.circuit, encoding='utf-8') as f:
        circuit = json.load(f)
    missing_years = [y for y in YEARS if str(y) not in circuit]
    if missing_years:
        print(f'circuit.json 缺 {missing_years} 年：先跑 build_circuit.py --years 2021,2022,2023,2024,2025')
        return 1
    known_players = {p['id'][1:]: p for p in world['players']}
    known_clubs = {t['id'][4:]: t for t in world['teams']}

    # ---- first and last year on record for everyone, cards and statlines, 2021 to today
    first_year: dict[str, int] = {}
    last_year: dict[str, int] = {}
    who: dict[str, dict] = {}

    def seen(pid: str, year: int) -> None:
        first_year[pid] = min(first_year.get(pid, year), year)
        last_year[pid] = max(last_year.get(pid, year), year)

    for ev in history.values():
        if not event_tier(ev):
            continue
        for t in ev.get('teams', []):
            for p in t.get('players', []):
                seen(p['id'], ev['year'])
                who.setdefault(p['id'], p)
    for eid, ev in raw_stats.items():
        if eid not in history or not event_tier(history[eid]):
            continue
        for r in ev['rows']:
            if (r.get('rnd') or 0) > 0:
                seen(r['id'], ev['year'])
                who.setdefault(r['id'], {'id': r['id'], 'ign': r.get('ign'), 'country': None})

    def age_in(pid: str, year: int) -> tuple[int, bool, str | None]:
        birth = (bios.get(pid) or {}).get('birth_date')
        age = bw.age_on(birth, date(year, 1, 1))
        if age is not None:
            return int(bw.clamp(age, 15, 40)), False, birth
        debut = first_year.get(pid, year)
        return int(bw.clamp(bw.DEBUT_AGE.get(debut, 17) + (year - debut), 15, 40)), True, None

    prev_role = {pid: p['role'] for pid, p in known_players.items()}
    prev_region = {tid: t['region'] for tid, t in known_clubs.items()}
    introduced = set(known_players)
    years_out: dict[str, dict] = {}
    report: list[str] = []
    rank = {'open': 0, 'top': 1, 'intl': 2}

    for Y in YEARS:
        evs = []
        for cev in circuit[str(Y)]:
            hev = history.get(cev['id'])
            tier = event_tier(hev) if hev else None
            if tier and cev.get('start') is not None:
                evs.append((cev['start'], cev, tier))
        evs.sort(key=lambda x: (x[0], int(x[1]['id'])))
        ev_tier = {cev['id']: tier for _, cev, tier in evs}
        league_of: dict[str, str] = {}
        club_roster: dict[str, list[str]] = {}
        club_first: dict[str, int] = {}
        club_name: dict[str, str] = {}
        club_regions: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        club_scene: dict[str, str] = {}
        club_best: dict[str, str] = collections.defaultdict(lambda: 'open')
        club_tags: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
        club_in_event: dict[str, dict[str, str]] = collections.defaultdict(dict)
        player_club: dict[str, str] = {}
        for day, cev, tier in evs:
            name, region, scene = cev['name'], cev['region'], cev.get('scene')
            rosters = cev.get('rosters') or {}
            sides = {x for x in cev['seeds'] if not x.startswith('N:')}
            sides |= {x for u in cev['units'] for nd in u.get('nodes', []) for x in nd['teams'] if not x.startswith('N:')}
            # the league seat, read off who played the league's own events —
            # not LOCK//IN (no region), not China's 2023 qualifier (no league yet)
            if (Y >= 2023 and cev['stage'] in ('kickoff', 'stage1', 'stage2') and region in LEAGUES
                    and not bc.CHALLENGERS.search(name) and not re.search(r'Qualifier|FGC', name)):
                for tid in sides:
                    league_of[tid] = region
            # a club that only came through the open qualifier played this event at the
            # sub-tier, whatever the event itself was: 2022's regional Challengers were
            # the top flight for their eight or ten, not for the fifty who tried to get in
            main = {x for u in cev['units'] if u['type'] != 'open' for nd in u.get('nodes', []) for x in nd['teams']}
            for tid in sides | set(rosters):
                club_name[tid] = cev['names'].get(tid) or club_name.get(tid) or tid
                level = tier if tid in main else 'open'
                if rank[level] > rank[club_best[tid]]:
                    club_best[tid] = level
                if region in CLUB_REGIONS:
                    club_regions[tid][region] += 1
                if scene:
                    club_scene[tid] = scene
                ids = rosters.get(tid) or []
                if len(ids) >= bw.ROSTER_MIN and tid not in club_roster:
                    club_roster[tid] = ids[:bw.ROSTER_MAX]
                    club_first[tid] = day
                for pid in ids:
                    player_club.setdefault(pid, tid)
                    club_in_event[cev['id']][pid] = tid
        for eid in ev_tier:
            for r in raw_stats.get(eid, {}).get('rows', []):
                cid = club_in_event[eid].get(r['id'])
                if cid and r.get('team'):
                    club_tags[cid][r['team']] += 1

        pool = set(player_club)
        ages = {pid: age_in(pid, Y) for pid in pool}
        people = rate(Y, ev_tier, raw_stats, pool, player_club, club_best, {p: v[0] for p, v in ages.items()}, prev_role)
        for ids in club_roster.values():
            call_the_shots(people, ids)

        def region_for(tid: str) -> str:
            if club_regions[tid]:
                return club_regions[tid].most_common(1)[0][0]
            if tid in prev_region:
                return prev_region[tid]
            codes = collections.Counter(COUNTRY_REGION.get((who.get(p, {}).get('country') or '')[:2].lower())
                                        for p in club_roster.get(tid, []))
            codes.pop(None, None)
            if codes:
                return codes.most_common(1)[0][0]
            return LEAGUE_HOME.get(league_of.get(tid, ''), 'Europe')

        def tier_for(tid: str) -> int:
            if Y >= 2023:
                if tid in league_of:
                    return 1
                # 2023 China had no league: the FGC acts and the Champions qualifier were its top flight
                return 1 if Y == 2023 and region_for(tid) == 'China' and club_best[tid] != 'open' else 2
            return 1 if club_best[tid] != 'open' else 2

        clubs_out: dict[str, dict] = {}
        for tid, ids in club_roster.items():
            if Y == 2021 and tid in known_clubs:
                continue
            squad = sorted((people[p]['overall'] for p in ids if p in people), reverse=True)[:5]
            clubs_out[tid] = {
                'n': club_name[tid],
                't': club_tags[tid].most_common(1)[0][0] if club_tags[tid] else bc.norm(club_name[tid])[:4].upper(),
                'r': region_for(tid), 'k': tier_for(tid), 'l': league_of.get(tid), 's': club_scene.get(tid),
                'd': club_first[tid], 'o': round(sum(squad) / len(squad)) if squad else 50,
            }
        ratings_out: dict[str, dict] = {}
        for pid in sorted(pool, key=int):
            if Y == 2021 and pid in known_players:
                continue
            p = people[pid]
            entry = {'a': [p['attrs'][k] for k in bw.ATTRS], 'o': p['overall'], 'p': p['potential'],
                     'r': '|'.join(p['roles']), 'g': p['agents'], 'n': p['rounds'], 'v': p['vlr']}
            if p['traits']:
                entry['t'] = p['traits']
            if p['isIgl']:
                entry['i'] = 1
            ratings_out[pid] = entry
            prev_role[pid] = p['role']
        debuts: dict[str, dict] = {}
        for pid in sorted(pool - introduced, key=int):
            age, est, birth = ages[pid]
            bio = bios.get(pid) or {}
            raw = who.get(pid, {})
            real = bio.get('name') if str(bio.get('name') or '').lower() != str(raw.get('ign', '')).lower() else None
            debuts[pid] = {'ign': raw.get('ign') or pid,
                           'nat': (raw.get('country') or bio.get('country') or '')[:2].lower() or None,
                           'name': real, 'birth': birth, 'age': age, 'est': est}
        introduced |= set(debuts)
        for tid, c in clubs_out.items():
            prev_region[tid] = c['r']
        years_out[str(Y)] = {'clubs': clubs_out, 'rosters': {tid: club_roster[tid] for tid in clubs_out},
                             'ratings': ratings_out, 'debuts': debuts}

        # ---- the league seats, against Liquipedia's own list
        members = leagues.get('members', {}).get(str(Y), {})
        for lg in LEAGUES:
            ours = sorted(club_name[t] for t, l in league_of.items() if l == lg)
            lp = members.get(lg, [])
            if ours or lp:
                flag = '' if len(ours) == len(lp) else f'  ≠ Liquipedia {len(lp)}'
                report.append(f'  {Y} {lg} 联赛席位 {len(ours)}{flag}：' + '、'.join(ours))
        no_roster = sorted(club_name[t] for t in league_of if t not in club_roster)
        if no_roster:
            report.append(f'  {Y} 联赛队没有五人名单：' + '、'.join(no_roster))
        top = sorted(ratings_out.items(), key=lambda kv: -kv[1]['o'])[:8]
        report.append(f'  {Y}：{len(clubs_out)} 支队（一线 {sum(1 for c in clubs_out.values() if c["k"] == 1)}）· '
                      f'评分 {len(ratings_out)} 人 · 新面孔 {len(debuts)} 人 · 最高：'
                      + '、'.join(f'{who.get(p, {}).get("ign", p)} {e["o"]}' for p, e in top))

    out = {
        'meta': {
            'years': list(YEARS),
            'attrs': bw.ATTRS,
            'traits': {k: [lb, good] for k, lb, good, _ in bw.TRAITS},
            'sources': 'vlr.gg rosters and statlines, Liquipedia birthdates and partnered-team pages',
            'ruler': "build_world_2021.py's formulas, one pool per year",
        },
        'years': years_out,
        'last': {pid: y for pid, y in sorted(last_year.items(), key=lambda kv: int(kv[0])) if pid in introduced},
    }
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print(f'写入 {a.out}（{os.path.getsize(a.out) // 1024} KB）')
    for line in report:
        print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
