import { MEASURE_TICKS } from './types';
import type { Duration, Measure, Pitch, Position, Score, ScoreEvent, Step } from './types';
import { validateScore } from './validation';

export function newId(): string {
  return crypto.randomUUID();
}

function emptyMeasure(): Measure {
  return { id: newId(), treble: [], bass: [] };
}

export function createScore(): Score {
  return { version: 2, title: 'Untitled score', measures: Array.from({ length: 4 }, emptyMeasure) };
}

export function pitchFromKey(key: string, octave: number, alter: -1 | 0 | 1 = 0): Pitch | null {
  const letter = key.toUpperCase();
  if (!['C', 'D', 'E', 'F', 'G', 'A', 'H', 'B'].includes(letter)) return null;
  if (!Number.isInteger(octave) || octave < 0 || octave > 8) throw new Error('Choose an octave from 0 to 8.');
  if (![-1, 0, 1].includes(alter)) throw new Error('Choose flat, natural, or sharp.');
  return {
    step: letter === 'H' || letter === 'B' ? 'B' : letter as Step,
    alter: letter === 'B' ? -1 : alter,
    octave,
  };
}

export function pitchLabel(pitch: Pitch): string {
  const letter = pitch.step === 'B' ? (pitch.alter === -1 ? 'B' : 'H') : pitch.step;
  const accidental = pitch.step === 'B' && pitch.alter === -1 ? '' : pitch.alter === -1 ? '♭' : pitch.alter === 1 ? '♯' : '';
  return `${letter}${accidental}${pitch.octave}`;
}

export function usedTicks(events: ScoreEvent[]): number {
  return events.reduce((total, event) => total + event.duration, 0);
}

function eventsAt(score: Score, position: Position, allowEnd: boolean): ScoreEvent[] {
  if (!Number.isInteger(position.measureIndex) || position.measureIndex < 0 || position.measureIndex >= score.measures.length) {
    throw new Error('Choose an existing measure.');
  }
  if (position.staff !== 'treble' && position.staff !== 'bass') throw new Error('Choose the treble or bass staff.');
  const events = score.measures[position.measureIndex][position.staff];
  if (!Number.isInteger(position.index) || position.index < 0 || position.index > events.length - (allowEnd ? 0 : 1)) {
    throw new Error(allowEnd ? 'Choose a valid insertion position.' : 'Select an existing note or rest.');
  }
  return events;
}

function replaceEvents(score: Score, position: Position, events: ScoreEvent[]): Score {
  if (usedTicks(events) > MEASURE_TICKS) {
    throw new Error('This measure is full: choose a shorter duration or another measure.');
  }
  return validateScore({
    ...score,
    measures: score.measures.map((measure, index) => index === position.measureIndex ? { ...measure, [position.staff]: events } : measure),
  });
}

export function insertEvent(score: Score, position: Position, event: ScoreEvent): Score {
  const events = eventsAt(score, position, true);
  return replaceEvents(score, position, [...events.slice(0, position.index), event, ...events.slice(position.index)]);
}

export function updateEvent(score: Score, position: Position, event: ScoreEvent): Score {
  const events = eventsAt(score, position, false);
  if (event.id !== events[position.index].id) throw new Error('An edited event must retain its original ID.');
  return replaceEvents(score, position, events.map((current, index) => index === position.index ? event : current));
}

export function deleteEvent(score: Score, position: Position): Score {
  const events = eventsAt(score, position, false);
  return replaceEvents(score, position, events.filter((_, index) => index !== position.index));
}

function chordAt(score: Score, position: Position): Extract<ScoreEvent, { kind: 'note' }> {
  const event = eventsAt(score, position, false)[position.index];
  if (event.kind !== 'note') throw new Error('Select a note to edit its chord pitches.');
  return event;
}

function checkPitchIndex(event: Extract<ScoreEvent, { kind: 'note' }>, pitchIndex: number): void {
  if (!Number.isInteger(pitchIndex) || pitchIndex < 0 || pitchIndex >= event.pitches.length) {
    throw new Error('Select an existing chord pitch.');
  }
}

/** Chord pitches share one event duration; adding a pitch consumes no extra time. */
export function addChordPitch(score: Score, position: Position, pitch: Pitch): Score {
  const event = chordAt(score, position);
  return updateEvent(score, position, { ...event, pitches: [...event.pitches, pitch] });
}

export function updateChordPitch(score: Score, position: Position, pitchIndex: number, pitch: Pitch): Score {
  const event = chordAt(score, position);
  checkPitchIndex(event, pitchIndex);
  return updateEvent(score, position, {
    ...event, pitches: event.pitches.map((current, index) => index === pitchIndex ? pitch : current),
  });
}

/** Removing the final pitch removes the event, shifting later events as deletion does. */
export function removeChordPitch(score: Score, position: Position, pitchIndex: number): Score {
  const event = chordAt(score, position);
  checkPitchIndex(event, pitchIndex);
  if (event.pitches.length === 1) return deleteEvent(score, position);
  return updateEvent(score, position, { ...event, pitches: event.pitches.filter((_, index) => index !== pitchIndex) });
}

export function appendMeasure(score: Score): Score {
  if (score.measures.length >= 200) throw new Error('This editor supports up to 200 measures per score.');
  return validateScore({ ...score, measures: [...score.measures, emptyMeasure()] });
}

/** A short original phrase; no external score data is bundled. */
export function createDemoScore(): Score {
  const note = (key: string, octave: number, duration: Duration): ScoreEvent => ({
    id: newId(), kind: 'note', duration, pitches: [pitchFromKey(key, octave)!],
  });
  const score = createScore();
  score.title = 'A little beginning';
  score.measures[0].treble = ['C', 'D', 'E', 'G'].map((key) => note(key, 4, 4));
  score.measures[0].bass = [note('C', 3, 8), note('G', 2, 8)];
  score.measures[1].treble = [note('A', 4, 4), note('G', 4, 4), note('E', 4, 8)];
  score.measures[1].bass = [note('F', 2, 8), note('C', 3, 8)];
  score.measures[2].treble = [note('D', 4, 4), note('E', 4, 4), note('H', 4, 4), note('G', 4, 4)];
  score.measures[2].bass = [note('G', 2, 16)];
  score.measures[3].treble = [note('C', 5, 8), { id: newId(), kind: 'rest', duration: 8 }];
  score.measures[3].bass = [note('C', 3, 16)];
  return validateScore(score);
}
