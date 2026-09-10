"""How every seat at every partnered-era international was really won — 2023 to 2025 — and what the points paid.

build_routes.py did this for the open era. From 2023 the grammar is different
and smaller: a seat at Masters or Champions came from a league's own event
(「Americas Stage 1 (#2)」), from a league's championship points
(「EMEA Points (#3)」), from a Last Chance Qualifier, or it was a partnership
and history keeps it. 2023 had two paths of its own: EMEA's three Champions
places went to the three best-placed EMEA sides at Masters Tokyo, and each
league's Last Chance Qualifier took the league's sides not already through.

Sources, all from pages fetch_lp_events.py already cached:

  * team cards — the label under each side is the reason it was there
  * Qualification tabs — for the three events whose cards are incomplete
    (Masters Tokyo 2023, Champions 2023, Masters Bangkok 2025). A row names
    its feeder and how many places it sent; the places go to that feeder's
    real top of the table, so no team-template alias ever has to be read
  * Championship Points tabs, 2024 and 2025 — what each placing paid, and the
    match-win, group-win and bye points on top

It then adds history up on paper: every league side's real points for the
year, from the real placings and the real match results, and holds them
against Liquipedia's own verdict — the sides it marks as through on points
must be exactly the top of our table among those not already through.

    python scripts/build_routes_partnered.py

Output: src/data/routes_partnered.json (read beside routes.json by engine/circuit.ts)
"""
from __future__ import annotations

import collections
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'src', 'data')
YEARS = ('2023', '2024', '2025')
LEAGUES = ('Americas', 'EMEA', 'Pacific', 'China')
POOL_REGIONS = {
    'Americas': ['North America', 'Brazil', 'LATAM'],
    'EMEA': ['Europe', 'Turkey', 'CIS', 'MENA'],
    'Pacific': ['Korea', 'Japan', 'SEA', 'Malaysia & Singapore', 'Indonesia', 'Thailand', 'Philippines', 'Vietnam',
                'Hong Kong & Taiwan', 'South Asia', 'Oceania'],
    'China': ['China'],
}
L = r'(Americas|EMEA|Pacific|China)'
KEEP = re.compile(r'Partner Team|Replacement Invite|Invited|^Ascension|^Act \d|Preliminary|Gauntlet', re.I)
# 2024's tables say 「Match Victory」 without saying which matches. Counting every
# match win, playoffs included, reproduces who went through on points in three
# of the four leagues; group-stage wins alone, two
WIN_MODE = os.environ.get('WIN_MODE', 'all')
HIDDEN = os.environ.get('HIDDEN', 'tie')
STAGE_OF = {'Kickoff': 'kickoff', 'Stage 1': 'stage1', 'Stage 2': 'stage2', 'League': 'stage1', 'LCQ': 'lcq'}


def norm(s: str | None) -> str:
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def cached_pages() -> dict[str, str]:
    out = {}
    for f in glob.glob(os.path.join(ROOT, '.cache', 'lp', 'events_*.json')):
        with open(f, encoding='utf-8') as fh:
            for p in json.load(fh).get('query', {}).get('pages', []):
                if not p.get('missing') and p.get('revisions'):
                    out[p['title']] = p['revisions'][0]['slots']['main']['content']
    return out


def sides(e: dict) -> set[str]:
    out = {s for s in e['seeds'] if not s.startswith('N:')}
    for u in e['units']:
        for nd in u.get('nodes', []):
            out |= {t for t in nd['teams'] if not t.startswith('N:')}
    return out


class Book:
    def __init__(self, circuit: dict):
        self.circuit = circuit

    def find(self, year: str, stage: str, region: str | None, name: str | None = None) -> dict | None:
        hits = [e for e in self.circuit.get(year, [])
                if e['stage'] == stage and e['region'] == region and not e.get('scene')
                and (name is None or re.search(name, e['name']))]
        if stage == 'stage1' and year == '2023' and region == 'China':
            hits = [e for e in hits if 'Qualifier' in e['name']]
        return hits[0] if len(hits) == 1 else None

    def for_title(self, title: str) -> dict | None:
        m = re.match(r'VCT/(\d{4})/(.+)$', title)
        if not m:
            return None
        year, rest = m.groups()
        if rest == 'Champions':
            return self.find(year, 'champions', None)
        if rest == 'Masters' and year == '2023':
            return self.find(year, 'masters1', None)
        mm = re.match(r'^Stage (\d)/Masters$', rest)
        if mm:
            return self.find(year, f'masters{mm.group(1)}', None)
        if rest.startswith('LOCK IN'):
            return self.find(year, 'kickoff', None, 'LOCK//IN')
        if rest == 'China' and year == '2023':
            return self.find(year, 'stage1', 'China', 'Champions China Qualifier')
        mm = re.match(rf'^{L} League/Last Chance Qualifier$', rest)
        if mm:
            return self.find(year, 'lcq', mm.group(1))
        mm = re.match(rf'^{L} League/Kickoff$', rest)
        if mm:
            return self.find(year, 'kickoff', mm.group(1))
        mm = re.match(rf'^{L} League/Stage[ _](\d)$', rest)
        if mm:
            return self.find(year, f'stage{mm.group(2)}', mm.group(1))
        mm = re.match(rf'^{L} League$', rest)
        if mm and year == '2023':
            return self.find(year, 'stage1', mm.group(1))
        return None


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    circuit = json.load(open(os.path.join(DATA, 'circuit.json'), encoding='utf-8'))
    lp = json.load(open(os.path.join(DATA, 'lp_events.json'), encoding='utf-8'))
    history = json.load(open(os.path.join(DATA, 'history.json'), encoding='utf-8'))
    timeline = json.load(open(os.path.join(DATA, 'timeline.json'), encoding='utf-8'))
    stats_path = os.path.join(DATA, 'stats_history.json')
    stats = json.load(open(stats_path, encoding='utf-8')) if os.path.exists(stats_path) else {}
    pages = cached_pages()
    book = Book(circuit)
    report = collections.Counter()
    problems: list[str] = []

    ign_of: dict[str, str] = {}
    for ev in history.values():
        for t in ev.get('teams', []):
            for p in t.get('players', []):
                ign_of.setdefault(p['id'], p['ign'])
    for ev in stats.values():
        for r in ev.get('rows', []):
            if r.get('ign'):
                ign_of.setdefault(r['id'], r['ign'])

    league_of: dict[str, dict[str, str]] = {
        y: {tid: c['l'] for tid, c in timeline['years'][y]['clubs'].items() if c['l']} for y in YEARS}
    by_id = {e['id']: e for y in YEARS for e in circuit[y]}

    def real_order(e: dict) -> list[str]:
        return [t for t, _ in e['places'] if not t.startswith('N:')]

    out_events: dict[str, dict] = {}

    # ---- 1. team cards
    def card_side(e: dict, card: dict) -> str | None:
        igns = {norm(p) for p in card.get('players', [])}
        best, best_n = None, 1
        for tid, ids in (e.get('rosters') or {}).items():
            n = len(igns & {norm(ign_of.get(pid)) for pid in ids})
            if n > best_n:
                best, best_n = tid, n
        if best:
            return best
        cn = norm(card['team'])
        for tid, nm in e['names'].items():
            k = norm(nm)
            if k and (k == cn or (min(len(k), len(cn)) >= 3 and (cn in k or k in cn))):
                return tid
        return None

    def label_route(label: str, e: dict, year: str) -> dict:
        s = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]*)\]\]', r'\1', label or '').strip()
        if not s or KEEP.search(s):
            return {'kind': 'keep'}
        m = re.match(rf'^{L} (Kickoff|Stage 1|Stage 2|League|LCQ)(?: \(#(\d+)\))?$', s)
        if m:
            feeder = book.find(year, STAGE_OF[m.group(2)], m.group(1))
            if not feeder:
                return {'kind': 'keep', 'why': 'feeder not found: ' + s}
            if e['stage'] == 'lcq' and m.group(2) == 'League':
                return {'kind': 'rest', 'event': feeder['id']}
            if m.group(2) == 'LCQ':
                return {'kind': 'top', 'event': feeder['id']}
            return {'kind': 'top', 'event': feeder['id']}
        m = re.match(rf'^{L} Points(?: \(#(\d+)\))?$', s)
        if m:
            return {'kind': 'points', 'pool': m.group(1), 'rank': int(m.group(2)) if m.group(2) else None}
        report['没解析的资格说明'] += 1
        problems.append(f'{year} {e["cn"]}：没解析的资格说明「{s}」')
        return {'kind': 'keep', 'why': 'unparsed: ' + s}

    for title, v in lp.items():
        if not re.search(r'/(2023|2024|2025)/', title):
            continue
        e = book.for_title(title)
        if not e or not v.get('teams'):
            continue
        year = str(e['start'] is not None and next(y for y in YEARS if e in circuit[y]))
        routes: dict[str, dict] = {}
        for card in v['teams']:
            tid = card_side(e, card)
            if not tid:
                report['队卡没配上队'] += 1
                continue
            if tid not in e['seeds']:
                continue
            routes[tid] = label_route(card.get('qualifier') or '', e, year)
        if routes:
            out_events.setdefault(e['id'], {'lp': title, 'routes': {}})['routes'].update(routes)
            report['队卡给出来路的赛事'] += 1

    # ---- 2. Qualification tabs: a feeder and how many places it sent
    def qual_rows(text: str) -> list[tuple[str, str | None, int]]:
        rows = []
        region = None
        for row in re.split(r'\n\|-', text):
            icon = re.search(r'LeagueIconSmall/vct (americas|emea|pacific|china)', row)
            if re.search(r'^\s*\|\s*rowspan', row, re.M) or (icon and row.strip().startswith('\n| {{LeagueIcon')):
                region = {'americas': 'Americas', 'emea': 'EMEA', 'pacific': 'Pacific', 'china': 'China'}[icon.group(1)] if icon else region
            link = re.search(r'\[\[(VCT/\d{4}/[^|\]#]+)', row)
            if not link:
                continue
            cells = [c for c in row.split('\n|') if c.strip()]
            first = next((c for c in cells if '{{Team|' in c), '')
            n = len(re.findall(r'\{\{Team\|', first))
            if not n:
                continue
            target = link.group(1).replace('_', ' ')
            if 'China' in target and not icon:
                region = 'China'
            if icon and not re.search(r'rowspan', row):
                region = {'americas': 'Americas', 'emea': 'EMEA', 'pacific': 'Pacific', 'china': 'China'}[icon.group(1)]
            rows.append((target, region, n))
        return rows

    for title in ('VCT/2023/Masters/Qualification', 'VCT/2023/Champions/Qualification', 'VCT/2025/Stage 1/Masters/Qualification'):
        e = book.for_title(title.rsplit('/Qualification', 1)[0])
        text = pages.get(title, '')
        if not e or not text:
            problems.append(f'{title}：没有缓存或没对上赛事')
            continue
        year = next(y for y in YEARS if e in circuit[y])
        start = text.find('=Qualification=')
        table = text[start:text.find('\n|}', start)]
        got = out_events.setdefault(e['id'], {'lp': title, 'routes': {}})['routes']
        for target, region, n in qual_rows(table):
            feeder = book.for_title(target)
            if not feeder:
                problems.append(f'{title}：来源页 {target} 没对上赛事')
                continue
            among = region if feeder['region'] is None else None
            order = [t for t in real_order(feeder) if among is None or league_of[year].get(t) == among]
            taken = [t for t in order if t in e['seeds']][:n]
            for t in taken:
                if got.get(t, {}).get('kind') in (None, 'keep'):
                    got[t] = {'kind': 'top', 'event': feeder['id'], **({'league': among} if among else {})}
            report['资格表给出来路的名额'] += len(taken)
            if len(taken) < n:
                problems.append(f'{title}：{target} 应送 {n} 队，对上 {len(taken)}')

    # Pacific's 2023 LCQ has no cards: its field is the league's sides not already through
    for lg in ('Americas', 'EMEA', 'Pacific'):
        lcq = book.find('2023', 'lcq', lg)
        league = book.find('2023', 'stage1', lg)
        if not lcq or not league:
            continue
        got = out_events.setdefault(lcq['id'], {'lp': f'VCT/2023/{lg} League/Last Chance Qualifier', 'routes': {}})['routes']
        for s in lcq['seeds']:
            if not s.startswith('N:') and got.get(s, {}).get('kind') in (None, 'keep'):
                got[s] = {'kind': 'rest', 'event': league['id']}

    # k: among the seats one feeder sent, the order its real table had them in
    for eid, info in out_events.items():
        groups = collections.defaultdict(list)
        for tid, r in info['routes'].items():
            if r['kind'] in ('top', 'rest'):
                groups[(r['kind'], r['event'], r.get('league'))].append(tid)
        for (kind, feeder, _), tids in groups.items():
            order = real_order(by_id[feeder])
            tids.sort(key=lambda t: order.index(t) if t in order else 999)
            for k, t in enumerate(tids):
                info['routes'][t]['k'] = k

    # ---- 3. championship points, 2024 and 2025
    def plain(c: str) -> str:
        if 'Champions logo' in c:
            return 'CHAMPS'
        c = re.sub(r'\{\{Placement\|([^}]*)\}\}', r'#\1', c)
        c = re.sub(r"\[\[(?:[^\]|]*\|)?([^\]]*)\]\]|'''|\{\{[^}]*\}\}", r'\1', c)
        return re.sub(r'<[^>]+>|style="[^"]*"\|?|width="?\d+px"?\|', '', c).strip()

    def places_of(e: dict) -> dict[str, int]:
        return {t: p for t, p in e['places']}

    def is_playoffs(u: dict) -> bool:
        return bool(re.search(r'Playoff|季后赛|Main Event|正赛', (u.get('phase') or '') + u['label']))

    def bonus(e: dict, rules: dict) -> collections.Counter:
        """Real match-win, group-win and bye points at one event."""
        pts = collections.Counter()
        for u in e['units']:
            nodes = u.get('nodes', [])
            if not nodes:
                continue
            wins = collections.Counter(nd['winner'] for nd in nodes if nd['winner'])
            where = rules.get('winsIn', 'groups')
            if is_playoffs(u):
                if rules.get('wins') and where in ('playoffs', 'all'):
                    for t, n in wins.items():
                        pts[t] += n * rules['wins']
                if rules.get('bye'):
                    for nd in nodes:
                        kinds = (nd['a'][0], nd['b'][0])
                        if '胜者组' in nd['round'] and set(kinds) & {'g', 's'} and set(kinds) & {'w', 'l'}:
                            pts[nd['teams'][0] if nd['a'][0] in 'gs' else nd['teams'][1]] += rules['bye']
                continue
            if rules.get('wins') and where in ('groups', 'all'):
                for t, n in wins.items():
                    pts[t] += n * rules['wins']
            if rules.get('groupWin'):
                # the groups are the match graph's connected parts
                adj = collections.defaultdict(set)
                for nd in nodes:
                    a, b = nd['teams']
                    adj[a].add(b)
                    adj[b].add(a)
                seen: set[str] = set()
                for start in list(adj):
                    if start in seen:
                        continue
                    comp, stack = [], [start]
                    while stack:
                        x = stack.pop()
                        if x in seen:
                            continue
                        seen.add(x)
                        comp.append(x)
                        stack.extend(adj[x] - seen)
                    diff = collections.Counter()
                    for nd in nodes:
                        a, b = nd['teams']
                        sa, sb = nd['score']
                        if a in comp and sa is not None and sb is not None:
                            diff[a] += sa - sb
                            diff[b] += sb - sa
                    top = max(comp, key=lambda t: (wins[t], diff[t]))
                    pts[top] += rules['groupWin']
        return pts

    pools_out: dict[str, dict] = {}
    for year in ('2024', '2025'):
        for lg in LEAGUES:
            title = f'VCT/{year}/Championship Points/{lg}'
            text = pages.get(title, '')
            i = text.find('==Points')
            if i < 0:
                problems.append(f'{title}：没有缓存')
                continue
            table = text[i:text.find('|}', i)]
            header = [plain(x) for x in re.findall(r'^\|(\{\{Placement[^\n]*|width[^\n]*)$', table, re.M)]
            pool_events: list[str] = []
            k_direct = 0
            for block in table.split('\n|-')[1:]:
                lines = [ln for ln in block.split('\n') if ln.strip()]
                # the icon in front links to the event's page, 「Stage_1/Masters」: read only the name after it
                label = next((plain(re.sub(r'\[\[File:[^\]]*\]\]', '', ln.split('|', 2)[-1])) for ln in lines
                              if 'text-align:left' in ln), '')
                cells = next((ln for ln in lines if ln.startswith('|') and '||' in ln), None)
                if not label or not cells:
                    continue
                vals = [plain(c) for c in cells.lstrip('|').split('||')]
                mm = re.search(r'Masters (\w+)|(Kickoff|Stage 1|Stage 2)', label)
                if not mm:
                    continue
                if mm.group(1):
                    e = next((x for x in circuit[year] if x['stage'].startswith('masters') and mm.group(1) in x['name']), None)
                else:
                    e = book.find(year, STAGE_OF[mm.group(2)], lg)
                if not e:
                    problems.append(f'{title}：「{label}」没对上赛事')
                    continue
                rules = out_events.setdefault(e['id'], {'lp': title, 'routes': {}})
                award: dict[str, int] = {}
                for h, v in zip(header, vals):
                    pm = re.match(r'^#(\d+)(?:-(\d+))?$', h)
                    if pm and v.isdigit():
                        for pl in range(int(pm.group(1)), int(pm.group(2) or pm.group(1)) + 1):
                            award[str(pl)] = int(v)
                    elif re.search(r'Match ?Victory', h) and v.isdigit():
                        rules['wins'] = int(v)
                        # 2025 says 「Regular Season」; 2024 does not say which matches
                        rules['winsIn'] = 'groups' if re.search(r'Regular Season', h) else WIN_MODE
                    elif re.search(r'Group ?Victory', h) and v.isdigit():
                        rules['groupWin'] = int(v)
                    elif re.search(r'Bye', h) and v.isdigit():
                        rules['bye'] = int(v)
                if award:
                    rules['award'] = {**rules.get('award', {}), **award}
                pool_events.append(e['id'])
                if mm.group(2) == 'Stage 2':
                    k_direct = sum(1 for v in vals if v == 'CHAMPS')
            # history on paper: every league side's real points
            members = [t for t, l in league_of[year].items() if l == lg]
            total = collections.Counter({t: 0 for t in members})
            for eid in pool_events:
                e = by_id[eid]
                rules = out_events[eid]
                pl = places_of(e)
                for t in members:
                    if t in pl:
                        total[t] += rules.get('award', {}).get(str(pl[t]), 0)
                for t, v in bonus(e, rules).items():
                    if t in total:
                        total[t] += v
            names = timeline['years'][year]['clubs']

            def same(a: str, b: str) -> bool:
                x, y = norm(a), norm(b)
                return bool(x and y) and (x == y or (min(len(x), len(y)) >= 3 and (x in y or y in x)))
            # hidden points: what Liquipedia records that no placing or result explains
            hidden = collections.Counter()
            for line in re.findall(r'^\|team\d+=\{\{RankingsTableRow\|(.*)$', text, re.M):
                name = line.split('|', 1)[0].strip()
                t = next((t for t in members if same(name, names[t]['n'])), None)
                for _col, v in re.findall(r'hiddenpoints(\d)=(\d+)', line):
                    if t:
                        hidden[t] += int(v)
            for t, v in hidden.items():
                if HIDDEN == '1':
                    total[t] += v
            # Liquipedia's hidden points order sides level on points; they are not points
            # the tiebreaks as each page writes them: 2025 Americas goes to head-to-head
            # first; the other leagues to the last event's standings, then the one before.
            # 2024 writes none down; the same chain puts TALON over Team Secret and BLG
            # over DRG, as it went. Liquipedia's hidden ordering settles whatever is left
            places_by = {by_id[eid]['stage']: places_of(by_id[eid]) for eid in pool_events}
            chain = ['stage2', 'masters2', 'stage1', 'masters1', 'kickoff']

            def h2h(t: str) -> int:
                tied = {u for u in members if total[u] == total[t]}
                if len(tied) < 2:
                    return 0
                score = 0
                for eid in pool_events:
                    for u in by_id[eid]['units']:
                        for nd in u.get('nodes', []):
                            a, b = nd['teams']
                            if nd['winner'] and t in (a, b) and a in tied and b in tied:
                                score += 1 if nd['winner'] == t else -1
                return score

            def tiebreak(t: str) -> tuple:
                first = -h2h(t) if (year, lg) == ('2025', 'Americas') else 0
                later = [places_by.get(k, {}).get(t, 99) for k in chain]
                return (-total[t], first, *later, -hidden[t] if HIDDEN == 'tie' else 0)
            standings = sorted(members, key=tiebreak)
            pools_out.setdefault(year, {})[lg] = {
                'league': lg, 'regions': POOL_REGIONS[lg], 'events': pool_events,
                'standings': [{'team': t, 'rank': i + 1, 'total': total[t]} for i, t in enumerate(standings)],
            }
            # the verdict: the Champions cards say who went through on this pool's points,
            # and the real Stage 2 table says who went straight through before them
            champs = book.find(year, 'champions', None)
            croutes = out_events.get(champs['id'], {}).get('routes', {}) if champs else {}
            up = {t for t, r in croutes.items() if r['kind'] == 'points' and r.get('pool') == lg}
            stage2 = book.find(year, 'stage2', lg)
            direct = set(real_order(stage2)[:k_direct]) if stage2 else set()
            ours = [t for t in standings if t not in direct][:len(up)]
            line = (f'  {year} {lg} 积分前六：' + ' · '.join(f'{names[t]["n"]} {total[t]}' for t in standings[:6])
                    + f'（直通 {"、".join(names[t]["n"] for t in direct)}；积分晋级 {"、".join(sorted(names[t]["n"] for t in up)) or "—"}）')
            print(line)
            if set(ours) != up:
                problems.append(f'{year} {lg} 积分：真实积分晋级 {sorted(names[t]["n"] for t in up)}，'
                                f'按真实成绩算出来是 {[(names[t]["n"], total[t]) for t in ours]}')
                for t in standings[:8]:
                    parts = []
                    for eid in pool_events:
                        e = by_id[eid]
                        pl = places_of(e).get(t)
                        a = out_events[eid].get('award', {}).get(str(pl), 0) if pl else 0
                        b = bonus(e, out_events[eid]).get(t, 0)
                        parts.append(f'{e["cn"][-6:]} 名次{pl}→{a}+{b}')
                    print(f'      {names[t]["n"]} {total[t]}（隐藏 {hidden[t]}）：' + ' | '.join(parts))
            else:
                report['积分晋级和真实一致的联赛'] += 1

    # ---- 4. what is still without a road
    for y in YEARS:
        for e in circuit[y]:
            if e['region'] is None and e['stage'] in ('masters1', 'masters2', 'champions') or e['stage'] == 'lcq' and not e.get('scene'):
                routes = out_events.get(e['id'], {}).get('routes', {})
                seeds = [s for s in e['seeds'] if not s.startswith('N:')]
                kinds = collections.Counter(routes.get(s, {'kind': '无'})['kind'] for s in seeds)
                print(f'  {y} {e["cn"]}：{len(seeds)} 个种子 · ' + ' · '.join(f'{k} {v}' for k, v in kinds.items()))

    out = {'events': out_events, 'pools': pools_out}
    with open(os.path.join(DATA, 'routes_partnered.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    print('写入 src/data/routes_partnered.json')
    for k, v in report.items():
        print(f'  {k}: {v}')
    if problems:
        print(f'  问题 {len(problems)} 条：')
        for p in problems[:40]:
            print('   ', p)
    return 0


if __name__ == '__main__':
    sys.exit(main())
