import type { Alteration, Clef, KeySignature, Measure, Pitch, Position, Score, ScoreEvent, StaffId, Step, TimeSignature } from './types';
import { compareFractions, eventFraction, sumFractions } from './timing';

const major = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];
const minor = ['Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m'];
const sharps: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
const flats: Step[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];
export const KEY_SIGNATURES: KeySignature[] = [...major, ...minor].map((name, index) => {
  const fifths = index % 15 - 7;
  const alterations: Partial<Record<Step, Alteration>> = {};
  for (const step of (fifths >= 0 ? sharps : flats).slice(0, Math.abs(fifths))) alterations[step] = fifths >= 0 ? 1 : -1;
  return { name, fifths, alterations };
});
export function keySignatureFor(name: string): KeySignature {
  const normalized = name.trim().replace(/ major$/i, '').replace(/ minor$/i, 'm').replace(/♭/g, 'b').replace(/♯/g, '#');
  const signature = KEY_SIGNATURES.find((key) => key.name === normalized);
  if (!signature) throw new Error('Choose a supported major or minor key signature.');
  return structuredClone(signature);
}
export function effectiveSettings(score: Score, index: number): { keySignature: KeySignature; timeSignature: TimeSignature; clefs: Record<StaffId, Clef> } {
  if (!Number.isInteger(index) || index < 0 || index >= score.measures.length) throw new Error('Choose an existing measure.');
  let keySignature: KeySignature = { name: 'C', fifths: 0, alterations: {} };
  let timeSignature: TimeSignature = { beats: 4, beatType: 4 };
  let clefs: Record<StaffId, Clef> = { treble: 'treble', bass: 'bass' };
  for (let i = 0; i <= index; i++) {
    const measure = score.measures[i];
    keySignature = measure.keySignature ?? keySignature;
    timeSignature = measure.timeSignature ?? timeSignature;
    clefs = { ...clefs, ...measure.clefs };
  }
  return { keySignature, timeSignature, clefs };
}
export function getEvents(measure: Measure, staff: StaffId, voice = 0): ScoreEvent[] {
  if (staff !== 'treble' && staff !== 'bass') throw new Error('Choose the treble or bass staff.');
  if (!Number.isInteger(voice) || voice < 0 || voice > 3) throw new Error('Choose a voice from 1 to 4.');
  return voice === 0 ? measure[staff] : measure.extraVoices?.[staff]?.[voice - 1] ?? [];
}
export function resolvePitch(score: Score, position: Position, pitch: Pitch): Pitch {
  if (pitch.accidental !== 'auto') return { ...pitch };
  const measure = score.measures[position.measureIndex];
  if (!measure) throw new Error('Choose an existing measure.');
  const targetTime = sumFractions(getEvents(measure, position.staff, position.voice).slice(0, position.index).map(eventFraction));
  const staff = pitch.staff ?? position.staff;
  let alter = effectiveSettings(score, position.measureIndex).keySignature.alterations[pitch.step] ?? 0;
  const changes: { time: ReturnType<typeof eventFraction>; alter: Alteration }[] = [];
  for (const sourceStaff of ['treble', 'bass'] as const) for (let voice = 0; voice < 4; voice++) {
    let time = { numerator: 0, denominator: 1 };
    for (const event of getEvents(measure, sourceStaff, voice)) {
      if (compareFractions(time, targetTime) >= 0) break;
      if (event.kind === 'note') for (const previous of [...(event.grace ?? []).flatMap((grace) => grace.pitches), ...event.pitches]) {
        if ((previous.staff ?? event.displayStaff ?? sourceStaff) === staff && previous.step === pitch.step && previous.octave === pitch.octave && previous.accidental !== 'auto') changes.push({ time, alter: previous.alter });
      }
      time = sumFractions([time, eventFraction(event)]);
    }
  }
  changes.sort((a, b) => compareFractions(a.time, b.time));
  if (changes.length) alter = changes.at(-1)!.alter;
  return { ...pitch, alter };
}
export function resolveAutoPitches(score: Score): Score {
  return { ...score, measures: score.measures.map((measure, measureIndex) => {
    const resolve = (staff: StaffId, voice: number) => getEvents(measure, staff, voice).map((event, index) => {
      if (event.kind === 'rest') return event;
      const graceAlterations = new Map<string, Alteration>();
      const resolveOne = (pitch: Pitch): Pitch => {
        const displayStaff = pitch.staff ?? event.displayStaff ?? staff;
        const resolved = resolvePitch(score, { measureIndex, staff, voice, index }, { ...pitch, staff: displayStaff });
        const earlierGrace = graceAlterations.get(`${displayStaff}/${pitch.step}/${pitch.octave}`);
        return { ...pitch, alter: pitch.accidental === 'auto' && earlierGrace !== undefined ? earlierGrace : resolved.alter };
      };
      const grace = event.grace?.map((item) => ({ ...item, pitches: item.pitches.map((pitch) => {
        const resolved = resolveOne(pitch);
        if (pitch.accidental !== 'auto') graceAlterations.set(`${pitch.staff ?? event.displayStaff ?? staff}/${pitch.step}/${pitch.octave}`, resolved.alter);
        return resolved;
      }) }));
      return { ...event, ...(grace ? { grace } : {}), pitches: event.pitches.map(resolveOne) };
    });
    return { ...measure, treble: resolve('treble', 0), bass: resolve('bass', 0), ...(measure.extraVoices ? {
      extraVoices: Object.fromEntries(Object.entries(measure.extraVoices).map(([staff, voices]) => [staff, voices!.map((_, i) => resolve(staff as StaffId, i + 1))])),
    } : {}) };
  }) };
}
