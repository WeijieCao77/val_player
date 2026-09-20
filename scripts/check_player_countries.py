import json
import unittest
from pathlib import Path

from player_countries import VERIFIED_COUNTRIES, country_code, player_country


class CountryTests(unittest.TestCase):
    def test_names_not_prefixes(self):
        for name, code in [('Poland', 'pl'), ('Portugal', 'pt'), ('Spain', 'es'),
                           ('Slovakia', 'sk'), ('Slovenia', 'si'), ('United States', 'us'),
                           ('United Kingdom', 'gb'), ('United Arab Emirates', 'ae'),
                           ('Hong Kong', 'hk'), ('Taiwan', 'tw'), ('China', 'cn')]:
            self.assertEqual(country_code(name), code)

    def test_unknown_not_nationality(self):
        for value in [None, '', 'xx', 'un', 'eu', 'Unknown', 'North America', 'Oceania', 'bad input']:
            self.assertIsNone(country_code(value))

    def test_codes_and_case(self):
        self.assertEqual(country_code(' CN '), 'cn')
        self.assertEqual(country_code('south korea'), 'kr')
        self.assertEqual(country_code('uk'), 'gb')
        for code in ['wa', 'en', 'sx']:
            self.assertEqual(player_country(code, {}, '999999999'), 'gb', 'VLR constituent flags use UK nationality')

    def test_identity_before_bio_fallback(self):
        bio = {'vlr': '12', 'matchedBy': 'vlr', 'country': 'United States'}
        self.assertEqual(player_country(None, bio, '12'), 'us')
        self.assertEqual(player_country('cn', bio, '12'), 'cn')
        self.assertIsNone(player_country(None, bio, '99'))
        self.assertIsNone(player_country(None, {**bio, 'matchedBy': 'search'}, '12'))
        self.assertIsNone(player_country(None, {'country': 'Poland'}, '12'))

    def test_verified_ids_survive_bio_quarantine(self):
        self.assertEqual(len(VERIFIED_COUNTRIES), 60)
        for pid, expected in VERIFIED_COUNTRIES.items():
            self.assertEqual(player_country(None, {}, pid), expected, pid)
            self.assertEqual(player_country('un', {'country': None}, pid), expected, pid)
        # A real roster flag remains the primary source, not the frozen repair.
        self.assertEqual(player_country('cn', {}, '9576'), 'cn')
        self.assertIsNone(player_country(None, {}, '999999999'))

    def test_all_real_roster_inputs_for_verified_ids(self):
        data = Path(__file__).resolve().parents[1] / 'src' / 'data'
        history = json.loads((data / 'history.json').read_text(encoding='utf-8'))
        bios = json.loads((data / 'bios.json').read_text(encoding='utf-8'))
        seen, count = set(), 0
        # These are the actual raw event-card inputs which populate `who` and
        # `in_world`; check every occurrence, not an invented correct code.
        for event in history.values():
            for team in event.get('teams', []):
                for p in team.get('players', []):
                    pid = p['id']
                    if pid not in VERIFIED_COUNTRIES:
                        continue
                    self.assertEqual(player_country(p.get('country'), bios.get(pid, {}), pid), VERIFIED_COUNTRIES[pid], pid)
                    seen.add(pid)
                    count += 1
        self.assertEqual(seen, set(VERIFIED_COUNTRIES))
        self.assertGreaterEqual(count, 60)


if __name__ == '__main__':
    unittest.main()
