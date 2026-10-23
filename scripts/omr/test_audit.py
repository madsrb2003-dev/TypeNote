from fractions import Fraction
import unittest

from audit import compare, extract


def score(body, divisions="<divisions>4</divisions>"):
    return (f'<score-partwise><part-list/><part id="P1"><measure number="1">'
            f'<attributes>{divisions}</attributes>{body}</measure></part></score-partwise>').encode()


def note(step="C", duration=3, chord=False, voice=1, rest=False):
    pitch = '<rest/>' if rest else f'<pitch><step>{step}</step><octave>4</octave></pitch>'
    return f'<note>{"<chord/>" if chord else ""}{pitch}<duration>{duration}</duration><voice>{voice}</voice><staff>1</staff></note>'


SAMPLE = {"id": "synthetic", "staff": 1, "measures": [{"number": 1, "events": [
    {"onset_quarters": [0, 1], "duration_quarters": [3, 4],
     "pitches": [{"step": "C", "octave": 4}, {"step": "E", "octave": 4}]}]}]}


class AuditTests(unittest.TestCase):
    def test_chord_grouping_and_exact_fractional_time(self):
        result = compare(score(note() + note("E", chord=True)), SAMPLE)
        self.assertEqual(result["exact_event_matches"], 1)
        self.assertEqual(result["matching_pitch_instances"], 2)
        self.assertEqual(result["missing_or_changed_events"], 0)

    def test_backup_preserves_an_independent_line_as_extra_event(self):
        body = note() + note("E", chord=True) + '<backup><duration>3</duration></backup>' + note("G", voice=2)
        result = compare(score(body), SAMPLE)
        self.assertEqual(result["exact_event_matches"], 1)
        self.assertEqual(result["extra_or_changed_events"], 1)

    def test_pitch_or_rhythm_errors_are_not_counted_as_exact(self):
        for body in [note() + note("F", chord=True), note(duration=4) + note("E", duration=4, chord=True)]:
            result = compare(score(body), SAMPLE)
            self.assertEqual(result["exact_event_matches"], 0)
            self.assertEqual(result["missing_or_changed_events"], 1)
            self.assertEqual(result["extra_or_changed_events"], 1)
        self.assertEqual(compare(score(note() + note("F", chord=True)), SAMPLE)["matching_pitch_instances"], 1)

    def test_missing_measure_and_extra_rest_are_reported(self):
        data = score(note(rest=True)).replace(b'number="1"', b'number="2"')
        result = compare(data, SAMPLE)
        self.assertEqual(result["observed_marks"]["missing_measures"], ["1"])
        self.assertEqual(result["missing_or_changed_events"], 1)
        self.assertEqual(compare(score(note(rest=True)), SAMPLE)["extra_or_changed_events"], 1)

    def test_missing_divisions_and_ambiguous_chords_fail(self):
        for data in [score(note(), divisions=""), score(note(chord=True)),
                     score(note() + '<backup><duration>4</duration></backup>')]:
            with self.assertRaises(ValueError):
                compare(data, SAMPLE)

    def test_forward_sets_exact_onset(self):
        events, _ = extract(score('<forward><duration>1</duration></forward>' + note()), SAMPLE)
        self.assertEqual(events[0][1], Fraction(1, 4))


if __name__ == "__main__":
    unittest.main()
