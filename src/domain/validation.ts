import { ALL_DURATIONS, ARTICULATIONS, DYNAMICS, DURATIONS, MAX_CHORD_PITCHES, ORNAMENTS } from './types';
import type { Anchor, Measure, Pitch, Score, ScoreEvent, Step } from './types';
import { compareFractions, eventFraction, measureCapacity, numberFraction, sumFractions } from './timing';
import { getEvents, keySignatureFor, resolveAutoPitches } from './settings';

const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
function fail(message: string): never { throw new Error(`Invalid score: ${message}`); }
function record(value: unknown, name: string, required: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} must be an object.`);
  const result = value as Record<string, unknown>;
  if (required.some((key) => !Object.hasOwn(result, key)) || Object.keys(result).some((key) => !required.includes(key) && !optional.includes(key))) fail(`${name} has missing or unsupported fields.`);
  return result;
}
function integer(value: unknown, min: number, max: number, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}.`);
}
function text(value: unknown, max: number, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length > max) fail(`${name} must be text of at most ${max} characters.`);
}
function enumeration(value: unknown, choices: readonly unknown[], name: string): void {
  if (!choices.includes(value)) fail(`unsupported ${name}.`);
}
function flag(value: unknown, name: string): void { if (typeof value !== 'boolean') fail(`${name} must be true or false.`); }
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('IDs must contain 1–100 letters, digits, hyphens, or underscores.');
}
const eventOptions = ['dots', 'tuplet', 'stem', 'beam', 'displayStaff', 'articulations', 'ornament', 'tremolo', 'arpeggio', 'grace', 'restLine', 'measureRest'];
const measureOptions = ['keySignature', 'timeSignature', 'clefs', 'pickup', 'barline', 'repeatStart', 'systemBreak', 'pageBreak', 'extraVoices'];

/** Validate all musical data and migrate legacy files without discarding fields. */
export function validateScore(input: unknown): Score {
  const top = record(input, 'score', ['version', 'title', 'measures'], ['composer', 'marks']);
  if (![1, 2, 3].includes(top.version as number)) fail('unsupported file version; this editor supports versions 1, 2 and 3.');
  const legacy = top.version !== 3;
  if (legacy) record(input, 'legacy score', ['version', 'title', 'measures']);
  text(top.title, 120, 'title');
  if (top.composer !== undefined) text(top.composer, 120, 'composer');
  if (!Array.isArray(top.measures) || top.measures.length < 1 || top.measures.length > 200) fail('a score must contain between 1 and 200 measures.');
  const ids = new Set<string>();
  function readId(value: unknown): void {
    identifier(value);
    if (ids.has(value)) fail('measure, event and mark IDs must be unique.');
    ids.add(value);
  }
  function pitch(value: unknown): void {
    const p = record(value, 'pitch', ['step', 'alter', 'octave'], legacy ? [] : ['accidental', 'staff', 'fingering']);
    enumeration(p.step, STEPS, 'pitch step');
    integer(p.alter, legacy ? -1 : -2, legacy ? 1 : 2, 'pitch alteration');
    integer(p.octave, 0, 8, 'pitch octave');
    if (p.accidental !== undefined) enumeration(p.accidental, ['auto', 'explicit', 'courtesy'], 'accidental policy');
    if (p.staff !== undefined) enumeration(p.staff, ['treble', 'bass'], 'pitch staff');
    if (p.fingering !== undefined) {
      text(p.fingering, 12, 'fingering');
      if (!/^[1-5](?:[-–][1-5])?$/.test(p.fingering)) fail('fingering must be 1–5 or a finger substitution such as 1–2.');
    }
  }
  function pitches(value: unknown, grace = false): void {
    if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHORD_PITCHES) fail(`notes and chords must contain between 1 and ${MAX_CHORD_PITCHES} pitches.`);
    if (top.version === 1 && !grace && value.length !== 1) fail('version 1 requires exactly one pitch per note.');
    value.forEach(pitch);
    const positions = new Set<string>();
    for (const p of value as Pitch[]) {
      const key = `${p.step}${p.octave}`;
      if (positions.has(key)) fail('a chord cannot repeat the same pitch step and octave, even with different accidentals.');
      positions.add(key);
    }
  }
  function events(value: unknown): void {
    if (!Array.isArray(value) || value.length > (legacy ? 16 : 4096)) fail('invalid staff event list.');
    for (const item of value) {
      if (!item || typeof item !== 'object') fail('invalid event.');
      const kind = (item as Record<string, unknown>).kind;
      enumeration(kind, ['note', 'rest'], 'event kind');
      const e = record(item, 'event', kind === 'note' ? ['id', 'kind', 'duration', 'pitches'] : ['id', 'kind', 'duration'], legacy ? [] : eventOptions);
      readId(e.id);
      enumeration(e.duration, legacy ? DURATIONS : ALL_DURATIONS, 'note duration');
      if (kind === 'note') pitches(e.pitches);
      if (e.measureRest !== undefined) {
        if (kind !== 'rest' || e.duration !== 16 || (e.dots !== undefined && e.dots !== 0) || e.tuplet !== undefined) fail('a full-measure rest must use a whole-rest glyph without dots or tuplet.');
        if (typeof e.measureRest !== 'number' || !Number.isFinite(e.measureRest) || e.measureRest <= 0 || e.measureRest > 512 || !Number.isInteger(e.measureRest * 8)) fail('invalid full-measure rest duration.');
        if (value.length !== 1) fail('a full-measure rest must be the only event in its voice.');
      }
      if (e.dots !== undefined) integer(e.dots, 0, 2, 'dots');
      if (e.tuplet !== undefined) {
        const t = record(e.tuplet, 'tuplet', ['actual', 'normal', 'group']);
        integer(t.actual, 2, 32, 'tuplet count'); integer(t.normal, 1, 32, 'tuplet normal count'); identifier(t.group);
      }
      if (e.stem !== undefined) enumeration(e.stem, ['auto', 'up', 'down'], 'stem direction');
      if (e.beam !== undefined) {
        enumeration(e.beam, ['auto', 'start', 'continue', 'end', 'none'], 'beam instruction');
        if (['start', 'continue', 'end'].includes(e.beam as string) && (e.duration as number) > 2) fail('manual beams require eighth notes or shorter.');
      }
      if (e.displayStaff !== undefined) enumeration(e.displayStaff, ['treble', 'bass'], 'display staff');
      if (e.articulations !== undefined) {
        if (!Array.isArray(e.articulations) || e.articulations.length > ARTICULATIONS.length || new Set(e.articulations).size !== e.articulations.length) fail('invalid articulation list.');
        e.articulations.forEach((a) => enumeration(a, ARTICULATIONS, 'articulation'));
      }
      if (e.ornament !== undefined) enumeration(e.ornament, ORNAMENTS, 'ornament');
      if (e.tremolo !== undefined) integer(e.tremolo, 1, 4, 'tremolo strokes');
      if (e.arpeggio !== undefined) enumeration(e.arpeggio, ['up', 'down'], 'arpeggio direction');
      if (e.restLine !== undefined && (kind !== 'rest' || typeof e.restLine !== 'number' || !Number.isInteger(e.restLine * 2) || e.restLine < 0 || e.restLine > 5)) fail('rest line must be a half-line from 0 to 5 on a rest.');
      if (e.grace !== undefined) {
        if (kind !== 'note' || !Array.isArray(e.grace) || e.grace.length > 16) fail('grace notes require a note event and at most 16 grace notes.');
        for (const item of e.grace) {
          const g = record(item, 'grace note', ['pitches', 'duration', 'slash']);
          pitches(g.pitches, true); enumeration(g.duration, ALL_DURATIONS, 'grace duration'); flag(g.slash, 'grace slash');
        }
      }
    }
    const groups = new Map<string, { actual: number; normal: number; ended: boolean }>();
    let previous: string | undefined;
    for (const e of value as ScoreEvent[]) {
      const current = e.tuplet?.group;
      if (previous && current !== previous) groups.get(previous)!.ended = true;
      if (e.tuplet) {
        const group = groups.get(e.tuplet.group);
        if (group && (group.ended || group.actual !== e.tuplet.actual || group.normal !== e.tuplet.normal)) fail('tuplet groups must be contiguous and use one consistent ratio.');
        if (!group) groups.set(e.tuplet.group, { ...e.tuplet, ended: false });
      }
      previous = current;
    }
  }
  for (const item of top.measures) {
    const m = record(item, 'measure', ['id', 'treble', 'bass'], legacy ? [] : measureOptions);
    readId(m.id); events(m.treble); events(m.bass);
    if (m.extraVoices !== undefined) {
      const voices = record(m.extraVoices, 'extra voices', [], ['treble', 'bass']);
      for (const voiceList of Object.values(voices)) {
        if (!Array.isArray(voiceList) || voiceList.length > 3) fail('each staff supports up to four voices.');
        voiceList.forEach(events);
      }
    }
    if (m.keySignature !== undefined) {
      const key = record(m.keySignature, 'key signature', ['alterations'], ['name', 'fifths']);
      if (key.name !== undefined) text(key.name, 40, 'key signature name');
      if (key.fifths !== undefined) integer(key.fifths, -7, 7, 'key signature fifths');
      const alterations = record(key.alterations, 'key alterations', [], STEPS);
      for (const a of Object.values(alterations)) integer(a, -2, 2, 'key alteration');
      if (key.name !== undefined && key.fifths !== undefined) {
        let named;
        try { named = keySignatureFor(key.name as string); } catch { fail('unsupported named key signature.'); }
        if (named.name !== key.name || named.fifths !== key.fifths || STEPS.some((step) => (named.alterations[step] ?? 0) !== (alterations[step] ?? 0))) fail('named key signature must match its fifths and alterations.');
      }
    }
    if (m.timeSignature !== undefined) {
      const time = record(m.timeSignature, 'time signature', ['beats', 'beatType'], ['groups']);
      integer(time.beats, 1, 32, 'time signature beats'); enumeration(time.beatType, [1, 2, 4, 8, 16, 32], 'time signature beat type');
      if (time.groups !== undefined) {
        if (!Array.isArray(time.groups) || !time.groups.length || time.groups.length > 32) fail('invalid additive time groups.');
        time.groups.forEach((group) => integer(group, 1, 32, 'time group'));
        if ((time.groups as number[]).reduce((a, b) => a + b, 0) !== time.beats) fail('additive time groups must sum to the numerator.');
      }
    }
    if (m.clefs !== undefined) Object.values(record(m.clefs, 'clefs', [], ['treble', 'bass'])).forEach((clef) => enumeration(clef, ['treble', 'bass', 'alto', 'tenor'], 'clef'));
    if (m.pickup !== undefined && (typeof m.pickup !== 'number' || !Number.isFinite(m.pickup) || m.pickup <= 0 || m.pickup > 512 || !Number.isInteger(m.pickup * 8))) fail('pickup length must be positive in 128th-note units, at most 512 ticks.');
    if (m.barline !== undefined) enumeration(m.barline, ['single', 'double', 'final', 'repeatEnd'], 'barline');
    for (const key of ['repeatStart', 'systemBreak', 'pageBreak']) if (m[key] !== undefined) flag(m[key], key);
  }
  // Resolve automatic alterations before validating semantic spans such as ties.
  const result = resolveAutoPitches(structuredClone({ ...top, version: 3 }) as unknown as Score);
  for (let index = 0; index < result.measures.length; index++) {
    const capacity = numberFraction(measureCapacity(result, index));
    for (const staff of ['treble', 'bass'] as const) for (let voice = 0; voice < 4; voice++) {
      const events = getEvents(result.measures[index], staff, voice);
      if (events.some((event) => event.measureRest !== undefined && compareFractions(numberFraction(event.measureRest), capacity) !== 0)) fail('a full-measure rest must match its measure capacity.');
      if (compareFractions(sumFractions(events.map(eventFraction)), capacity) > 0) fail('notes and rests exceed the measure capacity.');
    }
  }
  function anchor(value: unknown): Anchor {
    const a = record(value, 'mark anchor', ['measureId', 'staff'], ['eventId', 'pitchIndex']);
    identifier(a.measureId); enumeration(a.staff, ['treble', 'bass'], 'anchor staff');
    const measure = result.measures.find((m) => m.id === a.measureId);
    if (!measure) fail('mark anchor references a missing measure.');
    if (a.eventId !== undefined) {
      identifier(a.eventId);
      const all = Array.from({ length: 4 }, (_, voice) => getEvents(measure as Measure, a.staff as 'treble' | 'bass', voice)).flat();
      const event = all.find((e) => e.id === a.eventId);
      if (!event) fail('mark anchor references a missing event on its staff.');
      if (a.pitchIndex !== undefined) {
        if (event.kind !== 'note') fail('pitch anchor requires a note.');
        integer(a.pitchIndex, 0, event.pitches.length - 1, 'anchor pitch index');
      }
    } else if (a.pitchIndex !== undefined) fail('pitch anchor requires an event.');
    return a as unknown as Anchor;
  }
  if (top.marks !== undefined) {
    if (!Array.isArray(top.marks) || top.marks.length > 10000) fail('invalid score marks.');
    for (const item of top.marks) {
      const mark = record(item, 'score mark', ['id', 'kind', 'start', 'value', 'placement'], ['end']);
      readId(mark.id); enumeration(mark.kind, ['dynamic', 'hairpin', 'slur', 'tie', 'pedal', 'octave', 'glissando', 'text', 'tempo', 'rehearsal', 'ending', 'navigation', 'tremolo'], 'score mark kind');
      anchor(mark.start); if (mark.end !== undefined) anchor(mark.end);
      text(mark.value, 240, 'mark value'); enumeration(mark.placement, ['above', 'below'], 'mark placement');
      if (mark.kind === 'dynamic') enumeration(mark.value, DYNAMICS, 'dynamic');
      if (mark.kind === 'hairpin') enumeration(mark.value, ['crescendo', 'diminuendo'], 'hairpin');
      if (mark.kind === 'pedal') enumeration(mark.value, ['sustain', 'sostenuto', 'soft'], 'pedal');
      if (mark.kind === 'octave') enumeration(mark.value, ['8va', '8vb', '15ma', '15mb'], 'octave line');
      if (mark.kind === 'glissando') enumeration(mark.value, ['straight', 'wavy'], 'glissando');
      if (mark.kind === 'navigation') enumeration(mark.value, ['segno', 'coda', 'fine', 'dc', 'ds', 'dc-al-fine', 'ds-al-fine', 'dc-al-coda', 'ds-al-coda', 'to-coda'], 'navigation instruction');
      if (mark.kind === 'tremolo') enumeration(mark.value, ['1', '2', '3', '4'], 'tremolo strokes');
      if (mark.kind === 'tie' || mark.kind === 'slur') enumeration(mark.value, [''], 'tie or slur value');
      if (['hairpin', 'slur', 'tie', 'pedal', 'octave', 'glissando', 'ending', 'tremolo'].includes(mark.kind as string) && !mark.end) fail('this spanning mark requires an end anchor.');
      const locate = (value: unknown) => {
        const a = value as Anchor;
        const measureIndex = result.measures.findIndex((measure) => measure.id === a.measureId);
        const measure = result.measures[measureIndex];
        let time = { numerator: 0, denominator: 1 };
        let event: ScoreEvent | undefined;
        for (let voice = 0; voice < 4; voice++) {
          const list = getEvents(measure, a.staff, voice);
          const index = list.findIndex((item) => item.id === a.eventId);
          if (index >= 0) { event = list[index]; time = sumFractions(list.slice(0, index).map(eventFraction)); break; }
        }
        return { measureIndex, time, event, anchor: a };
      };
      if (mark.end) {
        const start = locate(mark.start), end = locate(mark.end);
        if (start.measureIndex > end.measureIndex || (start.measureIndex === end.measureIndex && compareFractions(start.time, end.time) > 0)) fail('a spanning mark must end at or after its start.');
        if (['tie', 'slur', 'glissando', 'tremolo'].includes(mark.kind as string)) {
          if (start.event?.kind !== 'note' || end.event?.kind !== 'note' || start.event.id === end.event.id) fail('this mark requires two distinct note anchors.');
          if (mark.kind === 'tie') {
            const first = start.event.pitches[start.anchor.pitchIndex ?? 0];
            const last = end.event.pitches[end.anchor.pitchIndex ?? 0];
            if (first.step !== last.step || first.octave !== last.octave || first.alter !== last.alter) fail('a tie must connect matching spelled pitches.');
          }
        }
      }
    }
  }
  // Optional undefined fields represent removal in editor patches.
  return JSON.parse(JSON.stringify(result)) as Score;
}
