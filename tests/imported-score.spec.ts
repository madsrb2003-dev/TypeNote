import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const fixture = (name: string) => new URL(`./fixtures/${name}.musicxml`, import.meta.url).pathname;

test('extended piano notation reaches the renderer without a reduced-model conversion', async ({ page }) => {
  await page.goto('/');
  const xml = await readFile(fixture('full-piano'), 'utf8');
  const result = await page.evaluate(async (source) => {
    const { openMusicXml, inspectMusicXml } = await import('/src/documents/musicxml.ts');
    const { renderImportedScore } = await import('/src/notation/imported.ts');
    const document = openMusicXml(source, 'full-piano.musicxml');
    const info = inspectMusicXml(document);
    const rendered = await renderImportedScore(document);
    const pages = rendered.pages.map(page => new DOMParser().parseFromString(page.svg, 'image/svg+xml'));
    const count = (selector: string) => pages.reduce((sum, svg) => sum + svg.querySelectorAll(selector).length, 0);
    return {
      noteCount: info.notes.length,
      notes: info.notes.filter(note => ['study-cue', 'study-hidden', 'study-third-staff'].includes(note.id)),
      pageSizes: rendered.pages.map(({ width, height }) => ({ width, height })),
      counts: {
        firstNote: count('[id="study-fsharp"]'),
        thirdStaffNote: count('[id="study-third-staff"]'),
        cueNote: count('[id="study-cue"]'),
        finalChordNote: count('[id="study-final-e"]'),
        clefs: count('.clef'),
        pedal: count('.pedal'),
        ornaments: count('.trill, .turn, .mordent'),
        directions: count('.dynam'),
      },
      diagnostics: rendered.diagnostics,
    };
  }, xml);
  expect(result.noteCount).toBe(21);
  expect(result.notes).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'study-cue', cue: true }),
    expect.objectContaining({ id: 'study-hidden', hidden: true }),
    expect.objectContaining({ id: 'study-third-staff', staff: '3' }),
  ]));
  expect(result.pageSizes.length).toBeGreaterThan(0);
  expect(result.pageSizes.every(page => page.width > 0 && page.height > page.width)).toBe(true);
  expect(result.counts.firstNote).toBe(1);
  expect(result.counts.thirdStaffNote).toBe(1);
  expect(result.counts.cueNote).toBe(1);
  expect(result.counts.finalChordNote).toBe(1);
  expect(result.counts.clefs).toBeGreaterThanOrEqual(5);
  expect(result.counts.pedal).toBeGreaterThan(0);
  expect(result.counts.ornaments).toBeGreaterThanOrEqual(3);
  expect(result.counts.directions).toBeGreaterThan(0);
  // Actual diagnostics remain visible in failures; rendering success alone is not fidelity.
  expect(result.diagnostics.filter(line => /error|failed/i.test(line))).toEqual([]);
});

test('nested and bar-spanning rhythms survive a pitch edit and local serialization', async ({ page }) => {
  await page.goto('/');
  const xml = await readFile(fixture('nested-rhythm'), 'utf8');
  const result = await page.evaluate(async (source) => {
    const { openMusicXml, editImportedNote, serializeMusicXmlDocument, parseMusicXmlDocument } = await import('/src/documents/musicxml.ts');
    const { renderImportedScore } = await import('/src/notation/imported.ts');
    const original = openMusicXml(source, 'nested-rhythm.musicxml');
    const edited = editImportedNote(original, 'nested-2', { step: 'F', alter: 1, accidental: 'explicit' });
    const reopened = parseMusicXmlDocument(serializeMusicXmlDocument(edited));
    const before = new DOMParser().parseFromString(original.xml, 'application/xml');
    const after = new DOMParser().parseFromString(reopened.xml, 'application/xml');
    const untouched = (document: XMLDocument) => {
      document.querySelector('[id="nested-2"]')?.remove();
      return new XMLSerializer().serializeToString(document);
    };
    const preserved = untouched(before) === untouched(after);
    const rendered = await renderImportedScore(reopened);
    const svg = new DOMParser().parseFromString(`<root>${rendered.pages.map(page => page.svg).join('')}</root>`, 'application/xml');
    return {
      preserved,
      xml: reopened.xml,
      noteIds: [...svg.querySelectorAll('g.note[id]')].map(note => note.id),
      tuplets: svg.querySelectorAll('.tuplet').length,
      ties: svg.querySelectorAll('.tie').length,
    };
  }, xml);
  expect(result.preserved).toBe(true);
  expect(result.xml).toContain('<actual-notes>9</actual-notes>');
  expect(result.xml).toContain('number="2"');
  expect(result.noteIds).toEqual(expect.arrayContaining(['nested-1', 'nested-2', 'nested-3', 'nested-4', 'nested-5', 'span-1', 'span-2a', 'span-2b', 'span-3']));
  expect(result.tuplets).toBeGreaterThanOrEqual(2);
  expect(result.ties).toBeGreaterThanOrEqual(1);
});

test('imported piano score can be corrected, undone, reopened and downloaded as A4 PDF', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('Open MusicXML file').setInputFiles(fixture('full-piano'));
  await page.getByRole('button', { name: 'Select imported note study-fsharp', exact: true }).locator('.notehead').click();
  await page.getByRole('button', { name: 'Natural', exact: true }).click();

  async function download(button: string) {
    const waiting = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    const result = await waiting;
    return readFile((await result.path())!);
  }
  const natural = (await download('Save MusicXML')).toString('utf8');
  expect(natural).toContain('<accidental>natural</accidental>');
  expect(natural).toContain('print-object="no"');
  expect(natural).toContain('type="change"');
  expect(natural).toContain('type="discontinue"');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const undone = (await download('Save MusicXML')).toString('utf8');
  expect(undone).not.toContain('<accidental>natural</accidental>');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();

  const editable = await download('Save score');
  const stored = JSON.parse(editable.toString('utf8'));
  expect(stored).toMatchObject({ version: 4, kind: 'musicxml' });
  expect(stored.xml).toContain('study-third-staff');
  await page.getByLabel('Open imported score file').setInputFiles({ name: 'extended.typenote.json', mimeType: 'application/json', buffer: editable });
  await page.getByLabel('Selected imported note').selectOption('study-hidden');
  await expect(page.getByLabel('Selected imported note')).toHaveValue('study-hidden');
  await expect(page.locator('svg [id="study-third-staff"]')).toHaveCount(1);

  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const pdfDownload = await waiting;
  await pdfDownload.saveAs(testInfo.outputPath('imported-piano.pdf'));
  const pdf = await PDFDocument.load(await readFile((await pdfDownload.path())!));
  expect(pdf.getPageCount()).toBeGreaterThan(0);
  for (const sheet of pdf.getPages()) {
    expect(sheet.getWidth()).toBeCloseTo(595.28, 1);
    expect(sheet.getHeight()).toBeCloseTo(841.89, 1);
  }
  await page.screenshot({ path: testInfo.outputPath('imported-piano.png'), fullPage: true });
});

test('rendered pages reject executable and external resources but preserve embedded notation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { prepareImportedPage } = await import('/src/notation/imported.ts');
    const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 840 1188" onload="alert(1)"><script>alert(1)</script><foreignObject/><style>@import 'https://invalid.example/style.css';</style><image href="https://invalid.example/image.png"/><use href="#glyph"/><path id="glyph" d="M0 0L1 1"/><g class="note" id="selected"><path style="fill:url(https://invalid.example/paint)"/></g></svg>`;
    const prepared = prepareImportedPage({ svg: source, width: 840, height: 1188 });
    const svg = new DOMParser().parseFromString(prepared.page.svg, 'image/svg+xml');
    let badDimensionsRejected = false;
    try { prepareImportedPage({ svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -1 1"/>', width: 1, height: 1 }); } catch { badDimensionsRejected = true; }
    return { unsafe: svg.querySelectorAll('script, foreignObject, [onload], [style]').length, external: prepared.page.svg.includes('https://invalid.example'), glyph: svg.querySelector('use')?.getAttribute('href'), selected: svg.querySelector('#selected')?.getAttribute('data-note-id'), diagnostics: prepared.diagnostics, badDimensionsRejected };
  });
  expect(result).toMatchObject({ unsafe: 0, external: false, glyph: '#glyph', selected: 'selected', badDimensionsRejected: true });
  expect(result.diagnostics).toHaveLength(1);
});

test('local rendering cancels obsolete work and loads no remote resources', async ({ page }) => {
  const externalRequests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:5173/')) externalRequests.push(request.url()); });
  await page.goto('/');
  const xml = await readFile(fixture('nested-rhythm'), 'utf8');
  const result = await page.evaluate(async (source) => {
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { renderImportedScore } = await import('/src/notation/imported.ts');
    const document = openMusicXml(source);
    const controller = new AbortController();
    const obsolete = renderImportedScore(document, { signal: controller.signal }).catch(error => error.name);
    controller.abort();
    const canceled = await obsolete;
    const fresh = await renderImportedScore(document);
    return { canceled, pages: fresh.pages.length };
  }, xml);
  expect(result.canceled).toBe('AbortError');
  expect(result.pages).toBeGreaterThan(0);
  expect(externalRequests).toEqual([]);
});
