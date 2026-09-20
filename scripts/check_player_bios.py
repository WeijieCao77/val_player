"""Offline biography parser regressions; never invokes a crawler or writes data."""
import unittest
from fetch_bios import matching_player, normalized_birth, parse_infobox
from player_bios import trusted_bio


class BiographyParserTests(unittest.TestCase):
    def test_exact_player_id(self):
        row = matching_player('{{Infobox player\n|name=Correct Person\n|vlr=8582\n}}', '8582')
        self.assertEqual(row['name'], 'Correct Person')

    def test_event_id_is_not_player_id(self):
        self.assertIsNone(matching_player('{{Infobox tournament\n|name=Wrong Event\n|vlr=1879\n}}', '1879'))

    def test_page_body_id_does_not_validate_infobox(self):
        self.assertIsNone(matching_player('{{Infobox player\n|name=Someone Else\n}}\n{{Match|vlr=1879}}', '1879'))

    def test_wrong_or_missing_id_never_matches_a_handle(self):
        self.assertIsNone(matching_player('{{Infobox player\n|name=Laz\n|vlr=999\n}}', '8582'))
        self.assertIsNone(matching_player('{{Infobox player\n|name=Laz\n}}', '8582'))

    def test_nested_template_does_not_end_infobox(self):
        row = matching_player('{{Infobox player\n|other={{a|b=c}}\n|name=A\n|vlr=999\n}}', '999')
        self.assertEqual(row['name'], 'A')

    def test_nested_ids_and_names_are_not_identity(self):
        text = '{{Infobox player|other={{Match|name=Wrong|vlr=999}}|name=Correct|vlr=123}}'
        self.assertIsNone(matching_player(text, '999'))
        self.assertEqual(matching_player(text, '123')['name'], 'Correct')

    def test_comments_cannot_impersonate_player(self):
        self.assertIsNone(parse_infobox('<!--{{Infobox player\n|vlr=999\n}}-->\n{{Infobox tournament|vlr=999}}'))

    def test_multiple_player_templates_are_ambiguous(self):
        self.assertIsNone(parse_infobox('{{Infobox player|vlr=1}}\n{{Infobox player|vlr=2}}'))

    def test_normalizes_full_dates(self):
        for raw in ['2002-8-16', '2002-08-16 <!-- source -->', "2002-08-16 <!--source-->'"]:
            self.assertEqual(normalized_birth(raw), '2002-08-16')
        self.assertEqual(normalized_birth('2000-2-29'), '2000-02-29')

    def test_unknown_or_invalid_dates_are_not_invented(self):
        for raw in [None, '2002', '????-08-16', '2002-??-??', '2001-02-29', '2000-13-01']:
            self.assertIsNone(normalized_birth(raw))

    def test_parse_birth_preserves_unresolved_raw_value(self):
        row = parse_infobox('{{Infobox player\n|vlr=1\n|birth_date=1999-??-??\n}}')
        self.assertIsNone(row['birth_date'])
        self.assertEqual(row['birth_date_raw'], '1999-??-??')

    def test_generator_identity_gate(self):
        self.assertEqual(trusted_bio({'matchedBy': 'name', 'vlr': None, 'name': 'Wrong'}, '1'), {})
        self.assertEqual(trusted_bio({'matchedBy': 'vlr', 'vlr': '2'}, '1'), {})
        self.assertEqual(trusted_bio({'matchedBy': 'search', 'vlr': '1', 'name': 'Event'}, '1'), {})
        row = {'matchedBy': 'search', 'vlr': '1', 'playerInfoboxVerified': True, 'birth_date': '2002-8-16'}
        self.assertEqual(trusted_bio(row, '1')['birth_date'], '2002-08-16')
        self.assertEqual(trusted_bio({'matchedBy': 'reviewed-vlr', 'vlr': '1', 'name': 'Known', 'birth_date': None}, '1')['name'], 'Known')

    def test_calendar_age_is_not_an_eligibility_floor(self):
        from datetime import date
        from build_world_2021 import age_on
        self.assertEqual(age_on('2006-10-19', date(2021, 1, 1)), 14)
        self.assertEqual(age_on('2001-2-29', date(2021, 1, 1)), None)


if __name__ == '__main__':
    unittest.main()
