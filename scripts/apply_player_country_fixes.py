"""Mechanical, field-scoped application of reviewed ID-based corrections.

Dry-run by default; --write is explicit. Never infer by name or replace a
country code globally. Keeps source JSON formatting and is idempotent.
"""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'src' / 'data'


def apply(write=False):
    fixes = json.loads((DATA / 'player_country_fixes.json').read_text(encoding='utf-8'))['fixes']
    timeline_path = DATA / 'timeline.json'
    raw = timeline_path.read_text(encoding='utf-8')
    timeline = json.loads(raw)
    changes = []
    for f in fixes:
        p = timeline['years'][str(f['year'])]['debuts'][f['pid']]
        assert p['nat'] in (f['from'], f['to']), f"Unexpected value for {f['pid']}: {p['nat']}"
        if p['nat'] == f['to']:
            continue
        p['nat'] = f['to']
        changes.append({'id': f['pid'], 'year': f['year'], 'from': f['from'], 'to': f['to']})
    if write and changes:
        timeline_path.write_text(json.dumps(timeline, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    print(json.dumps({'mode': 'write' if write else 'dry-run', 'nationalityChanges': len(changes), 'changes': changes}, ensure_ascii=False))

    world_path = DATA / 'world.json'
    raw_world = world_path.read_text(encoding='utf-8')
    world = json.loads(raw_world)
    names = [('T61', 'Eastern Pandas', 'Enterprise Esports'), ('T62', 'Sangal Esports', 'Eintracht Frankfurt')]
    changed_names = []
    for tid, wrong, right in names:
        team = next(t for t in world['teams'] if t['id'] == tid)
        assert team['name'] in (wrong, right), f'Unexpected team name for {tid}'
        if team['name'] == right:
            continue
        # Limit the textual replacement to the exact object after identity checks.
        # Preserve the legacy file's separators, Unicode escapes and unrelated data.
        old_obj = json.dumps(team, ensure_ascii=False)
        team['name'] = right
        new_obj = json.dumps(team, ensure_ascii=False)
        assert raw_world.count(old_obj) == 1, f'Formatting changed for {tid}; inspect before editing'
        raw_world = raw_world.replace(old_obj, new_obj, 1)
        changed_names.append({'id': tid, 'from': wrong, 'to': right})
    if write and changed_names:
        world_path.write_text(raw_world, encoding='utf-8')
    print(json.dumps({'teamNameChanges': changed_names}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write', action='store_true')
    apply(parser.parse_args().write)
