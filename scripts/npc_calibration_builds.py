"""Run fixed/legacy builders into temporary outputs without editing source data."""
import io
import json
import os
import sys
import build_world_2021 as bw
import build_timeline as bt


def legacy_role_pctiles(rows, key='rating', order=None):
    out = {}
    roles = order or sorted(set(r['role'] for r in rows))
    for role in roles:
        peers = [r for r in rows if r['role'] == role]
        mapping = bw.pctiles(peers if len(peers) >= 12 else rows, key)
        out.update(mapping)
    return out


def generate(source, worktree, tempdir):
    old_data = bw.DATA, bt.DATA
    bw.DATA = bt.DATA = str(source)
    real = bw.role_pctiles

    class NoopStringIO(io.StringIO):
        def reconfigure(self, *args, **kwargs):
            pass

    def run(module, name, extra=()):
        output_path = os.path.join(tempdir, name)
        old_argv, old_stdout = sys.argv, sys.stdout
        sys.argv = ['builder', '--out', output_path, '--staff', staff, *extra]
        sys.stdout = NoopStringIO()
        try:
            rc = module.main()
            if rc != 0:
                raise RuntimeError(f'builder failed {rc}: {sys.stdout.getvalue()}')
        finally:
            sys.argv, sys.stdout = old_argv, old_stdout
        with open(output_path, encoding='utf-8') as f:
            return json.load(f)

    staff = os.path.join(worktree, 'src', 'data', 'staff_stints.json')
    circuit = ['--circuit', os.path.join(worktree, 'src', 'data', 'circuit.json')]
    try:
        fixed_world = run(bw, 'fixed_world.json')
        fixed_timeline = run(bt, 'fixed_timeline.json', circuit)
        bw.role_pctiles = legacy_role_pctiles
        legacy_timeline = run(bt, 'legacy_timeline.json', circuit)
        large = ['先锋', '决斗者', '哨卫', '控场']
        legacy_worlds = []
        for mask in range(16):
            before = [role for i, role in enumerate(large) if mask & (1 << i)]
            order = before + ['自由人'] + [role for role in large if role not in before]
            bw.role_pctiles = lambda rows, key='rating', order=order: legacy_role_pctiles(rows, key, order)
            legacy_worlds.append(run(bw, f'legacy_world_{mask}.json'))
    finally:
        bw.role_pctiles = real
        bw.DATA, bt.DATA = old_data
    return fixed_world, legacy_worlds, fixed_timeline, legacy_timeline
