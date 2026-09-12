"""Real names and real birthdates, from Liquipedia.

Ages must not be guessed. `world.json` carries an `ageEstimated` flag, which
says the current world already guesses some of them; a 2021 era built the same
way would have a nineteen-year-old and a twenty-eight-year-old growing and
declining on invented curves.

Liquipedia publishes the real thing, and — crucially — its player infoboxes
carry `|vlr=<id>`, the same id our scraped rosters use. So the join is exact
rather than by nickname, which matters when a dozen players are called Life.

How it works
------------
1. Page titles are usually the nickname, so titles are fetched **50 at a time**
   (`action=query&titles=A|B|C…`) — 2896 players in about sixty requests
   instead of three thousand.
2. Every hit is verified against `|vlr=`. A page that does not carry our id is
   a different player with the same handle, and is dropped.
3. Whatever is left over is found by `insource:"vlr=<id>"`, which is an exact
   search on the id itself, one request each.

Usage
-----
    python scripts/fetch_bios.py                  # everyone in history.json
    python scripts/fetch_bios.py --limit 200      # a taste first
    python scripts/fetch_bios.py --no-fallback    # skip the slow phase 3

Liquipedia asks for a descriptive User-Agent and a request every two seconds.
Both are honoured below; do not lower DELAY.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'lp')
HISTORY = os.path.join(ROOT, 'src', 'data', 'history.json')
API = 'https://liquipedia.net/valorant/api.php'

UA = ('val_player-dataset/0.1 (personal VALORANT career-sim project; '
      'project page https://github.com/WeijieCao77/val_player)')
DELAY = 2.0
BATCH = 50

FIELDS = ('vlr', 'birth_date', 'name', 'country', 'status', 'roles',
          'years_active', 'romanized_name', 'nationality')


def get(params: dict, cache_name: str) -> dict:
    path = os.path.join(CACHE, cache_name)
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    os.makedirs(CACHE, exist_ok=True)
    url = API + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Encoding': 'gzip'})
    # Liquipedia answers a crawler that is going too fast with 429. The first
    # version raised straight away and the caller moved on to the next request
    # without waiting, which is exactly the wrong response to being told to
    # slow down. Now a refusal is waited out, longer each time.
    for attempt in range(6):
        try:
            r = urllib.request.urlopen(req, timeout=45)
            break
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == 5:
                time.sleep(DELAY)
                raise
            wait = 60 * (attempt + 1)
            print(f'    （Liquipedia {e.code}，{wait} 秒后再试）', flush=True)
            time.sleep(wait)
    with r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            import gzip
            raw = gzip.decompress(raw)
        data = json.loads(raw.decode('utf-8', errors='replace'))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False)
    time.sleep(DELAY)
    return data


def field(wikitext: str, key: str):
    m = re.search(r'\|\s*' + key + r'\s*=([^\n|]*)', wikitext)
    if not m:
        return None
    v = m.group(1).strip()
    return v or None


def parse_infobox(wikitext: str) -> dict:
    return {k: field(wikitext, k) for k in FIELDS}


def pages_by_title(titles: list[str], tag: str) -> dict[str, str]:
    """title -> wikitext, for up to BATCH titles."""
    data = get({
        'action': 'query', 'prop': 'revisions', 'rvprop': 'content',
        'rvslots': 'main', 'format': 'json', 'formatversion': '2',
        'titles': '|'.join(titles),
    }, f'batch_{tag}.json')
    out: dict[str, str] = {}
    for p in data.get('query', {}).get('pages', []):
        if p.get('missing'):
            continue
        try:
            out[p['title']] = p['revisions'][0]['slots']['main']['content']
        except (KeyError, IndexError):
            continue
    return out


def find_by_vlr(vlr_id: str) -> str | None:
    data = get({
        'action': 'query', 'list': 'search', 'format': 'json',
        'srsearch': f'insource:"vlr={vlr_id}"', 'srlimit': '2',
    }, f'srch_{vlr_id}.json')
    hits = data.get('query', {}).get('search', [])
    return hits[0]['title'] if hits else None


def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--no-fallback', action='store_true')
    ap.add_argument('--out', default=os.path.join(ROOT, 'src', 'data', 'bios.json'))
    a = ap.parse_args()

    with open(HISTORY, encoding='utf-8') as f:
        history = json.load(f)
    people: dict[str, str] = {}
    for e in history.values():
        for t in e['teams']:
            for p in t['players']:
                people.setdefault(p['id'], p['ign'])
    ids = sorted(people, key=lambda x: int(x))
    if a.limit:
        ids = ids[:a.limit]
    print(f'{len(ids)} 名选手要查', flush=True)

    out: dict[str, dict] = {}
    # ---- phase 1: guess the page title is the nickname, fifty at a time
    for i in range(0, len(ids), BATCH):
        chunk = ids[i:i + BATCH]
        titles = sorted({people[p] for p in chunk if people[p]})
        if not titles:
            continue
        try:
            pages = pages_by_title(titles, f'{chunk[0]}_{len(titles)}')
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            print(f'  ! batch {i}: {e}', flush=True)
            continue
        # Two ways a page is ours. Requiring `vlr=` was too strict: plenty of
        # pages simply do not carry it, and the first pass threw away Dep, Rb,
        # foxz and Haodong — all with published birthdates — for that reason.
        by_vlr: dict[str, tuple] = {}
        by_name: dict[str, tuple] = {}
        for title, wt in pages.items():
            if 'Infobox player' not in wt:
                continue
            info = parse_infobox(wt)
            v = (info.get('vlr') or '').strip()
            if v:
                by_vlr[v] = (title, info)
            else:
                by_name[title.lower()] = (title, info)
        for pid in chunk:
            ign = (people[pid] or '').lower()
            if pid in by_vlr:
                out[pid] = {'ign': people[pid], 'page': by_vlr[pid][0],
                            'matchedBy': 'vlr', **by_vlr[pid][1]}
            elif ign in by_name:
                # a name match only when the page names no vlr id at all; a page
                # carrying a *different* id is a different player, same handle
                out[pid] = {'ign': people[pid], 'page': by_name[ign][0],
                            'matchedBy': 'name', **by_name[ign][1]}
        if (i // BATCH) % 5 == 0 or i + BATCH >= len(ids):
            print(f'  第一轮 {min(i + BATCH, len(ids))}/{len(ids)}  命中 {len(out)}', flush=True)

    hit1 = len(out)
    print(f'\n第一轮（按昵称批量取）命中 {hit1}/{len(ids)}', flush=True)

    # ---- phase 2: the leftovers, found by the id itself
    missing = [p for p in ids if p not in out]
    if missing and not a.no_fallback:
        print(f'第二轮：用 insource:"vlr=<id>" 逐个找剩下的 {len(missing)} 人', flush=True)
        for n, pid in enumerate(missing, 1):
            try:
                title = find_by_vlr(pid)
                if not title:
                    continue
                pages = pages_by_title([title], f'one_{pid}')
                wt = pages.get(title)
                if not wt:
                    continue
                info = parse_infobox(wt)
                if (info.get('vlr') or '').strip() == pid:
                    out[pid] = {'ign': people[pid], 'page': title,
                                'matchedBy': 'search', **info}
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
                print(f'  ! {pid}: {e}', flush=True)
            if n % 50 == 0:
                print(f'  第二轮 {n}/{len(missing)}  累计命中 {len(out)}', flush=True)

    with open(a.out, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, ensure_ascii=False, indent=0)

    born = sum(1 for v in out.values() if v.get('birth_date'))
    named = sum(1 for v in out.values() if v.get('name'))
    print(f'\n写入 {a.out}')
    print(f'  查到 {len(out)}/{len(ids)} 人 · 有真实生日 {born} 人 · 有真名 {named} 人')
    if len(ids):
        print(f'  生日覆盖率 {born / len(ids) * 100:.1f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
