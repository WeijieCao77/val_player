"""Read-only nationality audit; print safe, field-scoped candidates as JSON.

A fix requires a reproduced name-prefix bug AND independent VLR roster flags
for that exact player ID which unanimously name the decoded country. Missing
or disagreeing sources stay in review; never guess from IGN or club region.
"""
import json
from collections import defaultdict
from pathlib import Path

from player_countries import country_code

DATA = Path(__file__).resolve().parents[1] / 'src' / 'data'


def audit():
    def read(name):
        return json.loads((DATA / name).read_text(encoding='utf-8'))

    bios = read('bios.json')
    flags = defaultdict(set)
    evidence = defaultdict(list)
    for eid, event in read('history.json').items():
        for team in event.get('teams', []):
            for p in team.get('players', []):
                code = country_code(p.get('country'))
                if code:
                    flags[p['id']].add(code)
                    evidence[p['id']].append({'event': eid, 'country': p['country']})
    corrections, uncertain = [], []
    timeline = read('timeline.json')
    rows = [('world_2021.json', p['id'][1:], p, None) for p in read('world_2021.json')['players']]
    rows += [('timeline.json', pid, p, year) for year, y in timeline['years'].items() for pid, p in y['debuts'].items()]
    for file, pid, p, year in rows:
        bio = bios.get(pid, {})
        raw_name = bio.get('country')
        normalized = country_code(raw_name)
        if not isinstance(raw_name, str) or len(raw_name) <= 2 or not normalized:
            continue
        if p.get('nat') != raw_name[:2].lower() or p['nat'] == normalized:
            continue
        row = {'file': file, 'year': year, 'vlr': pid, 'ign': p['ign'], 'from': p['nat'], 'to': normalized,
               'bioCountry': raw_name, 'bioMatchedBy': bio.get('matchedBy'),
               'rosterFlags': sorted(flags[pid]), 'rosterEvidence': evidence[pid][:3]}
        if flags[pid] == {normalized}:
            corrections.append(row)
        else:
            uncertain.append(row)
    return {'scope': {'historicalRows': len(rows), 'uniqueVlrIds': len({r[1] for r in rows})},
            'corrections': corrections, 'needsReview': uncertain}


if __name__ == '__main__':
    print(json.dumps(audit(), ensure_ascii=False, indent=2))
