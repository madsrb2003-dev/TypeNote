import { describe, expect, it } from 'vitest';
import { addChordPitch, createScore, insertEvent, newId, removeChordPitch, updateChordPitch, usedTicks } from './model';
import { parseScore, serializeScore } from './storage';
import type { Position } from './types';
import { historyReducer, initialHistory } from './history';

const position: Position = { measureIndex: 0, staff: 'treble', index: 0 };
const single = () => insertEvent(createScore(), position, { id: newId(), kind: 'note', duration: 16, pitches: [{ step: 'C', alter: 0, octave: 4 }] });

describe('chords and compatibility', () => {
  it('adds pitches to a full measure without consuming more time, preserves pitch order and history', () => {
    const base = single();
    const chord = addChordPitch(base, position, { step: 'A', alter: -1, octave: 3 });
    expect(usedTicks(chord.measures[0].treble)).toBe(16);
    expect(base.measures[0].treble[0]).toMatchObject({ pitches: [{ step: 'C' }] });
    const history = initialHistory({ score: base, selection: { ...position, kind: 'event' } });
    const next = historyReducer(history, { type: 'commit', snapshot: { ...history.present, score: chord } });
    expect(historyReducer(next, { type: 'undo' }).present.score).toEqual(base);
    expect(historyReducer(historyReducer(next, { type: 'undo' }), { type: 'redo' }).present.score).toEqual(chord);
    expect(parseScore(serializeScore(chord))).toEqual(chord);
  });
  it('edits/removes one pitch and removes the event only when its final pitch is removed', () => {
    const chord = addChordPitch(single(), position, { step: 'E', alter: 0, octave: 4 });
    const changed = updateChordPitch(chord, position, 1, { step: 'F', alter: 1, octave: 4 });
    expect(changed.measures[0].treble[0]).toMatchObject({ pitches: [{ step: 'C' }, { step: 'F', alter: 1 }] });
    const one = removeChordPitch(changed, position, 0);
    expect(one.measures[0].treble[0]).toMatchObject({ duration: 16, pitches: [{ step: 'F' }] });
    expect(removeChordPitch(one, position, 0).measures[0].treble).toEqual([]);
    expect(() => removeChordPitch(changed, position, 8)).toThrow(/existing/);
  });
  it('rejects duplicates and conflicting accidentals at the same staff position without mutation', () => {
    const score = single();
    const before = serializeScore(score);
    expect(() => addChordPitch(score, position, { step: 'C', alter: 1, octave: 4 })).toThrow(/cannot repeat/);
    expect(serializeScore(score)).toBe(before);
    const chord = addChordPitch(score, position, { step: 'D', alter: -1, octave: 4 });
    expect(() => updateChordPitch(chord, position, 1, { step: 'C', alter: 0, octave: 4 })).toThrow(/cannot repeat/);
  });
  it('migrates single-note v1 files without changing music or IDs and refuses falsely labeled v1 chords', () => {
    const base = single();
    const legacy = { ...base, version: 1 };
    expect(parseScore(JSON.stringify(legacy))).toEqual(base);
    const chord = addChordPitch(base, position, { step: 'E', alter: 0, octave: 4 });
    expect(() => parseScore(JSON.stringify({ ...chord, version: 1 }))).toThrow(/exactly one/);
  });
  it('bounds chord size and rejects empty pitch arrays', () => {
    const score = single();
    const event = score.measures[0].treble[0];
    if (event.kind !== 'note') throw new Error('Expected a note');
    event.pitches = Array.from({ length: 10 }, (_, i) => ({ step: i % 2 ? 'D' : 'C', octave: Math.floor(i / 2), alter: 0 }));
    expect(parseScore(serializeScore(score))).toEqual(score);
    expect(() => addChordPitch(score, position, { step: 'G', octave: 7, alter: 0 })).toThrow(/10 pitches/);
    event.pitches = [];
    expect(() => serializeScore(score)).toThrow(/between 1/);
  });
});
