import { describe, expect, it } from 'vitest';
import { appendMeasure, createDemoScore, createScore, deleteEvent, insertEvent, newId, pitchFromKey, pitchLabel, updateEvent, usedTicks } from './model';
import type { Position, ScoreEvent } from './types';

const start: Position = { measureIndex: 0, staff: 'treble', index: 0 };
const quarter = (): ScoreEvent => ({ id: newId(), kind: 'note', duration: 4, pitches: [{ step: 'C', alter: 0, octave: 4 }] });

describe('pitch convention', () => {
  it('maps H to B natural and B to B flat regardless of entry accidental', () => {
    expect(pitchFromKey('h', 4)).toEqual({ step: 'B', alter: 0, octave: 4 });
    expect(pitchFromKey('b', 3, 1)).toEqual({ step: 'B', alter: -1, octave: 3 });
    expect(pitchFromKey('H', 5, 1)).toEqual({ step: 'B', alter: 1, octave: 5 });
    expect(pitchLabel(pitchFromKey('H', 4)!)).toBe('H4');
    expect(pitchLabel(pitchFromKey('B', 3)!)).toBe('B3');
    expect(pitchLabel(pitchFromKey('H', 5, 1)!)).toBe('H♯5');
  });

  it('retains spelling and rejects unsupported input or octave', () => {
    expect(pitchFromKey('C', 4, 1)).toEqual({ step: 'C', alter: 1, octave: 4 });
    expect(pitchLabel(pitchFromKey('D', 4, -1)!)).toBe('D♭4');
    expect(pitchFromKey('Escape', 4)).toBeNull();
    expect(() => pitchFromKey('C', 9)).toThrow(/octave/);
    expect(() => pitchFromKey('C', 3.5)).toThrow(/octave/);
  });
});

describe('score operations', () => {
  it('creates independent empty piano measures and a complete demo', () => {
    const score = createScore();
    expect(score.measures).toHaveLength(4);
    expect(score.measures[0].treble).not.toBe(score.measures[1].treble);
    for (const measure of createDemoScore().measures) {
      expect(usedTicks(measure.treble)).toBe(16);
      expect(usedTicks(measure.bass)).toBe(16);
    }
  });

  it('inserts, updates, and deletes immutably so old versions support undo', () => {
    const original = createScore();
    const event = quarter();
    const inserted = insertEvent(original, start, event);
    const updated = updateEvent(inserted, start, { ...event, duration: 8 });
    const deleted = deleteEvent(updated, start);
    expect(original.measures[0].treble).toEqual([]);
    expect(inserted.measures[0].treble[0].duration).toBe(4);
    expect(updated.measures[0].treble[0].duration).toBe(8);
    expect(deleted).toEqual(original);
    event.duration = 16;
    expect(inserted.measures[0].treble[0].duration).toBe(4);
  });

  it('inserts at a gap while keeping the other staff and measures intact', () => {
    const score = insertEvent(createScore(), start, quarter());
    const rest: ScoreEvent = { id: newId(), kind: 'rest', duration: 2 };
    const afterRest = insertEvent(score, start, rest);
    const bass = insertEvent(afterRest, { ...start, staff: 'bass' }, quarter());
    expect(afterRest.measures[0].treble.map((event) => event.kind)).toEqual(['rest', 'note']);
    expect(bass.measures[0].treble).toEqual(afterRest.measures[0].treble);
    expect(bass.measures[1]).toEqual(score.measures[1]);
    expect(afterRest.measures[0].bass).toEqual([]);
  });

  it('counts all sixteen subdivisions exactly and rejects overflow without mutation', () => {
    let score = createScore();
    for (let index = 0; index < 16; index++) {
      score = insertEvent(score, { ...start, index }, { id: newId(), kind: 'rest', duration: 1 });
    }
    expect(usedTicks(score.measures[0].treble)).toBe(16);
    const snapshot = structuredClone(score);
    expect(() => insertEvent(score, { ...start, index: 16 }, quarter())).toThrow(/full/);
    expect(() => updateEvent(score, start, { ...score.measures[0].treble[0], duration: 2 })).toThrow(/full/);
    expect(score).toEqual(snapshot);
  });

  it('rejects invalid positions and preserves event identity', () => {
    const score = createScore();
    expect(() => deleteEvent(score, start)).toThrow(/Select/);
    expect(() => insertEvent(score, { ...start, index: -1 }, quarter())).toThrow(/position/);
    expect(() => insertEvent(score, { ...start, measureIndex: 4 }, quarter())).toThrow(/measure/);
    const inserted = insertEvent(score, start, quarter());
    expect(() => updateEvent(inserted, start, quarter())).toThrow(/original ID/);
    expect(appendMeasure(score).measures).toHaveLength(5);
    expect(score.measures).toHaveLength(4);
  });
});
