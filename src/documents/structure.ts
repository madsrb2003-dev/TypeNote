import type { Alteration, Step } from '../domain/types';
import type { MusicXmlDocument } from './types';
import { deleteImportedNote, editImportedNote, openMusicXml } from './musicxml';

export type ImportedDuration = 'breve' | 'whole' | 'half' | 'quarter' | 'eighth' | '16th' | '32nd' | '64th' | '128th';
export interface ImportedEntry { kind: 'note' | 'rest'; step: Step; octave: number; alter?: Alteration; accidental?: 'auto' | 'explicit'; type: ImportedDuration; dots: 0 | 1 | 2 }
export type ImportedStructureOperation =
  | { kind: 'insert'; position: 'before' | 'after' | 'replace-rest'; entry: ImportedEntry }
  | { kind: 'chord'; entry: ImportedEntry }
  | { kind: 'duration'; type: ImportedDuration; dots: 0 | 1 | 2 }
  | { kind: 'delete' }
  | { kind: 'bar'; position: 'before' | 'after' };
const names: ImportedDuration[] = ['breve', 'whole', 'half', 'quarter', 'eighth', '16th', '32nd', '64th', '128th'];
const children = (e: Element, name?: string) => Array.from(e.children).filter(c => c.namespaceURI === e.namespaceURI && (!name || c.localName === name));
const first = (e: Element, name: string) => children(e, name)[0];
const text = (e: Element, name: string, fallback = '') => first(e, name)?.textContent ?? fallback;
const fail = (message: string): never => { throw new Error(`MusicXML: ${message}`); };
const complex = () => fail('this passage has connected or unsupported notation; use the advanced MusicXML editor.');
function integer(value: string): bigint { if (!/^\d+$/.test(value) || value.length > 15) fail('invalid source timing; use the advanced MusicXML editor.'); return BigInt(value); }
function make(parent: Element, name: string, value?: string): Element { const e = parent.ownerDocument.createElementNS(parent.namespaceURI, name); if (value !== undefined) e.textContent = value; return e; }
function durationTicks(type: ImportedDuration, dots: number, divisions: bigint): bigint {
  const i = names.indexOf(type); if (i < 0 || ![0, 1, 2].includes(dots)) fail('choose a supported duration and up to two dots.');
  const n = divisions * 8n * BigInt([1, 3, 7][dots]); const d = (2n ** BigInt(i)) * BigInt([1, 2, 4][dots]);
  if (n % d) fail('this duration cannot be represented at the source divisions; use a longer duration or the advanced MusicXML editor.');
  return n / d;
}
function durationFields(note: Element, ticks: bigint, type: ImportedDuration, dots: number) {
  first(note, 'rest')?.removeAttribute('measure');
  for (const name of ['duration', 'type', 'dot']) children(note, name).forEach(e => e.remove());
  const order = ['chord', 'pitch', 'rest', 'duration', 'instrument', 'voice', 'type', 'dot', 'accidental', 'stem', 'notehead', 'staff', 'beam', 'notations', 'lyric'];
  for (const [name, value] of [['duration', String(ticks)], ['type', type], ...Array.from({ length: dots }, () => ['dot', ''])]) {
    const e = make(note, name, value); note.insertBefore(e, children(note).find(c => order.indexOf(c.localName) > order.indexOf(name)) ?? null);
  }
}
function lane(e: Element) { return `${text(e, 'staff', '1')}/${text(e, 'voice', '1')}`; }
function plain(e: Element, keepIndependentMarks = false) {
  const allowed = ['chord', 'pitch', 'rest', 'duration', 'voice', 'type', 'dot', 'accidental', 'stem', 'notehead', 'staff', 'instrument', 'beam'];
  if (keepIndependentMarks) allowed.push('notations');
  if (Array.from(e.children).some(c => c.namespaceURI !== e.namespaceURI || !allowed.includes(c.localName))) complex();
  if (e.getAttribute('print-object') === 'no') complex();
  const articulationNames = ['accent', 'strong-accent', 'staccato', 'tenuto', 'detached-legato', 'staccatissimo', 'spiccato', 'breath-mark', 'caesura', 'stress', 'unstress', 'soft-accent'];
  for (const notations of children(e, 'notations')) for (const group of Array.from(notations.children)) {
    if (group.namespaceURI !== e.namespaceURI) complex();
    if (group.localName === 'fermata' && !group.children.length) continue;
    const supported = group.localName === 'technical' ? ['fingering'] : group.localName === 'articulations' ? articulationNames : [];
    if (!supported.length || Array.from(group.children).some(mark => mark.namespaceURI !== e.namespaceURI || !supported.includes(mark.localName) || mark.children.length)) complex();
  }
}
interface Event { notes: Element[]; onset: bigint; duration: bigint; lane: string }
interface Context { divisions: bigint; capacity: bigint; events: Event[] }
function context(measure: Element, pickup = true): Context {
  const part = measure.parentElement!;
  let divisions = 1n, capacity = 0n;
  for (const m of children(part, 'measure')) {
    let cursor = 0n; const events: Event[] = []; let started = false;
    for (const e of children(m)) {
      if (e.localName === 'attributes') {
        const div = first(e, 'divisions'); if (div) { if (started) complex(); const next = integer(div.textContent ?? ''); if (!next) complex(); if (capacity * next % divisions) complex(); capacity = capacity * next / divisions; divisions = next; }
        for (const time of children(e, 'time')) {
          if (time.hasAttribute('number') || children(time, 'beats').length !== 1 || children(time, 'beat-type').length !== 1) fail('polymeter or additive meter needs the advanced MusicXML editor.');
          const beats = integer(text(time, 'beats')), unit = integer(text(time, 'beat-type'));
          if (!unit || divisions * beats * 4n % unit) complex(); capacity = divisions * beats * 4n / unit;
        }
      } else if (e.localName === 'backup' || e.localName === 'forward') {
        started = true; cursor += (e.localName === 'backup' ? -1n : 1n) * integer(text(e, 'duration')); if (cursor < 0n) complex();
      } else if (e.localName === 'note') {
        started = true;
        if (first(e, 'grace')) { if (m === measure) complex(); continue; }
        const duration = integer(text(e, 'duration'));
        if (first(e, 'chord')) {
          const prev = events.at(-1); if (!prev || prev.duration !== duration || prev.lane !== lane(e)) { if (m === measure) complex(); } else prev.notes.push(e);
        } else { events.push({ notes: [e], onset: cursor, duration, lane: lane(e) }); cursor += duration; }
      }
    }
    if (m === measure) {
      if (!capacity) fail('the measure needs a supported time signature before adding notes.');
      // Implicit pickups retain their actual encoded length.
      if (pickup && m.getAttribute('implicit') === 'yes' && events.length) capacity = events.reduce((max, e) => e.onset + e.duration > max ? e.onset + e.duration : max, 0n);
      if (events.some((e, i) => events.some((other, j) => j < i && e.lane === other.lane && e.onset < other.onset + other.duration && other.onset < e.onset + e.duration))) fail('overlapping events in one voice need the advanced MusicXML editor.');
      if (events.some(e => e.onset + e.duration > capacity)) fail('this source measure is already overfull; correct its timing in the advanced MusicXML editor.');
      return { divisions, capacity, events };
    }
  }
  return complex();
}
function groupFor(ctx: Context, note: Element): Event { return ctx.events.find(e => e.notes.includes(note)) ?? complex(); }
function newNote(parent: Element, entry: ImportedEntry, ticks: bigint, source: Element): Element {
  const note = make(parent, 'note'); note.setAttribute('id', `tn-note-${crypto.randomUUID()}`);
  if (entry.kind === 'rest') note.append(make(note, 'rest'));
  else {
    const pitch = make(note, 'pitch'); pitch.append(make(pitch, 'step', entry.step), make(pitch, 'octave', String(entry.octave))); note.append(pitch);
  }
  note.append(make(note, 'duration', String(ticks)), make(note, 'voice', text(source, 'voice', '1')), make(note, 'type', entry.type));
  for (let i = 0; i < entry.dots; i++) note.append(make(note, 'dot'));
  if (first(source, 'instrument')) note.insertBefore(first(source, 'instrument')!.cloneNode(true), first(note, 'voice')!);
  if (first(source, 'staff')) note.append(make(note, 'staff', text(source, 'staff')));
  return note;
}
function restPieces(parent: Element, ticks: bigint, ctx: Context, source: Element): Element[] {
  const result: Element[] = [];
  for (const type of names) for (const dots of [2, 1, 0] as const) {
    let amount: bigint; try { amount = durationTicks(type, dots, ctx.divisions); } catch { continue; }
    while (ticks >= amount) { result.push(newNote(parent, { kind: 'rest', step: 'C', octave: 4, type, dots }, amount, source)); ticks -= amount; if (result.length > 512) complex(); }
  }
  if (ticks) fail('the remaining time cannot be written at the source divisions; use the advanced MusicXML editor.');
  return result;
}
function removeBeams(event: Event) {
  // Remove the complete connected beam run, never leave dangling begin/end tags.
  for (const note of event.notes) {
    const numbers = children(note, 'beam').map(b => b.getAttribute('number') ?? '1');
    for (const number of numbers) {
      let begin: Element = note, end: Element = note;
      const beam = (e: Element) => children(e, 'beam').find(b => (b.getAttribute('number') ?? '1') === number);
      while (beam(begin) && beam(begin)?.textContent !== 'begin' && begin.previousElementSibling?.localName === 'note' && lane(begin.previousElementSibling) === event.lane) begin = begin.previousElementSibling;
      while (beam(end) && beam(end)?.textContent !== 'end' && end.nextElementSibling?.localName === 'note' && lane(end.nextElementSibling) === event.lane) end = end.nextElementSibling;
      for (let e: Element | null = begin; e; e = e.nextElementSibling) { const marking = beam(e); if (marking) { unreferenced(marking); marking.remove(); } if (e === end) break; }
    }
  }
}
function unreferenced(note: Element) {
  const ids = [note, ...Array.from(note.getElementsByTagName('*'))].flatMap(e => [e.getAttribute('id'), e.getAttribute('xml:id')]).filter(Boolean);
  for (const e of Array.from(note.ownerDocument.getElementsByTagName('*'))) if (e !== note && !note.contains(e) && Array.from(e.attributes).some(a => !['id', 'xml:id'].includes(a.name) && a.value.split(/\s+/).some(value => ids.some(id => id && (value === id || value.endsWith(`#${id}`)))))) complex();
}
function followingRests(event: Event, needed: bigint, ctx: Context): Event[] {
  const found: Event[] = []; let next = event.notes.at(-1)!.nextElementSibling, onset = event.onset + event.duration;
  while (needed > 0n && next?.localName === 'note') {
    const rest = ctx.events.find(e => e.notes[0] === next);
    if (!rest || rest.lane !== event.lane || rest.onset !== onset || rest.notes.length !== 1 || !first(next, 'rest')) break;
    plain(next); unreferenced(next); found.push(rest); needed -= rest.duration; onset += rest.duration; next = next.nextElementSibling;
  }
  if (needed > 0n) fail('not enough adjacent rest time; shorten another note or insert a bar first.');
  return found;
}
function persist(doc: MusicXmlDocument, dom: Document, doctype: string | undefined) {
  let xml = new XMLSerializer().serializeToString(dom); if (doctype) xml = `${doctype}\n${xml}`; return openMusicXml(xml, doc.filename);
}
function checkBarBoundary(part: Element, boundary: number) {
  const active = new Set<string>();
  for (const measure of children(part, 'measure').slice(0, boundary)) {
    if (measure.getElementsByTagNameNS(measure.namespaceURI, 'measure-style').length) fail('bar insertion near multiple-rest or measure-repeat notation needs the advanced MusicXML editor.');
    for (const note of children(measure, 'note')) {
      const pitch = first(note, 'pitch');
      const position = pitch ? `${text(pitch, 'step')}/${text(pitch, 'alter', '0')}/${text(pitch, 'octave')}` : 'unpitched';
      const sound = children(note, 'tie');
      const ties = sound.length ? sound : Array.from(note.getElementsByTagNameNS(note.namespaceURI, 'tied'));
      const groups = [...ties.map(e => ({ e, key: `tie/${lane(note)}/${position}` })), ...Array.from(note.getElementsByTagNameNS(note.namespaceURI, 'tuplet')).map(e => ({ e, key: `tuplet/${lane(note)}/${e.getAttribute('number') ?? '1'}` }))];
      for (const { e, key } of groups) if (e.getAttribute('type') === 'stop') active.delete(key);
      for (const { e, key } of groups) if (['start', 'continue'].includes(e.getAttribute('type') ?? '')) active.add(key);
    }
  }
  if (active.size) fail('a tie or tuplet crosses this bar boundary; insert the bar in the advanced MusicXML editor.');
}
function bar(dom: Document, selected: Element, position: 'before' | 'after'): string {
  const anchor = selected.parentElement!, part = anchor.parentElement!, parts = children(dom.documentElement, 'part');
  const index = children(part, 'measure').indexOf(anchor), offset = position === 'after' ? 1 : 0;
  const contextIndex = position === 'before' && index > 0 ? index - 1 : index;
  const count = children(part, 'measure').length, reference = context(children(part, 'measure')[contextIndex], false);
  if (parts.some(p => children(p, 'measure').length !== count || children(p, 'measure')[index].getAttribute('number') !== anchor.getAttribute('number'))) fail('parts have unaligned measures; align them in the advanced MusicXML editor first.');
  parts.forEach(p => checkBarBoundary(p, index + offset));
  let serial = 1; const prefix = `${anchor.getAttribute('number') ?? index + 1}-new-`;
  while (parts.some(p => children(p, 'measure').some(m => m.getAttribute('number') === prefix + serial))) serial++;
  let selectedId = '', fallbackId = '';
  for (const p of parts) {
    const measures = children(p, 'measure'), source = measures[index], ctx = context(measures[contextIndex], false);
    if (ctx.capacity * reference.divisions !== reference.capacity * ctx.divisions) fail('parts have different bar lengths; insert this bar in the advanced MusicXML editor.');
    const measure = make(p, 'measure'); measure.setAttribute('number', prefix + serial);
    const attrs = make(measure, 'attributes'), effective = new Map<string, Element>();
    for (const m of measures.slice(0, contextIndex + 1)) for (const a of children(m, 'attributes')) {
      if (index + offset === 0 && children(m).slice(0, children(m).indexOf(a)).some(e => ['note', 'backup', 'forward'].includes(e.localName))) complex();
      for (const e of children(a)) effective.set(`${e.localName}/${e.getAttribute('number') ?? (e.localName === 'clef' ? '1' : '')}`, e);
    }
    const attributeOrder = ['divisions', 'key', 'time', 'staves', 'part-symbol', 'instruments', 'clef', 'staff-details', 'transpose', 'for-part'];
    if (index + offset === 0) {
      for (const e of effective.values()) {
        if (['footnote', 'level', 'directive'].includes(e.localName)) continue;
        if (!attributeOrder.includes(e.localName)) complex();
        // Connected IDs and extension attributes cannot be duplicated into a bar.
        if ([e, ...Array.from(e.getElementsByTagName('*'))].some(n => n.hasAttribute('id') || n.hasAttribute('xml:id'))) complex();
      }
      for (const name of attributeOrder) for (const e of effective.values()) if (e.localName === name) attrs.append(e.cloneNode(true));
      measure.append(attrs);
    }
    const lanes = new Map<string, Element>();
    for (const e of ctx.events) lanes.set(e.lane, e.notes[0]);
    if (!lanes.size) fail('the selected bar has no staff/voice context; use the advanced MusicXML editor.');
    const staffCount = Number(effective.get('staves/')?.textContent ?? '1');
    if (!Number.isInteger(staffCount) || staffCount < 1 || staffCount > 32) complex();
    for (let staff = 1; staff <= staffCount; staff++) {
      if ([...lanes.values()].some(n => text(n, 'staff', '1') === String(staff))) continue;
      const previous = measures.slice(0, index + 1).flatMap(m => children(m, 'note')).find(n => text(n, 'staff', '1') === String(staff));
      const stub = make(measure, 'note'); stub.append(make(stub, 'staff', String(staff)), make(stub, 'voice', previous ? text(previous, 'voice', '1') : String(staff)));
      lanes.set(lane(stub), stub);
    }
    let firstLane = true;
    for (const sourceNote of lanes.values()) {
      if (!firstLane) { const backup = make(measure, 'backup'); backup.append(make(backup, 'duration', String(ctx.capacity))); measure.append(backup); }
      const rest = newNote(measure, { kind: 'rest', step: 'C', octave: 4, type: 'whole', dots: 0 }, ctx.capacity, sourceNote);
      first(rest, 'type')!.remove(); first(rest, 'rest')!.setAttribute('measure', 'yes'); measure.append(rest);
      if (p === part) { if (!fallbackId) fallbackId = rest.getAttribute('id')!; if (lane(sourceNote) === lane(selected)) selectedId = rest.getAttribute('id')!; }
      firstLane = false;
    }
    p.insertBefore(measure, measures[index + offset] ?? null);
    if (position === 'after' && index === count - 1) {
      const ending = children(source, 'barline').find(e => e.getAttribute('location') === 'right'
        && children(e).length === 1 && ['light-heavy', 'heavy-heavy'].includes(text(e, 'bar-style')));
      if (ending) measure.append(ending);
    }
  }
  return selectedId || fallbackId;
}

/** Transactional edits to the authoritative XML; all rejection paths leave the document untouched. */
export function editImportedStructure(doc: MusicXmlDocument, id: string, operation: ImportedStructureOperation): { document: MusicXmlDocument; selectedId: string } {
  const checked = openMusicXml(doc.xml, doc.filename), doctype = checked.xml.match(/<!DOCTYPE\b[^>]*>/i)?.[0];
  const dom = new DOMParser().parseFromString(checked.xml.replace(/<!DOCTYPE\b[^>]*>/i, ''), 'application/xml');
  const found = Array.from(dom.getElementsByTagNameNS(dom.documentElement.namespaceURI, 'note')).find(n => n.getAttribute('id') === id);
  const selected = found ?? fail('select a note or rest in a measure first.');
  if (!selected || selected.parentElement?.localName !== 'measure') fail('select a note or rest in a measure first.');
  if (operation.kind === 'bar') { const selectedId = bar(dom, selected, operation.position); return { document: persist(doc, dom, doctype), selectedId }; }
  const measure = selected.parentElement!, ctx = context(measure), event = groupFor(ctx, selected);
  if (operation.kind === 'delete') {
    plain(selected); removeBeams(event);
    const document = deleteImportedNote(persist(doc, dom, doctype), id);
    const remaining = new DOMParser().parseFromString(document.xml.replace(/<!DOCTYPE\b[^>]*>/i, ''), 'application/xml');
    const ids = Array.from(remaining.getElementsByTagNameNS('*', 'note')).map(n => n.getAttribute('id')!);
    return { document, selectedId: ids.includes(id) ? id : event.notes.find(n => n !== selected)?.getAttribute('id') ?? ids[0] ?? '' };
  }
  const entry = operation.kind === 'insert' || operation.kind === 'chord' ? operation.entry : undefined;
  if (entry && (entry.kind !== 'note' && entry.kind !== 'rest' || !['C', 'D', 'E', 'F', 'G', 'A', 'B'].includes(entry.step) || !Number.isInteger(entry.octave) || entry.octave < 0 || entry.octave > 9 || entry.alter !== undefined && ![-2, -1, 0, 1, 2].includes(entry.alter))) fail('choose a supported pitch, octave and accidental.');
  let created: Element | undefined;
  if (operation.kind === 'chord') {
    if (entry!.kind !== 'note' || event.notes.some(n => !first(n, 'pitch') || first(n, 'grace') || first(n, 'time-modification') || first(n, 'tie') || n.getElementsByTagNameNS(n.namespaceURI, 'tied').length)) complex();
    if (event.notes.some(n => text(first(n, 'pitch')!, 'step') === entry!.step && text(first(n, 'pitch')!, 'octave') === String(entry!.octave))) fail('another pitch in this chord already uses that staff position.');
    const type = text(event.notes[0], 'type') as ImportedDuration, dots = children(event.notes[0], 'dot').length;
    if (!names.includes(type) || dots > 2 || durationTicks(type, dots, ctx.divisions) !== event.duration) complex();
    created = newNote(measure, { ...entry!, type, dots: dots as 0 | 1 | 2 }, event.duration, selected); created.prepend(make(created, 'chord'));
    event.notes.at(-1)!.after(created);
  } else if (operation.kind === 'duration') {
    event.notes.forEach(note => plain(note, true)); const wanted = durationTicks(operation.type, operation.dots, ctx.divisions);
    if (wanted === event.duration && event.notes.every(n => text(n, 'type') === operation.type && children(n, 'dot').length === operation.dots)) return { document: doc, selectedId: id };
    if (wanted < event.duration) { const rests = restPieces(measure, event.duration - wanted, ctx, selected); event.notes.at(-1)!.after(...rests); }
    else if (wanted > event.duration) {
      const rests = followingRests(event, wanted - event.duration, ctx), total = rests.reduce((n, e) => n + e.duration, 0n), remainder = total - (wanted - event.duration);
      const pieces = restPieces(measure, remainder, ctx, selected); rests.forEach(removeBeams); rests.at(-1)!.notes[0].after(...pieces); rests.forEach(e => e.notes[0].remove());
    }
    removeBeams(event); event.notes.forEach(n => durationFields(n, wanted, operation.type, operation.dots));
  } else if (operation.kind === 'insert') {
    const wanted = durationTicks(entry!.type, entry!.dots, ctx.divisions); created = newNote(measure, entry!, wanted, selected);
    let rest: Event | undefined, fromEnd = false;
    if (operation.position === 'replace-rest') { if (!first(selected, 'rest')) fail('select a rest to replace.'); rest = event; }
    else if (operation.position === 'after') {
      const next = event.notes.at(-1)!.nextElementSibling; rest = ctx.events.find(e => e.notes[0] === next && e.lane === event.lane && e.onset === event.onset + event.duration && first(e.notes[0], 'rest'));
    } else {
      const prev = event.notes[0].previousElementSibling; rest = ctx.events.find(e => e.notes[0] === prev && e.lane === event.lane && e.onset + e.duration === event.onset && first(e.notes[0], 'rest')); fromEnd = true;
    }
    if (rest) {
      if (rest.notes.length !== 1) complex(); plain(rest.notes[0]); unreferenced(rest.notes[0]); if (wanted > rest.duration) fail('the selected adjacent rest is too short; choose a shorter duration.');
      const pieces = restPieces(measure, rest.duration - wanted, ctx, selected); removeBeams(rest); rest.notes[0].replaceWith(...(fromEnd ? [...pieces, created] : [created, ...pieces]));
    } else {
      if (operation.position !== 'after' || event.notes.at(-1)!.nextElementSibling && Array.from(event.notes.at(-1)!.parentElement!.children).slice(Array.from(measure.children).indexOf(event.notes.at(-1)!) + 1).some(e => ['note', 'backup', 'forward', 'attributes'].includes(e.localName))) fail('adding here requires an adjacent rest; replace a rest or insert a bar.');
      if (event.onset + event.duration + wanted > ctx.capacity) fail('the bar has no room for this note; replace a rest or insert a bar.');
      event.notes.at(-1)!.after(created);
    }
  }
  let document = persist(doc, dom, doctype); const selectedId = created?.getAttribute('id') ?? id;
  if (created && entry!.kind === 'note') document = editImportedNote(document, selectedId, { step: entry!.step, octave: entry!.octave, ...(entry!.alter !== undefined ? { alter: entry!.alter } : {}), accidental: entry!.accidental ?? 'auto' });
  return { document, selectedId };
}
