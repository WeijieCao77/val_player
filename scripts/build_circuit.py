"""Rebuild every real event's format from the matches it actually played.

The author's rule for the 2021 era: 「赛制当时是什么样的我们就做什么样的设计」.
The formats were not one format. North America ran eight-team double
elimination; Berlin and Champions ran GSL groups into a single bracket; Korea
ran round-robin preliminaries into GSL groups and Japan ran Bo2 groups that
could end level; LATAM split into a North and a South bracket; Europe's first
Challengers of each stage sent four quarter-final winners on and crowned
nobody; Reykjavík seeded four teams past its opening round. Typing each of
those in by hand is exactly the kind of table that is quietly wrong in one
cell.

So nothing here is typed in. vlr.gg lists every series of every event with its
round name, and a bracket can be read back off who played whom:

  * a side's **first** series in a phase is an entry slot — an outside seed,
    or a placing in an earlier phase of the same event (「A 组第一」)
  * every later series is fed by that side's previous one: **won** it → `w`,
    **lost** it → `l`

A round robin is recognised by its shape rather than its label: every pair
meets the same number of times, and there are no bracket words in the rounds.

An **open qualifier** is kept only as its result — who came through, in what
order. Its sides are mostly five friends and a Discord server, not clubs a
world holds, so the game never plays one; it replays it, and lets the player's
club contest the last place through (engine/circuit.ts offerPlayIn).

What comes out is a graph the game can play twice over — once with the real
winners (a side the player never reaches keeps its history) and once with
simulated ones (the side he does). Both walk the same nodes on the same days.

    python scripts/build_circuit.py
    python scripts/build_circuit.py --show 353,449,334

Output: src/data/circuit.json, keyed by year (2021 and 2022: the open era).
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

# ---------------------------------------------------------------- which events

# third-party cups that shared a region with the circuit but were not part of it
THIRD_PARTY = re.compile(
    r'game on masters|bechampions|becontender|ultimasters|guns and masters|mockern|'
    r'rog x|road to vct|thinkpro|metafy|masters pro league|valorant east', re.I)

# the region an event belongs to, most specific first: 「Asia-Pacific」 must not
# be read as Pacific, and 「EMEA Challengers Playoffs」 is the combining layer,
# not Europe
REGION_BY_NAME: list[tuple[str, str]] = [
    (r'North America', 'North America'),
    # 2022's CN Invitation door: China, Korea and Japan for one place
    (r'East Asia', 'East Asia'),
    (r'Turkey|Türkiye', 'Turkey'),
    (r'\bCIS\b', 'CIS'),
    (r'Brazil', 'Brazil'),
    (r'LATAM|Latin America', 'LATAM'),
    (r'Korea', 'Korea'),
    (r'Japan', 'Japan'),
    (r'Malaysia', 'Malaysia & Singapore'),
    (r'Indonesia', 'Indonesia'),
    (r'Thailand', 'Thailand'),
    (r'Philippines', 'Philippines'),
    (r'Vietnam', 'Vietnam'),
    (r'Hong Kong', 'Hong Kong & Taiwan'),
    (r'China|PangHu|Huya|FGC', 'China'),
    (r'\bSEA\b|Southeast Asia', 'SEA'),
    (r'EMEA', 'EMEA'),
    (r'Europe', 'Europe'),
    (r'Asia-Pacific|APAC', 'APAC'),
    (r'South America', 'South America'),
    (r'Americas', 'Americas'),
    (r'Pacific', 'Pacific'),
]
# an all-star game or a showmatch sits in an event's match list and decides nothing
SHOW = re.compile(r'show ?match|all-?star|exhibition', re.I)
# a relegation or promotion bracket after the playoffs decides who stays in a
# league, not who won it
SIDE_PHASE = re.compile(r'relegation|promotion', re.I)
INTERNATIONAL = re.compile(r'Masters (Reykjav|Berlin|Copenhagen|Tokyo|Madrid|Shanghai)|Valorant Champions 20|LOCK//IN', re.I)

# which clubs a combining layer draws on, for the game's qualification
LAYER_OF = {
    'EMEA': ['Europe', 'Turkey', 'CIS'],
    'SEA': ['SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam', 'Hong Kong & Taiwan'],
    'APAC': ['Korea', 'Japan', 'SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam',
             'Hong Kong & Taiwan'],
    'South America': ['Brazil', 'LATAM'],
    'East Asia': ['Korea', 'Japan', 'China'],
}

REGION_CN = {
    'North America': '北美', 'Europe': '欧洲', 'Turkey': '土耳其', 'CIS': '独联体', 'Brazil': '巴西',
    'LATAM': '拉美', 'Korea': '韩国', 'Japan': '日本', 'SEA': '东南亚', 'Malaysia & Singapore': '马新',
    'Indonesia': '印尼', 'Thailand': '泰国', 'Philippines': '菲律宾', 'Vietnam': '越南',
    'Hong Kong & Taiwan': '港台', 'China': '中国', 'EMEA': 'EMEA', 'APAC': '亚太', 'South America': '南美',
    'Americas': '美洲', 'Pacific': '太平洋', 'East Asia': '东亚',
}
CN_NUM = {'1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六', '7': '七', '8': '八'}


def region_of(name: str) -> str | None:
    if INTERNATIONAL.search(name):
        return None
    for pat, region in REGION_BY_NAME:
        if re.search(pat, name, re.I):
            return region
    return None


def stage_of(name: str, year: int = 2021) -> str | None:
    """The calendar slice an event belongs to, read off its name."""
    if re.search(r'Last Chance', name, re.I):
        return 'lcq'
    if re.search(r'Valorant Champions 20', name, re.I):
        return 'champions'
    if re.search(r'Masters Reykjav', name, re.I):
        return 'masters1'
    if re.search(r'Masters (Berlin|Copenhagen)', name, re.I):
        return 'masters2'
    m = re.search(r'Stage (\d)', name)
    if m:
        s = m.group(1)
        if re.search(r'Stage \d: Masters', name):
            return f's{s}masters'
        if re.search(r'Finals|Playoffs', name):
            # 2022's calendar has no finals window: its playoffs close the Challengers stage
            return f's{s}finals' if year <= 2021 else f's{s}chal'
        if re.search(r'Challengers', name):
            return f's{s}chal'
    return None


def cn_name(ev: dict, region: str | None, stage: str | None) -> str:
    n = ev['name']
    if re.search(r'PangHu Cup: Spring', n):
        return '虎牙胖虎杯 · 春季赛'
    if re.search(r'PangHu Cup: Summer', n):
        return '虎牙胖虎杯 · 夏季赛'
    if re.search(r'FGC', n):
        act = re.search(r'Act (\d)', n)
        if act:
            return f'FGC 邀请赛 {ev["year"]} · 第{CN_NUM.get(act.group(1), act.group(1))}幕'
        if re.search(r'Epilogue', n):
            return f'FGC 邀请赛 {ev["year"]} · 终章'
        return 'FGC 无畏契约邀请赛'
    if stage == 'masters1':
        return '雷克雅未克大师赛'
    if stage == 'masters2':
        return '柏林大师赛' if 'Berlin' in n else '哥本哈根大师赛'
    if stage == 'champions':
        return f'{ev["year"]} 全球冠军赛'
    rc = REGION_CN.get(region or '', region or '')
    if stage == 'lcq':
        return f'{rc} · 最后机会资格赛'
    m = re.search(r'Stage (\d)', n)
    s = CN_NUM.get(m.group(1), m.group(1)) if m else ''
    if re.search(r'Promotion', n):
        return f'{rc} · 第{s}赛段 升级赛'
    if stage and stage.endswith('masters'):
        return f'{rc} · 第{s}赛段 大师赛'
    if stage and stage.endswith('finals'):
        return f'{rc} · 第{s}赛段 挑战者决赛'
    c = re.search(r'Challengers (\d)', n)
    if stage and stage.endswith('chal'):
        return f'{rc} · 第{s}赛段 挑战者赛' + (f' {c.group(1)}' if c else '')
    return n


# ---------------------------------------------------------------- labels

UNIT_CN = {'Main Event': '正赛', 'Main Stage': '正赛', 'Group Stage': '小组赛', 'Playoffs': '季后赛',
           'Preliminary Round': '预选赛', 'Regular Season': '常规赛', 'Knockout Stage': '淘汰赛',
           'Play-In': '附加赛', 'Play-Ins': '附加赛', 'Promotion': '升级赛', 'Regional Playoffs': '赛区季后赛'}
QUAL_REST_CN = {'Playoffs': '淘汰赛', 'Play-in': '附加赛', 'Last Chance': '最后机会',
                'Day 1': '第一天', 'Day 2': '第二天', 'Day 3': '第三天'}
SPLIT_CN = {'LAS': '南区', 'LAN': '北区'}


def is_qualifier(stage: str) -> bool:
    return bool(re.search(r'qualif', stage, re.I))


def unit_label(stage: str, grp: str | None) -> str:
    base, _, split = stage.partition(': ')
    b = base.strip()
    if is_qualifier(b):
        cn = '海选'
        rest = re.sub(r'(?i)\b(open|closed)?\s*qualifiers?\b', '', b).strip(' :-')
        if rest:
            cn += ' · ' + QUAL_REST_CN.get(rest, rest)
    else:
        cn = UNIT_CN.get(b, b)
    if split.strip():
        cn += ' · ' + SPLIT_CN.get(split.strip(), split.strip())
    if grp:
        cn += f' · {grp}组'
    return cn


def round_cn(series: str) -> str:
    s = series.strip()
    g = re.search(r'\(([A-Z0-9])\)\s*$', s)
    grp = f'{g.group(1)}组 ' if g else ''
    core = re.sub(r'\s*\([A-Z0-9]\)\s*$', '', s)
    # vlr spells the same round several ways: 「Quarter Finals」, 「Semi-Finals」
    core = re.sub(r'(?i)\bquarter[\s-]*finals?\b', 'Quarterfinals', core)
    core = re.sub(r'(?i)\bsemi[\s-]*finals?\b', 'Semifinals', core)
    core = re.sub(r'(?i)\bgrand[\s-]*finals?\b', 'Grand Final', core)
    rules = [
        (r'^Grand Finals?$', '总决赛'),
        (r'^Upper (Bracket )?Finals?$', '胜者组决赛'),
        (r'^Lower (Bracket )?Finals?$', '败者组决赛'),
        (r'^Upper (Bracket )?Semifinals?$', '胜者组半决赛'),
        (r'^Lower (Bracket )?Semifinals?$', '败者组半决赛'),
        (r'^Upper (Bracket )?Quarterfinals?$', '胜者组四分之一决赛'),
        (r'^Semifinals?$', '半决赛'),
        (r'^Quarterfinals?$', '四分之一决赛'),
        (r'^(Third|3rd) Place.*$', '季军赛'),
        (r'^Consolation Finals?$', '季军赛'),
        (r'^Runner-?Up Finals?$', '亚军赛'),
        (r'^Opening$', '首轮'),
        (r"^Winner'?s$", '胜者赛'),
        (r'^Elimination$', '败者赛'),
        (r'^Decider$', '决胜赛'),
        (r'^Upper (Bracket )?Round$', '胜者组'),
        (r'^Lower (Bracket )?Round$', '败者组'),
    ]
    for pat, out in rules:
        if re.match(pat, core, re.I):
            return grp + out
    m = re.match(r'^(Upper|Lower) (Bracket )?Round (\d)$', core, re.I)
    if m:
        side = '胜者组' if m.group(1).lower() == 'upper' else '败者组'
        return f'{grp}{side}第{CN_NUM.get(m.group(3), m.group(3))}轮'
    m = re.match(r'^Round of (\d+)$', core, re.I)
    if m:
        return f'{grp}{m.group(1)} 强'
    m = re.match(r'^Group ([A-Z0-9]+)$', core, re.I)
    if m:
        return f'{m.group(1)}组'
    m = re.match(r'^(Week|Round|Day) (\d+)$', core, re.I)
    if m:
        return f'{grp}第 {m.group(2)} 轮'
    return grp + core


def group_of(series: str) -> str | None:
    m = re.search(r'\(([A-Z0-9])\)\s*$', series) or re.match(r'^Group ([A-Z0-9]+)$', series.strip())
    return m.group(1) if m else None


# ---------------------------------------------------------------- teams


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def team_index(history: dict) -> tuple[dict[str, set[str]], dict[tuple[int, str], collections.Counter]]:
    by_name: dict[str, set[str]] = collections.defaultdict(set)
    # a name two clubs wore at different times: which one wore it that year
    by_year: dict[tuple[int, str], collections.Counter] = collections.defaultdict(collections.Counter)
    for e in history.values():
        for t in e.get('teams', []):
            by_name[norm(t['name'])].add(t['id'])
            by_year[(e['year'], norm(t['name']))][t['id']] += 1
        for st in e.get('standings', []):
            if st.get('name'):
                by_name[norm(st['name'])].add(st['teamId'])
                by_year[(e['year'], norm(st['name']))][st['teamId']] += 1
    return by_name, by_year


# ---------------------------------------------------------------- ranking


def rank_unit(rr: bool, nodes: list[dict]) -> tuple[list[str], list[list[str]]]:
    """Order a phase's sides, and group the ones its format cannot tell apart.

    Mirrors engine/circuit.ts rankPhase: the two must agree, or a `g` slot
    written here would point at a different side in the game.
    """
    teams: list[str] = []
    for nd in nodes:
        for t in nd['teams']:
            if t not in teams:
                teams.append(t)
    if rr:
        pts = collections.Counter()
        mapd = collections.Counter()
        for nd in nodes:
            a, b = nd['teams']
            sa, sb = nd['score']
            if nd['winner']:
                pts[nd['winner']] += 3
            elif sa is not None and sa == sb:
                pts[a] += 1
                pts[b] += 1
            if sa is not None and sb is not None:
                mapd[a] += sa - sb
                mapd[b] += sb - sa
        # engine/circuit.ts rankPhase: points, then head-to-head maps among the
        # sides level on points, then overall map difference
        def h2h(t: str) -> int:
            tied = {u for u in teams if pts[u] == pts[t]}
            d = 0
            for nd in nodes:
                a, b = nd['teams']
                sa, sb = nd['score']
                if a in tied and b in tied and sa is not None and sb is not None:
                    d += (sa - sb) if a == t else (sb - sa) if b == t else 0
            return d
        ranked = sorted(teams, key=lambda t: (-pts[t], -h2h(t), -mapd[t]))
        tiers: list[list[str]] = []
        for t in ranked:
            if tiers and (pts[tiers[-1][0]], h2h(tiers[-1][0]), mapd[tiers[-1][0]]) == (pts[t], h2h(t), mapd[t]):
                tiers[-1].append(t)
            else:
                tiers.append([t])
        return ranked, tiers

    last: dict[str, int] = {}
    losses = collections.Counter()
    for i, nd in enumerate(nodes):
        for t in nd['teams']:
            last[t] = i
        if nd['winner']:
            losses[nd['teams'][1] if nd['winner'] == nd['teams'][0] else nd['teams'][0]] += 1

    def out(t: str) -> bool:
        nd = nodes[last[t]]
        # a third-place (or runner-up) match is played by two sides already out
        return nd['winner'] is not None and (nd['winner'] != t or nd['round'].endswith(('季军赛', '亚军赛')))

    alive = sorted((t for t in teams if not out(t)), key=lambda t: (losses[t], -last[t]))
    gone = sorted((t for t in teams if out(t)), key=lambda t: (-last[t], 0 if nodes[last[t]]['winner'] == t else 1))
    tiers = []
    for t in alive:
        if tiers and losses[tiers[-1][0]] == losses[t]:
            tiers[-1].append(t)
        else:
            tiers.append([t])
    by_round: dict[tuple, list[str]] = {}
    for t in gone:
        nd = nodes[last[t]]
        by_round.setdefault((nd['round'], nd['winner'] == t), []).append(t)
    tiers += list(by_round.values())
    return alive + gone, tiers


def phase_key(stage: str, grp: str | None) -> str:
    # the groups of a stage are one phase; the stage's own bracket is another
    return f'{stage}|{"groups" if grp else ""}'


# ---------------------------------------------------------------- inference


def infer_event(ev: dict, matches: list[dict], by_name: dict[str, set[str]],
                by_year: dict[tuple[int, str], collections.Counter]) -> tuple[dict, list[str], collections.Counter]:
    year = ev['year']
    jan1 = dt.date(year, 1, 1)
    problems: list[str] = []
    notes = collections.Counter()
    names: dict[str, str] = {}

    def tid(side: dict) -> str:
        if side['id']:
            return side['id']
        key = norm(side['name'])
        ids = by_name.get(key, set())
        if len(ids) == 1:
            return next(iter(ids))
        if by_year.get((year, key)):
            return by_year[(year, key)].most_common(1)[0][0]
        # nobody we know: an amateur side from an open qualifier. It still
        # needs an identity for the bracket to be read back.
        return 'N:' + norm(side['name'])

    ms = [m for m in matches if m.get('date') and m['a']['name'] and m['b']['name']
          and m['a']['name'].upper() != 'TBD' and m['b']['name'].upper() != 'TBD'
          and not SHOW.search((m.get('stage') or '') + ' ' + (m.get('series') or ''))]
    ms.sort(key=lambda m: (m['date'], int(m['id'])))

    order: list[tuple[str, str | None]] = []
    phase_ms: dict[tuple[str, str | None], list[dict]] = collections.defaultdict(list)
    for m in ms:
        key = (m['stage'] or 'Main Event', group_of(m['series']))
        if key not in phase_ms:
            order.append(key)
        phase_ms[key].append(m)

    seeds: list[str] = []
    units: list[dict] = []
    rank_in: list[dict[str, int]] = []

    for ui, key in enumerate(order):
        stage_name, grp = key
        pms = phase_ms[key]
        teams_in: list[str] = []
        for m in pms:
            for s in ('a', 'b'):
                t = tid(m[s])
                if t not in teams_in:
                    teams_in.append(t)
        pairs = collections.Counter(frozenset((tid(m['a']), tid(m['b']))) for m in pms)
        n = len(teams_in)
        rr = (n >= 3 and len(pairs) == n * (n - 1) // 2 and len(set(pairs.values())) == 1
              and not re.search(r'Opening|Winner|Elimination|Decider|Upper|Lower|Final|Semi|Quarter|Round of',
                                ' '.join(m['series'] for m in pms), re.I))

        def entry(t: str) -> list:
            for pj in range(ui - 1, -1, -1):
                if t in rank_in[pj]:
                    return ['g', pj, rank_in[pj][t]]
            if t not in seeds:
                seeds.append(t)
            return ['s', seeds.index(t)]

        bo_mode = collections.Counter()
        for m in pms:
            sa, sb = m['a']['score'], m['b']['score']
            if sa is not None and sb is not None and sa != sb:
                bo_mode[{1: 1, 2: 3, 3: 5}.get(max(sa, sb), 3)] += 1
        default_bo = bo_mode.most_common(1)[0][0] if bo_mode else 3

        nodes: list[dict] = []
        last: dict[str, int] = {}
        used: set[tuple[str, int]] = set()
        for i, m in enumerate(pms):
            a, b = tid(m['a']), tid(m['b'])
            names.setdefault(a, m['a']['name'])
            names.setdefault(b, m['b']['name'])
            slots = []
            for t in (a, b):
                if rr or t not in last:
                    slots.append(entry(t))
                else:
                    p = last[t]
                    ref = ('w' if nodes[p]['winner'] == t else 'l', p)
                    if ref in used:
                        notes['同一个胜负出口被用了两次（原始数据缺场或重赛）'] += 1
                    used.add(ref)
                    slots.append(list(ref))
            sa, sb = m['a']['score'], m['b']['score']
            winner = a if m.get('winner') == 'a' else b if m.get('winner') == 'b' else None
            if sa is not None and sb is not None and sa == sb:
                bo = 2
                if winner is None:
                    notes['Bo2 平局'] += 1
            else:
                bo = {1: 1, 2: 3, 3: 5}.get(max(sa or 0, sb or 0), default_bo) if sa is not None and sb is not None else default_bo
                if winner is None:
                    problems.append(f'{key} 第 {i} 场没有胜者')
            nodes.append({
                'day': (dt.date.fromisoformat(m['date']) - jan1).days,
                'round': round_cn(m['series']),
                'bo': bo, 'a': slots[0], 'b': slots[1],
                'winner': winner, 'teams': [a, b], 'score': [sa, sb],
            })
            last[a] = last[b] = i

        ranked, tiers = rank_unit(rr, nodes)
        rank_in.append({t: r + 1 for r, t in enumerate(ranked)})
        ghost_nodes = sum(1 for nd in nodes if any(t.startswith('N:') for t in nd['teams']))
        is_open = is_qualifier(stage_name) or ghost_nodes * 2 > len(nodes)
        unit = {'label': unit_label(stage_name, grp), 'type': 'open' if is_open else ('rr' if rr else 'bracket'),
                'size': n, '_phase': phase_key(stage_name, grp), '_tiers': tiers}
        if is_open:
            unit.update({'first': min(nd['day'] for nd in nodes), 'last': max(nd['day'] for nd in nodes),
                         'ranked': ranked})
        else:
            unit['nodes'] = nodes
        units.append(unit)

    # ---- the event's placings: the last phase decides the top, every earlier
    # phase ranks the sides it knocked out below everyone who went on, and a
    # stage's parallel groups are one phase — every group's third is joint
    phases: dict[str, list[dict]] = {}
    for u in units:
        phases.setdefault(u['_phase'], []).append(u)
    main = [g for k, g in phases.items() if not SIDE_PHASE.search(k)]
    side = [g for k, g in phases.items() if SIDE_PHASE.search(k)]
    places: list[list] = []
    seen: set[str] = set()
    for group in list(reversed(main)) + list(reversed(side)):
        fresh = [[[t for t in tier if t not in seen] for tier in u['_tiers']] for u in group]
        fresh = [[tier for tier in u if tier] for u in fresh]
        for k in range(max((len(u) for u in fresh), default=0)):
            joint = [t for u in fresh if k < len(u) for t in u[k] if t not in seen]
            place = len(seen) + 1
            for t in joint:
                seen.add(t)
                places.append([t, place])
    for u in units:
        del u['_phase'], u['_tiers']

    region = region_of(ev['name'])
    stage = stage_of(ev['name'], ev['year'])
    days = [nd['day'] for u in units for nd in u.get('nodes', [])] + \
           [d for u in units if u['type'] == 'open' for d in (u['first'], u['last'])]
    out = {
        'id': ev['id'], 'name': ev['name'], 'cn': cn_name(ev, region, stage),
        'region': region, 'layer': LAYER_OF.get(region or ''), 'stage': stage,
        'start': min(days) if days else None, 'end': max(days) if days else None,
        'prize': ev.get('prize'),
        'seeds': seeds, 'units': units, 'places': places,
        # names only for sides that appear somewhere a player can read them
        'names': {t: nm for t, nm in names.items() if not t.startswith('N:') or t in {p[0] for p in places[:16]}},
        # who each side brought. A club's vlr id is not its identity: Raise
        # Your Edge's five played March as Acend, and the game recognises a
        # side by the people on it (engine/circuit.ts teamOf)
        'rosters': {t['id']: [p['id'] for p in t['players']] for t in ev.get('teams', []) if t.get('players')},
    }
    # ---- against vlr's own standings. Several Challengers weekends crowned
    # nobody: vlr lists every side that went through as joint first.
    firsts = {s['teamId'] for s in ev.get('standings', []) if s['place'] == 1}
    if firsts and places and places[0][0] not in firsts:
        problems.append(f'冠军对不上：图里是 {names.get(places[0][0])}，vlr 第一名是 '
                        + '、'.join(s['name'] for s in ev['standings'] if s['place'] == 1))
    return out, problems, notes


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--matches', default=os.path.join(DATA, 'history_matches.json'))
    ap.add_argument('--out', default=os.path.join(DATA, 'circuit.json'))
    ap.add_argument('--years', default='2021,2022')
    ap.add_argument('--show', default='')
    a = ap.parse_args()
    years_wanted = {int(y) for y in a.years.split(',') if y}
    with open(os.path.join(DATA, 'history.json'), encoding='utf-8') as f:
        history = json.load(f)
    with open(a.matches, encoding='utf-8') as f:
        all_matches = json.load(f)
    by_name, by_year = team_index(history)

    years: dict[str, list] = collections.defaultdict(list)
    report = collections.Counter()
    notes = collections.Counter()
    bad: list[tuple[str, list[str]]] = []
    for eid in sorted(all_matches, key=int):
        ev = history[eid]
        if ev['year'] not in years_wanted:
            continue
        if THIRD_PARTY.search(ev['name']):
            report['第三方赛事，跳过'] += 1
            continue
        if not all_matches[eid]:
            report['没有比赛记录'] += 1
            continue
        out, problems, n = infer_event(ev, all_matches[eid], by_name, by_year)
        # a Challengers League split that opens in November is the next
        # year's format, played early; it is not this season's event
        if out['end'] is not None and out['end'] > 363:
            report['跨年赛事（属于下一年的赛制），跳过'] += 1
            continue
        notes.update(n)
        years[str(ev['year'])].append(out)
        report['收录'] += 1
        if problems:
            bad.append((eid, problems))
        if out['stage'] is None and out['region'] != 'China':
            report['赛段没认出来'] += 1
        for u in out['units']:
            report[{'rr': '循环赛阶段', 'bracket': '淘汰赛阶段', 'open': '海选阶段（只存结果）'}[u['type']]] += 1

    for evs in years.values():
        evs.sort(key=lambda e: (e['start'] if e['start'] is not None else 999, e['id']))
    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(years, f, ensure_ascii=False, separators=(',', ':'))

    print(f'写入 {a.out}（{os.path.getsize(a.out) // 1024} KB）')
    for y, evs in sorted(years.items()):
        nodes = sum(len(u.get('nodes', [])) for e in evs for u in e['units'])
        print(f'  {y}：{len(evs)} 场赛事 · 正赛 {nodes} 场对局')
    print('  ' + ' · '.join(f'{k} {v}' for k, v in report.items()))
    if notes:
        print('  原始数据里的情况：' + ' · '.join(f'{k} {v}' for k, v in notes.items()))
    if bad:
        print(f'\n  有问题的赛事 {len(bad)} 场：')
        for eid, probs in bad[:25]:
            print(f'    {eid} {history[eid]["name"][:56]}')
            for p in probs[:4]:
                print(f'      · {p}')

    for eid in [x for x in a.show.split(',') if x]:
        e = next((e for evs in years.values() for e in evs if e['id'] == eid), None)
        if not e:
            continue
        print(f'\n=== {eid} {e["cn"]}（{e["name"]}）region={e["region"]} stage={e["stage"]} 第 {e["start"]}–{e["end"]} 天')
        print(f'    外部种子 {len(e["seeds"])}：{e["seeds"][:20]}')
        for ui, u in enumerate(e['units']):
            if u['type'] == 'open':
                print(f'  [{ui}] {u["label"]} · open · {u["size"]} 队 · 第 {u["first"]}–{u["last"]} 天 · 前八 {u["ranked"][:8]}')
                continue
            print(f'  [{ui}] {u["label"]} · {u["type"]} · {u["size"]} 队 · {len(u["nodes"])} 场')
            for ni, nd in enumerate(u['nodes'][:40]):
                print(f'      {ni:>2} d{nd["day"]} {nd["round"]:<14} BO{nd["bo"]} {str(nd["a"]):<14} vs {str(nd["b"]):<14} → {e["names"].get(nd["winner"], nd["winner"])}')
        print('    名次：', [(e['names'].get(t, t), p) for t, p in e['places'][:12]])
    return 0


if __name__ == '__main__':
    sys.exit(main())
