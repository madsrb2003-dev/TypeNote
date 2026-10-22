import { DYNAMICS, MAX_SCORE_FILE_BYTES } from '../domain/types';
import type { Alteration, Step } from '../domain/types';
import type { DocumentInfo, ImportedDirection, ImportedNote, ImportedNotePatch, MusicXmlDocument } from './types';

const steps: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const validId = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const accidentalNames: Record<Alteration, string> = { '-2': 'flat-flat', '-1': 'flat', 0: 'natural', 1: 'sharp', 2: 'double-sharp' };
const elements = (node: ParentNode, name?: string): Element[] => Array.from(node.children).filter((element) => (!name || element.localName === name) && (!(node instanceof Element) || element.namespaceURI === node.namespaceURI));
const first = (node: ParentNode, name: string) => elements(node, name)[0];
const descendants = (node: Element | Document, name: string): Element[] => Array.from(node.getElementsByTagNameNS(node instanceof Element ? node.namespaceURI : node.documentElement?.namespaceURI ?? null, name));
const content = (node: ParentNode, name: string, fallback = '') => first(node, name)?.textContent ?? fallback;
function error(message: string): never { throw new Error(`MusicXML: ${message}`); }
function size(text: string): void {
  if (text.length > MAX_SCORE_FILE_BYTES || new TextEncoder().encode(text).byteLength > MAX_SCORE_FILE_BYTES) error('files must be at most 10 MB.');
}
interface Parsed { dom: XMLDocument; doctype?: string }
function parse(xml: string): Parsed {
  size(xml);
  if (/<!ENTITY\b/i.test(xml) || /<!DOCTYPE[^>]*\[/i.test(xml)) error('entity declarations and internal DTD subsets are not supported.');
  const doctypes = xml.match(/<!DOCTYPE\b[^>]*>/gi) ?? [];
  if (doctypes.length > 1 || (doctypes[0] && !/^<!DOCTYPE\s+score-partwise(?:\s+(?:SYSTEM\s+(?:"[^"]*"|'[^']*')|PUBLIC\s+(?:"[^"]*"|'[^']*')\s+(?:"[^"]*"|'[^']*')))?\s*>$/i.test(doctypes[0]))) error('unsupported document type declaration.');
  // The declaration is retained as inert source text, never passed to a parser that
  // might resolve a remote DTD. DOMParser does not execute stylesheets or scripts.
  const doctype = doctypes[0];
  const safe = doctype ? xml.replace(doctype, '') : xml;
  const dom = new DOMParser().parseFromString(safe, 'application/xml');
  if (dom.getElementsByTagNameNS('*', 'parsererror').length || dom.documentElement.localName === 'parsererror') error('the file is malformed XML.');
  if (dom.documentElement.localName !== 'score-partwise') error('open an uncompressed MusicXML score-partwise file (.musicxml or .xml).');
  if (!elements(dom.documentElement, 'part').length || !first(dom.documentElement, 'part-list')) error('the score needs a part-list and at least one part.');
  return { dom, doctype };
}
function xmlText(parsed: Parsed): string {
  let xml = new XMLSerializer().serializeToString(parsed.dom);
  if (parsed.doctype) xml = xml.replace(/<(?:[A-Za-z_][\w.-]*:)?score-partwise\b/, `${parsed.doctype}\n$&`);
  size(xml);
  return xml;
}
function targetDirections(dom: Document): Element[] {
  return descendants(dom, 'direction').flatMap((direction) => elements(direction, 'direction-type').flatMap((type) => elements(type).filter((item) => ['dynamics', 'words', 'rehearsal'].includes(item.localName))));
}
function targets(dom: Document): Element[] { return [...descendants(dom, 'note'), ...targetDirections(dom)]; }
function assignIds(dom: Document): void {
  const all = Array.from(dom.getElementsByTagName('*'));
  const reserved = new Map<string, Element[]>();
  for (const element of all) for (const attribute of ['id', 'xml:id']) {
    const id = element.getAttribute(attribute);
    if (id) reserved.set(id, [...reserved.get(id) ?? [], element]);
  }
  for (const target of targets(dom)) {
    const original = target.getAttribute('id');
    const xmlId = target.getAttribute('xml:id');
    if (original && (reserved.get(original)?.some((element) => element !== target))) error(`duplicate target ID "${original}"; resolve the duplicate in the source file before opening.`);
    if (original && validId.test(original)) continue;
    if (original && all.some((element) => Array.from(element.attributes).some((attribute) => attribute.name !== 'id' && attribute.name !== 'xml:id' && attribute.value.split(/\s+/).some((value) => value === original || value.endsWith(`#${original}`))))) error(`note or marking ID "${original}" is invalid and referenced elsewhere; repair the source ID and its references first.`);
    if (xmlId && validId.test(xmlId) && !reserved.get(xmlId)?.some((element) => element !== target)) {
      target.setAttribute('id', xmlId);
      continue;
    }
    let generated: string;
    do { generated = `tn-${target.localName}-${crypto.randomUUID()}`; } while (reserved.has(generated));
    target.setAttribute('id', generated); reserved.set(generated, [target]);
  }
}
function checkFilename(filename: unknown): void {
  if (filename !== undefined && (typeof filename !== 'string' || filename.length > 1024)) error('invalid filename.');
}
export function openMusicXml(xml: string, filename?: string): MusicXmlDocument {
  if (typeof xml !== 'string') error('the score source must be XML text.');
  checkFilename(filename);
  const parsed = parse(xml); assignIds(parsed.dom);
  return checkedDocument({ version: 4, kind: 'musicxml', xml: xmlText(parsed), ...(filename !== undefined ? { filename } : {}) });
}
function readDocument(doc: MusicXmlDocument): Parsed {
  if (!doc || doc.version !== 4 || doc.kind !== 'musicxml' || typeof doc.xml !== 'string' || Object.keys(doc).some((key) => !['version', 'kind', 'xml', 'filename'].includes(key))) error('unsupported editable document.');
  return parse(doc.xml);
}
function checkedDocument(doc: MusicXmlDocument): MusicXmlDocument {
  checkFilename(doc.filename); size(JSON.stringify(doc) + '\n'); return doc;
}
function writeDocument(doc: MusicXmlDocument, parsed: Parsed): MusicXmlDocument { return checkedDocument({ ...doc, xml: xmlText(parsed) }); }
function ancestor(element: Element, name: string): Element | null {
  let parent = element.parentElement;
  while (parent && parent.localName !== name) parent = parent.parentElement;
  return parent;
}
function pitchData(note: Element) {
  const pitch = first(note, 'pitch');
  if (!pitch) return undefined;
  return { step: content(pitch, 'step'), alter: Number(content(pitch, 'alter', '0')), octave: Number(content(pitch, 'octave')) };
}
function finiteAlter(value: number): value is Alteration { return [-2, -1, 0, 1, 2].includes(value); }
function directionValue(element: Element): string {
  if (element.localName !== 'dynamics') return element.textContent ?? '';
  return elements(element).map((child) => child.localName === 'other-dynamics' ? child.textContent ?? '' : child.localName).join(' ');
}
export function inspectMusicXml(doc: MusicXmlDocument): DocumentInfo {
  const { dom } = readDocument(doc);
  const root = dom.documentElement;
  const warnings: string[] = [];
  const notes: ImportedNote[] = descendants(dom, 'note').map((element) => {
    const pitch = pitchData(element);
    const accidental = first(element, 'accidental');
    const fingering = descendants(element, 'fingering')[0];
    return {
      id: element.getAttribute('id') ?? '', measure: ancestor(element, 'measure')?.getAttribute('number') ?? '', part: ancestor(element, 'part')?.getAttribute('id') ?? '',
      staff: content(element, 'staff', '1'), voice: content(element, 'voice', '1'), kind: first(element, 'rest') ? 'rest' : 'note',
      ...(pitch && steps.includes(pitch.step as Step) ? { step: pitch.step as Step } : {}),
      ...(pitch && finiteAlter(pitch.alter) ? { alter: pitch.alter } : {}), ...(pitch && Number.isInteger(pitch.octave) ? { octave: pitch.octave } : {}),
      accidental: accidental ? accidental.getAttribute('cautionary') === 'yes' || accidental.getAttribute('parentheses') === 'yes' ? 'courtesy' : 'explicit' : 'auto',
      type: content(element, 'type', first(element, 'rest')?.getAttribute('measure') === 'yes' ? 'measure rest' : 'unspecified'), dots: elements(element, 'dot').length,
      grace: !!first(element, 'grace'), cue: !!first(element, 'cue'), hidden: element.getAttribute('print-object') === 'no', ...(fingering ? { fingering: fingering.textContent ?? '' } : {}),
    };
  });
  if (descendants(dom, 'note').some((note) => { const p = pitchData(note); return p && !finiteAlter(p.alter); })) warnings.push('Microtonal pitches are retained. Choose an explicit supported alteration when editing their pitch.');
  if (descendants(dom, 'unpitched').length) warnings.push('Unpitched notes are retained; their pitch cannot be edited with the pitched-note controls.');
  const directions: ImportedDirection[] = targetDirections(dom).map((element) => ({ id: element.getAttribute('id') ?? '', kind: element.localName === 'dynamics' ? 'dynamic' : element.localName as 'words' | 'rehearsal', value: directionValue(element), measure: ancestor(element, 'measure')?.getAttribute('number') ?? '' }));
  const featureTags: [string, string][] = [['tuplet', 'Tuplets'], ['key', 'Key signatures'], ['clef', 'Clef changes'], ['transpose', 'Transposition'], ['pedal', 'Pedal markings'], ['octave-shift', 'Octave lines'], ['glissando', 'Glissandi'], ['slide', 'Slides'], ['slur', 'Slurs'], ['tied', 'Ties'], ['tremolo', 'Tremolo'], ['arpeggiate', 'Arpeggios'], ['grace', 'Grace notes'], ['cue', 'Cue notes'], ['lyric', 'Lyrics'], ['ending', 'Repeat endings'], ['repeat', 'Repeats'], ['offset', 'Direction offsets'], ['technical', 'Technical notation'], ['staff-details', 'Staff details']];
  const features = featureTags.filter(([tag]) => descendants(dom, tag).length).map(([, label]) => label);
  if (notes.some((note) => note.hidden)) features.push('Hidden notes');
  if (notes.some((note) => Number(note.staff) > 2)) features.push('More than two staves');
  if (elements(root, 'part').length > 1) features.push('Multiple parts');
  return { title: content(root, 'movement-title', content(first(root, 'work') ?? root, 'work-title', 'Untitled score')), composer: descendants(root, 'creator').find((creator) => creator.getAttribute('type') === 'composer')?.textContent ?? '', notes, directions, features, warnings };
}
function create(parent: Element, name: string): Element { return parent.ownerDocument.createElementNS(parent.namespaceURI, name); }
function setText(element: Element, value: string): void {
  if (element.children.length) error(`cannot safely replace structured ${element.localName} text; edit that field in the advanced MusicXML editor.`);
  element.textContent = value;
}
function field(parent: Element, name: string, value: string, order: string[]): Element {
  let element = first(parent, name);
  if (!element) {
    element = create(parent, name);
    const index = order.indexOf(name);
    const following = elements(parent).find((child) => order.indexOf(child.localName) > index);
    parent.insertBefore(element, following ?? null);
  }
  setText(element, value); return element;
}
function target(parsed: Parsed, id: string, names: string[]): Element {
  const found = targets(parsed.dom).filter((element) => element.getAttribute('id') === id && names.includes(element.localName));
  if (found.length !== 1) error('the selected note or marking no longer exists or has an ambiguous ID.');
  return found[0];
}

interface Rational { n: bigint; d: bigint }
const zero = (): Rational => ({ n: 0n, d: 1n });
function rational(n: bigint, d: bigint): Rational { if (d <= 0n) error('invalid timing divisions.'); let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b]; return { n: n / (a || 1n), d: d / (a || 1n) }; }
function add(a: Rational, b: Rational): Rational { return rational(a.n * b.d + b.n * a.d, a.d * b.d); }
function compare(a: Rational, b: Rational): number { const delta = a.n * b.d - b.n * a.d; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
function integerText(value: string, label: string, allowZero = false): bigint {
  if (!/^\d+$/.test(value.trim()) || (!allowZero && BigInt(value) === 0n)) error(`automatic accidentals cannot resolve ${label}; choose an explicit accidental instead.`);
  return BigInt(value);
}
function keyAlterations(key: Element): Map<string, number> {
  if (first(key, 'key-octave')) error('automatic accidentals for octave-specific key signatures are not supported; choose an explicit accidental.');
  const values = new Map<string, number>();
  const fifths = first(key, 'fifths');
  if (fifths) {
    const count = Number(fifths.textContent);
    if (!Number.isInteger(count) || count < -7 || count > 7) error('automatic accidentals need a supported key signature; choose an explicit accidental.');
    for (const step of (count >= 0 ? ['F', 'C', 'G', 'D', 'A', 'E', 'B'] : ['B', 'E', 'A', 'D', 'G', 'C', 'F']).slice(0, Math.abs(count))) values.set(step, count >= 0 ? 1 : -1);
  } else {
    let step: string | undefined;
    for (const child of elements(key)) {
      if (child.localName === 'key-step') step = child.textContent ?? '';
      if (child.localName === 'key-alter') {
        const alter = Number(child.textContent);
        if (!step || !steps.includes(step as Step) || !finiteAlter(alter)) error('automatic accidentals cannot resolve this custom key; choose an explicit accidental.');
        values.set(step, alter); step = undefined;
      }
    }
    if (step) error('incomplete key signature; choose an explicit accidental.');
  }
  return values;
}
/** Source timing, including backups and mid-bar attributes, determines key context. */
function automaticAlter(note: Element, step: Step, octave: number): Alteration {
  const part = ancestor(note, 'part');
  if (!part) error('the note has no part.');
  const staff = content(note, 'staff', '1');
  let divisions = 1n;
  let defaultKey = new Map<string, number>();
  const staffKeys = new Map<string, Map<string, number>>();
  for (const measure of elements(part, 'measure')) {
    let cursor = zero(), previousOnset = zero();
    const timeline: { time: Rational; order: number; element: Element; key?: boolean }[] = [];
    let order = 0;
    for (const item of elements(measure)) {
      order++;
      if (item.localName === 'attributes') {
        if (first(item, 'divisions')) divisions = integerText(content(item, 'divisions'), 'divisions');
        for (const key of elements(item, 'key')) timeline.push({ time: cursor, order, element: key, key: true });
      } else if (item.localName === 'backup' || item.localName === 'forward') {
        const duration = rational(integerText(content(item, 'duration'), 'a duration', true), divisions);
        cursor = add(cursor, item.localName === 'backup' ? { ...duration, n: -duration.n } : duration);
        if (cursor.n < 0n) error('automatic accidentals cannot resolve a backup before the measure; choose an explicit accidental.');
      } else if (item.localName === 'note') {
        const chord = !!first(item, 'chord');
        const onset = chord ? previousOnset : cursor;
        timeline.push({ time: onset, order, element: item });
        if (!chord) previousOnset = onset;
        if (!chord && !first(item, 'grace')) cursor = add(cursor, rational(integerText(content(item, 'duration'), 'a note duration', true), divisions));
      }
    }
    timeline.sort((a, b) => compare(a.time, b.time) || a.order - b.order);
    const locals = new Map<string, number>();
    const wanted = timeline.find((item) => item.element === note);
    for (const item of timeline) {
      if (item.key) {
        const keyStaff = item.element.getAttribute('number');
        if (keyStaff && keyStaff !== staff) continue;
        const signature = keyAlterations(item.element);
        if (keyStaff) { staffKeys.set(keyStaff, signature); for (const key of locals.keys()) if (key.startsWith(`${keyStaff}/`)) locals.delete(key); }
        else { defaultKey = signature; staffKeys.clear(); locals.clear(); }
      } else {
        if (item.element === note) {
          const alter = locals.get(`${staff}/${step}/${octave}`) ?? (staffKeys.get(staff) ?? defaultKey).get(step) ?? 0;
          if (!finiteAlter(alter)) error('the active accidental is microtonal; choose an explicit supported accidental.');
          return alter;
        }
        const pitch = pitchData(item.element);
        const tiedStop = elements(item.element, 'tie').some((tie) => tie.getAttribute('type') === 'stop');
        if (pitch && !(tiedStop && !first(item.element, 'accidental')) && (!wanted || compare(item.time, wanted.time) < 0 || !!first(item.element, 'grace'))) locals.set(`${content(item.element, 'staff', '1')}/${pitch.step}/${pitch.octave}`, pitch.alter);
      }
    }
    if (wanted) break;
  }
  return error('cannot determine the note’s key context; choose an explicit accidental.');
}

/** Resolve only unambiguous chains within one part, voice and staff.
 * Cross-staff/voice ties and repeat-dependent ties remain editable in source. */
function tiedChain(note: Element): Element[] {
  if (!elements(note, 'tie').length && !descendants(note, 'tied').length) return [note];
  const part = ancestor(note, 'part')!, wanted = pitchData(note)!;
  const fail = (): never => error('this tie chain is ambiguous or incomplete; edit the connected passage in the advanced MusicXML editor.');
  const candidates = descendants(part, 'note').filter((item) => {
    const pitch = pitchData(item);
    return pitch && pitch.step === wanted.step && pitch.alter === wanted.alter && pitch.octave === wanted.octave && content(item, 'voice', '1') === content(note, 'voice', '1') && content(item, 'staff', '1') === content(note, 'staff', '1');
  });
  const edges = new Map<Element, Element[]>();
  const active = new Map<string, Element>();
  const problems = new Set<Element>();
  for (const item of candidates) {
    const visual = descendants(item, 'tied'), sound = elements(item, 'tie');
    const signs = visual.length ? visual : sound;
    const types = (items: Element[]) => [...new Set(items.flatMap((sign) => sign.getAttribute('type') === 'continue' ? ['start', 'stop'] : [sign.getAttribute('type')]))].sort().join(',');
    if ((visual.length && sound.length && types(visual) !== types(sound)) || [...visual, ...sound].some((sign) => sign.hasAttribute('time-only'))) { problems.add(item); continue; }
    if (signs.some((sign) => !['start', 'stop', 'continue'].includes(sign.getAttribute('type') ?? '') || sign.hasAttribute('time-only'))) { problems.add(item); continue; }
    if (['start', 'stop', 'continue'].some((type) => signs.filter((sign) => sign.getAttribute('type') === type).length > 1)) { problems.add(item); continue; }
    const keys = new Set(signs.map((sign) => sign.getAttribute('number') ?? '1'));
    if (keys.size > 1) { problems.add(item); continue; }
    const key = [...keys][0] ?? '1';
    const stop = signs.some((sign) => ['stop', 'continue'].includes(sign.getAttribute('type')!));
    const start = signs.some((sign) => ['start', 'continue'].includes(sign.getAttribute('type')!));
    if (stop) {
      const prior = active.get(key);
      if (!prior) problems.add(item);
      else { edges.set(prior, [...edges.get(prior) ?? [], item]); edges.set(item, [...edges.get(item) ?? [], prior]); active.delete(key); }
    }
    if (start) {
      const prior = active.get(key);
      if (prior) { problems.add(prior); problems.add(item); }
      active.set(key, item);
    }
    if (!start && !stop && active.has(key)) { problems.add(active.get(key)!); }
  }
  for (const pending of active.values()) problems.add(pending);
  const connected = new Set<Element>();
  const visit = (item: Element) => { if (connected.has(item)) return; connected.add(item); for (const next of edges.get(item) ?? []) visit(next); };
  visit(note);
  if ([...connected].some((item) => problems.has(item)) || connected.size < 2) fail();
  return candidates.filter((item) => connected.has(item));
}

export function editImportedNote(doc: MusicXmlDocument, id: string, patch: ImportedNotePatch): MusicXmlDocument {
  if (!patch || Object.keys(patch).some((key) => !['step', 'alter', 'octave', 'accidental', 'fingering'].includes(key))) error('unsupported note edit.');
  if (patch.step !== undefined && !steps.includes(patch.step)) error('choose a pitch from C, D, E, F, G, A and H/B.');
  if (patch.alter !== undefined && !finiteAlter(patch.alter)) error('choose an alteration from double flat through double sharp.');
  if (patch.octave !== undefined && (!Number.isInteger(patch.octave) || patch.octave < 0 || patch.octave > 9)) error('choose an octave from 0 to 9.');
  if (patch.accidental !== undefined && !['auto', 'explicit', 'courtesy'].includes(patch.accidental)) error('unsupported accidental policy.');
  if (patch.fingering !== undefined && (typeof patch.fingering !== 'string' || patch.fingering.length > 40)) error('fingering must be text of at most 40 characters.');
  const parsed = readDocument(doc), note = target(parsed, id, ['note']);
  const pitch = first(note, 'pitch'), original = pitchData(note);
  if (Object.keys(patch).some((key) => key !== 'fingering') && !pitch) error('pitch controls require a pitched note; rests and unpitched notes are retained unchanged.');
  if (pitch && original && Object.keys(patch).some((key) => key !== 'fingering')) {
    const step = patch.step ?? original.step as Step, octave = patch.octave ?? original.octave;
    let alter = patch.alter ?? original.alter;
    if (patch.accidental === 'auto') alter = automaticAlter(note, step, octave);
    if (!steps.includes(step) || !Number.isInteger(octave) || !finiteAlter(alter)) error('this pitch needs an explicit supported step, octave and accidental before it can be edited.');
    const changed = step !== original.step || octave !== original.octave || alter !== original.alter;
    const connected = changed ? tiedChain(note) : [note];
    for (const linked of connected) {
      let base = linked;
      while (first(base, 'chord') && base.previousElementSibling?.localName === 'note') base = base.previousElementSibling;
      const chord = [base];
      for (let next = base.nextElementSibling; next?.localName === 'note' && first(next, 'chord'); next = next.nextElementSibling) chord.push(next);
      if (chord.some((other) => other !== linked && pitchData(other)?.step === step && pitchData(other)?.octave === octave)) error('another pitch in this chord already uses that staff position.');
      const linkedPitch = first(linked, 'pitch')!;
      if (step !== original.step) field(linkedPitch, 'step', step, ['step', 'alter', 'octave']);
      if (alter !== original.alter) field(linkedPitch, 'alter', String(alter), ['step', 'alter', 'octave']);
      if (octave !== original.octave) field(linkedPitch, 'octave', String(octave), ['step', 'alter', 'octave']);
      // Existing signs retain their engraving attributes, but must match the new pitch.
      const sign = first(linked, 'accidental');
      if (linked !== note && sign) setText(sign, accidentalNames[alter]);
    }
    // The chain's first note must visibly establish its new alteration, even when
    // the user edited a continuation in a later measure/key signature.
    if (changed && connected.length > 1) {
      const start = connected[0];
      let contextual: number | undefined;
      try { contextual = automaticAlter(start, step, octave); } catch { /* Explicit sign is safe when context is unsupported. */ }
      if (contextual !== alter || patch.accidental === 'explicit' || patch.accidental === 'courtesy' || patch.alter !== undefined) {
        field(start, 'accidental', accidentalNames[alter], ['grace', 'cue', 'chord', 'pitch', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen']);
      }
    }
    const policy = patch.accidental ?? (patch.alter !== undefined ? 'explicit' : undefined);
    if (policy === 'auto') first(note, 'accidental')?.remove();
    else if (policy) {
      const accidental = field(note, 'accidental', accidentalNames[alter], ['grace', 'cue', 'chord', 'pitch', 'rest', 'duration', 'tie', 'instrument', 'footnote', 'level', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'notehead-text', 'staff', 'beam', 'notations', 'lyric', 'play', 'listen']);
      if (policy === 'courtesy') { accidental.setAttribute('cautionary', 'yes'); accidental.setAttribute('parentheses', 'yes'); }
      else { accidental.removeAttribute('cautionary'); accidental.removeAttribute('parentheses'); }
    }
  }
  if (patch.fingering !== undefined) {
    const fingerings = descendants(note, 'fingering');
    if (fingerings.length > 1) error('this note has multiple fingerings; edit them in the advanced MusicXML editor to preserve their individual meanings.');
    if (!patch.fingering) fingerings[0]?.remove();
    else if (fingerings[0]) setText(fingerings[0], patch.fingering);
    else {
      let notations = first(note, 'notations');
      if (!notations) { notations = create(note, 'notations'); const following = elements(note).find((element) => ['lyric', 'play', 'listen'].includes(element.localName)); note.insertBefore(notations, following ?? null); }
      let technical = first(notations, 'technical');
      if (!technical) { technical = create(notations, 'technical'); notations.appendChild(technical); }
      field(technical, 'fingering', patch.fingering, ['fingering']);
    }
  }
  return writeDocument(doc, parsed);
}
/** Remove one chord pitch, or replace a standalone pitch with an equal-duration rest.
 * Conservative guards keep structural references and unknown notation intact. */
export function deleteImportedNote(doc: MusicXmlDocument, id: string): MusicXmlDocument {
  const parsed = readDocument(doc), note = target(parsed, id, ['note']);
  const fail = (): never => error('this note carries connected or unsupported notation; remove it in the advanced MusicXML editor to preserve the passage.');
  if (!first(note, 'pitch')) error('select a pitched note to remove.');
  const allowed = ['chord', 'pitch', 'duration', 'voice', 'type', 'dot', 'accidental', 'time-modification', 'stem', 'notehead', 'staff', 'instrument'];
  if (elements(note).some((child) => !allowed.includes(child.localName) || child.namespaceURI !== note.namespaceURI)) fail();
  const ids = Array.from(note.getElementsByTagName('*')).flatMap((item) => [item.getAttribute('id'), item.getAttribute('xml:id')]).filter(Boolean);
  ids.push(id, note.getAttribute('xml:id'));
  for (const element of Array.from(parsed.dom.getElementsByTagName('*'))) {
    if (element === note || note.contains(element)) continue;
    if (Array.from(element.attributes).some((attribute) => !['id', 'xml:id'].includes(attribute.name) && attribute.value.split(/\s+/).some((value) => ids.some((targetId) => targetId && (value === targetId || value.endsWith(`#${targetId}`)))))) fail();
  }
  const next = note.nextElementSibling;
  const nextChord = next?.localName === 'note' && first(next, 'chord');
  if (first(note, 'chord') || nextChord) {
    // Removing a base promotes its next member without changing the voice cursor.
    if (!first(note, 'chord') && next && nextChord) {
      if (content(next, 'duration') !== content(note, 'duration') || content(next, 'voice', '1') !== content(note, 'voice', '1')) fail();
      nextChord.remove();
    }
    note.remove();
  } else {
    const pitch = first(note, 'pitch')!;
    note.replaceChild(create(note, 'rest'), pitch);
    for (const name of ['accidental', 'stem', 'notehead']) for (const child of elements(note, name)) child.remove();
  }
  return writeDocument(doc, parsed);
}

export function editImportedMetadata(doc: MusicXmlDocument, patch: { title?: string; composer?: string }): MusicXmlDocument {
  if (Object.keys(patch).some((key) => !['title', 'composer'].includes(key))) error('unsupported metadata edit.');
  for (const value of Object.values(patch)) if (typeof value !== 'string' || value.length > 500) error('metadata must be text of at most 500 characters.');
  const parsed = readDocument(doc), root = parsed.dom.documentElement;
  if (patch.title !== undefined) {
    const existing = first(root, 'movement-title') ?? (first(root, 'work') ? first(first(root, 'work')!, 'work-title') : undefined);
    if (existing) setText(existing, patch.title);
    else field(root, 'movement-title', patch.title, ['work', 'movement-number', 'movement-title', 'identification', 'defaults', 'credit', 'part-list', 'part']);
  }
  if (patch.composer !== undefined) {
    let identification = first(root, 'identification');
    if (!identification) { identification = create(root, 'identification'); root.insertBefore(identification, elements(root).find((element) => ['defaults', 'credit', 'part-list', 'part'].includes(element.localName)) ?? null); }
    const composer = elements(identification, 'creator').find((element) => element.getAttribute('type') === 'composer');
    if (composer) setText(composer, patch.composer);
    else { const creator = create(identification, 'creator'); creator.setAttribute('type', 'composer'); creator.textContent = patch.composer; identification.insertBefore(creator, identification.firstChild); }
  }
  return writeDocument(doc, parsed);
}
export function editImportedDirection(doc: MusicXmlDocument, id: string, value: string): MusicXmlDocument {
  if (typeof value !== 'string' || value.length > 500) error('marking text must be at most 500 characters.');
  const parsed = readDocument(doc), element = target(parsed, id, ['dynamics', 'words', 'rehearsal']);
  if (element.localName !== 'dynamics') setText(element, value);
  else {
    const dynamicElements = elements(element).filter((item) => (DYNAMICS as readonly string[]).includes(item.localName) || ['other-dynamics', 'n', 'pf', 'sfpp'].includes(item.localName));
    if (dynamicElements.length > 1) error('this compound dynamic has multiple signs; edit it in the advanced MusicXML editor.');
    const old = dynamicElements[0];
    const name = (DYNAMICS as readonly string[]).includes(value) ? value : 'other-dynamics';
    if (old?.localName === name) { if (name === 'other-dynamics') setText(old, value); }
    else {
      const replacement = create(element, name);
      if (old) for (const attribute of Array.from(old.attributes)) replacement.setAttributeNS(attribute.namespaceURI, attribute.name, attribute.value);
      if (name === 'other-dynamics') replacement.textContent = value;
      if (old) element.replaceChild(replacement, old); else element.appendChild(replacement);
    }
  }
  return writeDocument(doc, parsed);
}
export function serializeMusicXmlDocument(doc: MusicXmlDocument): string {
  readDocument(doc); checkFilename(doc.filename);
  const text = JSON.stringify(doc) + '\n'; size(text); return text;
}
export function parseMusicXmlDocument(json: string): MusicXmlDocument {
  size(json);
  let value: unknown;
  try { value = JSON.parse(json); } catch { return error('the editable document is not valid JSON.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) error('invalid editable document.');
  const record = value as Record<string, unknown>;
  if (record.version !== 4 || record.kind !== 'musicxml' || typeof record.xml !== 'string' || Object.keys(record).some((key) => !['version', 'kind', 'xml', 'filename'].includes(key))) error('unsupported editable MusicXML document.');
  checkFilename(record.filename);
  return openMusicXml(record.xml, record.filename as string | undefined);
}
