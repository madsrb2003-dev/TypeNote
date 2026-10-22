import { describe, expect, it } from 'vitest';
import { addChordPitch, createScore, deleteEvent, getEvents, insertEvent, newId, patchEvent, removeChordPitch, setComposer, setMeasureSettings, setScoreMark, updateEvent } from './model';
import { effectiveSettings, keySignatureFor, resolvePitch } from './settings';
import { addFractions, compareFractions, eventFraction, measureCapacity, sumFractions, usedTicks } from './timing';
import { parseScore, serializeScore } from './storage';
import { validateScore } from './validation';
import { historyReducer, initialHistory } from './history';
import type { Pitch, Position, ScoreEvent, ScoreMark } from './types';

const start: Position = { measureIndex: 0, staff: 'treble', index: 0 };
const note = (pitch: Partial<Pitch> = {}): ScoreEvent => ({ id: newId(), kind: 'note', duration: 4, pitches: [{ step: 'C', octave: 4, alter: 0, ...pitch }] });
const auto = (): ScoreEvent => note({ step: 'F', accidental: 'auto' });

describe('exact notation timing', () => {
  it('represents dots and nested duration/tuplet factors exactly', () => {
    expect(eventFraction({ ...note(), dots: 2 })).toEqual({ numerator: 7, denominator: 1 });
    expect(eventFraction({ ...note(), duration: 0.125, dots: 2, tuplet: { group: 'g', actual: 7, normal: 4 } })).toEqual({ numerator: 1, denominator: 8 });
    expect(addFractions({ numerator: 1, denominator: 3 }, { numerator: 1, denominator: 6 })).toEqual({ numerator: 1, denominator: 2 });
    expect(compareFractions({ numerator: 2, denominator: 3 }, { numerator: 4, denominator: 6 })).toBe(0);
  });
  it('fills a bar with triplets exactly and rejects even a 128th overflow', () => {
    let score = createScore();
    for (let index = 0; index < 6; index++) score = insertEvent(score, { ...start, index }, { ...note(), tuplet: { group: 'g', actual: 3, normal: 2 } });
    expect(sumFractions(score.measures[0].treble.map(eventFraction))).toEqual({ numerator: 16, denominator: 1 });
    expect(usedTicks(score.measures[0].treble)).toBe(16);
    expect(() => insertEvent(score, { ...start, index: 6 }, { ...note(), duration: 0.125 })).toThrow(/full/);
  });
  it('supports extended durations and removable notation patches', () => {
    let score = setMeasureSettings(createScore(), 0, { timeSignature: { beats: 2, beatType: 1 } });
    score = insertEvent(score, start, { ...note(), duration: 32 });
    expect(usedTicks(score.measures[0].treble)).toBe(32);
    score = updateEvent(score, start, { ...score.measures[0].treble[0], duration: 4 });
    score = patchEvent(score, start, { dots: 2, stem: 'down' });
    expect(usedTicks(score.measures[0].treble)).toBe(7);
    score = patchEvent(score, start, { dots: undefined });
    expect(score.measures[0].treble[0]).not.toHaveProperty('dots');
    expect(score.measures[0].treble[0].stem).toBe('down');
  });
  it('rejects nonfinite timing, invalid tuplets and incoherent group ratios', () => {
    const score = createScore();
    score.measures[0].treble = [{ ...note(), tuplet: { group: 'g', actual: 3, normal: 2 } }, { ...note(), tuplet: { group: 'g', actual: 5, normal: 4 } }];
    expect(() => validateScore(score)).toThrow(/consistent ratio/);
    expect(() => setMeasureSettings(createScore(), 0, { pickup: NaN })).toThrow(/pickup/);
    expect(() => insertEvent(createScore(), start, { ...note(), tuplet: { group: 'g', actual: 0, normal: 2 } })).toThrow();
  });
});

describe('measure settings and independent voices', () => {
  it('inherits settings, with pickup limited to its measure', () => {
    let score = setMeasureSettings(createScore(), 0, { keySignature: keySignatureFor('D major'), timeSignature: { beats: 7, beatType: 8, groups: [2, 2, 3] }, clefs: { bass: 'tenor' }, pickup: 2 });
    expect(effectiveSettings(score, 1)).toMatchObject({ keySignature: { name: 'D' }, timeSignature: { beats: 7 }, clefs: { treble: 'treble', bass: 'tenor' } });
    expect(measureCapacity(score, 0)).toBe(2);
    expect(measureCapacity(score, 1)).toBe(14);
    score = setMeasureSettings(score, 1, { clefs: { treble: 'alto' } });
    expect(effectiveSettings(score, 2).clefs).toEqual({ treble: 'alto', bass: 'tenor' });
    score = setMeasureSettings(score, 0, { pickup: undefined });
    expect(measureCapacity(score, 0)).toBe(14);
  });
  it('rejects settings changes that would truncate existing content', () => {
    const score = insertEvent(createScore(), start, { ...note(), duration: 16 });
    expect(() => setMeasureSettings(score, 0, { timeSignature: { beats: 3, beatType: 4 } })).toThrow(/capacity/);
    expect(measureCapacity(score, 0)).toBe(16);
  });
  it('edits four voices without consuming the capacity of other voices', () => {
    let score = createScore();
    for (let voice = 0; voice < 4; voice++) score = insertEvent(score, { ...start, voice }, { ...note(), duration: 16 });
    expect(Array.from({ length: 4 }, (_, voice) => usedTicks(getEvents(score.measures[0], 'treble', voice)))).toEqual([16, 16, 16, 16]);
    score = deleteEvent(score, { ...start, voice: 2 });
    expect(getEvents(score.measures[0], 'treble', 2)).toEqual([]);
    expect(getEvents(score.measures[0], 'treble', 3)).toHaveLength(1);
    expect(() => insertEvent(score, { ...start, voice: 4 }, note())).toThrow(/voice/);
  });
  it('restores voice selection and notation through undo/redo', () => {
    const initial = { score: createScore(), selection: { ...start, voice: 2, kind: 'gap' as const } };
    const score = insertEvent(initial.score, initial.selection, { ...note(), dots: 1 });
    const state = historyReducer(initialHistory(initial), { type: 'commit', snapshot: { ...initial, score } });
    const undone = historyReducer(state, { type: 'undo' });
    expect(undone.present).toEqual(initial);
    expect(historyReducer(undone, { type: 'redo' }).present.score).toEqual(score);
  });
});

describe('automatic pitch alteration', () => {
  it('uses named keys, explicit overrides, bar resets, and later signature changes', () => {
    let score = setMeasureSettings(createScore(), 0, { keySignature: keySignatureFor('G') });
    score = insertEvent(score, start, auto());
    const pitchAt = (bar: number, index = 0) => {
      const event = score.measures[bar].treble[index];
      if (event.kind !== 'note') throw new Error('expected note');
      return event.pitches[0];
    };
    expect(pitchAt(0).alter).toBe(1);
    score = insertEvent(score, { ...start, index: 1 }, note({ step: 'F', alter: 0, accidental: 'explicit' }));
    score = insertEvent(score, { ...start, index: 2 }, auto());
    expect(pitchAt(0, 2).alter).toBe(0);
    score = insertEvent(score, { ...start, measureIndex: 1 }, auto());
    expect(pitchAt(1).alter).toBe(1);
    score = setMeasureSettings(score, 0, { keySignature: keySignatureFor('C') });
    expect(pitchAt(0).alter).toBe(0);
    expect(pitchAt(1).alter).toBe(0);
  });
  it('shares earlier explicit accidentals across voices by musical time', () => {
    let score = insertEvent(createScore(), start, note({ step: 'F', alter: -1 }));
    score = insertEvent(score, { ...start, voice: 1 }, { id: newId(), kind: 'rest', duration: 4 });
    expect(resolvePitch(score, { ...start, voice: 1, index: 1 }, { step: 'F', octave: 4, alter: 0, accidental: 'auto' }).alter).toBe(-1);
    expect(resolvePitch(score, { ...start, voice: 1, index: 1 }, { step: 'F', octave: 5, alter: 0, accidental: 'auto' }).alter).toBe(0);
    score = deleteEvent(score, start);
    expect(resolvePitch(score, { ...start, voice: 1, index: 1 }, { step: 'F', octave: 4, alter: 0, accidental: 'auto' }).alter).toBe(0);
  });
  it('re-evaluates grace pitches and carries their explicit accidental into the principal note', () => {
    let score = setMeasureSettings(createScore(), 0, { keySignature: keySignatureFor('G') });
    score = insertEvent(score, start, { ...auto(), grace: [{ duration: 2, slash: true, pitches: [{ step: 'F', octave: 4, alter: 0, accidental: 'auto' }] }] });
    expect(score.measures[0].treble[0].grace?.[0].pitches[0].alter).toBe(1);
    score = setMeasureSettings(score, 0, { keySignature: keySignatureFor('C') });
    expect(score.measures[0].treble[0].grace?.[0].pitches[0].alter).toBe(0);
    score = patchEvent(score, start, { grace: [{ duration: 2, slash: true, pitches: [{ step: 'F', octave: 4, alter: -1, accidental: 'explicit' }] }] });
    expect(score.measures[0].treble[0]).toMatchObject({ pitches: [{ alter: -1 }] });
  });
  it('accepts double accidentals, custom signatures, and cross-staff notes', () => {
    let score = setMeasureSettings(createScore(), 0, { keySignature: { alterations: { C: 2, D: -2 } } });
    score = insertEvent(score, start, note({ step: 'C', alter: 0, accidental: 'auto', staff: 'bass' }));
    const event = score.measures[0].treble[0];
    expect(event.kind === 'note' && event.pitches[0]).toMatchObject({ alter: 2, staff: 'bass' });
    expect(keySignatureFor('F# minor').alterations).toEqual({ F: 1, C: 1, G: 1 });
  });
});

describe('anchored notation and persistence', () => {
  function pair() {
    let score = insertEvent(createScore(), start, note());
    score = insertEvent(score, { ...start, index: 1 }, note());
    const mark: ScoreMark = { id: newId(), kind: 'tie', value: '', placement: 'above', start: { measureId: score.measures[0].id, staff: 'treble', eventId: score.measures[0].treble[0].id, pitchIndex: 0 }, end: { measureId: score.measures[0].id, staff: 'treble', eventId: score.measures[0].treble[1].id, pitchIndex: 0 } };
    return { score, mark };
  }
  it('cleans dangling marks on deletion, preserving the old undo snapshot', () => {
    const { score, mark } = pair();
    const marked = setScoreMark(score, mark);
    const deleted = deleteEvent(marked, start);
    expect(deleted.marks).toEqual([]);
    expect(marked.marks).toEqual([mark]);
  });
  it('removes note-only spans when converting an endpoint to a rest', () => {
    const { score, mark } = pair();
    const marked = setScoreMark(score, { ...mark, start: { ...mark.start, pitchIndex: undefined }, end: { ...mark.end!, pitchIndex: undefined } });
    const converted = updateEvent(marked, start, { id: marked.measures[0].treble[0].id, kind: 'rest', duration: 4 });
    expect(converted.marks).toEqual([]);
  });
  it('validates tie pitches after resolving key signatures', () => {
    const { score, mark } = pair();
    score.measures[0].keySignature = keySignatureFor('G');
    Object.assign(score.measures[0].treble[0], { pitches: [{ step: 'F', octave: 4, alter: 0, accidental: 'auto' }] });
    Object.assign(score.measures[0].treble[1], { pitches: [{ step: 'F', octave: 4, alter: 1, accidental: 'explicit' }] });
    expect(setScoreMark(score, mark).marks).toHaveLength(1);
    const crossBar = createScore();
    crossBar.measures[0].keySignature = keySignatureFor('G');
    crossBar.measures[1].keySignature = keySignatureFor('C');
    crossBar.measures[0].treble = [auto()];
    crossBar.measures[1].treble = [auto()];
    expect(() => setScoreMark(crossBar, { ...mark,
      start: { measureId: crossBar.measures[0].id, staff: 'treble', eventId: crossBar.measures[0].treble[0].id },
      end: { measureId: crossBar.measures[1].id, staff: 'treble', eventId: crossBar.measures[1].treble[0].id },
    })).toThrow(/matching spelled pitches/);
  });
  it('adjusts surviving pitch anchors when an earlier chord pitch is removed', () => {
    const { score, mark } = pair();
    let chord = addChordPitch(score, start, { step: 'E', alter: 0, octave: 4 });
    chord = setScoreMark(chord, { ...mark, kind: 'dynamic', value: 'f', end: undefined, start: { ...mark.start, pitchIndex: 1 } });
    chord = removeChordPitch(chord, start, 0);
    expect(chord.marks?.[0].start.pitchIndex).toBe(0);
  });
  it('rejects dangling anchors, backward spans, mismatched ties and invalid enums', () => {
    const { score, mark } = pair();
    expect(() => setScoreMark(score, { ...mark, start: { ...mark.start, eventId: 'missing' } })).toThrow(/missing event/);
    expect(() => setScoreMark(score, { ...mark, start: mark.end!, end: mark.start })).toThrow(/after its start/);
    const changed = updateEvent(score, { ...start, index: 1 }, { ...score.measures[0].treble[1], kind: 'note', pitches: [{ step: 'D', alter: 0, octave: 4 }] });
    expect(() => setScoreMark(changed, mark)).toThrow(/matching spelled pitches/);
    expect(() => setScoreMark(score, { ...mark, kind: 'hairpin', value: 'louder' })).toThrow(/hairpin/);
  });
  it('round-trips complete notation and migrates both legacy versions', () => {
    let score = insertEvent(createScore(), start, { ...note({ fingering: '1-2', accidental: 'courtesy' }), dots: 1, stem: 'up', beam: 'none', articulations: ['staccato'], ornament: 'trill', tremolo: 2, arpeggio: 'up', grace: [{ duration: 1, slash: true, pitches: [{ step: 'D', alter: 0, octave: 4 }] }] });
    score = setMeasureSettings(score, 0, { keySignature: keySignatureFor('F'), timeSignature: { beats: 6, beatType: 8 }, clefs: { bass: 'tenor' }, barline: 'repeatEnd', repeatStart: true, systemBreak: true, pageBreak: true });
    score = insertEvent(score, { ...start, staff: 'bass', voice: 3 }, { id: newId(), kind: 'rest', duration: 4, restLine: 2.5 });
    score = setComposer(score, 'Composer');
    score = setScoreMark(score, { id: newId(), kind: 'tempo', start: { measureId: score.measures[0].id, staff: 'treble' }, value: 'Andante', placement: 'above' });
    expect(parseScore(serializeScore(score))).toEqual(score);
    for (const version of [1, 2]) {
      const old = { ...insertEvent(createScore(), start, note()), version };
      const migrated = parseScore(JSON.stringify(old));
      expect(migrated).toEqual({ ...old, version: 3 });
    }
  });
  it('rejects unsupported optional notation instead of silently discarding it', () => {
    const score = insertEvent(createScore(), start, note());
    for (const patch of [{ stem: 'sideways' }, { ornament: 'unknown' }, { articulations: ['unknown'] }, { grace: [{ duration: 4, slash: true, pitches: [] }] }]) {
      const copy = structuredClone(score);
      Object.assign(copy.measures[0].treble[0], patch);
      expect(() => validateScore(copy)).toThrow();
    }
  });
});


describe('full-measure rests', () => {
  it.each([3, 5])('preserves the whole-rest glyph and exact %s/4 timing through save/open', (beats) => {
    let score = setMeasureSettings(createScore(), 0, { timeSignature: { beats, beatType: 4 } });
    score = insertEvent(score, start, { id: newId(), kind: 'rest', duration: 16, measureRest: beats * 4 });
    expect(eventFraction(score.measures[0].treble[0])).toEqual({ numerator: beats * 4, denominator: 1 });
    expect(parseScore(serializeScore(score))).toEqual(score);
    expect(score.measures[0].treble[0].duration).toBe(16);
  });
  it('updates all inherited full-bar rests and preserves local overrides and pickups', () => {
    let score = createScore();
    score = insertEvent(score, start, { id: newId(), kind: 'rest', duration: 16, measureRest: 16 });
    score = insertEvent(score, { ...start, measureIndex: 1, voice: 2 }, { id: newId(), kind: 'rest', duration: 16, measureRest: 16 });
    score = setMeasureSettings(score, 2, { timeSignature: { beats: 5, beatType: 4 } });
    score = insertEvent(score, { ...start, measureIndex: 2 }, { id: newId(), kind: 'rest', duration: 16, measureRest: 20 });
    score = setMeasureSettings(score, 0, { timeSignature: { beats: 3, beatType: 4 } });
    expect(score.measures[0].treble[0].measureRest).toBe(12);
    expect(getEvents(score.measures[1], 'treble', 2)[0].measureRest).toBe(12);
    expect(score.measures[2].treble[0].measureRest).toBe(20);
    score = setMeasureSettings(score, 0, { pickup: 4 });
    expect(score.measures[0].treble[0].measureRest).toBe(4);
    expect(getEvents(score.measures[1], 'treble', 2)[0].measureRest).toBe(12);
  });
  it('rejects invalid full-bar rest combinations and long manual beams', () => {
    const base = createScore();
    for (const invalid of [
      { ...note(), duration: 16, measureRest: 16 },
      { id: newId(), kind: 'rest', duration: 8, measureRest: 16 },
      { id: newId(), kind: 'rest', duration: 16, measureRest: 12 },
      { id: newId(), kind: 'rest', duration: 16, measureRest: 16, dots: 1 },
      { id: newId(), kind: 'rest', duration: 16, measureRest: 16, tuplet: { actual: 3, normal: 2, group: 'g' } },
      { ...note(), beam: 'start' },
    ]) {
      const score = structuredClone(base);
      score.measures[0].treble = [invalid as ScoreEvent];
      expect(() => validateScore(score)).toThrow();
    }
    const score = structuredClone(base);
    score.measures[0].treble = [{ id: newId(), kind: 'rest', duration: 16, measureRest: 16 }, note()];
    expect(() => validateScore(score)).toThrow(/only event/);
    expect(() => insertEvent(base, start, { ...note(), duration: 2, beam: 'start' })).not.toThrow();
    expect(() => insertEvent(base, start, { ...note(), beam: 'none' })).not.toThrow();
  });
});
