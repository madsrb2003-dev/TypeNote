import { describe, expect, it } from 'vitest';
import { accidentalPlan, isSelected, standardKeyName, systemGeometry } from './engraving';
import { annotationSpace, markSegments, parseMetronome } from './marks';
import type { Measure, Pitch, Score, ScoreEvent } from '../domain/types';

function note(id: string, pitch: Partial<Pitch> = {}, duration: ScoreEvent['duration'] = 4): ScoreEvent {
  return { id, kind: 'note', duration, pitches: [{ step: 'F', octave: 4, alter: 1, ...pitch }] };
}
const bar = (treble: ScoreEvent[] = [], bass: ScoreEvent[] = []): Measure => ({ id: 'bar', treble, bass });

describe('engraving accidental decisions', () => {
  it('uses authoritative alterations instead of stale key metadata', () => {
    expect(standardKeyName({ name: 'G', fifths: 1, alterations: { B: -1 } })).toBe('F');
    expect(standardKeyName({ alterations: { F: -1 } })).toBeUndefined();
    expect(standardKeyName({ alterations: { F: 1, C: 1 } })).toBe('D');
  });
  it('respects the signature, cancels locally, repeats no redundant glyph, and resets per octave', () => {
    const measure = bar([note('a'), note('b', { alter: 0 }), note('c', { alter: 0 }), note('d', { octave: 5 })]);
    const plan = accidentalPlan(measure, { alterations: { F: 1 } });
    expect([...plan.values()]).toEqual([[null], [0], [null], [null]]);
    expect(accidentalPlan(bar([note('fresh', { alter: 0 })]), { alterations: { F: 1 } }).get('fresh')).toEqual([0]);
  });
  it('shares chronological state across voices and respects displayed staff', () => {
    const measure = bar([note('v1', { alter: -2 }, 2)], [note('bass', { alter: 0 })]);
    measure.extraVoices = { treble: [[{ id: 'r', kind: 'rest', duration: 2 }, note('v2', { alter: -2 })]] };
    expect(accidentalPlan(measure, { alterations: {} }).get('v2')).toEqual([null]);
    measure.extraVoices.treble![0][1] = { ...note('v2', { alter: -2 }), displayStaff: 'bass' };
    expect(accidentalPlan(measure, { alterations: {} }).get('v2')).toEqual([-2]);
  });
  it('shows explicit and courtesy accidentals even when unchanged, and supports double sharps', () => {
    const measure = bar([note('a', { alter: 2 }), note('b', { alter: 2, accidental: 'courtesy' }), note('c', { alter: 2, accidental: 'explicit' }), note('d', { alter: 2 })]);
    expect([...accidentalPlan(measure, { alterations: {} }).values()]).toEqual([[2], [2], [2], [null]]);
  });
  it('does not let simultaneous voices suppress each other’s accidental', () => {
    const measure = bar([note('a')]); measure.extraVoices = { treble: [[note('b')]] };
    expect([...accidentalPlan(measure, { alterations: {} }).values()]).toEqual([[1], [1]]);
  });
});

describe('systems and annotation geometry', () => {
  const score: Score = { version: 3, title: '', measures: [{ ...bar(), id: 'a' }, { ...bar(), id: 'b' }, { ...bar(), id: 'c' }], marks: [
    { id: 'span', kind: 'pedal', start: { measureId: 'a', staff: 'bass' }, end: { measureId: 'c', staff: 'bass' }, value: 'sustain', placement: 'below' },
    { id: 'dynamic', kind: 'dynamic', start: { measureId: 'b', staff: 'bass' }, value: 'pp', placement: 'below' },
  ] };
  it('continues spans across system boundaries and allocates separate lanes', () => {
    expect(markSegments(score, 1, 1).map(s => [s.mark.id, s.startsHere, s.endsHere, s.lane])).toEqual([['span', false, false, 0], ['dynamic', true, true, 1]]);
    expect(annotationSpace(score, 1, 1, 'bass', 'below')).toBe(67);
    expect(markSegments(score, 2, 1)[0].endsHere).toBe(true);
  });
  it('reserves space for marks and extreme notes on the display staff', () => {
    const basic: Score = { ...score, marks: [] };
    const marked = systemGeometry([score.measures[1]], score, 1);
    const plain = systemGeometry([score.measures[1]], basic, 1);
    expect(marked.height).toBeGreaterThan(plain.height);
    const extreme = { ...basic, measures: [bar([{ ...note('low', { step: 'C', octave: 0, alter: 0 }), displayStaff: 'bass' }])] };
    expect(systemGeometry(extreme.measures, extreme).bassExtent.bottom).toBeGreaterThan(plain.bassExtent.bottom);
  });
  it('distinguishes voice selections while accepting omitted primary voice', () => {
    const a = { kind: 'event' as const, measureIndex: 0, staff: 'treble' as const, index: 0 };
    expect(isSelected(a, { ...a, voice: 0 })).toBe(true);
    expect(isSelected(a, { ...a, voice: 1 })).toBe(false);
    expect(isSelected(a, { ...a, pitchIndex: 0 })).toBe(false);
    expect(isSelected({ ...a, pitchIndex: 1 }, { ...a, pitchIndex: 1 })).toBe(true);
    expect(isSelected({ ...a, pitchIndex: 0 }, { ...a, pitchIndex: 1 })).toBe(false);
  });
});

describe('metronome notation', () => {
  it('engraves a real beat glyph and keeps an expressive prefix', () => {
    expect(parseMetronome('Allegro · quarter = 100')).toEqual({ prefix: 'Allegro', glyph: '\uECA5', bpm: 100 });
    expect(parseMetronome('dotted eighth = 72 bpm')).toEqual({ prefix: '', glyph: '\uECA7\uECB7', bpm: 72 });
    expect(parseMetronome('Largo, double-dotted half = 40')).toEqual({ prefix: 'Largo', glyph: '\uECA3\uECB7\uECB7', bpm: 40 });
    expect(parseMetronome('Andante')).toBeNull();
    expect(parseMetronome('quarter = 0')).toBeNull();
  });
});
