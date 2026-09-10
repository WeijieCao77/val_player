"""Every match of every event we already have, in the order it was played.

history.json knows who went to each event and who finished where. That is
enough to build a world, not enough to build a season: the formats were not
uniform in 2021 — NA ran double elimination, Berlin ran GSL groups into a
single bracket, Korea ran a round robin — and the author's rule is that the
format is whatever it really was. vlr.gg's `/event/matches/<id>/?series_id=all`
lists every series with its date, its round name, both teams and the score.

From that one page per event the game gets two things at once:

  * **the format** — which round feeds which, rebuilt from who played whom
    (see scripts/build_circuit.py)
  * **what really happened** — the result a side the player never reaches
    keeps, and the line 「真实历史里这场是 X 赢的」 on the ones he does

The list names teams by display name and flag only. The match URL, though,
carries both team slugs (`/12550/envy-vs-gen-g-champions-tour-...`), and
history.json has every participant's slug and id — so ids are recovered from
the slug first and the name second.

    python scripts/fetch_matches.py --ids 333,353       # a taste
    python scripts/fetch_matches.py                     # all 270, ~8 min

Pages are cached under .cache/vlrm/, same crawl manners as fetch_history.py.
"""
from __future__ import annotations

import argparse
import datetime as dt
import html as htmllib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'vlrm')
HISTORY = os.path.join(ROOT, 'src', 'data', 'history.json')
OUT = os.path.join(ROOT, 'src', 'data', 'history_matches.json')

UA = ('val_player-dataset/0.1 (personal VALORANT career-sim project; '
      'contact yankejing711@gmail.com)')
DELAY = 1.5


def fetch(eid: str) -> tuple[str, bool]:
    path = os.path.join(CACHE, f'm{eid}.html')
    if os.path.exists(path) and os.path.getsize(path) > 2000:
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read(), False
    os.makedirs(CACHE, exist_ok=True)
    url = f'https://www.vlr.gg/event/matches/{eid}/?series_id=all'
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        body = r.read().decode('utf-8', errors='replace')
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(body)
    time.sleep(DELAY)
    return body, True


def clean(s: str) -> str:
    return htmllib.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', s))).strip()


TOKEN = re.compile(
    r'<div class="wf-label mod-large">\s*(?P<date>[^<]+?)\s*<'
    r'|<a href="/(?P<mid>\d+)/(?P<slug>[^"]*)" class="wf-module-item match-item(?P<body>.*?)</a>',
    re.S)
SIDE = re.compile(
    r'<div class="match-item-vs-team(?P<win> mod-winner)?\s*">(?P<side>.*?)'
    r'match-item-vs-team-score[^>]*>\s*(?P<score>[^<]*?)\s*</div>', re.S)


def parse_date(label: str) -> str | None:
    # 'Thu, March 11, 2021'
    m = re.search(r'([A-Z][a-z]+) (\d{1,2}), (\d{4})', label)
    if not m:
        return None
    return dt.datetime.strptime(f'{m.group(1)} {m.group(2)} {m.group(3)}', '%B %d %Y').date().isoformat()


def norm(s: str) -> str:
    return re.sub(r'[^a-z0-9]', '', s.lower())


def parse(html: str, event: dict) -> tuple[list[dict], list[str]]:
    teams = event.get('teams', []) + [
        {'id': s['teamId'], 'slug': s['slug'], 'name': s['name']} for s in event.get('standings', [])]
    by_slug = {t['slug']: t['id'] for t in teams if t.get('slug')}
    by_name = {norm(t['name']): t['id'] for t in teams if t.get('name')}
    slugs = sorted(by_slug, key=len, reverse=True)
    unresolved: list[str] = []

    def resolve(name: str, slug_hint: str | None) -> str | None:
        if slug_hint and slug_hint in by_slug:
            return by_slug[slug_hint]
        n = norm(name)
        if n in by_name:
            return by_name[n]
        # display names are often the short form of the listed one: 'ENVY' / 'Team Envy'
        hits = {tid for k, tid in by_name.items() if len(n) >= 3 and (n in k or k in n)}
        return hits.pop() if len(hits) == 1 else None

    out: list[dict] = []
    date = None
    for m in TOKEN.finditer(html):
        if m.group('date'):
            date = parse_date(m.group('date')) or date
            continue
        body = m.group('body')
        sides = SIDE.findall(body)
        if len(sides) != 2:
            continue
        # the slug is '<teamA>-vs-<teamB>-<event slug>-<round>'
        slug = m.group('slug')
        a_slug = b_slug = None
        if '-vs-' in slug:
            left, right = slug.split('-vs-', 1)
            a_slug = left if left in by_slug else None
            b_slug = next((s for s in slugs if right.startswith(s + '-') or right == s), None)
        rec: dict = {'id': m.group('mid'), 'date': date}
        for key, (win, side, score), hint in (('a', sides[0], a_slug), ('b', sides[1], b_slug)):
            name_m = re.search(r'class="text-of">(.*?)</div>', side, re.S)
            flag_m = re.search(r'flag mod-([a-z]+)', side)
            name = clean(name_m.group(1)) if name_m else ''
            tid = resolve(name, hint)
            if tid is None and name and name.upper() != 'TBD':
                unresolved.append(name)
            rec[key] = {'id': tid, 'name': name, 'flag': flag_m.group(1) if flag_m else None,
                        'score': int(score) if score.strip().isdigit() else None}
            if win:
                rec['winner'] = key
        series = re.search(r'match-item-event-series[^>]*>(.*?)</div>', body, re.S)
        ev = re.search(r'match-item-event text-of">(.*?)</div>\s*$', body, re.S)
        rec['series'] = clean(series.group(1)) if series else ''
        stage = clean(ev.group(1)) if ev else ''
        rec['stage'] = stage.replace(rec['series'], '', 1).strip()
        rec['forfeit'] = 'mod-forfeit' in body or 'Forfeit' in body
        out.append(rec)
    return out, unresolved


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--ids', default='')
    ap.add_argument('--out', default=OUT)
    a = ap.parse_args()
    with open(HISTORY, encoding='utf-8') as f:
        history = json.load(f)
    ids = [i for i in a.ids.split(',') if i] or sorted(history, key=int)

    result: dict = {}
    fresh = 0
    bad: dict[str, list[str]] = {}
    for n, eid in enumerate(ids, 1):
        try:
            html, new = fetch(eid)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f'  ! {eid}: {e}', flush=True)
            continue
        fresh += new
        matches, unresolved = parse(html, history[eid])
        result[eid] = matches
        if unresolved:
            bad[eid] = sorted(set(unresolved))
        if n % 20 == 0 or n == len(ids):
            print(f'  {n}/{len(ids)}  新抓 {fresh}', flush=True)

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(result, f, ensure_ascii=False, separators=(',', ':'))
    total = sum(len(v) for v in result.values())
    no_winner = sum(1 for v in result.values() for m in v if 'winner' not in m)
    print(f'\n写入 {a.out}：{len(result)} 场赛事 · {total} 场比赛 · 没有胜者标记的 {no_winner} 场')
    if bad:
        print(f'  队名对不上 id 的赛事 {len(bad)} 场：')
        for eid, names in list(bad.items())[:15]:
            print(f'    {eid} {history[eid]["name"][:50]}：{names[:6]}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
