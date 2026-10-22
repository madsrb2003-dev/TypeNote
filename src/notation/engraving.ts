import {
  Accidental, Articulation, Barline, Beam, Dot, Formatter, Fraction, FretHandFinger,
  GraceNote, GraceNoteGroup, Modifier, Ornament, Stave, StaveConnector, StaveModifier,
  StaveNote, Stroke, Tremolo, Tuplet, Voice,
} from 'vexflow/bravura';
import type { RenderContext } from 'vexflow/bravura';
import { pitchLabel } from '../domain/model';
import { effectiveSettings, getEvents, KEY_SIGNATURES } from '../domain/settings';
import { addFractions, compareFractions, eventFraction, measureCapacity, numberFraction, sumFractions } from '../domain/timing';
import { ALL_DURATIONS, DURATION_LABELS } from '../domain/types';
import type { Alteration, Clef, Duration, KeySignature, Measure, Pitch, Score, ScoreEvent, Selection, StaffId, Step } from '../domain/types';
import { annotationSpace, drawMarks } from './marks';
import type { AnchorPoint } from './marks';

export interface HitTarget { key: string; selection: Selection; label: string; description: string; left: number; top: number; width: number; height: number; placeholder?: boolean }
const notationDurations: Record<Duration, string> = { 32: '1/2', 16: 'w', 8: 'h', 4: 'q', 2: '8', 1: '16', 0.5: '32', 0.25: '64', 0.125: '128' };
const staffIds: StaffId[] = ['treble', 'bass'];
const stepIndices = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
const topPitches: Record<Clef, number> = { treble: 38, bass: 26, alto: 32, tenor: 30 };
const accidentalCodes: Record<Alteration, string> = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' };
const accidentalGlyphs: Record<Alteration, string> = { '-2': '\uE264', '-1': '\uE260', 0: '\uE261', 1: '\uE262', 2: '\uE263' };
const articulationCodes: Record<string, string> = { staccato: 'a.', staccatissimo: 'av', accent: 'a>', tenuto: 'a-', marcato: 'a^', fermata: 'a@a', breath: '\uE4CE' };
const ornamentCodes: Record<string, string> = { trill: 'tr', mordent: 'mordentInverted', 'inverted-mordent': 'mordent', turn: 'turn', 'inverted-turn': 'turnInverted', 'delayed-turn': 'turn' };
export const isSelected = (a: Selection, b: Selection) => a.kind === b.kind && a.staff === b.staff && (a.voice ?? 0) === (b.voice ?? 0) && a.measureIndex === b.measureIndex && a.index === b.index && (a.kind === 'gap' || a.pitchIndex === b.pitchIndex);
const fallbackScore = (measures: Measure[]): Score => ({ version: 3, title: '', measures });
const eventStaff = (event: ScoreEvent, staff: StaffId) => event.displayStaff ?? staff;
const pitchStaff = (pitch: Pitch, event: ScoreEvent, staff: StaffId) => pitch.staff ?? eventStaff(event, staff);
function eventDescription(event: ScoreEvent): string {
  if (event.kind === 'rest' && event.measureRest !== undefined) return 'full-measure rest';
  return `${event.dots ? `${event.dots === 2 ? 'double ' : ''}dotted ` : ''}${DURATION_LABELS[event.duration].toLowerCase()} ${event.kind === 'rest' ? 'rest' : event.pitches.map(pitchLabel).join(', ')}${event.tuplet ? `, tuplet ${event.tuplet.actual}:${event.tuplet.normal}` : ''}`;
}

interface TimedEvent { event: ScoreEvent; staff: StaffId; voice: number; index: number; time: ReturnType<typeof eventFraction> }
function timeline(measure: Measure): TimedEvent[] {
  const events: TimedEvent[] = [];
  for (const staff of staffIds) for (let voice = 0; voice <= (measure.extraVoices?.[staff]?.length ?? 0); voice++) {
    let time = { numerator: 0, denominator: 1 };
    getEvents(measure, staff, voice).forEach((event, index) => { events.push({ event, staff, voice, index, time }); time = addFractions(time, eventFraction(event)); });
  }
  return events.sort((a, b) => compareFractions(a.time, b.time));
}

/** Accidentals share staff state across voices, but never leak across bars or octaves. */
export function accidentalPlan(measure: Measure, signature: KeySignature): Map<string, (Alteration | null)[]> {
  const states = new Map<string, Alteration>();
  const result = new Map<string, (Alteration | null)[]>();
  const items = timeline(measure);
  for (let i = 0; i < items.length;) {
    let end = i + 1;
    while (end < items.length && compareFractions(items[i].time, items[end].time) === 0) end++;
    const changes = new Map<string, Alteration>();
    for (const { event, staff } of items.slice(i, end)) {
      if (event.kind === 'rest') continue;
      result.set(event.id, event.pitches.map(pitch => {
        const key = `${pitchStaff(pitch, event, staff)}/${pitch.step}/${pitch.octave}`;
        const current = states.get(key) ?? signature.alterations[pitch.step] ?? 0;
        changes.set(key, pitch.alter);
        return pitch.accidental === 'explicit' || pitch.accidental === 'courtesy' || pitch.alter !== current ? pitch.alter : null;
      }));
    }
    changes.forEach((value, key) => states.set(key, value));
    i = end;
  }
  return result;
}

/** Alterations are authoritative; descriptive metadata never changes the music. */
export function standardKeyName(key: KeySignature): string | undefined {
  const same = (candidate: KeySignature) => (Object.keys(stepIndices) as Step[]).every(step => (candidate.alterations[step] ?? 0) === (key.alterations[step] ?? 0));
  return KEY_SIGNATURES.find(candidate => candidate.name === key.name && same(candidate))?.name
    ?? KEY_SIGNATURES.find(candidate => same(candidate))?.name;
}

/** Arbitrary keys keep their supplied spelling, including mixed/double alterations. */
class PianoStave extends Stave {
  setNotationClef(clef: Clef) { this.clef = clef; return this; }
}

class CustomKeySignature extends StaveModifier {
  static get CATEGORY() { return 'KeySignature'; }
  private entries: { step: Step; alter: Alteration }[];
  constructor(key: KeySignature, previous?: KeySignature) {
    super(); this.setPosition(StaveModifier.Position.BEGIN);
    const order: Step[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    this.entries = [];
    if (previous) for (const step of order) if (previous.alterations[step] && previous.alterations[step] !== key.alterations[step]) this.entries.push({ step, alter: 0 });
    const newOrder = Object.values(key.alterations).every(value => (value ?? 0) <= 0) ? [...order].reverse() : order;
    for (const step of newOrder) if (key.alterations[step]) this.entries.push({ step, alter: key.alterations[step]! });
    this.setWidth(this.entries.length * 12 + (this.entries.length ? 5 : 0)); this.setPadding(8);
  }
  draw() {
    const stave = this.checkStave(), context = this.checkContext();
    const top = topPitches[stave.getClef() as Clef] ?? 38;
    context.save().setFont('Bravura', 24);
    this.entries.forEach(({ step, alter }, index) => {
      let pitch = Math.floor(top / 7) * 7 + stepIndices[step];
      while (pitch > top + 1) pitch -= 7;
      while (pitch < top - 7) pitch += 7;
      context.fillText(accidentalGlyphs[alter], this.getX() + index * 12, stave.getYForLine((top - pitch) / 2));
    });
    context.restore();
  }
}

/** Map split-chord heads onto physical staves while retaining a single shared stem. */
class PianoNote extends StaveNote {
  ledgerTargets?: { stave: Stave; line: number }[];
  drawLedgerLines() {
    if (!this.ledgerTargets) { super.drawLedgerLines(); return; }
    const context = this.checkContext();
    context.save().setLineWidth(1);
    this.ledgerTargets.forEach(({ stave, line }, index) => {
      const head = this.noteHeads[index];
      const x = head.getAbsoluteX();
      for (let ledger = 0; ledger >= line && line <= 0; ledger--) context.beginPath().moveTo(x - 3, stave.getYForNote(ledger)).lineTo(x + head.getWidth() + 3, stave.getYForNote(ledger)).stroke();
      for (let ledger = 6; ledger <= line && line >= 6; ledger++) context.beginPath().moveTo(x - 3, stave.getYForNote(ledger)).lineTo(x + head.getWidth() + 3, stave.getYForNote(ledger)).stroke();
    });
    context.restore();
  }
}

class CrossStaffBeam extends Beam {
  constructor(notes: StaveNote[], private centerY: number) { super(notes, false); this.renderOptions.flatBeams = true; }
  calculateFlatSlope() { this.slope = 0; this.yShift = 0; this.renderOptions.flatBeamOffset = this.centerY; }
}

interface VoiceDrawing { staff: StaffId; voiceIndex: number; events: ScoreEvent[]; notes: PianoNote[]; voice: Voice; tuplets: Tuplet[]; beams: Beam[] }
function buildVoices(score: Score, measureIndex: number, staves?: Record<StaffId, Stave>, selection?: Selection, print = false, crossBeamY?: number): VoiceDrawing[] {
  const measure = score.measures[measureIndex];
  const settings = effectiveSettings(score, measureIndex);
  const plannedAccidentals = accidentalPlan(measure, settings.keySignature);
  const drawings: VoiceDrawing[] = [];
  for (const staff of staffIds) {
    const count = Math.max(1 + (measure.extraVoices?.[staff]?.length ?? 0), selection?.measureIndex === measureIndex && selection.staff === staff ? (selection.voice ?? 0) + 1 : 1);
    for (let voiceIndex = 0; voiceIndex < count; voiceIndex++) {
      const events = getEvents(measure, staff, voiceIndex);
      const tuplets: Tuplet[] = [], beams: Beam[] = [];
      const groups = new Map<string, { notes: StaveNote[]; actual: number; normal: number }>();
      const notes = events.map((event, index) => {
        const targetStaff = eventStaff(event, staff), clef = settings.clefs[targetStaff];
        const stem = event.stem === 'up' ? 1 : event.stem === 'down' ? -1 : count > 1 ? (voiceIndex % 2 === 0 ? 1 : -1) : undefined;
        const note = new PianoNote({ clef, keys: event.kind === 'rest' ? ['r/4'] : event.pitches.map(p => `${p.step.toLowerCase()}/${p.octave}`), duration: notationDurations[event.duration] + (event.kind === 'rest' ? 'r' : ''), dots: event.dots ?? 0, alignCenter: event.measureRest !== undefined, autoStem: stem === undefined, ...(stem === undefined ? {} : { stemDirection: stem }) });
        if (event.kind === 'rest' && event.measureRest !== undefined) { const time = numberFraction(event.measureRest); note.setDuration(new Fraction(time.numerator, time.denominator * 16)); }
        if (event.kind === 'rest' && (event.restLine !== undefined || count > 1)) note.setKeyLine(0, event.restLine ?? (voiceIndex % 2 === 0 ? 4 : 2));
        if (event.kind === 'note') {
          if (staves) {
            const base = staves[targetStaff];
            const targets = event.pitches.map(pitch => {
              const destination = pitchStaff(pitch, event, staff), target = staves[destination];
              const top = topPitches[settings.clefs[destination]];
              const line = 5 - (top - (pitch.octave * 7 + stepIndices[pitch.step])) / 2;
              return { stave: target, line };
            });
            if (targets.some(target => target.stave !== base)) {
              targets.forEach((target, pitchIndex) => note.setKeyLine(pitchIndex, (base.getYForNote(0) - target.stave.getYForNote(target.line)) / 10));
              note.ledgerTargets = targets;
            }
          }
          event.pitches.forEach((pitch, pitchIndex) => {
            const alter = plannedAccidentals.get(event.id)?.[pitchIndex];
            if (alter !== undefined && alter !== null) {
              const accidental = new Accidental(accidentalCodes[alter]);
              if (pitch.accidental === 'courtesy') accidental.setAsCautionary();
              note.addModifier(accidental, pitchIndex);
            }
            if (pitch.fingering) note.addModifier(new FretHandFinger(pitch.fingering).setPosition(Modifier.Position.LEFT), pitchIndex);
          });
        }
        for (let d = 0; d < (event.dots ?? 0); d++) Dot.buildAndAttach([note], { all: true });
        for (const articulation of event.articulations ?? []) note.addModifier(new Articulation(articulation === 'fermata' && voiceIndex % 2 ? 'a@u' : articulationCodes[articulation] ?? articulation).setPosition(voiceIndex % 2 ? Modifier.Position.BELOW : Modifier.Position.ABOVE));
        if (event.ornament) note.addModifier(new Ornament(ornamentCodes[event.ornament] ?? event.ornament).setDelayed(event.ornament === 'delayed-turn'));
        if (event.tremolo) note.addModifier(new Tremolo(event.tremolo));
        if (event.arpeggio) note.addModifier(new Stroke(event.arpeggio === 'up' ? Stroke.Type.ROLL_UP : Stroke.Type.ROLL_DOWN));
        if (event.grace?.length) {
          const graces = event.grace.map(grace => {
            const graceNote = new GraceNote({ clef, keys: grace.pitches.map(p => `${p.step.toLowerCase()}/${p.octave}`), duration: notationDurations[grace.duration], slash: grace.slash });
            grace.pitches.forEach((pitch, i) => { if (pitch.alter || pitch.accidental === 'explicit' || pitch.accidental === 'courtesy') { const accidental = new Accidental(accidentalCodes[pitch.alter]); if (pitch.accidental === 'courtesy') accidental.setAsCautionary(); graceNote.addModifier(accidental, i); } });
            return graceNote;
          });
          const graceGroup = new GraceNoteGroup(graces, true); if (graces.length > 1) graceGroup.beamNotes(); note.addModifier(graceGroup);
        }
        if (event.tuplet) {
          const group = groups.get(event.tuplet.group) ?? { notes: [], actual: event.tuplet.actual, normal: event.tuplet.normal };
          group.notes.push(note); groups.set(event.tuplet.group, group);
        }
        if (!print && selection?.kind === 'event' && selection.measureIndex === measureIndex && selection.staff === staff && (selection.voice ?? 0) === voiceIndex && selection.index === index) {
          const style = { fillStyle: '#187aab', strokeStyle: '#187aab' };
          if (event.kind === 'note' && selection.pitchIndex !== undefined) note.setKeyStyle(Math.min(selection.pitchIndex, event.pitches.length - 1), style);
          else note.setStyle({ fillStyle: '#28634f', strokeStyle: '#28634f' });
        }
        if (staves) note.setStave(staves[targetStaff]);
        return note;
      });
      for (const group of groups.values()) tuplets.push(new Tuplet(group.notes, { numNotes: group.actual, notesOccupied: group.normal, bracketed: true, ratioed: group.actual !== 3 || group.normal !== 2, location: voiceIndex % 2 ? -1 : 1 }));
      // Fill exact unused time. Non-binary remainders carry an explicit tuplet ratio.
      const used = sumFractions(events.map(eventFraction));
      const capacity = numberFraction(measureCapacity(score, measureIndex));
      const remainder = addFractions(capacity, { numerator: -used.numerator, denominator: used.denominator });
      let odd = remainder.denominator; let binary = 1;
      while (odd % 2 === 0) { odd /= 2; binary *= 2; }
      let remaining = remainder.numerator / binary;
      const fillers: PianoNote[] = [];
      if (events.length === 0 && remainder.numerator > 0) {
        const rest = new PianoNote({ clef: settings.clefs[staff], keys: ['r/4'], duration: 'wr', alignCenter: true });
        rest.setDuration(new Fraction(remainder.numerator, remainder.denominator * 16));
        if (count > 1) rest.setKeyLine(0, voiceIndex % 2 === 0 ? 4 : 2);
        rest.setStyle({ fillStyle: print ? '#000' : '#aeb6ac', strokeStyle: print ? '#000' : '#aeb6ac' });
        if (staves) rest.setStave(staves[staff]);
        notes.push(rest); remaining = 0;
      }
      // Mixed coprime tuplets can produce a large common denominator. Keep the
      // exact remainder explicit without creating thousands of placeholder notes.
      if (remaining > 128) {
        const rest = new PianoNote({ clef: settings.clefs[staff], keys: ['r/4'], duration: 'wr' });
        rest.setStyle({ fillStyle: print ? '#000' : '#aeb6ac', strokeStyle: print ? '#000' : '#aeb6ac' });
        if (staves) rest.setStave(staves[staff]);
        tuplets.push(new Tuplet([rest], { numNotes: 16 * remainder.denominator, notesOccupied: remainder.numerator, bracketed: true, ratioed: true }));
        notes.push(rest); remaining = 0;
      }
      while (remaining > 0) {
        const duration = ALL_DURATIONS.find(d => d <= remaining) ?? 0.125;
        const fractionalTail = remaining < 0.125;
        const rest = new PianoNote({ clef: settings.clefs[staff], keys: ['r/4'], duration: `${notationDurations[duration]}r` });
        if (fractionalTail) {
          let actual = binary * odd, normal = Math.round(remaining * binary * 8);
          let a = actual, b = normal; while (b) [a, b] = [b, a % b];
          actual /= a; normal /= a;
          tuplets.push(new Tuplet([rest], { numNotes: actual, notesOccupied: normal, bracketed: true, ratioed: true }));
        }
        if (count > 1) rest.setKeyLine(0, voiceIndex % 2 === 0 ? 4 : 2);
        rest.setStyle({ fillStyle: print ? '#000' : '#aeb6ac', strokeStyle: print ? '#000' : '#aeb6ac' });
        if (staves) rest.setStave(staves[staff]);
        if (fractionalTail) { if (odd > 1 && fillers.length) tuplets.push(new Tuplet(fillers, { numNotes: odd, notesOccupied: 1, bracketed: true, ratioed: true })); notes.push(...fillers, rest); fillers.length = 0; remaining = 0; }
        else { fillers.push(rest); remaining -= duration; }
      }
      if (odd > 1 && fillers.length) tuplets.push(new Tuplet(fillers, { numNotes: odd, notesOccupied: 1, bracketed: true, ratioed: true }));
      notes.push(...fillers);
      const voice = new Voice({ numBeats: settings.timeSignature.beats, beatValue: settings.timeSignature.beatType }).setMode(Voice.Mode.SOFT).addTickables(notes);
      let manual: StaveNote[] = [];
      const flush = () => {
        if (manual.length > 1) {
          if (manual.some(note => !note.getGlyphProps().beamCount)) throw new Error('Manual beams require eighth notes or shorter.');
          if (!manual.every(note => note.isRest())) beams.push(new Beam(manual, false));
        }
        manual = [];
      };
      events.forEach((event, index) => {
        if (event.beam === 'start') { flush(); manual.push(notes[index]); }
        else if (event.beam === 'continue' || event.beam === 'end') { manual.push(notes[index]); if (event.beam === 'end') flush(); }
        else flush();
      }); flush();
      const hasManual = events.some(e => e.beam && e.beam !== 'auto');
      if (!hasManual) beams.push(...Beam.generateBeams(notes, { groups: settings.timeSignature.groups?.map(group => new Fraction(group, settings.timeSignature.beatType)) ?? Beam.getDefaultBeamGroups(`${settings.timeSignature.beats}/${settings.timeSignature.beatType}`), maintainStemDirections: count > 1 || events.some(event => event.stem && event.stem !== 'auto') }));
      if (staves) beams.forEach((beam, beamIndex) => {
        const destinations = new Set(beam.notes.map(note => note.getStave()));
        if (destinations.size > 1) {
          beam.notes.forEach(note => {
            const event = events[notes.indexOf(note as PianoNote)];
            if (!event?.stem || event.stem === 'auto') note.setStemDirection(note.getStave() === staves.treble ? -1 : 1);
          });
          beams[beamIndex] = new CrossStaffBeam(beam.notes as StaveNote[], crossBeamY ?? (staves.treble.getYForLine(4) + staves.bass.getYForLine(0)) / 2);
        }
      });
      drawings.push({ staff, voiceIndex, events, notes, voice, tuplets, beams });
    }
  }
  return drawings;
}

function staffExtents(measures: Measure[], staff: StaffId, score: Score, firstIndex: number) {
  const tops = [15], bottoms = [105];
  measures.forEach((measure, local) => {
    const settings = effectiveSettings(score, firstIndex + local);
    for (const { event, staff: sourceStaff, voice } of timeline(measure)) {
      const display = eventStaff(event, sourceStaff);
      const pitches = event.kind === 'note' ? event.pitches.filter(pitch => pitchStaff(pitch, event, sourceStaff) === staff) : [];
      if (!pitches.length && display !== staff) continue;
      const ys = pitches.map(pitch => 40 + (topPitches[settings.clefs[staff]] - (pitch.octave * 7 + stepIndices[pitch.step])) * 5);
      const min = ys.length ? Math.min(...ys) : 60, max = ys.length ? Math.max(...ys) : 60;
      const hasStem = event.kind === 'note' && event.duration < 16;
      const multiVoice = (measure.extraVoices?.[sourceStaff]?.length ?? 0) > 0;
      const up = event.stem === 'up' || (event.stem !== 'down' && (multiVoice ? voice % 2 === 0 : (min + max) / 2 >= 60));
      let top = min - (hasStem && up ? 40 : 18), bottom = max + (hasStem && !up ? 40 : 18);
      const notationRoom = (event.articulations?.length ?? 0) * 13 + (event.ornament ? 26 : 0) + (event.tuplet ? 23 : 0);
      if (voice % 2) bottom += notationRoom; else top -= notationRoom;
      for (const grace of event.grace ?? []) for (const pitch of grace.pitches) {
        const y = 40 + (topPitches[settings.clefs[staff]] - (pitch.octave * 7 + stepIndices[pitch.step])) * 5;
        top = Math.min(top, y - 30); bottom = Math.max(bottom, y + 18);
      }
      tops.push(top); bottoms.push(bottom);
    }
  });
  return { top: Math.min(...tops), bottom: Math.max(...bottoms) };
}
export function systemGeometry(measures: Measure[], score = fallbackScore(measures), firstIndex = 0) {
  const trebleExtent = staffExtents(measures, 'treble', score, firstIndex), bassExtent = staffExtents(measures, 'bass', score, firstIndex);
  const trebleAbove = annotationSpace(score, firstIndex, measures.length, 'treble', 'above');
  const trebleBelow = annotationSpace(score, firstIndex, measures.length, 'treble', 'below');
  const bassAbove = annotationSpace(score, firstIndex, measures.length, 'bass', 'above');
  const bassBelow = annotationSpace(score, firstIndex, measures.length, 'bass', 'below');
  const trebleY = 35 - trebleExtent.top + trebleAbove;
  const bassY = trebleY + trebleExtent.bottom + trebleBelow + 30 - bassExtent.top + bassAbove;
  return { trebleExtent, bassExtent, trebleY, bassY, height: bassY + bassExtent.bottom + bassBelow + 35 };
}

function addStaffSettings(stave: PianoStave, staff: StaffId, score: Score, index: number, first: boolean) {
  const measure = score.measures[index], settings = effectiveSettings(score, index);
  stave.setNotationClef(settings.clefs[staff]);
  if (first || measure.clefs?.[staff]) stave.addClef(settings.clefs[staff]);
  if (first || measure.keySignature) {
    const previous = index > 0 && measure.keySignature ? effectiveSettings(score, index - 1).keySignature : undefined;
    const name = standardKeyName(settings.keySignature), previousName = previous ? standardKeyName(previous) : undefined;
    if (name && (!previous || previousName)) stave.addKeySignature(name, previousName);
    else stave.addModifier(new CustomKeySignature(settings.keySignature, previous));
  }
  if (index === 0 || measure.timeSignature) stave.addTimeSignature(`${settings.timeSignature.groups?.join('+') ?? settings.timeSignature.beats}/${settings.timeSignature.beatType}`);
  if (measure.repeatStart) stave.setBegBarType(Barline.type.REPEAT_BEGIN);
  const barline = { single: Barline.type.SINGLE, double: Barline.type.DOUBLE, final: Barline.type.END, repeatEnd: Barline.type.REPEAT_END };
  stave.setEndBarType(barline[measure.barline ?? 'single']);
}

export function drawSystem(context: RenderContext, measures: Measure[], firstIndex: number, width: number, selection?: Selection, print = false, fullScore?: Score): HitTarget[] {
  const score = fullScore ?? fallbackScore(measures), offset = fullScore ? firstIndex : 0;
  const { trebleExtent, bassExtent, trebleY, bassY } = systemGeometry(measures, score, offset);
  const targets: HitTarget[] = [], anchors = new Map<string, AnchorPoint>(), measureBounds = new Map<string, { left: number; right: number }>();
  context.setFillStyle(print ? '#000' : '#26352d').setStrokeStyle(print ? '#000' : '#26352d');
  const barWidth = (width - 45) / measures.length;
  measures.forEach((measure, localIndex) => {
    const measureIndex = offset + localIndex, x = 30 + localIndex * barWidth;
    const staves = { treble: new PianoStave(x, trebleY, barWidth), bass: new PianoStave(x, bassY, barWidth) };
    for (const staff of staffIds) addStaffSettings(staves[staff], staff, score, measureIndex, localIndex === 0);
    const noteStart = Math.max(...staffIds.map(staff => staves[staff].getNoteStartX()));
    for (const staff of staffIds) staves[staff].setNoteStartX(noteStart).setContext(context).draw();
    new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();
    if (localIndex === 0) {
      new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.BRACE).setContext(context).draw();
      new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
    }
    context.setFont('Arial', 10).setFillStyle(print ? '#333' : '#899287').fillText(`${firstIndex + localIndex + 1}${measure.pickup !== undefined ? ' (pickup)' : ''}`, x + 6, trebleY + 20).setFillStyle(print ? '#000' : '#26352d');
    const crossBeamY = (trebleY + trebleExtent.bottom + annotationSpace(score, offset, measures.length, 'treble', 'below') + bassY + bassExtent.top - annotationSpace(score, offset, measures.length, 'bass', 'above')) / 2;
    const drawings = buildVoices(score, measureIndex, staves, selection, print, crossBeamY);
    const formatter = new Formatter();
    for (const staff of staffIds) formatter.joinVoices(drawings.filter(d => d.staff === staff).map(d => d.voice));
    formatter.format(drawings.map(d => d.voice), staves.treble.getNoteEndX() - noteStart - 25);
    for (const drawing of drawings) {
      const { staff, voiceIndex, events, notes, voice, tuplets, beams } = drawing;
      // Passing no stave preserves individual display-staff assignments, including cross-staff chords.
      voice.draw(context);
      for (const beam of beams) beam.setContext(context).draw();
      for (const tuplet of tuplets) tuplet.setContext(context).draw();
      const stave = staves[staff], staveY = staff === 'treble' ? trebleY : bassY;
      notes.forEach((note, index) => {
        const placeholder = index >= events.length, ys = note.getYs();
        const event = events[index];
        if (event) anchors.set(event.id, { x: note.getAbsoluteX() + 6, ys, top: Math.min(...ys), bottom: Math.max(...ys) });
        const voiceLabel = voiceIndex ? ` voice ${voiceIndex + 1}` : '';
        targets.push({ key: `${firstIndex + localIndex}-${staff}-${voiceIndex}-${index}-note`, selection: { kind: placeholder ? 'gap' : 'event', measureIndex: firstIndex + localIndex, staff, voice: voiceIndex, index: placeholder ? events.length : index }, label: placeholder ? `Unused time in ${staff}${voiceLabel} measure ${firstIndex + localIndex + 1}` : `Select ${staff}${voiceLabel} measure ${firstIndex + localIndex + 1} event ${index + 1}, ${eventDescription(event)}`, description: placeholder ? 'Unused time — click to insert here' : eventDescription(event), left: note.getAbsoluteX() - 11, top: Math.min(...ys) - 18, width: 38, height: Math.max(...ys) - Math.min(...ys) + 38, placeholder });
        if (event?.kind === 'note' && event.pitches.length > 1) {
          // The event target sits above the chord. Each head has its own target,
          // using VexFlow's final displaced/cross-staff position in source order.
          const eventTarget = targets[targets.length - 1];
          eventTarget.top = Math.min(...ys) - 24;
          eventTarget.height = 12;
          note.noteHeads.forEach((head, pitchIndex) => targets.push({
            key: `${firstIndex + localIndex}-${staff}-${voiceIndex}-${index}-pitch-${pitchIndex}`,
            selection: { kind: 'event', measureIndex, staff, voice: voiceIndex, index, pitchIndex },
            label: `Select pitch ${pitchLabel(event.pitches[pitchIndex])} in ${staff}${voiceLabel} measure ${measureIndex + 1} event ${index + 1}`,
            description: `Edit ${pitchLabel(event.pitches[pitchIndex])} · Delete removes this pitch`,
            // The drawn bounds include displacement exactly once, whereas
            // getAbsoluteX() reapplies it after drawing adjacent heads.
            left: head.getBoundingBox().getX() - 2, top: ys[pitchIndex] - 5,
            width: head.getWidth() + 4, height: 10,
          }));
        }
      });
      for (let index = 0; index <= events.length; index++) {
        const previous = index > 0 ? notes[index - 1].getAbsoluteX() : noteStart - 2;
        const next = index < notes.length ? notes[index].getAbsoluteX() : stave.getNoteEndX();
        const gapX = index === 0 ? Math.max(noteStart + 2, next - 22) : (previous + next) / 2;
        const voiceLabel = voiceIndex ? ` voice ${voiceIndex + 1}` : '';
        targets.push({ key: `${firstIndex + localIndex}-${staff}-${voiceIndex}-${index}-gap`, selection: { kind: 'gap', measureIndex: firstIndex + localIndex, staff, voice: voiceIndex, index }, label: `Insert ${staff}${voiceLabel} measure ${firstIndex + localIndex + 1} position ${index + 1}`, description: `Insert here${voiceLabel}`, left: gapX - 8, top: staveY + 14 + voiceIndex * 17, width: 16, height: Math.max(20, 79 - voiceIndex * 17) });
      }
    }
    measureBounds.set(measure.id, { left: noteStart, right: staves.treble.getNoteEndX() });
  });
  drawMarks(context, score, offset, measures.length, width, { treble: { top: trebleY + trebleExtent.top, bottom: trebleY + trebleExtent.bottom }, bass: { top: bassY + bassExtent.top, bottom: bassY + bassExtent.bottom } }, anchors, measureBounds);
  return targets;
}

export function minimumMeasureWidth(measure: Measure, first: boolean, initial: boolean, score?: Score, index = 0): number {
  const source = score ?? fallbackScore([measure]);
  const drawings = buildVoices(source, score ? index : 0);
  const formatter = new Formatter();
  for (const staff of staffIds) formatter.joinVoices(drawings.filter(d => d.staff === staff).map(d => d.voice));
  const settings = effectiveSettings(source, score ? index : 0);
  const signatureWidth = (first || measure.keySignature) ? Object.keys(settings.keySignature.alterations).length * 12 : 0;
  return Math.max(180, formatter.preCalculateMinTotalWidth(drawings.map(d => d.voice)) + signatureWidth + (first ? (initial ? 135 : 105) : 55) + (measure.timeSignature ? 45 : 0));
}
