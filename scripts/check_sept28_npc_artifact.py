"""Read-only validation of every emitted calibration source fingerprint."""
import json
from pathlib import Path
from build_npc_role_calibration import world_map

ROOT = Path(__file__).resolve().parents[1]
def read(name):
    return json.loads((ROOT / 'src/data' / name).read_text(encoding='utf-8'))

data = read('npc_role_calibration.json')
timeline = read('timeline.json')
world = world_map(read('world_2021.json'))
assert data['version'] == 1
assert data['years']['2023'] == {} and data['years']['2026'] == {}
groups = [(data['worlds']['2021'], world)]
groups += [(entries, timeline['years'][year]['ratings']) for year, entries in data['years'].items()]
checked = 0
for entries, source in groups:
    for pid, entry in entries.items():
        original = source[pid]
        assert entry['before'] == {key: original[key] for key in ('a', 'o', 'p')}
        assert all(entry[key] == original[key] for key in ('r', 'n', 'v'))
        assert entry['after'] != entry['before']
        for point in ('before', 'after'):
            value = entry[point]
            assert len(value['a']) == 8 and all(type(n) is int and 20 <= n <= 99 for n in value['a'])
            assert type(value['o']) is int and 30 <= value['o'] <= value['p'] <= 99
        checked += 1
assert checked == 5317  # Exactly two deleted-person entries removed: world 2021 and timeline 2025.
assert all('4710' not in entries for entries, _ in groups)
print(f'NPC calibration artifact: {checked} exact source fingerprints verified; no writes')
