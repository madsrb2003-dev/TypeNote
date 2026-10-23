import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRl8AAAAASUVORK5CYII=';
function score(images = false) {
  const credits = images ? `<credit page="1"><credit-type>typenote-source-header</credit-type><credit-image source="${pixel}" type="image/png" default-x="0" default-y="850" width="700" height="150" halign="left" valign="bottom"/></credit><credit page="1"><credit-type>typenote-source-footer</credit-type><credit-image source="${pixel}" type="image/png" default-x="0" default-y="0" width="700" height="55"/></credit>`
    : '<credit page="1"><credit-type>title</credit-type><credit-words default-x="350" default-y="950" justify="center" font-size="18">Positioned title</credit-words></credit><credit page="1"><credit-words default-x="350" default-y="35" justify="center" font-size="8">Footer stays at the bottom</credit-words></credit>';
  return `<score-partwise version="4.0"><work><work-title>Positioned title</work-title></work><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><page-layout><page-height>1000</page-height><page-width>700</page-width></page-layout></defaults>${credits}<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${Array.from({ length: 20 }, (_, i) => `<measure number="${i + 1}">${i === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>' : i % 5 === 0 ? '<print new-system="yes"/>' : ''}<note id="u${i}"><rest measure="yes"/><duration>4</duration><voice>1</voice><staff>1</staff></note><backup><duration>4</duration></backup>${Array.from({ length: 4 }, (_, j) => `<note id="n${i}-${j}"><pitch><step>C</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>`).join('')}</measure>`).join('')}</part></score-partwise>`;
}

test('encoded five-bar systems and positioned credits fill the page without changing source', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async source => {
    const d = await import('/src/documents/musicxml.ts');
    const n = await import('/src/notation/imported.ts');
    const doc = d.openMusicXml(source), before = doc.xml;
    const rendered = await n.renderImportedScore(doc);
    const host = document.createElement('div'); host.innerHTML = rendered.pages[0].svg; document.body.append(host);
    const root = host.querySelector('svg')!, bounds = root.getBoundingClientRect();
    const systems = [...root.querySelectorAll('g.system')];
    const bottom = systems.at(-1)!.getBoundingClientRect().bottom;
    const credits = [...root.querySelectorAll('.source-page-text text')].map(e => ({ text: e.textContent, top: (e.getBoundingClientRect().top - bounds.top) / bounds.height }));
    const result = { pages: rendered.pages.length, systems: systems.map(e => e.querySelectorAll('.measure').length), credits, bottom: (bottom - bounds.top) / bounds.height, unchanged: before === doc.xml };
    host.remove(); return result;
  }, score());
  expect(result.pages).toBe(1);
  expect(result.systems).toEqual([5, 5, 5, 5]);
  expect(result.unchanged).toBe(true);
  expect(result.bottom).toBeGreaterThan(.85);
  expect(result.bottom).toBeLessThan(.96);
  expect(result.credits.find(c => c.text?.includes('Footer'))!.top).toBeGreaterThan(.9);
  expect(result.credits.find(c => c.text === 'Positioned title')!.top).toBeLessThan(.12);
});

test('original page images survive saving and can switch to editable text with undo', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open MusicXML file').setInputFiles({ name: 'page-text.musicxml', mimeType: 'application/xml', buffer: Buffer.from(score(true)) });
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator('.source-page-text image')).toHaveCount(2);
  await expect(page.getByLabel('Score title', { exact: true })).toBeDisabled();
  await page.getByText('Advanced MusicXML editing', { exact: true }).click();
  expect(await page.getByLabel('MusicXML source').inputValue()).toContain(pixel);
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  const saved = await readFile((await (await waiting).path())!);
  expect(JSON.parse(saved.toString('utf8')).xml).toContain(pixel);
  await page.getByLabel('Open imported score file').setInputFiles({ name: 'reopened.typenote.json', mimeType: 'application/json', buffer: saved });
  await expect(page.locator('.source-page-text image')).toHaveCount(2);
  await page.getByRole('button', { name: 'Use editable page text' }).click();
  await expect(page.getByLabel('Score title', { exact: true })).toBeEnabled();
  await expect(page.locator('.source-page-text image')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Score title', { exact: true })).toBeDisabled();
  await expect(page.locator('.source-page-text image')).toHaveCount(2);
});

test('unsafe page images are not overlaid or fetched', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async source => {
    const { prepareImportedLayout } = await import('/src/notation/importedLayout.ts');
    const external = prepareImportedLayout(source.replaceAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'https://example.invalid/private.png'));
    const forged = prepareImportedLayout(source.replaceAll(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'data:image/png;base64,PHN2Zy8+'));
    return { external: external.credits.filter(c => c.image).length, forged: forged.credits.filter(c => c.image).length };
  }, score(true));
  expect(result).toEqual({ external: 0, forged: 0 });
});

test('a two-system excerpt keeps readable spacing near its header', async ({ page }) => {
  await page.goto('/');
  const bottom = await page.evaluate(async source => {
    const parsed = new DOMParser().parseFromString(source, 'application/xml');
    [...parsed.querySelectorAll('part > measure')].slice(10).forEach(m => m.remove());
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { renderImportedScore } = await import('/src/notation/imported.ts');
    const rendered = await renderImportedScore(openMusicXml(new XMLSerializer().serializeToString(parsed)));
    const host = document.createElement('div'); host.innerHTML = rendered.pages[0].svg; document.body.append(host);
    const root = host.querySelector('svg')!, bounds = root.getBoundingClientRect();
    const systems = [...root.querySelectorAll('g.system')];
    const bottom = (systems.at(-1)!.getBoundingClientRect().bottom - bounds.top) / bounds.height;
    host.remove(); return bottom;
  }, score());
  expect(bottom).toBeLessThan(.75);
  expect(bottom).toBeGreaterThan(.3);
});

test('a sparse final page retains natural gaps after fuller pages', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async source => {
    const parsed = new DOMParser().parseFromString(source, 'application/xml');
    const part = parsed.querySelector('part')!;
    [...part.children].slice(5).forEach((measure, i) => {
      const copy = measure.cloneNode(true) as Element;
      copy.setAttribute('number', String(i + 21));
      copy.querySelectorAll('[id]').forEach(e => e.id = `last-${e.id}`);
      if (i === 0) copy.querySelector('print')!.setAttribute('new-page', 'yes');
      part.append(copy);
    });
    const { openMusicXml } = await import('/src/documents/musicxml.ts');
    const { renderImportedScore } = await import('/src/notation/imported.ts');
    const rendered = await renderImportedScore(openMusicXml(new XMLSerializer().serializeToString(parsed)));
    const host = document.createElement('div'); host.innerHTML = rendered.pages[1].svg; document.body.append(host);
    const root = host.querySelector('svg')!, bounds = root.getBoundingClientRect();
    const systems = [...root.querySelectorAll('g.system')];
    const bottom = (systems.at(-1)!.getBoundingClientRect().bottom - bounds.top) / bounds.height;
    host.remove(); return { pages: rendered.pages.length, systems: systems.length, bottom };
  }, score());
  expect(result.pages).toBe(2);
  expect(result.systems).toBe(3);
  expect(result.bottom).toBeLessThan(.85);
});
