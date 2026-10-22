import type { Alteration, Duration, EventNotation, Measure, MeasureSettings, Pitch, Position, Score, ScoreEvent, ScoreMark, Step } from './types';
import { validateScore } from './validation';
import { getEvents } from './settings';
import { compareFractions, eventFraction, measureCapacity, numberFraction, sumFractions } from './timing';
export { getEvents, effectiveSettings, resolvePitch, keySignatureFor } from './settings';
export { usedTicks, measureCapacity } from './timing';

export function newId(): string {
  return crypto.randomUUID();
}

function emptyMeasure(): Measure {
  return { id: newId(), treble: [], bass: [] };
}

export function createScore(): Score {
  return { version: 3, title: 'Untitled score', measures: Array.from({ length: 4 }, emptyMeasure) };
}

export function pitchFromKey(key: string, octave: number, alter: Alteration = 0): Pitch | null {
  const letter = key.toUpperCase();
  if (!['C', 'D', 'E', 'F', 'G', 'A', 'H', 'B'].includes(letter)) return null;
  if (!Number.isInteger(octave) || octave < 0 || octave > 8) throw new Error('Choose an octave from 0 to 8.');
  if (![-2, -1, 0, 1, 2].includes(alter)) throw new Error('Choose an accidental from double flat through double sharp.');
  return {
    step: letter === 'H' || letter === 'B' ? 'B' : letter as Step,
    alter: letter === 'B' ? -1 : alter,
    octave,
  };
}

export function pitchLabel(pitch: Pitch): string {
  const letter = pitch.step === 'B' ? (pitch.alter === -1 ? 'B' : 'H') : pitch.step;
  const accidental = pitch.step === 'B' && pitch.alter === -1 ? '' : pitch.alter === -1 ? '♭' : pitch.alter === 1 ? '♯' : pitch.alter === -2 ? '𝄫' : pitch.alter === 2 ? '𝄪' : '';
  return `${letter}${accidental}${pitch.octave}`;
}

function eventsAt(score: Score, position: Position, allowEnd: boolean): ScoreEvent[] {
  if (!Number.isInteger(position.measureIndex) || position.measureIndex < 0 || position.measureIndex >= score.measures.length) {
    throw new Error('Choose an existing measure.');
  }
  if (position.staff !== 'treble' && position.staff !== 'bass') throw new Error('Choose the treble or bass staff.');
  const events = getEvents(score.measures[position.measureIndex], position.staff, position.voice);
  if (!Number.isInteger(position.index) || position.index < 0 || position.index > events.length - (allowEnd ? 0 : 1)) {
    throw new Error(allowEnd ? 'Choose a valid insertion position.' : 'Select an existing note or rest.');
  }
  return events;
}

function removeDanglingMarks(score: Score): Score {
  if (!score.marks) return score;
  const valid = (anchor: ScoreMark['start'], needsNote: boolean) => {
    const measure = score.measures.find((item) => item.id === anchor.measureId);
    if (!measure) return false;
    if (!anchor.eventId) return anchor.pitchIndex === undefined;
    const event = Array.from({ length: 4 }, (_, voice) => getEvents(measure, anchor.staff, voice)).flat().find((item) => item.id === anchor.eventId);
    return !!event && (!needsNote || event.kind === 'note') && (anchor.pitchIndex === undefined || (event.kind === 'note' && anchor.pitchIndex < event.pitches.length));
  };
  return { ...score, marks: score.marks.filter((mark) => {
    const needsNote = ['tie', 'slur', 'glissando', 'tremolo'].includes(mark.kind);
    return valid(mark.start, needsNote) && (!mark.end || valid(mark.end, needsNote));
  }) };
}
function finishEdit(score: Score): Score {
  return validateScore(score);
}
function replaceEvents(score: Score, position: Position, events: ScoreEvent[]): Score {
  if (compareFractions(sumFractions(events.map(eventFraction)), numberFraction(measureCapacity(score, position.measureIndex))) > 0) {
    throw new Error('This measure is full: choose a shorter duration or another measure.');
  }
  const voice = position.voice ?? 0;
  const measures = score.measures.map((measure, index) => {
    if (index !== position.measureIndex) return measure;
    if (voice === 0) return { ...measure, [position.staff]: events };
    const voices = [...(measure.extraVoices?.[position.staff] ?? [])];
    while (voices.length < voice) voices.push([]);
    voices[voice - 1] = events;
    return { ...measure, extraVoices: { ...measure.extraVoices, [position.staff]: voices } };
  });
  return finishEdit(removeDanglingMarks({ ...score, measures }));
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
  const adjust = (anchor: ScoreMark['start']) => anchor.eventId === event.id && anchor.pitchIndex !== undefined && anchor.pitchIndex > pitchIndex ? { ...anchor, pitchIndex: anchor.pitchIndex - 1 } : anchor;
  const marks = score.marks?.filter((mark) => ![mark.start, mark.end].some((anchor) => anchor?.eventId === event.id && anchor.pitchIndex === pitchIndex)).map((mark) => ({ ...mark, start: adjust(mark.start), ...(mark.end ? { end: adjust(mark.end) } : {}) }));
  return updateEvent({ ...score, ...(marks ? { marks } : {}) }, position, { ...event, pitches: event.pitches.filter((_, index) => index !== pitchIndex) });
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

/** Undefined removes an optional setting, restoring inheritance. */
export function setMeasureSettings(score: Score, index: number, patch: MeasureSettings): Score {
  if (!Number.isInteger(index) || index < 0 || index >= score.measures.length) throw new Error('Choose an existing measure.');
  const measure = { ...score.measures[index], ...patch };
  for (const key of Object.keys(patch) as (keyof MeasureSettings)[]) if (patch[key] === undefined) delete measure[key];
  const changed = { ...score, measures: score.measures.map((item, i) => i === index ? measure : item) };
  // Whole-bar rests follow meter inheritance and irregular/pickup bar lengths.
  changed.measures = changed.measures.map((bar, barIndex) => {
    const refresh = (events: ScoreEvent[]) => events.map((event) => event.measureRest === undefined ? event : { ...event, measureRest: measureCapacity(changed, barIndex) });
    return { ...bar, treble: refresh(bar.treble), bass: refresh(bar.bass), ...(bar.extraVoices ? {
      extraVoices: Object.fromEntries(Object.entries(bar.extraVoices).map(([staff, voices]) => [staff, voices!.map(refresh)])),
    } : {}) };
  });
  return finishEdit(changed);
}
export function patchEvent(score: Score, position: Position, patch: Partial<EventNotation>): Score {
  const event = { ...eventsAt(score, position, false)[position.index], ...patch };
  for (const key of Object.keys(patch) as (keyof EventNotation)[]) if (patch[key] === undefined) delete event[key];
  return updateEvent(score, position, event);
}
export function setScoreMark(score: Score, mark: ScoreMark): Score {
  const marks = score.marks ?? [];
  return validateScore({ ...score, marks: marks.some((item) => item.id === mark.id) ? marks.map((item) => item.id === mark.id ? mark : item) : [...marks, mark] });
}
export function deleteScoreMark(score: Score, id: string): Score {
  return validateScore({ ...score, marks: (score.marks ?? []).filter((mark) => mark.id !== id) });
}
export function setComposer(score: Score, composer: string): Score {
  return validateScore({ ...score, composer });
}
