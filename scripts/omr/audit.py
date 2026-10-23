#!/usr/bin/env python3
"""Compare a manually transcribed excerpt with MusicXML using exact timing."""

import argparse
from collections import Counter
from fractions import Fraction
import json
from pathlib import Path

from musicxml import musicxml_bytes, parse_xml


def duration(element, divisions):
    if divisions is None:
        raise ValueError("Missing divisions; timing cannot be inferred")
    value = element.findtext("duration")
    if value is None or not value.isdecimal():
        raise ValueError("Missing or invalid duration")
    return Fraction(int(value), divisions)


def extract(data: bytes, sample: dict) -> tuple[list[tuple], dict]:
    root = parse_xml(data)
    for element in root.iter():
        element.tag = element.tag.split("}")[-1]
    if root.tag != "score-partwise":
        raise ValueError("Excerpt audit requires score-partwise MusicXML")
    parts = root.findall("part")
    if len(parts) != 1:
        raise ValueError("Excerpt audit requires exactly one part")
    wanted = {str(measure["number"]) for measure in sample["measures"]}
    staff = str(sample["staff"])
    divisions, found, events = None, set(), []
    observations = {"fingerings": 0, "tie_starts": 0, "tie_stops": 0,
                    "slur_starts": 0, "dynamics": [], "words": [], "metronomes": []}
    for measure in parts[0].findall("measure"):
        number = measure.get("number")
        selected = number in wanted
        if selected:
            if number in found:
                raise ValueError("Repeated measure numbers make this excerpt ambiguous")
            found.add(number)
        cursor, previous = Fraction(0), None
        for element in measure:
            if element.tag == "attributes":
                value = element.findtext("divisions")
                if value is not None:
                    if not value.isdecimal() or int(value) <= 0:
                        raise ValueError("Invalid divisions")
                    divisions = int(value)
            elif element.tag in ("backup", "forward"):
                cursor += duration(element, divisions) * (-1 if element.tag == "backup" else 1)
                previous = None
                if cursor < 0:
                    raise ValueError("Backup moves before the start of a measure")
            elif element.tag == "note":
                if element.find("grace") is not None:
                    if selected and element.findtext("staff", "1") == staff:
                        raise ValueError("Grace-note audit is outside this excerpt comparator's scope")
                    continue
                length = duration(element, divisions)
                voice = element.findtext("voice", "1")
                is_chord = element.find("chord") is not None
                if is_chord:
                    if previous is None or previous["voice"] != voice or previous["duration"] != length:
                        raise ValueError("Chord lacks a compatible preceding note")
                    onset = previous["onset"]
                else:
                    onset = cursor
                    cursor += length
                    previous = {"voice": voice, "onset": onset, "duration": length, "event": None}
                if not selected or element.findtext("staff", "1") != staff:
                    continue
                pitch = element.find("pitch")
                if pitch is None and element.find("rest") is None:
                    raise ValueError("Unpitched notes are unsupported by this comparator")
                spelled = () if pitch is None else (pitch.findtext("step"),
                           Fraction(pitch.findtext("alter", "0")), int(pitch.findtext("octave")))
                if not is_chord or previous["event"] is None:
                    event = [number, onset, length, []]
                    events.append(event)
                    previous["event"] = event
                if spelled:
                    previous["event"][3].append(spelled)
                observations["fingerings"] += len(element.findall(".//fingering"))
                observations["tie_starts"] += len(element.findall("tie[@type='start']"))
                observations["tie_stops"] += len(element.findall("tie[@type='stop']"))
                observations["slur_starts"] += len(element.findall(".//slur[@type='start']"))
            elif selected and element.tag == "direction":
                observations["dynamics"].extend(child.tag for dyn in element.findall(".//dynamics") for child in dyn)
                observations["words"].extend(item.text or "" for item in element.findall(".//words"))
                observations["metronomes"].extend({"unit": item.findtext("beat-unit"),
                                                   "per_minute": item.findtext("per-minute")}
                                                  for item in element.findall(".//metronome"))
    observations["missing_measures"] = sorted(wanted - found)
    return [(number, onset, length, tuple(sorted(pitches))) for number, onset, length, pitches in events], observations


def compare(data: bytes, sample: dict) -> dict:
    expected = [(str(measure["number"]), Fraction(*event["onset_quarters"]),
                 Fraction(*event["duration_quarters"]),
                 tuple(sorted((pitch["step"], Fraction(pitch.get("alter", 0)), pitch["octave"])
                              for pitch in event["pitches"])))
                for measure in sample["measures"] for event in measure["events"]]
    actual, observations = extract(data, sample)
    expected_counts, actual_counts = Counter(expected), Counter(actual)
    # Pitch instances must match spelling, onset AND duration. Voice numbers are
    # deliberately not compared; manually selected excerpts have one staff line.
    def pitches(events):
        return Counter((number, onset, length, pitch) for number, onset, length, chord in events for pitch in chord)
    expected_pitches, actual_pitches = pitches(expected), pitches(actual)
    return {"sample": sample["id"], "expected_events": len(expected), "recognized_events": len(actual),
            "exact_event_matches": sum((expected_counts & actual_counts).values()),
            "missing_or_changed_events": sum((expected_counts - actual_counts).values()),
            "extra_or_changed_events": sum((actual_counts - expected_counts).values()),
            "expected_pitch_instances": sum(expected_pitches.values()),
            "matching_pitch_instances": sum((expected_pitches & actual_pitches).values()),
            "observed_marks": observations,
            "scope": "Only the selected part/staff/measures; exact spelling/onset/duration and chord grouping. "
                     "Voice IDs, layout and notation display intent are not scored. Marks require manual comparison. "
                     "These counts do not estimate whole-score accuracy."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--sample", required=True)
    parser.add_argument("--musicxml", type=Path, required=True)
    args = parser.parse_args()
    try:
        samples = json.loads(args.reference.read_text())["samples"]
        matches = [sample for sample in samples if sample["id"] == args.sample]
        if len(matches) != 1:
            raise ValueError("Reference must contain exactly one matching sample ID")
        result = compare(musicxml_bytes(args.musicxml), matches[0])
    except (ValueError, KeyError, TypeError, OSError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
