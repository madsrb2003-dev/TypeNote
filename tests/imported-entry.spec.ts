import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const fixture = new URL('./fixtures/imported-entry.musicxml', import.meta.url).pathname;
async function open(page: Page) {
  await page.goto('/');
  await page.getByLabel('Open MusicXML file').setInputFiles(fixture);
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 30000 });
}
async function download(page: Page, button: string) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: button, exact: true }).click();
  return readFile((await (await waiting).path())!);
}
async function notes(page: Page) {
  const xml = (await download(page, 'Save MusicXML')).toString('utf8');
  return page.evaluate(source => {
    const dom = new DOMParser().parseFromString(source, 'application/xml');
    return [...dom.querySelectorAll('note')].map(n => ({ id: n.id, rest: !!n.querySelector('rest'), step: n.querySelector('pitch step')?.textContent, alter: Number(n.querySelector('pitch alter')?.textContent ?? '0'), octave: n.querySelector('pitch octave')?.textContent, duration: n.querySelector('duration')?.textContent, chord: !!n.querySelector('chord'), voice: n.querySelector('voice')?.textContent, staff: n.querySelector('staff')?.textContent }));
  }, xml);
}

test('keyboard entry adds bass notes and rests with H/B spelling, timing and selection undo', async ({ page }) => {
  await open(page);
  await page.getByLabel('Selected imported note').selectOption('lower-rest');
  await page.getByLabel('Note entry mode').selectOption('insert');
  await page.getByLabel('Entry octave').selectOption('3');
  await page.locator('.imported-editor').focus();
  await page.keyboard.press('F');
  const first = await page.getByLabel('Selected imported note').inputValue();
  await page.keyboard.press('H');
  await page.keyboard.press('B');
  const third = await page.getByLabel('Selected imported note').inputValue();
  await page.keyboard.press('R');
  const fourth = await page.getByLabel('Selected imported note').inputValue();
  const bass = (await notes(page)).filter(n => n.staff === '2' && n.id !== 'held-lower');
  expect(bass).toEqual([
    expect.objectContaining({ id: first, step: 'F', alter: 1, octave: '3', duration: '4', voice: '5' }),
    expect.objectContaining({ step: 'B', alter: 0, duration: '4' }),
    expect.objectContaining({ id: third, step: 'B', alter: -1, duration: '4' }),
    expect.objectContaining({ id: fourth, rest: true, duration: '4' }),
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Selected imported note')).toHaveValue(third);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.getByLabel('Selected imported note')).toHaveValue(fourth);
  await page.locator('.imported-editor').focus();
  await page.keyboard.press('C');
  await expect(page.locator('.status-bar')).toContainText(/no room|adjacent rest/);
  expect((await notes(page)).filter(n => n.staff === '2' && n.id !== 'held-lower')).toEqual(bass);
  const saved = await download(page, 'Save score');
  await page.getByLabel('Open imported score file').setInputFiles({ name: 'edited.typenote.json', mimeType: 'application/json', buffer: saved });
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 30000 });
  expect((await notes(page)).filter(n => n.staff === '2' && n.id !== 'held-lower')).toEqual(bass);
});

test('build chord, resize it, delete a tone and undo while preserving the other staff', async ({ page }) => {
  await open(page);
  await page.getByLabel('Selected imported note').selectOption('upper-rest');
  await page.getByLabel('Note entry mode').selectOption('insert');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  const base = await page.getByLabel('Selected imported note').inputValue();
  await page.getByLabel('Note entry mode').selectOption('chord');
  await page.getByLabel('Entry pitch').selectOption('E');
  await page.getByRole('button', { name: 'Add chord tone', exact: true }).click();
  const upper = await page.getByLabel('Selected imported note').inputValue();
  await page.getByLabel('Rhythm duration').selectOption('half');
  await page.getByRole('button', { name: 'Set selected duration', exact: true }).click();
  let current = await notes(page);
  expect(current.filter(n => [base, upper].includes(n.id))).toEqual([
    expect.objectContaining({ id: base, duration: '8', chord: false }), expect.objectContaining({ id: upper, duration: '8', chord: true }),
  ]);
  expect(current.find(n => n.id === 'lower-rest')).toMatchObject({ duration: '16', rest: true });
  await page.getByRole('button', { name: 'Delete note', exact: true }).click();
  await expect(page.getByLabel('Selected imported note')).toHaveValue(base);
  expect((await notes(page)).some(n => n.id === upper)).toBe(false);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Selected imported note')).toHaveValue(upper);
  await page.getByLabel('Rhythm duration').selectOption('quarter');
  await page.getByRole('button', { name: 'Set selected duration', exact: true }).click();
  current = await notes(page);
  expect(current.filter(n => [base, upper].includes(n.id)).every(n => n.duration === '4')).toBe(true);
  expect(current.filter(n => n.staff === '1' && n.id !== 'held-upper' && !n.chord).reduce((sum, n) => sum + Number(n.duration), 0)).toBe(16);
});

test('insert a piano bar, fill both staves, save and export the edited score', async ({ page }, testInfo) => {
  await open(page);
  await page.getByLabel('Selected imported note').selectOption('lower-rest');
  await page.getByRole('button', { name: 'Insert bar after', exact: true }).click();
  await expect(page.getByLabel('Note entry mode')).toHaveValue('insert');
  await expect(page.getByLabel('Insertion position')).toHaveValue('replace-rest');
  await page.getByLabel('Entry octave').selectOption('3');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  const bassId = await page.getByLabel('Selected imported note').inputValue();
  const xml = (await download(page, 'Save MusicXML')).toString('utf8');
  const result = await page.evaluate(source => {
    const dom = new DOMParser().parseFromString(source, 'application/xml'), added = dom.querySelector('measure[number="1-new-1"]')!;
    return { numbers: [...dom.querySelectorAll('measure')].map(m => m.getAttribute('number')), staffRest: [...added.querySelectorAll('note')].find(n => n.querySelector('staff')?.textContent === '1')?.id, expression: dom.querySelector('#keep-expression')?.textContent, fingering: dom.querySelector('#held-upper fingering')?.textContent, backup: added.querySelector('backup duration')?.textContent };
  }, xml);
  expect(result).toMatchObject({ numbers: ['1', '1-new-1', '2'], expression: 'Keep this expression', fingering: '3', backup: '16' });
  await page.getByLabel('Selected imported note').selectOption(result.staffRest!);
  await page.getByLabel('Entry octave').selectOption('4');
  await page.getByLabel('Entry pitch').selectOption('G');
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 30000 });
  await expect(page.locator(`[data-note-id="${bassId}"] .notehead`)).toHaveCount(1);
  const pdfBytes = await download(page, 'Download PDF');
  const pdf = await PDFDocument.load(pdfBytes);
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  await import('node:fs/promises').then(fs => fs.writeFile(testInfo.outputPath('imported-entry.pdf'), pdfBytes));
  await page.screenshot({ path: testInfo.outputPath('imported-entry.png'), fullPage: true });
  const before = (await notes(page)).length;
  await page.getByLabel('Composer', { exact: true }).fill('ABCDE');
  expect((await notes(page)).length).toBe(before);
});
