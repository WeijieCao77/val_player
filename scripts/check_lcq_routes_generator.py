"""Bounded, offline regression for the verified two-place route normalization."""
import copy
import unittest
from build_routes import normalize_lcq_places


class LcqRoutes(unittest.TestCase):
    def setUp(self):
        self.routes = {'2355': {'kind': 'winner', 'event': '1111'}, '2406': {'kind': 'winner', 'event': '1111'}}
        self.events = {'1111': {'places': [['2355', 1], ['2406', 2], ['6946', 3]]}}

    def test_verified_pair(self):
        normalize_lcq_places('2022', '1015', self.routes, self.events)
        self.assertEqual([r['kind'] for r in self.routes.values()], ['top', 'top'])

    def test_single_winner_unchanged(self):
        del self.routes['2406']
        before = copy.deepcopy(self.routes)
        normalize_lcq_places('2022', '1015', self.routes, self.events)
        self.assertEqual(self.routes, before)

    def test_other_year_or_target_not_inferred(self):
        for year, target in [('2021', '1015'), ('2022', 'other')]:
            with self.assertRaises(ValueError):
                normalize_lcq_places(year, target, self.routes, self.events)

    def test_real_places_must_back_the_pair(self):
        self.events['1111']['places'][1][1] = 3
        with self.assertRaises(ValueError):
            normalize_lcq_places('2022', '1015', self.routes, self.events)


if __name__ == '__main__':
    unittest.main()
