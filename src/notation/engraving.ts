import { Accidental, Formatter, Stave, StaveConnector, StaveNote, Voice } from 'vexflow/bravura';
import type { RenderContext } from 'vexflow/bravura';
import { pitchLabel } from '../domain/model';
import { DURATIONS, DURATION_LABELS, MEASURE_TICKS } from '../domain/types';
import type { Duration, Measure, ScoreEvent, Selection, StaffId } from '../domain/types';

export interface HitTarget {
  key: string;
  selection: Selection;
  label: string;
  description: string;
  left: number;
  top: number;
  width: number;
  height: number;
  placeholder?: boolean;
}

const notationDurations: Record<Duration, string> = { 16: 'w', 8: 'h', 4: 'q', 2: '8', 1: '16' };
const staffIds: StaffId[] = ['treble', 'bass'];
const stepIndices = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
export const isSelected = (a: Selection, b: Selection) => a.kind === b.kind && a.staff === b.staff
  && a.measureIndex === b.measureIndex && a.index === b.index;

function eventDescription(event: ScoreEvent): string {
  return `${DURATION_LABELS[event.duration].toLowerCase()} ${event.kind === 'rest'
    ? 'rest' : event.pitches.map(pitchLabel).join(', ')}`;
}

/** Empty time is a rendering aid, never part of the editable score. */
function makeNotes(events: ScoreEvent[], staff: StaffId, selectedIndex: number, print = false) {
  const accidentals = new Map<string, number>();
  const notes = events.map((event, index) => {
    const note = new StaveNote({
      clef: staff,
      // VexFlow's rest key puts whole rests below line 4 and other rests on line 3.
      keys: event.kind === 'rest' ? ['r/4']
        : event.pitches.map(pitch => `${pitch.step.toLowerCase()}/${pitch.octave}`),
      duration: notationDurations[event.duration] + (event.kind === 'rest' ? 'r' : ''),
      autoStem: true,
    });
    if (event.kind === 'note') {
      event.pitches.forEach((pitch, pitchIndex) => {
        const key = `${pitch.step}/${pitch.octave}`;
        if ((accidentals.get(key) ?? 0) !== pitch.alter) {
          note.addModifier(new Accidental(pitch.alter === 1 ? '#' : pitch.alter === -1 ? 'b' : 'n'), pitchIndex);
        }
        accidentals.set(key, pitch.alter);
      });
    }
    if (index === selectedIndex) note.setStyle({ fillStyle: '#28634f', strokeStyle: '#28634f' });
    return note;
  });

  let cursor = events.reduce((sum, event) => sum + event.duration, 0);
  while (cursor < MEASURE_TICKS) {
    const duration = DURATIONS.find(value => value <= MEASURE_TICKS - cursor && cursor % value === 0)!;
    const rest = new StaveNote({
      clef: staff,
      keys: ['r/4'],
      duration: `${notationDurations[duration]}r`,
    });
    rest.setStyle({ fillStyle: print ? '#000' : '#aeb6ac', strokeStyle: print ? '#000' : '#aeb6ac' });
    notes.push(rest);
    cursor += duration;
  }
  return notes;
}

/** Leave room for ledger lines and stems even at unusually high/low octaves. */
function staffExtents(measures: Measure[], staff: StaffId) {
  const topPitch = staff === 'treble' ? 38 : 26;
  const pitches = measures.flatMap(measure => measure[staff].flatMap(event => event.kind === 'note'
    ? event.pitches.map(pitch => pitch.octave * 7 + stepIndices[pitch.step]) : []));
  const ys = pitches.map(pitch => 40 + (topPitch - pitch) * 5);
  return { top: Math.min(15, ...ys.map(y => y - 40)), bottom: Math.max(105, ...ys.map(y => y + 40)) };
}

export function systemGeometry(measures: Measure[]) {
  const trebleExtent = staffExtents(measures, 'treble');
  const bassExtent = staffExtents(measures, 'bass');
  const trebleY = 35 - trebleExtent.top;
  const bassY = trebleY + trebleExtent.bottom + 30 - bassExtent.top;
  const height = bassY + bassExtent.bottom + 35;

  return { trebleExtent, trebleY, bassY, height };
}

export function drawSystem(context: RenderContext, measures: Measure[], firstIndex: number, width: number, selection?: Selection, print = false): HitTarget[] {
  const { trebleExtent, trebleY, bassY } = systemGeometry(measures);
  const nextTargets: HitTarget[] = [];
        context.setFillStyle(print ? '#000' : '#26352d').setStrokeStyle(print ? '#000' : '#26352d');
        const barWidth = (width - 45) / measures.length;

        measures.forEach((measure, localIndex) => {
          const measureIndex = firstIndex + localIndex;
          const x = 30 + localIndex * barWidth;
          const staves = { treble: new Stave(x, trebleY, barWidth), bass: new Stave(x, bassY, barWidth) };
          if (localIndex === 0) {
            staves.treble.addClef('treble');
            staves.bass.addClef('bass');
            if (firstIndex === 0) {
              staves.treble.addTimeSignature('4/4');
              staves.bass.addTimeSignature('4/4');
            }
          }
          const noteStart = Math.max(staves.treble.getNoteStartX(), staves.bass.getNoteStartX());
          for (const staff of staffIds) staves[staff].setNoteStartX(noteStart).setContext(context).draw();
          new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.SINGLE_RIGHT).setContext(context).draw();
          if (localIndex === 0) {
            new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.BRACE).setContext(context).draw();
            new StaveConnector(staves.treble, staves.bass).setType(StaveConnector.type.SINGLE_LEFT).setContext(context).draw();
          }
          context.setFont('Arial', 11).setFillStyle(print ? '#333' : '#899287');
          context.fillText(String(measureIndex + 1), x + (localIndex === 0 ? 6 : 10), trebleY + trebleExtent.top - 10);
          context.setFillStyle(print ? '#000' : '#26352d');

          const notes = Object.fromEntries(staffIds.map(staff => [staff,
            makeNotes(measure[staff], staff, selection?.kind === 'event' && selection.staff === staff
              && selection.measureIndex === measureIndex ? selection.index : -1, print),
          ])) as Record<StaffId, StaveNote[]>;
          const voices = staffIds.map(staff => new Voice({ numBeats: 4, beatValue: 4 }).addTickables(notes[staff]));
          const formatter = new Formatter();
          voices.forEach(voice => formatter.joinVoices([voice]));
          formatter.format(voices, staves.treble.getNoteEndX() - noteStart - 24);
          staffIds.forEach((staff, staffIndex) => {
            const stave = staves[staff];
            voices[staffIndex].draw(context, stave);
            const events = measure[staff];
            const staveY = staff === 'treble' ? trebleY : bassY;
            notes[staff].forEach((note, index) => {
              const placeholder = index >= events.length;
              const ys = note.getYs();
              const left = note.getAbsoluteX() - 11;
              nextTargets.push({
                key: `${measureIndex}-${staff}-${index}-note`,
                selection: { kind: placeholder ? 'gap' : 'event', measureIndex, staff, index: placeholder ? events.length : index },
                label: placeholder ? `Unused time in ${staff} measure ${measureIndex + 1}`
                  : `Select ${staff} measure ${measureIndex + 1} event ${index + 1}, ${eventDescription(events[index])}`,
                description: placeholder ? 'Unused time — click to insert here' : eventDescription(events[index]),
                left, top: Math.min(...ys) - 20, width: 40, height: Math.max(...ys) - Math.min(...ys) + 42,
                placeholder,
              });
            });
            for (let index = 0; index <= events.length; index++) {
              const previous = index > 0 ? notes[staff][index - 1].getAbsoluteX() : noteStart - 2;
              const next = index < notes[staff].length ? notes[staff][index].getAbsoluteX() : stave.getNoteEndX();
              const gapX = index === 0 ? Math.max(noteStart + 2, next - 22) : (previous + next) / 2;
              nextTargets.push({
                key: `${measureIndex}-${staff}-${index}-gap`,
                selection: { kind: 'gap', measureIndex, staff, index },
                label: `Insert ${staff} measure ${measureIndex + 1} position ${index + 1}`,
                description: 'Insert here', left: gapX - 8, top: staveY + 14, width: 16, height: 79,
              });
            }
          });
        });

  return nextTargets;
}

export function minimumMeasureWidth(measure: Measure, first: boolean, initial: boolean): number {
  const voices = staffIds.map(staff => new Voice({ numBeats: 4, beatValue: 4 }).addTickables(makeNotes(measure[staff], staff, -1)));
  const formatter = new Formatter();
  voices.forEach(voice => formatter.joinVoices([voice]));
  return Math.max(180, formatter.preCalculateMinTotalWidth(voices) + (first ? (initial ? 125 : 95) : 45));
}
