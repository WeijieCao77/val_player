"""How every seat at every open-era event was really won — as rules the game can replay.

The author's rule: 「冠军赛名额……现实是怎么做的我们就怎么做」. The first build
guessed where each seed came from — 「the last event that team played」 — and
that guess broke the moment a club played in two scenes: CBT Gaming played the
Huya cups and the Hong Kong & Taiwan Challengers in the same summer, so a
simulated Chinese cup rewrote a Taiwanese qualifier it had nothing to do with.

Liquipedia records the real reason on every team card, and the grammar is
small:

  * 「NA Circuit Points」, 「Circuit Points #3」   a place in a points pool
  * 「Masters Berlin」, 「EMEA Last Chance」       the winner of an event
  * 「TH Challengers 1」, 「NA Challengers Finals」 a placing in a named feeder
  * 「Open Qualifier」, 「Invited」, 「VCC」         history keeps it

This matches every Liquipedia page to the vlr event it describes (the players
on its team cards first, then its words and main-event date), every team card
to the side that took the seat, turns each label into one of those four routes,
and reads the real points each event paid off Liquipedia's standings — so a
simulated placing is paid what that placing really paid.

It then replays history on paper: award every event's real placings their
real points, and each team's total must equal Liquipedia's. Three things on
those tables are rules rather than numbers, and are counted as such: a 「Q」
total (qualified through a Masters win, not points), a deduction column, and a
total wiped to zero when a club lost its core of three (Riot's rule: points
belong to three players, not to the badge).

    python scripts/build_routes.py
    python scripts/build_routes.py --debug 2021:EMEA,2021:KR

Output: src/data/routes.json

2023–2025 are scripts/build_routes_partnered.py's (src/data/routes_partnered.json),
read beside this file by engine/circuit.ts.
"""
from __future__ import annotations

import argparse
import collections
import datetime as dt
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
YEARS = ('2021', '2022')

POOL_PAGE = {'NA': 'North America', 'EMEA': 'EMEA', 'BR': 'Brazil', 'LATAM': 'Latin America', 'JP': 'Japan',
             'KR': 'Korea', 'SEA': 'Southeast Asia', 'APAC': 'APAC'}
POOL_REGIONS = {
    '2021': {'NA': ['North America'], 'EMEA': ['Europe', 'Turkey', 'CIS'], 'BR': ['Brazil'], 'LATAM': ['LATAM'],
             'JP': ['Japan'], 'KR': ['Korea'],
             'SEA': ['SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam', 'Hong Kong & Taiwan']},
    '2022': {'NA': ['North America'], 'EMEA': ['Europe', 'Turkey', 'CIS', 'EMEA'], 'BR': ['Brazil'], 'LATAM': ['LATAM'],
             'JP': ['Japan'], 'KR': ['Korea'],
             'APAC': ['SEA', 'APAC', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam', 'Hong Kong & Taiwan']},
}
CODE = {'NA': 'North America', 'EU': 'Europe', 'TR': 'Turkey', 'CIS': 'CIS', 'BR': 'Brazil', 'Brazil': 'Brazil',
        'LATAM': 'LATAM', 'LAS': 'LATAM', 'LAN': 'LATAM', 'JP': 'Japan', 'Japan': 'Japan', 'KR': 'Korea',
        'Korea': 'Korea', 'SEA': 'SEA', 'APAC': 'APAC', 'EMEA': 'EMEA', 'TH': 'Thailand', 'PH': 'Philippines',
        'ID': 'Indonesia', 'MY & SG': 'Malaysia & Singapore', 'HK & TW': 'Hong Kong & Taiwan', 'VN': 'Vietnam',
        'East Asia': 'East Asia', 'SA': 'South America'}
KEEP = re.compile(r'open|closed|invited|week|road to vct|vcc|strike arabia|champions series|final qualifier|'
                  r'relegation|first division|^group|seed into|tiebreaker|first strike|qualif|vot|^vrl |sea ec', re.I)


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def tokens(s: str) -> set[str]:
    s = s.lower().replace('&', ' and ').replace('_', ' ')
    s = re.sub(r'latam/br', 'south america', s)
    s = re.sub(r'last chance qualifier', 'lcq', s)
    s = re.sub(r'latin america', 'latam', s)
    s = re.sub(r'south ?east asia', 'sea', s)
    s = re.sub(r'asia-pacific', 'apac', s)
    s = re.sub(r'stage (\d)', r'stage\1', s)
    s = re.sub(r'challengers (\d)', r'challengers\1', s)
    s = re.sub(r'\b(finals|playoffs)\b', 'finals', s)
    words = set(re.findall(r'[a-z0-9]+', s))
    return words - {'valorant', 'champions', 'tour', 'vct', 'the', 'and', '2021', '2022', 'main', 'event'}


def stage_no(name: str) -> int | None:
    m = re.search(r'Stage (\d)', name)
    return int(m.group(1)) if m else None


def kind_of(name: str) -> tuple[str, int | None]:
    if re.search(r'Last Chance', name, re.I):
        return 'lcq', None
    if re.search(r'Valorant Champions 20', name, re.I):
        return 'champions', None
    if re.search(r'Masters (Reykjav|Berlin|Copenhagen)', name, re.I):
        return 'intl', None
    if re.search(r'Stage \d: Masters', name):
        return 'masters', None
    if re.search(r'Promotion', name):
        return 'promotion', None
    if re.search(r'Finals|Playoffs', name):
        return 'finals', None
    m = re.search(r'Challengers (\d)', name)
    if m:
        return 'chal', int(m.group(1))
    if re.search(r'Challengers', name):
        return 'chal', 0
    return 'other', None


def intl_stage(name: str, year: str) -> int | None:
    if 'Reykjav' in name:
        return 2 if year == '2021' else 1
    if 'Berlin' in name:
        return 3
    if 'Copenhagen' in name:
        return 2
    return stage_no(name)


def main_start(e: dict) -> int:
    """The day the event proper opens — vlr dates an event from its open qualifier."""
    days = [n['day'] for u in e['units'] if u['type'] != 'open' for n in u.get('nodes', [])]
    return min(days) if days else e['start']


def day_of(date: str | None, year: str) -> int | None:
    try:
        return (dt.date.fromisoformat((date or '')[:10]) - dt.date(int(year), 1, 1)).days
    except ValueError:
        return None


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--debug', default='')
    a = ap.parse_args()
    debug = {tuple(x.split(':')) for x in a.debug.split(',') if ':' in x}

    circuit = json.load(open(os.path.join(DATA, 'circuit.json'), encoding='utf-8'))
    lp = json.load(open(os.path.join(DATA, 'lp_events.json'), encoding='utf-8'))
    history = json.load(open(os.path.join(DATA, 'history.json'), encoding='utf-8'))
    points_pages = json.load(open(os.path.join(DATA, 'lp_points.json'), encoding='utf-8'))

    report = collections.Counter()
    out_events: dict[str, dict] = {}
    unparsed = collections.Counter()
    unmatched_pages: list[str] = []
    thin: list[str] = []
    igns_of_event = {eid: {norm(p['ign']) for t in ev.get('teams', []) for p in t.get('players', [])}
                     for eid, ev in history.items()}

    for year in YEARS:
        evs = circuit[year]
        by_id = {e['id']: e for e in evs}
        pages = {t: v for t, v in lp.items() if f'/{year}/' in t}

        # ---- 1. every vlr event to its Liquipedia page: the people first, then
        # words and the main-event date. One page, one event, best pairs first.
        candidates = []
        for e in evs:
            k, _ = kind_of(e['name'])
            igns_e = igns_of_event.get(e['id'], set())
            et = tokens(e['name'])
            starts = (e['start'], main_start(e))
            for t, v in pages.items():
                sd = day_of(v['info'].get('sdate'), year)
                # 2022's LATAM-vs-Brazil deciders have pages with no date at all
                sa_decider = 'LATAM/BR' in e['name'] and re.search(
                    r'/South America/Stage %d/Challengers Playoffs$' % (stage_no(e['name']) or 0), t)
                if sd is None and not sa_decider:
                    continue
                gap = min(abs(sd - s) for s in starts) if sd is not None else 0
                pt = tokens(t) | tokens(v['info'].get('name', ''))
                words = len(et & pt) / max(1, len(et | pt))
                igns_p = {norm(p) for c in v['teams'] for p in c.get('players', [])}
                people = len(igns_e & igns_p) / len(igns_e | igns_p) if igns_e and igns_p else 0.0
                if gap > (45 if people >= 0.5 else 20):
                    continue
                special = 0.0
                if k == 'champions' and re.search(r'/Champions$', t):
                    special = 2.0
                if k == 'intl' and re.search(r'/Stage %d/Masters$' % (intl_stage(e['name'], year) or 0), t):
                    special = 2.0
                # 2022's LATAM-vs-Brazil deciders: vlr calls them LCQs, Liquipedia calls them playoffs
                if 'LATAM/BR' in e['name'] and re.search(r'/South America/Stage %d/Challengers Playoffs$' % (stage_no(e['name']) or 0), t):
                    special = 2.0
                dates = 0.35 if gap <= 3 else 0.15 if gap <= 7 else 0.0
                score = special + 1.5 * people + words + dates
                if special or people >= 0.3 or words + dates >= 0.8:
                    candidates.append((score, e['id'], t))
        candidates.sort(reverse=True)
        page_of: dict[str, str] = {}
        used_pages: set[str] = set()
        for score, eid, t in candidates:
            if eid in page_of or t in used_pages:
                continue
            page_of[eid] = t
            used_pages.add(t)
        for e in evs:
            if e['id'] not in page_of:
                unmatched_pages.append(f"{year} {e['id']} {e['name']}")
        report[f'{year} 赛事配上 Liquipedia 页'] = len(page_of)
        report[f'{year} 赛事没配上'] = len(evs) - len(page_of)

        def events_where(region: str | None, stage: int | None, kind: str, number: int | None = None,
                         before: int | None = None) -> list[dict]:
            out = []
            for e in evs:
                k, n = kind_of(e['name'])
                if k != kind:
                    continue
                if region is not None and e['region'] != region:
                    continue
                if stage is not None and stage_no(e['name']) != stage:
                    continue
                if number is not None and n != number:
                    continue
                if before is not None and e['end'] >= before:
                    continue
                out.append(e)
            return sorted(out, key=lambda e: e['start'])

        def resolve(label: str, e: dict) -> dict:
            s = label.strip()
            if not s or KEEP.search(s):
                return {'kind': 'keep'}
            m = re.match(r'^(?:(NA|EMEA|BR|LATAM|JP|KR|SEA|APAC|FGC) )?Circuit Points(?: #(\d+))?$', s)
            if m:
                pool = m.group(1) or {'North America': 'NA', 'EMEA': 'EMEA'}.get(e['region'] or '', None)
                if pool == 'FGC' or pool is None:
                    return {'kind': 'keep', 'why': 'points pool not kept: ' + s}
                return {'kind': 'points', 'pool': pool, 'rank': int(m.group(2)) if m.group(2) else None}
            m = re.match(r'^Masters (Berlin|Reykjav\w*|Copenhagen)$', s)
            if m:
                target = [x for x in evs if kind_of(x['name'])[0] == 'intl' and m.group(1)[:5] in x['name']]
                return {'kind': 'winner', 'event': target[0]['id']} if target else {'kind': 'keep', 'why': s}
            m = re.match(r'^(NA|EMEA|SA|APAC|East Asia) Last Chance$', s)
            if m:
                region = CODE[m.group(1)]
                target = [x for x in evs if kind_of(x['name'])[0] == 'lcq' and x['region'] == region]
                return {'kind': 'winner', 'event': target[0]['id']} if target else {'kind': 'keep', 'why': s}
            stage = intl_stage(e['name'], year) or stage_no(e['name'])
            m = re.match(r'^(?:VCT )?(NA|EU|TR|CIS|BR|Brazil|LATAM|LAS|LAN|JP|Japan|KR|Korea|SEA|APAC|EMEA|TH|PH|ID|MY & SG|HK & TW|VN):? '
                         r'Challengers(?: (Finals|Playoffs|\d|#\d+))?$', s)
            if m:
                region = CODE[m.group(1)]
                tail = m.group(2)
                if tail and tail.isdigit():
                    cands = events_where(region, stage, 'chal', int(tail), before=e['start'])
                elif tail and tail.startswith('#'):
                    cands = events_where(region, stage, 'chal', None, before=e['start'])[-1:]
                else:
                    cands = (events_where(region, stage, 'finals', before=e['start'])
                             or events_where(region, stage, 'chal', None, before=e['start'])[-1:])
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            m = re.match(r'^(?:VCT (?:EMEA|NA): )?Challengers (\d)\b', s)
            if m:
                cands = events_where(e['region'], stage, 'chal', int(m.group(1)), before=e['start'])
                if not cands and year == '2022':
                    cands = events_where(e['region'], int(m.group(1)), 'chal', None, before=e['start'])
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            m = re.match(r'^(?:Stage (\d) Challengers|Challengers Stage (\d)|Stage (\d))$', s)
            if m:
                st = int(next(g for g in m.groups() if g))
                cands = events_where(e['region'], st, 'chal', None, before=e['start']) + \
                    events_where(e['region'], st, 'finals', before=e['start'])
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            m = re.match(r'^Masters(?: (\d))?$', s)
            if m:
                st = int(m.group(1)) if m.group(1) else (stage or 2) - 1
                layer = 'SEA' if e['region'] in POOL_REGIONS['2021']['SEA'] else e['region']
                cands = events_where(layer, st, 'masters', before=e['start'])
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            if re.match(r'^VCT EMEA: Promotion$', s):
                cands = [x for x in evs if kind_of(x['name'])[0] == 'promotion' and x['end'] < e['start']]
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            if re.match(r'^LATAM vs BR Playoffs$', s):
                cands = [x for x in evs if 'LATAM/BR' in x['name'] and x['end'] < e['start']]
                return {'kind': 'top', 'event': cands[-1]['id']} if cands else {'kind': 'keep', 'why': s}
            unparsed[s] += 1
            return {'kind': 'keep', 'why': 'unparsed: ' + s}

        # ---- 2. each card to the side that took the seat, and its route
        for eid, title in page_of.items():
            e = by_id[eid]
            hev = history.get(eid, {})
            roster_igns = {t['id']: {norm(p['ign']) for p in t.get('players', [])} for t in hev.get('teams', [])}
            names = {vid: norm(nm) for vid, nm in e['names'].items()}
            routes: dict[str, dict] = {}
            card_team: dict[str, str] = {}
            for card in lp[title]['teams']:
                igns = {norm(p) for p in card.get('players', [])}
                best, best_n = None, 1
                for vid, ros in roster_igns.items():
                    n = len(igns & ros)
                    if n > best_n:
                        best, best_n = vid, n
                if not best:
                    cn = norm(card['team'])
                    for vid, nm in names.items():
                        if nm and (nm == cn or (len(cn) >= 4 and (cn in nm or nm in cn))):
                            best = vid
                            break
                if not best:
                    report['队卡没配上种子'] += 1
                    continue
                card_team[norm(card['team'])] = best
                if best not in e['seeds']:
                    report['队卡对应的是赛内晋级，不是外部种子'] += 1
                    continue
                routes[best] = resolve(card.get('qualifier') or '', e)
                report['种子有来路'] += 1
                report['来路·' + routes[best]['kind']] += 1
            place_in = {ev_id: {t: p for t, p in by_id[ev_id]['places']} for ev_id in
                        {r['event'] for r in routes.values() if r.get('event')}}
            groups = collections.defaultdict(list)
            for vid, r in routes.items():
                if r['kind'] == 'top':
                    groups[r['event']].append(vid)
            for feeder, vids in groups.items():
                vids.sort(key=lambda v: place_in[feeder].get(v, 999))
                for k, v in enumerate(vids):
                    routes[v]['k'] = k
            out_events[eid] = {'lp': title, 'routes': routes, 'cards': card_team}
            if kind_of(e['name'])[0] in ('intl', 'champions', 'lcq', 'finals', 'masters'):
                outside = [s for s in e['seeds'] if not s.startswith('N:')]
                missing = [e['names'].get(s, s) for s in outside if s not in routes]
                if missing:
                    thin.append(f"{year} {e['cn']}：{len(missing)}/{len(outside)} 个种子没有来路（{'、'.join(missing[:5])}）")

    # ---- 3. what each placing paid, and the check against Liquipedia's totals
    circuit_by_id = {e['id']: e for y in YEARS for e in circuit[y]}
    title_to_event = {v['lp'].replace('_', ' '): eid for eid, v in out_events.items()}

    def event_for_page(year: str, page: str | None) -> str | None:
        """A points column's event: its own match, else the event that contains its teams —
        vlr keeps Korea's Stage 3 Challengers and its playoffs as one event, Liquipedia as two."""
        page = (page or '').replace('_', ' ')
        if page in title_to_event:
            return title_to_event[page]
        v = lp.get(page)
        if not v:
            return None
        igns_p = {norm(p) for c in v['teams'] for p in c.get('players', [])}
        sd = day_of(v['info'].get('sdate'), year)
        best, best_p = None, 0.6
        for e in circuit[year]:
            if sd is None or not (e['start'] - 3 <= sd <= e['end'] + 3):
                continue
            igns_e = igns_of_event.get(e['id'], set())
            if not igns_e or not igns_p:
                continue
            p = len(igns_e & igns_p) / min(len(igns_e), len(igns_p))
            if p > best_p:
                best, best_p = e['id'], p
        if best:
            report['积分列按阵容挂到所属赛事'] += 1
        return best

    pools_out: dict[str, dict] = {}
    award: dict[str, dict[int, int]] = collections.defaultdict(dict)
    tables = []
    # what each placing paid, straight off the event's own prize table — not
    # inferred from who got what, which could not tell 7th from joint 7th
    for eid, info in out_events.items():
        for s in lp.get(info.get('lp') or '', {}).get('prizes') or []:
            if s['points'] is None:
                continue
            for pl in range(s['from'], s['to'] + 1):
                award[eid].setdefault(pl, s['points'])
        if award.get(eid):
            report['赛事奖金表里读到积分'] += 1
    for ptitle, table in points_pages.items():
        m = re.search(r'/(2021|2022)/Circuit Points/(.+)$', ptitle)
        if not m:
            continue
        year, pool_page = m.group(1), m.group(2)
        pool = next((k for k, v in POOL_PAGE.items() if v == pool_page), None)
        if not pool:
            continue
        cols = table['columns']
        col_events = [event_for_page(year, c.get('page')) if c['kind'] == 'event' else None for c in cols]
        order = []
        for row in table['rows']:
            tid = None
            rn = norm(row['team'])
            for eid in col_events:
                if eid and rn in out_events.get(eid, {}).get('cards', {}):
                    tid = out_events[eid]['cards'][rn]
                    break
            if not tid:
                for e in circuit[year]:
                    for vid, nm in e['names'].items():
                        if norm(nm) == rn:
                            tid = vid
                            break
                    if tid:
                        break
            order.append({'team': tid, 'name': row['team'], 'total': row['total'], 'rank': row['rank'], 'status': row['status']})
        pools_out.setdefault(year, {})[pool] = {'regions': POOL_REGIONS[year][pool], 'standings': order,
                                                'columns': [{'label': c.get('label'), 'event': ev} for c, ev in zip(cols, col_events)]}
        tables.append((year, pool, cols, col_events, table['rows'], order))

    verify, voided = [], []
    for year, pool, cols, col_events, rows, order in tables:
        for row, info in zip(rows, order):
            tid = info['team']
            if not tid:
                report['积分表里的队没对上 id'] += 1
                continue
            if row['status'] == 'byeup':
                report['经大师赛直通、表上不计分'] += 1
                continue
            deducted = sum(p for c, p in zip(cols, row['points']) if c['kind'] == 'deduction')
            earned = 0
            for c, eid in zip(cols, col_events):
                if c['kind'] != 'event' or not eid:
                    continue
                pl = dict((t, p) for t, p in circuit_by_id[eid]['places']).get(tid)
                if pl is not None:
                    earned += award[eid].get(pl, 0)
            if earned + deducted == row['total']:
                report['积分核对一致'] += 1
            elif row['total'] == 0 and earned > 0 and deducted == 0:
                voided.append(f"{year} {pool} {row['team']}（按名次该有 {earned}）")
            else:
                verify.append(f"{year} {pool} {row['team']}: 表上 {row['total']}，按名次 {earned}，扣分 {deducted}")
            if (year, pool) in debug:
                cells = []
                for c, eid, p in zip(cols, col_events, row['points']):
                    pl = dict((t, x) for t, x in circuit_by_id[eid]['places']).get(tid) if eid else None
                    ours = award.get(eid, {}).get(pl, 0) if pl is not None else None
                    cells.append(f'{p}' if ours in (p, None) else f'{p}≠{ours}@{pl}')
                print(f"  [{year} {pool}] {row['rank']:>2} {row['team']:<22} 合计 {row['total']:>4} | " + ' | '.join(cells))
    report['积分核对不一致'] = len(verify)
    report['整队积分作废（三人核心离队）'] = len(voided)

    for eid, pts in award.items():
        out_events.setdefault(eid, {'routes': {}, 'cards': {}})['award'] = {str(k): v for k, v in sorted(pts.items())}

    out = {'events': out_events, 'pools': pools_out}
    with open(os.path.join(DATA, 'routes.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('写入 src/data/routes.json')
    for k, v in report.items():
        print(f'  {k}: {v}')
    if unparsed:
        print('  没解析的资格说明：', dict(unparsed.most_common(20)))
    if unmatched_pages:
        print('  没配上页面的赛事：')
        for line in unmatched_pages[:20]:
            print('   ', line)
    if thin:
        print('  关键赛事里没有来路的种子：')
        for line in thin[:30]:
            print('   ', line)
    if voided:
        print('  积分作废的队：' + '；'.join(voided[:12]))
    if verify:
        print(f'  积分核对不一致（{len(verify)} 条）：')
        for line in verify[:30]:
            print('   ', line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
