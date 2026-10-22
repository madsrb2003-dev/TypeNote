import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const fixture = readFileSync(new URL('./fixtures/nested-rhythm.musicxml', import.meta.url), 'utf8');

test('source edits preserve nested rhythm and update every tied endpoint atomically', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (xml) => {
    const m = await import('/src/documents/musicxml.ts');
    const original = m.openMusicXml(xml);
    const edited = m.editImportedNote(original, 'span-2b', { step: 'F', alter: 1, accidental: 'explicit' });
    const reopened = m.parseMusicXmlDocument(m.serializeMusicXmlDocument(edited));
    const pitches = m.inspectMusicXml(reopened).notes.filter((n) => ['span-2a', 'span-2b'].includes(n.id));
    const stripPitch = (source: string) => {
      const dom = new DOMParser().parseFromString(source, 'application/xml');
      for (const id of ['span-2a', 'span-2b']) {
        dom.getElementById(id)?.querySelector('pitch')?.remove();
        dom.getElementById(id)?.querySelector('accidental')?.remove();
      }
      return new XMLSerializer().serializeToString(dom);
    };
    const dom = new DOMParser().parseFromString(reopened.xml, 'application/xml');
    return { pitches, startSign: dom.getElementById('span-2a')?.querySelector('accidental')?.textContent, preserved: stripPitch(original.xml) === stripPitch(reopened.xml) };
  }, fixture);
  expect(result.pitches).toHaveLength(2);
  expect(result.pitches.every((p) => p.step === 'F' && p.alter === 1)).toBe(true);
  expect(result.preserved).toBe(true);
  expect(result.startSign).toBe('sharp');
});

test('unsafe XML, ambiguous ties and JSON expansion fail before saving', async ({ page }) => {
  await page.goto('/');
  const errors = await page.evaluate(async (xml) => {
    const m = await import('/src/documents/musicxml.ts');
    const attempt = (fn: () => unknown) => { try { fn(); return ''; } catch (error) { return (error as Error).message; } };
    return [
      attempt(() => m.openMusicXml('<!DOCTYPE score-partwise [<!ENTITY x "bad">]>' + xml)),
      attempt(() => m.editImportedNote(m.openMusicXml(xml.replace('<tie type="stop"/>', '').replace('<tied type="stop"/>', '')), 'span-2a', { step: 'F' })),
      attempt(() => m.openMusicXml(xml.replace('<part-list>', '<!--' + '\\'.repeat(6 * 1024 * 1024) + '--><part-list>'))),
      attempt(() => m.openMusicXml(xml.replace('id="span-2b"', 'id="span-2a"'))),
    ];
  }, fixture);
  expect(errors[0]).toContain('entity');
  expect(errors[1]).toContain('advanced MusicXML editor');
  expect(errors[2]).toContain('10 MB');
  expect(errors[3]).toContain('duplicate');
});

test('automatic pitch spelling follows staff keys and local signs without redundant accidentals', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const m = await import('/src/documents/musicxml.ts');
    const note = (id: string, step: string, staff = '1', extra = '') => `<note id="${id}"><pitch><step>${step}</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type>${extra}<staff>${staff}</staff></note>`;
    const xml = `<score-partwise><part-list/><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key number="1"><fifths>1</fifths></key><key number="2"><fifths>0</fifths></key></attributes>${note('a', 'C')}${note('b', 'C')}${note('c', 'C', '2')}</measure><measure number="2">${note('d', 'C')}</measure></part></score-partwise>`;
    let doc = m.openMusicXml(xml);
    doc = m.editImportedNote(doc, 'a', { step: 'F', accidental: 'auto' });
    const initial = m.inspectMusicXml(doc).notes[0];
    doc = m.editImportedNote(doc, 'a', { alter: 0, accidental: 'explicit' });
    for (const id of ['b', 'c', 'd']) doc = m.editImportedNote(doc, id, { step: 'F', accidental: 'auto' });
    return { initial, notes: m.inspectMusicXml(doc).notes };
  });
  expect(result.initial.alter).toBe(1);
  expect(result.initial.accidental).toBe('auto');
  expect(result.notes.map((n) => n.alter)).toEqual([0, 0, 0, 1]);
  expect(result.notes.map((n) => n.accidental)).toEqual(['explicit', 'auto', 'auto', 'auto']);
});

test('metadata changes preserve other titles, creators, extensions and inert external declarations', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const m = await import('/src/documents/musicxml.ts');
    const source = '<!DOCTYPE score-partwise SYSTEM "https://example.invalid/never-fetch.dtd"><score-partwise><work><work-title>Work title</work-title></work><movement-title>Movement</movement-title><identification><creator type="composer">Old</creator><creator type="lyricist">Other</creator></identification><part-list/><part id="P1"><measure number="1"><extension xmlns="urn:example" custom="yes">retained</extension></measure></part></score-partwise>';
    const doc = m.editImportedMetadata(m.openMusicXml(source), { title: 'New', composer: 'Composer' });
    return { info: m.inspectMusicXml(doc), xml: doc.xml };
  });
  expect(result.info.title).toBe('New');
  expect(result.info.composer).toBe('Composer');
  expect(result.xml).toContain('<work-title>Work title</work-title>');
  expect(result.xml).toContain('type="lyricist">Other');
  expect(result.xml).toContain('custom="yes">retained');
  expect(result.xml).toContain('https://example.invalid/never-fetch.dtd');
});

test('deleting a chord pitch promotes its base safely and standalone deletion preserves timing', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const m = await import('/src/documents/musicxml.ts');
    const note = (id: string, step: string, chord = '') => `<note id="${id}">${chord}<pitch><step>${step}</step><octave>4</octave></pitch><duration>3</duration><voice>1</voice><type>quarter</type><dot/><staff>1</staff></note>`;
    const original = m.openMusicXml(`<score-partwise><part-list/><part id="P1"><measure number="1">${note('base', 'C')}${note('middle', 'E', '<chord/>')}${note('top', 'G', '<chord/>')}${note('solo', 'D')}</measure></part></score-partwise>`);
    const edited = m.deleteImportedNote(m.deleteImportedNote(original, 'base'), 'solo');
    const dom = new DOMParser().parseFromString(edited.xml, 'application/xml');
    const rest = dom.getElementById('solo');
    let failure = '';
    try { m.deleteImportedNote(m.openMusicXml(original.xml.replace('<staff>1</staff>', '<staff>1</staff><notations><slur type="start"/></notations>')), 'base'); } catch (error) { failure = (error as Error).message; }
    return { base: !!dom.getElementById('base'), middleChord: !!dom.getElementById('middle')?.querySelector('chord'), topChord: !!dom.getElementById('top')?.querySelector('chord'), rest: !!rest?.querySelector('rest'), duration: rest?.querySelector('duration')?.textContent, dots: rest?.querySelectorAll('dot').length, failure };
  });
  expect(result).toMatchObject({ base: false, middleChord: false, topChord: true, rest: true, duration: '3', dots: 1 });
  expect(result.failure).toContain('advanced MusicXML editor');
});
