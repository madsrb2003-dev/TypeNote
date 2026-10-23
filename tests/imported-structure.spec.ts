import { expect, test } from '@playwright/test';

const note = (id: string, pitch: string, duration = 4, voice = '1', staff = '1') => `<note id="${id}">${pitch === 'rest' ? '<rest/>' : `<pitch><step>${pitch}</step><octave>4</octave></pitch>`}<duration>${duration}</duration><voice>${voice}</voice><type>${duration === 4 ? 'quarter' : 'half'}</type><staff>${staff}</staff></note>`;
const score = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part><score-part id="P2"><part-name>Other</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><direction><direction-type><words>Keep this</words></direction-type></direction>${note('a', 'C')}${note('r', 'rest', 8)}${note('b', 'D')}<backup><duration>16</duration></backup>${note('bass', 'E', 8, '5', '2')}${note('bass-rest', 'rest', 8, '5', '2')}<barline location="right"><bar-style>light-heavy</bar-style></barline></measure></part><part id="P2"><measure number="1"><attributes><divisions>4</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>${note('other', 'G', 8)}${note('other-rest', 'rest', 8)}</measure></part></score-partwise>`;

test('rest filling, chord construction and resizing preserve other voices and unknown content', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml, inspectMusicXml, serializeMusicXmlDocument, parseMusicXmlDocument } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const original = openMusicXml(xml), entry = { kind: 'note' as const, step: 'F' as const, octave: 4, type: 'quarter' as const, dots: 0 as const };
    const inserted = edit(original, 'r', { kind: 'insert', position: 'replace-rest', entry });
    const chord = edit(inserted.document, inserted.selectedId, { kind: 'chord', entry: { ...entry, step: 'A' } });
    const short = edit(chord.document, chord.selectedId, { kind: 'duration', type: 'eighth', dots: 0 });
    const grown = edit(short.document, chord.selectedId, { kind: 'duration', type: 'half', dots: 0 });
    const doc = new DOMParser().parseFromString(grown.document.xml, 'application/xml');
    const saved = parseMusicXmlDocument(serializeMusicXmlDocument(grown.document));
    return { inserted: inspectMusicXml(inserted.document).notes.find(n => n.id === inserted.selectedId), durations: Array.from(doc.querySelectorAll('note')).filter(n => n.id === inserted.selectedId || n.id === chord.selectedId).map(n => n.querySelector('duration')?.textContent), backup: doc.querySelector('backup')?.outerHTML, bass: doc.querySelector('#bass')?.outerHTML, other: doc.querySelector('#other')?.outerHTML, text: doc.querySelector('words')?.textContent, original: original.xml, unchanged: saved.xml === grown.document.xml, count: inspectMusicXml(grown.document).notes.length };
  }, score);
  expect(result.inserted).toMatchObject({ step: 'F', alter: 1, accidental: 'auto' });
  expect(result.durations).toEqual(['8', '8']);
  expect(result.backup).toBe('<backup><duration>16</duration></backup>');
  expect(result.bass).toContain('<duration>8</duration><voice>5</voice>');
  expect(result.other).toContain('<step>G</step>');
  expect(result.text).toBe('Keep this');
  expect(result.unchanged).toBe(true);
  expect(result.original).toContain('id="r"');
});

test('before and after insertion consume adjacent rest time; rejection is transactional', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts'); const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const original = openMusicXml(xml), entry = { kind: 'note' as const, step: 'B' as const, octave: 4, alter: -1 as const, accidental: 'explicit' as const, type: 'quarter' as const, dots: 0 as const };
    const before = edit(original, 'b', { kind: 'insert', position: 'before', entry });
    const after = edit(original, 'a', { kind: 'insert', position: 'after', entry });
    const parse = (source: string) => new DOMParser().parseFromString(source, 'application/xml');
    const ids = (source: string) => Array.from(parse(source).querySelector('part')!.querySelectorAll('note')).map(n => n.id);
    const failures: string[] = [];
    for (const operation of [{ kind: 'duration' as const, type: 'breve' as const, dots: 0 as const }, { kind: 'insert' as const, position: 'before' as const, entry }, { kind: 'duration' as const, type: '128th' as const, dots: 0 as const }]) { try { edit(original, 'a', operation); } catch (e) { failures.push((e as Error).message); } }
    const bad = original.xml.replace('<duration>4</duration>', '<duration>40</duration>'); try { edit(openMusicXml(bad), 'a', { kind: 'chord', entry }); } catch (e) { failures.push((e as Error).message); }
    return { beforeIds: ids(before.document.xml), beforeId: before.selectedId, afterIds: ids(after.document.xml), afterId: after.selectedId, accidental: parse(after.document.xml).getElementById(after.selectedId)?.querySelector('accidental')?.textContent, failures, unchanged: original.xml === openMusicXml(xml).xml.replace(/tn-words-[A-Za-z0-9-]+/g, original.xml.match(/tn-words-[A-Za-z0-9-]+/)?.[0] ?? '') };
  }, score);
  expect(result.beforeIds.slice(0, 4)).toEqual(['a', expect.any(String), result.beforeId, 'b']);
  expect(result.afterIds[1]).toBe(result.afterId);
  expect(result.accidental).toBe('flat');
  expect(result.failures).toHaveLength(4);
  expect(result.failures.join(' ')).toContain('overfull');
  expect(result.failures.join(' ')).toContain('source divisions');
  expect(result.unchanged).toBe(true);
});

test('bar insertion aligns parts and preserves original numbering, staff lanes and attributes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts'); const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const original = openMusicXml(xml), added = edit(original, 'bass', { kind: 'bar', position: 'before' });
    const dom = new DOMParser().parseFromString(added.document.xml, 'application/xml'), selected = dom.getElementById(added.selectedId)!;
    return { numbers: Array.from(dom.querySelectorAll('part')).map(p => Array.from(p.querySelectorAll('measure')).map(m => m.getAttribute('number'))), staff: selected.querySelector('staff')?.textContent, voice: selected.querySelector('voice')?.textContent, rests: dom.querySelector('measure')?.querySelectorAll('rest[measure="yes"]').length, key: dom.querySelector('measure key fifths')?.textContent, backup: dom.querySelector('measure backup duration')?.textContent, original: dom.querySelector('measure[number="1"] #a')?.querySelector('pitch step')?.textContent };
  }, score);
  expect(result).toMatchObject({ numbers: [['1-new-1', '1'], ['1-new-1', '1']], staff: '2', voice: '5', rests: 2, key: '1', backup: '16', original: 'C' });
});

test('connected notation and referenced rests are retained and safely rejected; ordinary beams can be edited', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts'); const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const entry = { kind: 'note' as const, step: 'E' as const, octave: 4, type: 'quarter' as const, dots: 0 as const };
    const failures: string[] = [];
    for (const source of [xml.replace('<note id="a">', '<note id="a"><grace/>'), xml.replace('<note id="a">', '<note id="a"><tie type="start"/>'), xml.replace('<direction>', '<direction href="#r">')]) {
      const original = openMusicXml(source); try { edit(original, source.includes('href') ? 'r' : 'a', { kind: 'insert', position: 'replace-rest', entry }); } catch (e) { failures.push((e as Error).message); }
    }
    const beamed = openMusicXml(xml.replace('<staff>1</staff></note>', '<staff>1</staff><beam number="1">begin</beam></note>').replace('<note id="r"><rest/>', '<note id="r"><rest/>'));
    const deleted = edit(beamed, 'a', { kind: 'delete' });
    const dom = new DOMParser().parseFromString(deleted.document.xml, 'application/xml');
    return { failures, rest: !!dom.querySelector('#a rest'), beams: dom.querySelector('#a beam')?.textContent, backup: dom.querySelector('backup duration')?.textContent };
  }, score);
  expect(result.failures).toHaveLength(3);
  expect(result).toMatchObject({ rest: true, backup: '16' });
  expect(result.beams).toBeUndefined();
});

test('entries after a rest keep that rest, and unchanged rhythms retain beam instructions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const entry = { kind: 'rest' as const, step: 'C' as const, octave: 4, type: 'quarter' as const, dots: 0 as const };
    const first = edit(openMusicXml(xml), 'r', { kind: 'insert', position: 'replace-rest', entry });
    const second = edit(first.document, first.selectedId, { kind: 'insert', position: 'after', entry: { ...entry, kind: 'note', step: 'F' } });
    const dom = new DOMParser().parseFromString(second.document.xml, 'application/xml');
    const beamed = openMusicXml(xml.replace('<staff>1</staff></note>', '<staff>1</staff><beam number="1">begin</beam></note>'));
    const unchanged = edit(beamed, 'a', { kind: 'duration', type: 'quarter', dots: 0 });
    return { restRetained: !!dom.getElementById(first.selectedId)?.querySelector('rest'), nextStep: dom.getElementById(second.selectedId)?.querySelector('step')?.textContent, nextSibling: dom.getElementById(first.selectedId)?.nextElementSibling?.id, selectedId: second.selectedId, unchanged: unchanged.document.xml === beamed.xml };
  }, score);
  expect(result).toMatchObject({ restRetained: true, nextStep: 'F', unchanged: true });
  expect(result.nextSibling).toBe(result.selectedId);
});

test('new bars inherit prior settings, retain absent staff lanes, and do not duplicate signature changes', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    parsed.querySelector('part[id="P2"]')?.remove(); parsed.querySelector('score-part[id="P2"]')?.remove();
    const part = parsed.querySelector('part')!;
    part.insertAdjacentHTML('beforeend', '<measure number="2"><attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note id="next"><rest measure="yes"/><duration>12</duration><voice>1</voice><staff>1</staff></note></measure>');
    const original = openMusicXml(new XMLSerializer().serializeToString(parsed));
    const before = edit(original, 'next', { kind: 'bar', position: 'before' });
    const after = edit(original, 'next', { kind: 'bar', position: 'after' });
    const read = (xml: string) => {
      const dom = new DOMParser().parseFromString(xml, 'application/xml'), measure = dom.querySelector('measure[number="2-new-1"]')!;
      return { attributes: measure.querySelectorAll('attributes').length, staffs: [...measure.querySelectorAll('note staff')].map(e => e.textContent), duration: measure.querySelector('note duration')?.textContent, originalTime: dom.querySelector('measure[number="2"] time beats')?.textContent };
    };
    return { before: read(before.document.xml), after: read(after.document.xml) };
  }, score);
  expect(result.before).toMatchObject({ attributes: 0, staffs: ['1', '2'], duration: '16', originalTime: '3' });
  expect(result.after).toMatchObject({ attributes: 0, staffs: ['1', '2'], duration: '12', originalTime: '3' });
});

test('connected beam IDs, duplicated attribute IDs and unequal part lengths are guarded', async ({ page }) => {
  await page.goto('/');
  const failures = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const cases = [
      { source: xml.replace('<staff>1</staff></note>', '<staff>1</staff><beam id="beam-link" number="1">begin</beam></note>').replace('<direction>', '<direction href="#beam-link">'), operation: { kind: 'delete' as const } },
      { source: xml.replace('<key>', '<key id="key-link">'), operation: { kind: 'bar' as const, position: 'before' as const } },
      { source: xml.replace('<part id="P2">', '<part id="P2">').replace('<note id="other">', '<attributes><time><beats>3</beats><beat-type>4</beat-type></time></attributes><note id="other">').replace('<note id="other-rest"><rest/><duration>8', '<note id="other-rest"><rest/><duration>4'), operation: { kind: 'bar' as const, position: 'after' as const } },
    ];
    return cases.map(({ source, operation }) => {
      const doc = openMusicXml(source), before = doc.xml;
      try { edit(doc, 'a', operation); return { rejected: false, unchanged: before === doc.xml }; }
      catch { return { rejected: true, unchanged: before === doc.xml }; }
    });
  }, score);
  expect(failures).toEqual(Array.from({ length: 3 }, () => ({ rejected: true, unchanged: true })));
});

test('rhythm edits retain independent fingering and articulation but reject ties and tuplets', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const notation = '<notations><technical><fingering>3</fingering></technical><articulations><staccato/></articulations></notations>';
    const original = openMusicXml(xml.replace('<staff>1</staff></note>', `<staff>1</staff>${notation}</note>`));
    const changed = edit(original, 'a', { kind: 'duration', type: 'eighth', dots: 0 });
    const dom = new DOMParser().parseFromString(changed.document.xml, 'application/xml');
    const rejected = ['<tie type="start"/>', '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>'].map(mark => {
      try { edit(openMusicXml(xml.replace('<note id="a">', `<note id="a">${mark}`)), 'a', { kind: 'duration', type: 'eighth', dots: 0 }); return false; } catch { return true; }
    });
    return { marks: dom.querySelector('#a notations')?.outerHTML, restHasMarks: !!dom.querySelector('#a + note notations'), duration: dom.querySelector('#a duration')?.textContent, rejected };
  }, score);
  expect(result).toMatchObject({ marks: '<notations><technical><fingering>3</fingering></technical><articulations><staccato/></articulations></notations>', restHasMarks: false, duration: '2', rejected: [true, true] });
});

test('bar insertion does not separate ties or tuplets across the chosen boundary', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async xml => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { editImportedStructure: edit } = await import('/src/documents/structure.ts');
    const parsed = new DOMParser().parseFromString(xml, 'application/xml');
    parsed.querySelector('part[id="P2"]')?.remove(); parsed.querySelector('score-part[id="P2"]')?.remove();
    const base = new XMLSerializer().serializeToString(parsed);
    return ['<tie type="start"/>', '<notations><tuplet type="start" number="1"/></notations>'].map(mark => {
      const doc = openMusicXml(base.replace('<note id="b">', `<note id="b">${mark}`)), before = doc.xml;
      try { edit(doc, 'b', { kind: 'bar', position: 'after' }); return { rejected: false, unchanged: doc.xml === before }; }
      catch (error) { return { rejected: /crosses this bar boundary/.test(String(error)), unchanged: doc.xml === before }; }
    });
  }, score);
  expect(results).toEqual([{ rejected: true, unchanged: true }, { rejected: true, unchanged: true }]);
});
