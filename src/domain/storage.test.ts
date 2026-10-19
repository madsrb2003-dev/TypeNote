import { describe, expect, it } from 'vitest';
import { createDemoScore, createScore, newId } from './model';
import { parseScore, serializeScore } from './storage';

describe('local score files', () => {
  it('round-trips both staves, exact durations, title, pitch spelling and IDs', () => {
    const score = createDemoScore();
    score.title = 'Øvelse ♫';
    const first = score.measures[0].treble[0];
    if (first.kind === 'note') first.pitches[0].alter = -1;
    expect(parseScore(serializeScore(score))).toEqual(score);
    expect(parseScore(serializeScore(createScore()))).toEqual(expect.objectContaining({ version: 2 }));
  });

  it('rejects invalid JSON, unsupported version and unexpected fields', () => {
    expect(() => parseScore('%PDF')).toThrow(/JSON/);
    expect(() => parseScore('null')).toThrow(/object/);
    expect(() => parseScore(JSON.stringify({ ...createScore(), version: 99 }))).toThrow(/version/);
    expect(() => parseScore(JSON.stringify({ ...createScore(), ignoredMusic: [] }))).toThrow(/unsupported fields/);
  });

  it('enforces both file byte size and score limits', () => {
    expect(() => parseScore(' '.repeat(10 * 1024 * 1024 + 1))).toThrow(/10 MB/);
    expect(() => parseScore('ø'.repeat(5 * 1024 * 1024 + 1))).toThrow(/10 MB/);
    expect(() => serializeScore({ ...createScore(), title: 'x'.repeat(121) })).toThrow(/title/);
    expect(() => serializeScore({ ...createScore(), measures: [] })).toThrow(/measures/);
    const score = createScore();
    score.measures = Array.from({ length: 201 }, () => ({ id: newId(), treble: [], bass: [] }));
    expect(() => serializeScore(score)).toThrow(/200/);
  });

  it('can reopen the largest supported score even with maximum-length IDs', () => {
    let counter = 0;
    const id = () => String(counter++).padStart(100, 'x');
    const events = () => Array.from({ length: 16 }, () => ({
      id: id(), kind: 'note' as const, duration: 1 as const,
      pitches: Array.from({ length: 10 }, (_, i) => ({ step: (i % 2 ? 'D' : 'C') as 'C' | 'D', alter: 0 as const, octave: Math.floor(i / 2) })),
    }));
    const score = createScore();
    score.title = 'ø'.repeat(120);
    score.measures = Array.from({ length: 200 }, () => ({ id: id(), treble: events(), bass: events() }));
    expect(parseScore(serializeScore(score))).toEqual(score);
  });

  it('rejects duplicate IDs, invalid durations, excessive timing and duplicate pitches', () => {
    const score = createDemoScore();
    const check = (mutate: (data: ReturnType<typeof createDemoScore>) => void, message: RegExp) => {
      const copy = structuredClone(score);
      mutate(copy);
      expect(() => parseScore(JSON.stringify(copy))).toThrow(message);
    };
    check((copy) => { copy.measures[1].id = copy.measures[0].id; }, /unique/);
    check((copy) => { copy.measures[0].bass[0].id = copy.measures[0].treble[0].id; }, /unique/);
    check((copy) => { Object.assign(copy.measures[0].treble[0], { duration: 3 }); }, /duration/);
    check((copy) => { copy.measures[0].treble[0].duration = 16; }, /capacity/);
    check((copy) => {
      const event = copy.measures[0].treble[0];
      if (event.kind === 'note') event.pitches.push({ ...event.pitches[0] });
    }, /cannot repeat/);
    expect(score).toEqual(parseScore(serializeScore(score)));
  });

  it.each([
    [{ step: 'H', alter: 0, octave: 4 }, /step/],
    [{ step: 'C', alter: 2, octave: 4 }, /alteration/],
    [{ step: 'C', alter: 0, octave: -1 }, /octave/],
    [{ step: 'C', alter: 0, octave: 4.5 }, /octave/],
    [{ step: 'C', alter: 0, octave: 4, frequency: 261 }, /unsupported fields/],
  ])('rejects unsupported pitch data %j', (pitch, message) => {
    const score = createDemoScore();
    Object.assign(score.measures[0].treble[0], { pitches: [pitch] });
    expect(() => parseScore(JSON.stringify(score))).toThrow(message);
  });
});
