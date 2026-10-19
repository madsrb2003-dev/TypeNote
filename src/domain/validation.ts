import { DURATIONS, MAX_CHORD_PITCHES, MEASURE_TICKS } from './types';
import type { Duration, Measure, Pitch, Score, ScoreEvent, Step } from './types';

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

function fail(message: string): never {
  throw new Error(`Invalid score: ${message}`);
}

function record(value: unknown, name: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${name} must be an object.`);
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || keys.some((key) => !Object.hasOwn(result, key))) {
    fail(`${name} has missing or unsupported fields.`);
  }
  return result;
}

/** Validate and copy musical structure; migrate supported version 1 files to version 2. */
export function validateScore(input: unknown): Score {
  const score = record(input, 'score', ['version', 'title', 'measures']);
  if (score.version !== 1 && score.version !== 2) fail('unsupported file version; this editor supports versions 1 and 2.');
  if (typeof score.title !== 'string' || score.title.length > 120) {
    fail('title must be text of at most 120 characters.');
  }
  if (!Array.isArray(score.measures) || score.measures.length < 1 || score.measures.length > 200) {
    fail('a score must contain between 1 and 200 measures.');
  }
  const ids = new Set<string>();
  const readId = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) {
      fail('IDs must contain 1–100 letters, digits, hyphens, or underscores.');
    }
    if (ids.has(value)) fail('measure and event IDs must be unique.');
    ids.add(value);
    return value;
  };
  const readPitch = (value: unknown): Pitch => {
    const pitch = record(value, 'pitch', ['step', 'alter', 'octave']);
    if (!STEPS.includes(pitch.step as Step)) fail('unsupported pitch step.');
    if (pitch.alter !== -1 && pitch.alter !== 0 && pitch.alter !== 1) {
      fail('pitch alteration must be flat, natural, or sharp.');
    }
    if (typeof pitch.octave !== 'number' || !Number.isInteger(pitch.octave) || pitch.octave < 0 || pitch.octave > 8) {
      fail('pitch octave must be an integer from 0 to 8.');
    }
    return { step: pitch.step as Step, alter: pitch.alter, octave: pitch.octave };
  };
  const readEvents = (value: unknown): ScoreEvent[] => {
    if (!Array.isArray(value) || value.length > MEASURE_TICKS) fail('invalid staff event list.');
    const events = value.map((item): ScoreEvent => {
      if (!item || typeof item !== 'object') fail('invalid event.');
      const kind = (item as Record<string, unknown>).kind;
      if (kind !== 'note' && kind !== 'rest') fail('unsupported event kind.');
      const event = record(item, 'event', kind === 'note' ? ['id', 'kind', 'duration', 'pitches'] : ['id', 'kind', 'duration']);
      const id = readId(event.id);
      if (!DURATIONS.includes(event.duration as Duration)) fail('unsupported note duration.');
      const duration = event.duration as Duration;
      if (kind === 'rest') return { id, kind, duration };
      if (score.version === 1 && (!Array.isArray(event.pitches) || event.pitches.length !== 1)) {
        fail('version 1 requires exactly one pitch per note.');
      }
      if (!Array.isArray(event.pitches) || event.pitches.length < 1 || event.pitches.length > MAX_CHORD_PITCHES) {
        fail(`notes and chords must contain between 1 and ${MAX_CHORD_PITCHES} pitches.`);
      }
      const pitches = event.pitches.map(readPitch);
      const positions = new Set<string>();
      for (const pitch of pitches) {
        const position = `${pitch.step}${pitch.octave}`;
        if (positions.has(position)) fail('a chord cannot repeat the same pitch step and octave, even with different accidentals.');
        positions.add(position);
      }
      return { id, kind, duration, pitches };
    });
    if (events.reduce((ticks, event) => ticks + event.duration, 0) > MEASURE_TICKS) {
      fail('notes and rests exceed the 4/4 measure capacity.');
    }
    return events;
  };
  const measures = score.measures.map((value): Measure => {
    const measure = record(value, 'measure', ['id', 'treble', 'bass']);
    return { id: readId(measure.id), treble: readEvents(measure.treble), bass: readEvents(measure.bass) };
  });
  return { version: 2, title: score.title, measures };
}

