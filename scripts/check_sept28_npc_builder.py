"""Role fallback regression: reference pools must not expand assignment targets."""
import build_world_2021 as bw

rows = [{'id': str(i), 'role': 'a', 'rating': i} for i in range(12)] + [{'id': 'z', 'role': 'z', 'rating': 100}]
p = bw.role_pctiles(rows)
assert p['11'] == 1
legacy = {}
for role in sorted(set(r['role'] for r in rows)):
    peers = [r for r in rows if r['role'] == role]
    legacy.update(bw.pctiles(peers if len(peers) >= 12 else rows, 'rating'))
assert legacy['11'] == 11 / 12
assert {str(i): p[str(i)] for i in range(12)} == bw.role_pctiles(rows[:-1])
assert p['z'] == bw.pctiles(rows, 'rating')['z']
rows11 = [r for r in rows if r['id'] != '11']
assert bw.role_pctiles(rows11) == bw.pctiles(rows11, 'rating')
assert bw.role_pctiles(list(reversed(rows))) == p
missing = {'id': 'missing', 'role': 'a', 'rating': None}
assert bw.role_pctiles(rows + [missing])['missing'] == .5
print('NPC builder: 7 checks passed; legacy fallback overwrite reproduced')
