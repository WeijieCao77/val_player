"""Pure structured cleanup regression: no files are written."""
import copy
from removed import Removed
from remove_player_data import scrub_world, scrub_circuit, scrub_timeline, scrub_calibration

r = Removed()
assert '4710' in r.ids
world = {'players': [{'id': 'V4710', 'ign': 'YOU'}, {'id': 'V7987'}, {'id': 'ME', 'ign': 'YOU'}],
         'teams': [{'id': 'V21T4710', 'roster': ['V4710', 'ME'], 'starters': ['V4710'], 'igl': 'V4710'}],
         'text': 'thank you for your youth program'}
assert scrub_world(world, r) == 5
assert world['players'] == [{'id': 'ME', 'ign': 'YOU'}]
assert world['teams'][0] == {'id': 'V21T4710', 'roster': ['ME'], 'starters': [], 'igl': None}
assert world['text'] == 'thank you for your youth program'
assert scrub_world(world, r) == 0
circuit = {'2025': [{'id': '4710', 'rosters': {'4710': ['4710', '123']}}]}
assert scrub_circuit(circuit, r) == 1
assert circuit == {'2025': [{'id': '4710', 'rosters': {'4710': ['123']}}]}
keep = {'o': 80, 'a': [1, 2, 3], 'i': 1}
book = {'years': {'2025': {'rosters': {'4710': ['4710', '123']}, 'clubs': {'4710': {'o': 85}},
                          'ratings': {'4710': {'o': 90}, '123': copy.deepcopy(keep)}, 'debuts': {'4710': {}}}}, 'last': {'4710': 2025, '123': 2025}}
assert scrub_timeline(book, r) == 4
assert book['years']['2025']['ratings']['123'] == keep
assert book['years']['2025']['clubs']['4710']['o'] == 80
assert scrub_timeline(book, r) == 0
cal = {'worlds': {'2021': {'4710': {}, '123': keep}}, 'years': {'2025': {'4710': {}}}}
assert scrub_calibration(cal, r) == 2
assert cal['worlds']['2021']['123'] == keep
assert scrub_calibration(cal, r) == 0
cal['summary'] = {'world': {'changed': 2, 'matched': 7}, 'years': {'2025': {'changed': 1}}}
assert scrub_calibration(cal, r) == 2
assert cal['summary'] == {'world': {'changed': 1, 'matched': 7}, 'years': {'2025': {'changed': 0}}}
assert scrub_calibration(cal, r) == 0
print('OK precise cleanup IDs, adjacent removals, same-number teams/events, preserved attributes, idempotency')
