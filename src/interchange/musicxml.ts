import type { Alteration, Anchor, Clef, Duration, GraceNote, Measure, Pitch, Score, ScoreEvent, ScoreMark, StaffId, Step } from '../domain/types';
import { ALL_DURATIONS, DYNAMICS, MAX_SCORE_FILE_BYTES } from '../domain/types';
import { effectiveSettings, getEvents, KEY_SIGNATURES, resolveAutoPitches } from '../domain/settings';
import { eventFraction, measureCapacity, sumFractions } from '../domain/timing';
import { validateScore } from '../domain/validation';

// MusicXML 4.0 score-partwise. The file contains standard notation, never a hidden TypeNote document.
const durations: Record<Duration, string> = { 32: 'breve', 16: 'whole', 8: 'half', 4: 'quarter', 2: 'eighth', 1: '16th', 0.5: '32nd', 0.25: '64th', 0.125: '128th' };
const accidentals: Record<Alteration, string> = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const staffs: StaffId[] = ['treble', 'bass'];
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const tag = (name: string, value: unknown) => `<${name}>${escape(value)}</${name}>`;
const id = () => crypto.randomUUID();
const staffNumber = (staff: StaffId) => staff === 'treble' ? 1 : 2;
const children = (node: Element, name: string) => Array.from(node.children).filter((child) => child.localName === name);
const child = (node: Element, name: string) => children(node, name)[0];
const text = (node: Element, name: string, fallback = '') => child(node, name)?.textContent?.trim() ?? fallback;
const integer = (value: string, label: string, min = 0, max = 1_000_000) => {
  const number = Number(value);
  if (!value.trim() || !Number.isSafeInteger(number) || number < min || number > max) throw new Error(`MusicXML: unsupported ${label} (${value}).`);
  return number;
};
const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
const lcm = (a: number, b: number) => {
  const result = a / gcd(a, b) * b;
  if (!Number.isSafeInteger(result) || result > 100_000_000) throw new Error('MusicXML timing is too complex to export exactly.');
  return result;
};
const anchorMatches = (anchor: Anchor, measure: Measure, event?: ScoreEvent, pitch = 0) => anchor.measureId === measure.id && anchor.eventId === event?.id && (anchor.pitchIndex ?? 0) === pitch;
const ornamentXml: Record<string, string> = { trill: 'trill-mark', mordent: 'mordent', 'inverted-mordent': 'inverted-mordent', turn: 'turn', 'inverted-turn': 'inverted-turn', 'delayed-turn': 'delayed-turn' };
const navigationText: Record<string, string> = { dc: 'D.C.', ds: 'D.S.', fine: 'Fine', 'dc-al-fine': 'D.C. al Fine', 'ds-al-fine': 'D.S. al Fine', 'dc-al-coda': 'D.C. al Coda', 'ds-al-coda': 'D.S. al Coda', 'to-coda': 'To Coda' };
const clefShifts: Record<Clef, number> = { treble: 0, bass: 6, alto: 3, tenor: 4 };
const diatonicSteps: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
function restDisplay(line: number, clef: Clef, measureRest = false): string {
  const index = 28 + 2 * (line - clefShifts[clef]);
  return `<rest${measureRest ? ' measure="yes"' : ''}>${tag('display-step', diatonicSteps[index % 7])}${tag('display-octave', Math.floor(index / 7))}</rest>`;
}
function endingXml(mark: ScoreMark, type: 'start' | 'stop'): string {
  // The number attribute is machine-readable; visible punctuation belongs in its text.
  const number = mark.value.split(',').map((v) => v.trim().replace(/\.$/, '')).join(',');
  if (!/^\d+(,\d+)*$/.test(number)) throw new Error('MusicXML ending numbers must be positive integers separated by commas.');
  return `<ending number="${number}" type="${type}">${escape(mark.value)}</ending>`;
}

function xmlDirection(mark: ScoreMark, stop: boolean, number: number): string {
  let content = '';
  switch (mark.kind) {
    case 'dynamic': content = (DYNAMICS as readonly string[]).includes(mark.value) ? `<dynamics><${mark.value}/></dynamics>` : `<dynamics>${tag('other-dynamics', mark.value)}</dynamics>`; break;
    case 'hairpin': content = `<wedge type="${stop ? 'stop' : mark.value === 'diminuendo' ? 'diminuendo' : 'crescendo'}" number="${number}"/>`; break;
    case 'pedal': content = `<pedal type="${stop ? 'stop' : mark.value === 'sostenuto' ? 'sostenuto' : 'start'}" number="${number}" line="yes" sign="${mark.value === 'sustain' ? 'yes' : 'no'}"/>`; if (!stop && mark.value === 'soft') content = tag('words', 'una corda') + `</direction-type><direction-type>${content}`; break;
    case 'octave': content = `<octave-shift type="${stop ? 'stop' : mark.value.endsWith('b') ? 'up' : 'down'}" size="${mark.value.startsWith('15') ? 15 : 8}" number="${number}"/>`; break;
    case 'rehearsal': content = tag('rehearsal', mark.value); break;
    case 'navigation': content = ['segno', 'coda'].includes(mark.value.toLowerCase()) ? `<${mark.value.toLowerCase()}/>` : tag('words', navigationText[mark.value] ?? mark.value); break;
    case 'tempo': {
      const match = /^(whole|half|quarter|eighth)\s*=\s*(\d+)$/i.exec(mark.value);
      content = match ? `<metronome>${tag('beat-unit', match[1].toLowerCase())}${tag('per-minute', match[2])}</metronome>` : tag('words', mark.value);
      break;
    }
    case 'text': content = tag('words', mark.value); break;
    default: return '';
  }
  return `<direction placement="${mark.placement}"><direction-type>${content}</direction-type>${tag('staff', staffNumber((stop ? mark.end : mark.start)!.staff))}</direction>`;
}

/** Downloadable, uncompressed MusicXML; all pitch alterations describe sounding pitch. */
export function exportMusicXml(input: Score): string {
  const score = resolveAutoPitches(input);
  let divisions = 8;
  for (const measure of score.measures) for (const staff of staffs) for (let voice = 0; voice < 4; voice++) for (const event of getEvents(measure, staff, voice)) {
    const fraction = eventFraction(event);
    divisions = lcm(divisions, fraction.denominator * 4);
  }
  const ticks = (event: ScoreEvent) => { const f = eventFraction(event); return f.numerator * divisions / (f.denominator * 4); };
  const marks = score.marks ?? [];
  // MusicXML number-level is 1..16. Reuse numbers after a span ends.
  const anchorTime = (anchor: Anchor) => {
    const index = score.measures.findIndex((m) => m.id === anchor.measureId);
    let offset = 0;
    if (anchor.eventId) for (const staff of staffs) for (let voice = 0; voice < 4; voice++) {
      const events = getEvents(score.measures[index], staff, voice);
      const eventIndex = events.findIndex((e) => e.id === anchor.eventId);
      if (eventIndex >= 0) { const f = sumFractions(events.slice(0, eventIndex).map(eventFraction)); offset = f.numerator / f.denominator; }
    }
    return index * 10000 + offset;
  };
  const spanNumbers = new Map<string, number>();
  const active = new Map<string, { end: number; number: number }[]>();
  for (const mark of marks.filter((m) => m.end).sort((a, b) => anchorTime(a.start) - anchorTime(b.start))) {
    const time = anchorTime(mark.start);
    const list = (active.get(mark.kind) ?? []).filter((s) => s.end >= time);
    const number = Array.from({ length: 16 }, (_, i) => i + 1).find((n) => !list.some((s) => s.number === n));
    if (!number) throw new Error(`MusicXML supports at most 16 overlapping ${mark.kind} spans.`);
    spanNumbers.set(mark.id, number); list.push({ end: anchorTime(mark.end!), number }); active.set(mark.kind, list);
  }
  const numberFor = (mark: ScoreMark) => spanNumbers.get(mark.id) ?? 1;
  const isDirection = (mark: ScoreMark) => ['dynamic', 'hairpin', 'pedal', 'octave', 'rehearsal', 'navigation', 'tempo', 'text'].includes(mark.kind);
  const measureXml = score.measures.map((measure, measureIndex) => {
    const settings = effectiveSettings(score, measureIndex);
    let body = '';
    if (measure.pageBreak || measure.systemBreak) body += `<print${measure.pageBreak ? ' new-page="yes"' : ' new-system="yes"'}/>`;
    let attrs = measureIndex === 0 ? tag('divisions', divisions) : '';
    if (measureIndex === 0 || measure.keySignature) {
      const key = settings.keySignature;
      const standard = KEY_SIGNATURES.find((k) => k.fifths === key.fifths && diatonicSteps.every((step) => (k.alterations[step] ?? 0) === (key.alterations[step] ?? 0)));
      attrs += '<key>' + (standard ? tag('fifths', key.fifths) + tag('mode', key.name?.endsWith('m') ? 'minor' : 'major') : Object.entries(key.alterations).map(([step, alter]) => tag('key-step', step) + tag('key-alter', alter)).join('')) + '</key>';
    }
    if (measureIndex === 0 || measure.timeSignature) attrs += `<time>${tag('beats', settings.timeSignature.groups?.join('+') ?? settings.timeSignature.beats)}${tag('beat-type', settings.timeSignature.beatType)}</time>`;
    if (measureIndex === 0) attrs += '<staves>2</staves>';
    for (const staff of staffs) if (measureIndex === 0 || measure.clefs?.[staff]) {
      const clef = settings.clefs[staff];
      attrs += `<clef number="${staffNumber(staff)}">${tag('sign', clef === 'treble' ? 'G' : clef === 'bass' ? 'F' : 'C')}${tag('line', clef === 'treble' ? 2 : clef === 'alto' ? 3 : 4)}</clef>`;
    }
    if (attrs) body += `<attributes>${attrs}</attributes>`;
    const endingsStart = marks.filter((mark) => mark.kind === 'ending' && mark.start.measureId === measure.id);
    const endingsStop = marks.filter((mark) => mark.kind === 'ending' && mark.end?.measureId === measure.id);
    if (measure.repeatStart || endingsStart.length) body += `<barline location="left">${endingsStart.map((mark) => endingXml(mark, 'start')).join('')}${measure.repeatStart ? '<repeat direction="forward"/>' : ''}</barline>`;
    const directions = (event: ScoreEvent | undefined, staff: StaffId) => marks.flatMap((mark) => {
      if (!isDirection(mark)) return [];
      const result = [];
      if (mark.start.staff === staff && anchorMatches(mark.start, measure, event)) result.push(xmlDirection(mark, false, numberFor(mark)));
      if (mark.end?.staff === staff && anchorMatches(mark.end, measure, event)) result.push(xmlDirection(mark, true, numberFor(mark)));
      return result;
    }).join('');
    // Measure directions precede the voice streams, at musical time zero.
    body += staffs.map((staff) => directions(undefined, staff)).join('');
    let previousLength = 0;
    for (const staff of staffs) for (let voice = 0; voice < 4; voice++) {
      const events = getEvents(measure, staff, voice);
      if (voice > 0 && !events.length) continue;
      if (previousLength) body += `<backup>${tag('duration', previousLength)}</backup>`;
      previousLength = 0;
      const voiceId = staffNumber(staff) * 10 + voice;
      const serializeNote = (event: ScoreEvent, pitch: Pitch | undefined, pitchIndex: number, eventIndex: number, grace?: GraceNote): string => {
        const isGrace = !!grace;
        let notation = '';
        let soundTies = '';
        if (!isGrace) for (const mark of marks) {
          if (!['tie', 'slur', 'glissando', 'tremolo'].includes(mark.kind)) continue;
          for (const stop of [true, false]) {
            const anchor = stop ? mark.end : mark.start;
            if (!anchor || !anchorMatches(anchor, measure, event, pitchIndex)) continue;
            const type = stop ? 'stop' : 'start';
            const name = mark.kind === 'tie' ? 'tied' : mark.kind;
            if (mark.kind === 'tremolo') notation += `<ornaments><tremolo type="${type}">${escape(mark.value)}</tremolo></ornaments>`;
            else notation += `<${name} type="${type}" number="${numberFor(mark)}"${mark.kind === 'glissando' ? ` line-type="${mark.value === 'straight' ? 'solid' : 'wavy'}"` : ` placement="${mark.placement}"`}/>`;
            if (mark.kind === 'tie') soundTies += `<tie type="${type}"/>`;
          }
        }
        if (!isGrace && pitchIndex === 0) {
          if (event.tuplet) {
            const before = events[eventIndex - 1]?.tuplet?.group === event.tuplet.group;
            const after = events[eventIndex + 1]?.tuplet?.group === event.tuplet.group;
            if (!before) notation += '<tuplet type="start" number="1"/>';
            if (!after) notation += '<tuplet type="stop" number="1"/>';
          }
          const arts = (event.articulations ?? []).filter((a) => a !== 'fermata').map((a) => `<${a === 'marcato' ? 'strong-accent' : a === 'breath' ? 'breath-mark' : a}/>`).join('');
          if (arts) notation += `<articulations>${arts}</articulations>`;
          if (event.articulations?.includes('fermata')) notation += '<fermata/>';
          if (event.ornament || event.tremolo) notation += `<ornaments>${event.ornament ? `<${ornamentXml[event.ornament] ?? 'trill-mark'}/>` : ''}${event.tremolo ? `<tremolo type="single">${event.tremolo}</tremolo>` : ''}</ornaments>`;
        }
        if (!isGrace && event.arpeggio) notation += `<arpeggiate direction="${event.arpeggio}"/>`;
        if (pitch?.fingering) notation += `<technical>${tag('fingering', pitch.fingering)}</technical>`;
        const duration = grace?.duration ?? event.duration;
        const acc = pitch && pitch.accidental !== 'auto' ? `<accidental${pitch.accidental === 'courtesy' ? ' cautionary="yes" parentheses="yes"' : ''}>${accidentals[pitch.alter]}</accidental>` : '';
        const rest = event.restLine === undefined ? `<rest${event.measureRest !== undefined ? ' measure="yes"' : ''}/>` : restDisplay(event.restLine, settings.clefs[event.displayStaff ?? staff], event.measureRest !== undefined);
        return `<note>${isGrace ? `<grace slash="${grace.slash ? 'yes' : 'no'}"/>` : ''}${pitchIndex ? '<chord/>' : ''}${pitch ? `<pitch>${tag('step', pitch.step)}${tag('alter', pitch.alter)}${tag('octave', pitch.octave)}</pitch>` : rest}${isGrace ? '' : tag('duration', ticks(event))}${soundTies}${tag('voice', voiceId)}${tag('type', durations[duration])}${'<dot/>'.repeat(isGrace ? 0 : event.dots ?? 0)}${acc}${!isGrace && event.tuplet ? `<time-modification>${tag('actual-notes', event.tuplet.actual)}${tag('normal-notes', event.tuplet.normal)}</time-modification>` : ''}${!isGrace && event.stem && event.stem !== 'auto' ? tag('stem', event.stem) : ''}${tag('staff', staffNumber(pitch?.staff ?? event.displayStaff ?? staff))}${!isGrace && pitchIndex === 0 && event.beam && !['none', 'auto'].includes(event.beam) ? `<beam number="1">${event.beam === 'start' ? 'begin' : event.beam}</beam>` : ''}${notation ? `<notations>${notation}</notations>` : ''}</note>`;
      };
      events.forEach((event, eventIndex) => {
        body += directions(event, staff);
        for (const grace of event.grace ?? []) grace.pitches.forEach((pitch, pitchIndex) => { body += serializeNote(event, pitch, pitchIndex, eventIndex, grace); });
        if (event.kind === 'rest') body += serializeNote(event, undefined, 0, eventIndex);
        else event.pitches.forEach((pitch, pitchIndex) => { body += serializeNote(event, pitch, pitchIndex, eventIndex); });
        previousLength += ticks(event);
      });
      // Forward preserves unfilled time without inventing editable rests.
      const remaining = measureCapacity(score, measureIndex) * divisions / 4 - previousLength;
      if (remaining > 0) { body += `<forward>${tag('duration', remaining)}${tag('voice', voiceId)}${tag('staff', staffNumber(staff))}</forward>`; previousLength += remaining; }
    }
    if (measure.barline || endingsStop.length) body += `<barline location="right">${tag('bar-style', measure.barline === 'double' ? 'light-light' : measure.barline === 'final' ? 'light-heavy' : 'regular')}${endingsStop.map((mark) => endingXml(mark, 'stop')).join('')}${measure.barline === 'repeatEnd' ? '<repeat direction="backward"/>' : ''}</barline>`;
    return `<measure number="${measureIndex + 1}"${measure.pickup !== undefined ? ' implicit="yes"' : ''}>${body}</measure>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<score-partwise version="4.0"><work>${tag('work-title', score.title)}</work>${score.composer ? `<identification><creator type="composer">${escape(score.composer)}</creator></identification>` : ''}<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling></defaults><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measureXml}</part></score-partwise>`;
}

interface PendingDirection { element: Element; measure: Measure; offset: number; staff: StaffId }
interface Located { event: ScoreEvent; staff: StaffId; voice: number; offset: number }

/** Import one uncompressed piano part. Unsupported structural content fails instead of disappearing. */
export function importMusicXml(xml: string): { score: Score; warnings: string[] } {
  if (xml.startsWith('PK')) throw new Error('Compressed .mxl files are not supported. Export an uncompressed .musicxml file.');
  if (new TextEncoder().encode(xml).length > MAX_SCORE_FILE_BYTES) throw new Error('MusicXML files must be smaller than 10 MB.');
  if (/<!ENTITY/i.test(xml) || /<!DOCTYPE[^>]*\[/i.test(xml)) throw new Error('MusicXML entity declarations are not supported.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('The MusicXML file is not well-formed XML.');
  if (doc.documentElement.localName !== 'score-partwise') throw new Error('Only score-partwise MusicXML is supported; convert score-timewise or compressed files first.');
  const parts = children(doc.documentElement, 'part');
  if (parts.length !== 1) throw new Error('Import requires one piano part. Export the piano part separately from a multi-instrument score.');
  const warnings = new Set<string>();
  const warn = (message: string) => warnings.add(message);
  const score: Score = { version: 3, title: doc.querySelector('work-title')?.textContent?.trim() || doc.querySelector('movement-title')?.textContent?.trim() || 'Imported score', measures: [], marks: [] };
  const composer = doc.querySelector('creator[type="composer"]')?.textContent?.trim();
  if (composer) score.composer = composer;
  const mark = (kind: ScoreMark['kind'], start: Anchor, value: string, placement: ScoreMark['placement'] = 'above') => { const result: ScoreMark = { id: id(), kind, start, value, placement }; score.marks!.push(result); return result; };
  const openSpans = new Map<string, ScoreMark>();
  const pendingSpans: { key: string; kind: ScoreMark['kind']; type: string; anchor: Anchor; value: string; placement: ScoreMark['placement'] }[] = [];
  const span = (key: string, kind: ScoreMark['kind'], type: string, anchor: Anchor, value: string, placement: ScoreMark['placement']) => { pendingSpans.push({ key, kind, type, anchor, value, placement }); };
  const applySpan = ({ key, kind, type, anchor, value, placement }: typeof pendingSpans[number]) => {
    if (type === 'stop' || type === 'discontinue') {
      const existing = openSpans.get(key);
      if (!existing) { warn(`An unmatched ${kind} ending was omitted.`); return; }
      existing.end = anchor; openSpans.delete(key);
    } else if (type === 'start' || type === 'crescendo' || type === 'diminuendo' || type === 'down' || type === 'up' || type === 'sostenuto') {
      if (openSpans.has(key)) throw new Error(`Overlapping ${kind} spans share the same MusicXML number.`);
      openSpans.set(key, mark(kind, anchor, value, placement));
    } else if (type !== 'continue') warn(`Unsupported ${kind} action "${type}" was omitted.`);
  };
  let divisions = 1;
  const voiceAssignments = new Map<string, { staff: StaffId; voice: number }>();
  const locations = new Map<string, Located[]>();
  const pending: PendingDirection[] = [];
  const getStaff = (value: string): StaffId => {
    const n = integer(value || '1', 'staff number', 1, 2);
    return n === 1 ? 'treble' : 'bass';
  };
  const assignVoice = (voice: string, displayStaff: StaffId) => {
    let assignment = voiceAssignments.get(voice);
    if (!assignment) {
      const count = [...voiceAssignments.values()].filter((v) => v.staff === displayStaff).length;
      if (count >= 4) throw new Error('MusicXML has more than four voices on a staff.');
      assignment = { staff: displayStaff, voice: count }; voiceAssignments.set(voice, assignment);
    }
    return assignment;
  };
  const eventList = (measure: Measure, staff: StaffId, voice: number) => {
    if (!voice) return measure[staff];
    measure.extraVoices ??= {};
    measure.extraVoices[staff] ??= [];
    while (measure.extraVoices[staff]!.length < voice) measure.extraVoices[staff]!.push([]);
    return measure.extraVoices[staff]![voice - 1];
  };
  const pitchFrom = (note: Element): Pitch => {
    const p = child(note, 'pitch');
    if (!p) throw new Error('Unpitched notes are not supported in a piano score.');
    const step = text(p, 'step') as Step;
    if (!['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(step)) throw new Error('Unsupported pitch step in MusicXML.');
    const alter = integer(text(p, 'alter', '0'), 'pitch alteration', -2, 2) as Alteration;
    const octave = integer(text(p, 'octave'), 'octave', 0, 8);
    const acc = child(note, 'accidental');
    const result: Pitch = { step, alter, octave, accidental: acc ? acc.getAttribute('cautionary') === 'yes' || acc.getAttribute('parentheses') === 'yes' ? 'courtesy' : 'explicit' : 'auto' };
    const fingering = note.querySelector('notations > technical > fingering')?.textContent?.trim();
    if (fingering) result.fingering = fingering;
    return result;
  };
  const readNotation = (note: Element, event: ScoreEvent, measure: Measure, staff: StaffId, pitchIndex: number, voiceKey: string) => {
    const anchor: Anchor = { measureId: measure.id, staff, eventId: event.id, ...(event.kind === 'note' ? { pitchIndex } : {}) };
    const notation = child(note, 'notations');
    const elements = notation ? Array.from(notation.children) : [];
    // Some producers include the sounding tie without its redundant visual tied element.
    if (!elements.some((n) => n.localName === 'tied')) elements.push(...children(note, 'tie'));
    for (const n of elements) {
      const type = n.getAttribute('type') ?? '';
      const placement = n.getAttribute('placement') === 'below' ? 'below' : 'above';
      if (['tie', 'tied', 'slur', 'glissando', 'slide'].includes(n.localName)) {
        const kind = n.localName === 'tied' || n.localName === 'tie' ? 'tie' : n.localName === 'slide' ? 'glissando' : n.localName as 'slur' | 'glissando';
        const pitch = event.kind === 'note' ? event.pitches[pitchIndex] : undefined;
        const key = `${kind}-${n.getAttribute('number') ?? '1'}-${kind === 'tie' ? `${voiceKey}-${pitch?.step}-${pitch?.octave}-${pitch?.alter}` : ''}`;
        span(key, kind, type, anchor, kind === 'glissando' ? n.getAttribute('line-type') === 'wavy' ? 'wavy' : 'straight' : '', placement);
      } else if (n.localName === 'articulations') {
        event.articulations ??= [];
        for (const a of Array.from(n.children)) {
          const value = a.localName === 'strong-accent' ? 'marcato' : a.localName === 'breath-mark' ? 'breath' : a.localName;
          if (['staccato', 'staccatissimo', 'accent', 'tenuto', 'marcato', 'breath'].includes(value)) event.articulations.push(value);
          else warn(`Articulation ${a.localName} is not supported and was omitted.`);
        }
      } else if (n.localName === 'fermata') { event.articulations ??= []; event.articulations.push('fermata'); }
      else if (n.localName === 'arpeggiate') event.arpeggio = n.getAttribute('direction') === 'down' ? 'down' : 'up';
      else if (n.localName === 'ornaments') for (const o of Array.from(n.children)) {
        if (o.localName === 'tremolo') {
          const count = integer(o.textContent ?? '', 'tremolo strokes', 1, 4);
          if (!o.getAttribute('type') || o.getAttribute('type') === 'single') event.tremolo = count;
          else span(`tremolo-${voiceKey}`, 'tremolo', o.getAttribute('type')!, anchor, String(count), placement);
        } else {
          const value = Object.entries(ornamentXml).find(([, name]) => name === o.localName)?.[0];
          if (value && !event.ornament) event.ornament = value;
          else warn(`Ornament ${o.localName} could not be represented and was omitted.`);
        }
      } else if (n.localName === 'technical') {
        for (const t of Array.from(n.children)) if (t.localName !== 'fingering') warn(`Technical marking ${t.localName} was omitted.`);
      } else if (n.localName !== 'tuplet') warn(`Notation ${n.localName} was omitted.`);
    }
  };
  for (const source of children(parts[0], 'measure')) {
    const measure: Measure = { id: id(), treble: [], bass: [] };
    score.measures.push(measure);
    const located: Located[] = []; locations.set(measure.id, located);
    let cursor = 0, maxTime = 0;
    const previousByVoice = new Map<string, ScoreEvent>();
    const graceByVoice = new Map<string, GraceNote[]>();
    const tupletGroups = new Map<string, string>();
    const fillGap = (events: ScoreEvent[], gap: number) => {
      if (gap < -1e-8) throw new Error('Overlapping events in one MusicXML voice cannot be represented.');
      if (gap <= 1e-8) return;
      if (!Number.isSafeInteger(gap * 8)) throw new Error('A MusicXML voice contains an unsupported fractional gap.');
      warn('Explicit rests were inserted for gaps inside a voice.');
      for (const duration of ALL_DURATIONS) while (gap >= duration) { events.push({ id: id(), kind: 'rest', duration }); gap -= duration; }
    };
    for (const node of Array.from(source.children)) {
      if (node.localName === 'attributes') {
        if (cursor > 0) throw new Error('Mid-measure signature or clef changes are not yet supported; split the measure before importing.');
        if (child(node, 'divisions')) divisions = integer(text(node, 'divisions'), 'divisions', 1);
        if (child(node, 'staves')) integer(text(node, 'staves'), 'staff count', 1, 2);
        if (child(node, 'transpose')) throw new Error('Transposing instruments are outside the piano importer scope.');
        const key = child(node, 'key');
        if (key) {
          if (children(node, 'key').length > 1) throw new Error('Independent key signatures on each staff are not supported.');
          const fifths = child(key, 'fifths');
          if (fifths) {
            const f = integer(fifths.textContent ?? '', 'key signature', -7, 7);
            const mode = text(key, 'mode', 'major');
            if (!['major', 'minor', 'none'].includes(mode)) warn(`Key mode ${mode} is preserved as its signature, without a named mode.`);
            const standard = KEY_SIGNATURES.find((k) => k.fifths === f && !!k.name?.endsWith('m') === (mode === 'minor'))!;
            measure.keySignature = structuredClone(standard);
          } else {
            const alterations: Partial<Record<Step, Alteration>> = {};
            let step: Step | undefined;
            for (const k of Array.from(key.children)) {
              if (k.localName === 'key-step') step = k.textContent as Step;
              if (k.localName === 'key-alter') {
                if (!step || !['A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(step)) throw new Error('Invalid custom key signature.');
                alterations[step] = integer(k.textContent ?? '', 'custom signature alteration', -2, 2) as Alteration;
                step = undefined;
              }
            }
            measure.keySignature = { alterations };
          }
        }
        const time = child(node, 'time');
        if (time) {
          if (children(time, 'beats').length !== 1 || children(time, 'beat-type').length !== 1) throw new Error('Composite time signatures with different denominators are not supported.');
          const groups = text(time, 'beats').split('+').map((value) => integer(value, 'beats', 1, 32));
          const beatType = integer(text(time, 'beat-type'), 'beat type', 1, 32);
          if (![1, 2, 4, 8, 16, 32].includes(beatType)) throw new Error('Unsupported time signature denominator.');
          measure.timeSignature = { beats: groups.reduce((a, b) => a + b, 0), beatType: beatType as 1 | 2 | 4 | 8 | 16 | 32, ...(groups.length > 1 ? { groups } : {}) };
        }
        for (const clef of children(node, 'clef')) {
          const sign = text(clef, 'sign'), line = text(clef, 'line');
          const value: Clef | undefined = sign === 'G' && line === '2' ? 'treble' : sign === 'F' && line === '4' ? 'bass' : sign === 'C' && line === '3' ? 'alto' : sign === 'C' && line === '4' ? 'tenor' : undefined;
          if (!value || child(clef, 'clef-octave-change')) throw new Error('This clef cannot be represented by the piano editor.');
          measure.clefs ??= {}; measure.clefs[getStaff(clef.getAttribute('number') ?? '1')] = value;
        }
        for (const attr of Array.from(node.children)) if (!['divisions', 'key', 'time', 'staves', 'clef'].includes(attr.localName)) warn(`Measure attribute ${attr.localName} was omitted.`);
      } else if (node.localName === 'backup' || node.localName === 'forward') {
        const amount = integer(text(node, 'duration'), 'movement duration', 1) * 4 / divisions;
        cursor += node.localName === 'backup' ? -amount : amount;
        if (cursor < -1e-8) throw new Error('MusicXML backup moves before the start of a measure.');
        maxTime = Math.max(maxTime, cursor);
      } else if (node.localName === 'print') {
        if (node.getAttribute('new-page') === 'yes') measure.pageBreak = true;
        else if (node.getAttribute('new-system') === 'yes') measure.systemBreak = true;
        if (node.children.length) warn('Detailed MusicXML page and staff positioning is replaced by automatic layout.');
      } else if (node.localName === 'direction') {
        const offset = Number(text(node, 'offset', '0')) * 4 / divisions;
        if (!Number.isFinite(offset)) throw new Error('Invalid direction offset.');
        pending.push({ element: node, measure, offset: cursor + offset, staff: getStaff(text(node, 'staff', '1')) });
      } else if (node.localName === 'barline') {
        const repeat = child(node, 'repeat');
        if (repeat?.getAttribute('direction') === 'forward') measure.repeatStart = true;
        if (repeat?.getAttribute('direction') === 'backward') measure.barline = 'repeatEnd';
        const style = text(node, 'bar-style');
        if (!repeat && style) {
          if (style === 'light-light') measure.barline = 'double';
          else if (style === 'light-heavy') measure.barline = 'final';
          else if (style !== 'regular') warn(`Barline style ${style} was omitted.`);
        }
        for (const ending of children(node, 'ending')) span(`ending-${ending.getAttribute('number') ?? '1'}`, 'ending', ending.getAttribute('type') ?? '', { measureId: measure.id, staff: 'treble' }, ending.textContent?.trim() || ending.getAttribute('number') || '1', 'above');
      } else if (node.localName === 'note') {
        const displayStaff = getStaff(text(node, 'staff', '1'));
        const voiceKey = text(node, 'voice', `default-${displayStaff}`);
        const assignment = assignVoice(voiceKey, displayStaff);
        const events = eventList(measure, assignment.staff, assignment.voice);
        const isChord = !!child(node, 'chord'), grace = child(node, 'grace');
        const type = text(node, 'type');
        let duration = Number(Object.entries(durations).find(([, value]) => value === type)?.[0]) as Duration;
        const rawDuration = grace ? 0 : integer(text(node, 'duration'), 'note duration', 1) * 4 / divisions;
        if (!type) duration = ALL_DURATIONS.find((d) => Math.abs(d - rawDuration) < 1e-8) ?? 4;
        const restNode = child(node, 'rest');
        const fullMeasureRest = !!restNode && (restNode.getAttribute('measure') === 'yes' || (!type && Math.abs(rawDuration - measureCapacity(score, score.measures.length - 1)) < 1e-8));
        if (fullMeasureRest) duration = 16;
        if (!ALL_DURATIONS.includes(duration)) throw new Error(`Unsupported MusicXML note duration: ${type}.`);
        const pitch = child(node, 'rest') ? undefined : pitchFrom(node);
        if (pitch && displayStaff !== assignment.staff) pitch.staff = displayStaff;
        if (grace) {
          if (!pitch) throw new Error('Grace rests cannot be represented.');
          const group = graceByVoice.get(voiceKey) ?? [];
          if (isChord && group.length) group.at(-1)!.pitches.push(pitch);
          else group.push({ pitches: [pitch], duration, slash: grace.getAttribute('slash') === 'yes' });
          graceByVoice.set(voiceKey, group);
          if (children(node, 'dot').length || child(node, 'notations')) warn('Grace-note dots and decorations are not supported and were omitted.');
          continue;
        }
        let event: ScoreEvent;
        if (isChord) {
          const previous = previousByVoice.get(voiceKey);
          if (!previous || previous.kind !== 'note' || !pitch) throw new Error('Invalid chord sequence in MusicXML.');
          if (Math.abs(eventFraction(previous).numerator / eventFraction(previous).denominator - rawDuration) > 1e-8) throw new Error('Chord tones with different durations require separate voices.');
          previous.pitches.push(pitch); event = previous;
        } else {
          const used = sumFractions(events.map(eventFraction));
          fillGap(events, cursor - used.numerator / used.denominator);
          event = pitch ? { id: id(), kind: 'note', duration, pitches: [pitch] } : { id: id(), kind: 'rest', duration };
          if (fullMeasureRest) event.measureRest = rawDuration;
          const rest = child(node, 'rest');
          if (rest && child(rest, 'display-step')) {
            const stepIndex = diatonicSteps.indexOf(text(rest, 'display-step') as Step);
            if (stepIndex < 0) throw new Error('Invalid rest display pitch.');
            const displayOctave = integer(text(rest, 'display-octave'), 'rest display octave', 0, 8);
            const clef = effectiveSettings(score, score.measures.length - 1).clefs[displayStaff];
            const line = (displayOctave * 7 + stepIndex - 28) / 2 + clefShifts[clef];
            if (line < 0 || line > 5) warn('A rest outside the supported staff positions uses its default position.');
            else event.restLine = line;
          }
          const dots = children(node, 'dot').length;
          if (dots > 2) throw new Error('More than two augmentation dots are not supported.');
          if (dots) event.dots = dots as 1 | 2;
          const modification = child(node, 'time-modification');
          if (modification) {
            const actual = integer(text(modification, 'actual-notes'), 'tuplet actual count', 2, 32);
            const normal = integer(text(modification, 'normal-notes'), 'tuplet normal count', 1, 32);
            const starts = node.querySelector('notations > tuplet[type="start"]');
            if (starts && tupletGroups.has(voiceKey)) throw new Error('Nested tuplets cannot be represented by this editor yet.');
            if (starts || !tupletGroups.has(voiceKey)) tupletGroups.set(voiceKey, id());
            event.tuplet = { actual, normal, group: tupletGroups.get(voiceKey)! };
          } else tupletGroups.delete(voiceKey);
          const f = eventFraction(event);
          if (Math.abs(f.numerator / f.denominator - rawDuration) > 1e-8) throw new Error('MusicXML duration disagrees with its note value, dots, or tuplet ratio.');
          if (node.querySelector('notations > tuplet[type="stop"]')) tupletGroups.delete(voiceKey);
          const stem = text(node, 'stem'); if (stem === 'up' || stem === 'down') event.stem = stem;
          const beam = children(node, 'beam').find((b) => (b.getAttribute('number') ?? '1') === '1')?.textContent;
          if (beam === 'begin' || beam === 'continue' || beam === 'end') event.beam = beam === 'begin' ? 'start' : beam;
          if (displayStaff !== assignment.staff) event.displayStaff = displayStaff;
          const graceNotes = graceByVoice.get(voiceKey);
          if (graceNotes?.length) { event.grace = graceNotes; graceByVoice.delete(voiceKey); }
          events.push(event); previousByVoice.set(voiceKey, event);
          located.push({ event, staff: assignment.staff, voice: assignment.voice, offset: cursor });
          cursor += rawDuration; maxTime = Math.max(maxTime, cursor);
        }
        readNotation(node, event, measure, assignment.staff, event.kind === 'note' ? event.pitches.length - 1 : 0, voiceKey);
        for (const feature of ['lyric', 'cue', 'notehead', 'notehead-text', 'play', 'listen']) if (child(node, feature)) warn(`Note feature ${feature} was omitted.`);
        if (node.getAttribute('print-object') === 'no') warn('Hidden MusicXML notes/rests are imported as visible musical content.');
      } else if (!['sound', 'bookmark', 'link'].includes(node.localName)) warn(`Measure element ${node.localName} was omitted.`);
    }
    if (graceByVoice.size) throw new Error('Grace notes at the end of a measure need a following principal note.');
    const capacity = measureCapacity(score, score.measures.length - 1);
    if (source.getAttribute('implicit') === 'yes' && maxTime > 0 && maxTime < capacity) {
      if (!Number.isSafeInteger(maxTime * 8)) throw new Error('Pickup duration is not representable in 128th-note units.');
      measure.pickup = maxTime;
    } else if (maxTime > capacity + 1e-8) throw new Error('MusicXML content exceeds its time signature.');
  }
  if (!score.measures.length) throw new Error('The MusicXML file has no measures.');
  for (const { element, measure, offset, staff } of pending) {
    const available = (locations.get(measure.id) ?? []).filter((l) => l.staff === staff).sort((a, b) => a.offset - b.offset || a.voice - b.voice);
    const exact = available.find((l) => Math.abs(l.offset - offset) < 1e-8);
    const anchor: Anchor = { measureId: measure.id, staff, ...(exact ? { eventId: exact.event.id } : {}) };
    if (!exact && Math.abs(offset) > 1e-8) { warn('A direction between note positions could not be anchored and was omitted.'); continue; }
    const placement = element.getAttribute('placement') === 'below' ? 'below' : 'above';
    const directionTypes = children(element, 'direction-type').flatMap((d) => Array.from(d.children));
    for (const d of directionTypes) {
      const value = d.textContent?.trim() ?? '';
      const number = d.getAttribute('number') ?? '1';
      const type = d.getAttribute('type') ?? '';
      if (d.localName === 'dynamics') for (const dynamic of Array.from(d.children)) {
        const dynamicValue = dynamic.localName === 'other-dynamics' ? dynamic.textContent?.trim() ?? '' : dynamic.localName;
        if ((DYNAMICS as readonly string[]).includes(dynamicValue)) mark('dynamic', anchor, dynamicValue, placement);
        else warn(`Dynamic ${dynamicValue} is not supported and was omitted.`);
      }
      else if (d.localName === 'wedge') span(`hairpin-${number}`, 'hairpin', type, anchor, type, placement);
      else if (d.localName === 'pedal') span(`pedal-${number}`, 'pedal', type, anchor, type === 'sostenuto' ? 'sostenuto' : directionTypes.some((v) => v.localName === 'words' && v.textContent === 'una corda') ? 'soft' : 'sustain', placement);
      else if (d.localName === 'octave-shift') span(`octave-${number}`, 'octave', type, anchor, `${d.getAttribute('size') === '15' ? '15m' : '8v'}${type === 'up' ? 'b' : 'a'}`, placement);
      else if (d.localName === 'words') {
        if (value === 'una corda' && directionTypes.some((v) => v.localName === 'pedal')) continue;
        const navigation = Object.entries(navigationText).find(([, label]) => label.toLowerCase() === value.toLowerCase());
        mark(navigation ? 'navigation' : 'text', anchor, navigation?.[0] ?? value, placement);
      } else if (d.localName === 'metronome') {
        if (children(d, 'beat-unit').length !== 1 || !child(d, 'per-minute')) { warn('A complex metronome marking was omitted.'); continue; }
        mark('tempo', anchor, `${text(d, 'beat-unit')} = ${text(d, 'per-minute')}`, placement);
      } else if (d.localName === 'rehearsal') mark('rehearsal', anchor, value, placement);
      else if (d.localName === 'segno' || d.localName === 'coda') mark('navigation', anchor, d.localName, placement);
      else warn(`Direction ${d.localName} was omitted.`);
    }
  }
  // MusicXML voice streams can place a stop before its start in document order.
  // Resolve all spans in musical order after every anchor is known.
  const anchorOrder = (anchor: Anchor) => score.measures.findIndex((m) => m.id === anchor.measureId) * 10000 + ((locations.get(anchor.measureId) ?? []).find((l) => l.event.id === anchor.eventId)?.offset ?? 0);
  pendingSpans.sort((a, b) => anchorOrder(a.anchor) - anchorOrder(b.anchor)).forEach(applySpan);
  for (const unmatched of openSpans.values()) {
    score.marks = score.marks!.filter((m) => m !== unmatched);
    warn(`An unmatched ${unmatched.kind} start was omitted.`);
  }
  // Keep the MusicXML sounding pitch if its accidental context cannot be inferred by this editor.
  const resolved = resolveAutoPitches(score);
  score.measures.forEach((measure, measureIndex) => { for (const staff of staffs) for (let voice = 0; voice < 4; voice++) getEvents(measure, staff, voice).forEach((event, index) => {
    if (event.kind !== 'note') return;
    const other = getEvents(resolved.measures[measureIndex], staff, voice)[index];
    if (other.kind !== 'note') return;
    event.pitches.forEach((pitch, pitchIndex) => { if (pitch.accidental === 'auto' && pitch.alter !== other.pitches[pitchIndex].alter) { pitch.accidental = 'explicit'; warn('Explicit accidentals were added where needed to preserve MusicXML pitch.'); } });
  }); });
  return { score: validateScore(score), warnings: [...warnings] };
}
