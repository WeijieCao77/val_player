"""Bounded mechanical biography correction. Dry-run default; --apply writes JSON.

No requests, nickname joins, ratings, nationalities, teams, or roster changes.
An existing manifest prevents accidental loss of the original migration guards.
"""
import argparse
import json
from pathlib import Path
from datetime import date
from fetch_bios import normalized_birth

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'src' / 'data'
EVENT_IDS = '1879 1906 1923 2398 2399 2686 2769 2773 2940 3016 3043'.split()
COLLISION_IDS = '290 2315 2435 4130 5283 5514 8582 9189 9192 9248 9576 10739 11173 11701 14197 14204 14453 14570 14675 17085 17830 20668 23918 24406 25152 25921 38423 38662'.split()
NAMES = {
    '2315': 'Tautvydas Grušauskas', '2435': 'Lin Chi-Hung (林奇宏)',
    '4130': 'Seo Hong-seung (서홍승)', '5283': 'Chae Joon-hyuk (채준혁)',
    '5514': 'Mert Çolak', '8582': 'Kittikawin Jirawatkakan',
    '9192': 'Koo Min-jae (구민재)', '9576': 'Petr Vočadlo',
    '10739': 'Hildegard Arnaldo', '14453': 'Huang Jinjie (黄进杰)',
    '14675': 'Anupong Mueangngam', '17830': 'Hoàng Quốc Huy',
    '24406': 'Nguyễn Bá Anh Tuấn', '25152': 'Efren Mayuga',
}


def age_on(birth, year):
    born = date.fromisoformat(birth)
    return year - born.year - ((1, 1) < (born.month, born.day))


def append_bird(apply):
    """One reviewed addendum, preserving every existing manifest guard."""
    paths = {name: DATA / f'{name}.json' for name in ('bios', 'timeline', 'player_bio_fixes')}
    data = {name: json.loads(path.read_text(encoding='utf-8')) for name, path in paths.items()}
    bios, timeline, manifest = (data[n] for n in paths)
    pid = '38423'
    if pid in manifest['players']:
        raise SystemExit('Bird is already in manifest; refusing to overwrite original guards.')
    old_bio = bios[pid]
    old = timeline['years']['2023']['debuts'][pid]
    assert old_bio['matchedBy'] == 'name' and old_bio['name'] == 'Erik Sjösten' and old_bio['birth_date'] == '1995-01-27'
    assert old == {'ign': 'Bird', 'nat': 'un', 'name': 'Erik Sjösten', 'birth': '1995-01-27', 'age': 27, 'est': False}
    source = 'https://www.vlr.gg/player/38423/bird'
    manifest['players'][pid] = {'source': source, 'playerIds': ['V38423', 'Y38423'],
        'oldNames': ['Erik Sjösten'], 'oldBirths': ['1995-01-27'], 'reasons': ['nickname-collision'],
        'name': None, 'birth': None, 'estimated': True,
        'evidence': ['https://www.vlr.gg/player/13/bird', 'https://nip.gl/de/pages/nip-paladins-return-as-nip-valorant']}
    bios[pid] = {'ign': 'Bird', 'page': None, 'matchedBy': 'reviewed-vlr', 'vlr': pid,
        'birth_date': None, 'name': None, 'country': None, 'source': source, 'rejectedPage': 'Bird'}
    manifest['changes'].append({'file': 'bios', 'id': pid, 'field': 'quarantined-biography'})
    for key, value in {'name': None, 'birth': None, 'age': 17, 'est': True}.items():
        manifest['changes'].append({'file': 'timeline', 'id': pid, 'field': key, 'before': old[key], 'after': value})
        old[key] = value
    # 2023 is this ID's first recorded season, whose established debut estimate
    # is 17. It is explicitly an estimate, not a replacement real birthdate.
    assert old['nat'] == 'un'
    print(json.dumps({'id': pid, 'addedManifestPlayers': 1, 'addedChangeEntries': 5,
                      'totalManifestPlayers': len(manifest['players']), 'applied': apply}))
    if apply:
        paths['bios'].write_text(json.dumps(bios, ensure_ascii=False, indent=0), encoding='utf-8')
        paths['timeline'].write_text(json.dumps(timeline, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        paths['player_bio_fixes'].write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--append-bird', action='store_true', help='append only the reviewed V38423 addendum to an existing manifest')
    args = ap.parse_args()
    if args.append_bird:
        append_bird(args.apply)
        return
    target = DATA / 'player_bio_fixes.json'
    if target.exists():
        raise SystemExit('Existing player_bio_fixes.json: refusing to overwrite original migration guards.')
    filenames = ['bios', 'world', 'world_2021', 'timeline', 'prospects']
    original = {n: (DATA / f'{n}.json').read_text(encoding='utf-8') for n in filenames}
    data = {n: json.loads(v) for n, v in original.items()}
    bios = data['bios']
    dossier = json.loads((DATA / 'dossier.json').read_text(encoding='utf-8'))
    stats = json.loads((DATA / 'stats_players.json').read_text(encoding='utf-8'))
    first_year = {pid: min(r['year'] for r in rows) for pid, rows in stats.items() if rows}
    fixes, changes = {}, []

    def fix(pid):
        return fixes.setdefault(pid, {'source': f'https://www.vlr.gg/player/{pid}', 'playerIds': ['V' + pid, 'Y' + pid],
                                      'oldNames': [], 'oldBirths': [], 'reasons': []})

    def set_field(row, key, value, file, pid):
        if row.get(key) != value:
            changes.append({'file': file, 'id': pid, 'field': key, 'before': row.get(key), 'after': value})
            row[key] = value

    rejected = set(EVENT_IDS + COLLISION_IDS)
    for pid in rejected:
        b = bios[pid]
        f = fix(pid)
        f.update(name=NAMES.get(pid), birth=None, estimated=True)
        f['oldNames'].append(b.get('name'))
        f['oldBirths'].append(b.get('birth_date'))
        f['reasons'].append('event-page' if pid in EVENT_IDS else 'nickname-collision')
        # Do not retain someone else's status, roles, country or year of birth.
        bios[pid] = {'ign': b['ign'], 'page': None, 'matchedBy': 'reviewed-vlr', 'vlr': pid,
                     'birth_date': None, 'name': NAMES.get(pid), 'country': None,
                     'source': f['source'], 'rejectedPage': b.get('page')}
        changes.append({'file': 'bios', 'id': pid, 'field': 'quarantined-biography'})

    for pid, b in bios.items():
        if b.get('matchedBy') != 'vlr' or str(b.get('vlr')) != pid:
            continue
        clean = normalized_birth(b.get('birth_date'))
        if clean and clean != b.get('birth_date'):
            set_field(b, 'birth_date', clean, 'bios', pid)

    rows = []
    for source in ['world', 'world_2021']:
        for p in data[source]['players']:
            pid = p['id'][1:] if source == 'world_2021' else dossier['players'].get(p['id'], {}).get('vlr')
            if pid:
                rows.append((source, pid, p, data[source]['meta']['season'], 'realName', 'birth', 'ageEstimated'))
                if pid in fixes and p['id'] not in fixes[pid]['playerIds']:
                    fixes[pid]['playerIds'].append(p['id'])
    for year, y in data['timeline']['years'].items():
        for pid, p in y['debuts'].items():
            rows.append(('timeline', pid, p, int(year), 'name', 'birth', 'est'))
    for p in data['prospects']['players']:
        rows.append(('prospects', p['id'][1:], p, 2027, 'real', 'born', None))

    for source, pid, p, year, name_key, birth_key, est_key in rows:
        prior_name, prior_birth = p.get(name_key), p.get(birth_key)
        b = bios.get(pid, {})
        trusted = b.get('matchedBy') == 'vlr' and str(b.get('vlr')) == pid
        candidate = normalized_birth(b.get('birth_date')) if trusted else None
        existing = normalized_birth(prior_birth)
        # Never replace an already valid, conflicting full date just from this
        # sweep. Missing dates require an exact joined source; formats do not.
        new_birth = None if pid in rejected else (existing or candidate)
        if pid not in rejected and not new_birth:
            continue
        needs_date = new_birth != prior_birth
        needs_age = bool(new_birth and 'age' in p and p['age'] != age_on(new_birth, year))
        needs_est = est_key and p.get(est_key) != (new_birth is None)
        if pid in rejected or needs_date or needs_age or needs_est:
            f = fix(pid)
            f.update(birth=new_birth, estimated=new_birth is None)
            if source == 'world' and p['id'] not in f['playerIds']:
                f['playerIds'].append(p['id'])
            if prior_name not in f['oldNames']:
                f['oldNames'].append(prior_name)
            if prior_birth not in f['oldBirths']:
                f['oldBirths'].append(prior_birth)
            if pid not in rejected:
                reason = 'birthday-format' if prior_birth else 'exact-id-birthday'
                if not needs_date and needs_age:
                    reason = 'age-clamp'
                if reason not in f['reasons']:
                    f['reasons'].append(reason)
                f['source'] = 'https://liquipedia.net/valorant/' + b.get('page', '')
            if pid in rejected:
                set_field(p, name_key, NAMES.get(pid), source, pid)
            set_field(p, birth_key, new_birth, source, pid)
            if est_key:
                set_field(p, est_key, new_birth is None, source, pid)
            if 'age' in p:
                if new_birth:
                    new_age = age_on(new_birth, year)
                elif prior_birth:
                    debut = first_year.get(pid, year)
                    new_age = 18 if source == 'world_2021' else min(40, max(15, {2020: 19, 2021: 18, 2022: 17, 2023: 17}.get(debut, 17) + year - debut))
                else:
                    new_age = p['age']
                set_field(p, 'age', new_age, source, pid)

    # Some 2026 entries already had a correct birthday while their historical
    # counterpart needed a fix. Still record their exact known P-id mapping.
    for p in data['world']['players']:
        pid = dossier['players'].get(p['id'], {}).get('vlr')
        if pid in fixes and p['id'] not in fixes[pid]['playerIds']:
            fixes[pid]['playerIds'].append(p['id'])
    manifest = {'version': 1, 'date': '2026-09-20', 'ageReference': 'January 1 of game year; unknown-birth save ages are preserved',
                'players': dict(sorted(fixes.items(), key=lambda pair: int(pair[0]))), 'changes': changes}
    summary = {}
    for c in changes:
        summary.setdefault(c['file'], set()).add(c['id'])
    print(json.dumps({'manifestPlayers': len(fixes), 'changedRecords': {k: len(v) for k, v in summary.items()},
                      'changedFields': len(changes), 'applied': args.apply}, ensure_ascii=False))
    if args.apply:
        for n in filenames:
            if data[n] == json.loads(original[n]):
                continue
            # Preserve each original JSON layout; this is a bounded mechanical
            # serialization of only the field assignments recorded above.
            indent = 0 if '\n"' in original[n][:100] else None
            separators = (',', ':') if '\": ' not in original[n][:200] and indent is None else None
            (DATA / f'{n}.json').write_text(json.dumps(data[n], ensure_ascii=False, indent=indent, separators=separators), encoding='utf-8')
        target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
