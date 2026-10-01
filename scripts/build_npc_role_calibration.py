"""Emit only numeric deltas whose legacy generation exactly matches shipped data."""
import argparse
import hashlib
import json
import tempfile
from pathlib import Path
import build_world_2021 as bw
from npc_calibration_builds import generate

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def numeric(r):
    return {k: r[k] for k in ('a', 'o', 'p')}


def fingerprint(r):
    return {k: r.get(k) for k in ('a', 'o', 'p', 'r', 'n', 'v')}


def world_map(world):
    return {p['id'].removeprefix('V'): {
        'a': [p['attrs'][k] for k in bw.ATTRS], 'o': p['overall'], 'p': p['potential'],
        'r': '|'.join(p.get('roles') or [p['role']]),
        'n': (p.get('vlr') or {}).get('rounds', p.get('rounds', 0)),
        'v': [(p.get('vlr') or {}).get('rating'), (p.get('vlr') or {}).get('acs')],
        'i': bool(p.get('isIgl')),
    } for p in world['players']}


def compare(current, legacy_variants, fixed):
    deltas = {}
    summary = {'matched': 0, 'skipped': 0, 'changed': 0, 'callerSkipped': 0}
    for pid, before in sorted(current.items(), key=lambda item: int(item[0])):
        old = next((v[pid] for v in legacy_variants if pid in v and fingerprint(v[pid]) == fingerprint(before)), None)
        after = fixed.get(pid)
        if old is None or after is None or any(before.get(k) != after.get(k) for k in ('r', 'n', 'v')):
            summary['skipped'] += 1
            continue
        summary['matched'] += 1
        if bool(old.get('i')) != bool(after.get('i')):
            summary['callerSkipped'] += 1
            continue
        if numeric(before) != numeric(after):
            deltas[pid] = {'before': numeric(before), 'after': numeric(after), **{k: before[k] for k in ('r', 'n', 'v')}}
            summary['changed'] += 1
    return deltas, summary


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--source-data', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--built-dir', help='Reuse this generator driver\'s temporary outputs for audit')
    args = ap.parse_args()
    if args.built_dir:
        d = Path(args.built_dir)
        generated = (read(d / 'fixed_world.json'), [read(d / f'legacy_world_{i}.json') for i in range(16)],
                     read(d / 'fixed_timeline.json'), read(d / 'legacy_timeline.json'))
    else:
        with tempfile.TemporaryDirectory(prefix='npc-role-calibration-') as d:
            generated = generate(args.source_data, str(ROOT), d)
    fw, worlds, ft, lt = generated
    current = read(ROOT / 'src/data/timeline.json')
    wd, ws = compare(world_map(read(ROOT / 'src/data/world_2021.json')), list(map(world_map, worlds)), world_map(fw))
    artifact = {'version': 1, 'sources': {
        'description': 'Same VLR source cache; role fallback assignments restricted to peers; only exact legacy fingerprints accepted. No rosters or caller flags changed.',
        'statsSha256': hashlib.sha256((Path(args.source_data) / 'stats_history.json').read_bytes()).hexdigest(),
    }, 'worlds': {'2021': wd}, 'years': {}, 'summary': {'world': ws, 'years': {}}}
    for year, data in sorted(current['years'].items()):
        delta, summary = compare(data['ratings'], [lt['years'][year]['ratings']], ft['years'][year]['ratings'])
        artifact['years'][year] = delta
        artifact['summary']['years'][year] = summary
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(json.dumps(artifact['summary'], ensure_ascii=False))
    for year, entries in artifact['years'].items():
        for pid in ['438', '3520', '4742', '872', '5022', '8480']:
            if pid in entries:
                r = entries[pid]
                print(year, pid, r['before']['o'], '->', r['after']['o'])


if __name__ == '__main__':
    main()
