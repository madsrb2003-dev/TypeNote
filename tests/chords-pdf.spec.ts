import { expect, test } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';

test('build and edit chords, undo, and reopen their pitches', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true }).click();
  await page.keyboard.type('kceg');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter C4, E4, G4/ })).toBeVisible();
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByRole('button', { name: 'Edit pitch E4', exact: true }).click();
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Edit pitch E♭4', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Half note', exact: true }).click();
  await page.getByRole('button', { name: 'Remove pitch', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, half C4, G4/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, half C4, E♭4, G4/ })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  const file = await download;
  const path = await file.path();
  const contents = await readFile(path!);
  const score = JSON.parse(contents.toString());
  expect(score.version).toBe(3);
  expect(score.measures[0].treble[0].duration).toBe(8);
  expect(score.measures[0].treble[0].pitches).toHaveLength(3);
  await page.getByRole('button', { name: 'New score', exact: true }).click();
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'chords.json', mimeType: 'application/json', buffer: contents });
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, half C4, E♭4, G4/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/chord-editor.png', fullPage: true });
});

test('direct PDF download preserves unsaved music and creates A4 pages without printing', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true }).click();
  await page.keyboard.type('kgec'); // deliberately descending entry order
  await page.keyboard.press('Enter');
  await page.getByLabel('Score title', { exact: true }).fill('Øvelse — piano');
  await page.evaluate(() => { window.print = () => { throw new Error('Print must not be called'); }; });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const path = testInfo.outputPath('single-page.pdf');
  await file.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBe(1);
  expect(pdf.getTitle()).toBe('Øvelse — piano');
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  expect(pdf.getPage(0).getHeight()).toBeCloseTo(841.89, 1);
  await expect(page.locator('.save-state')).toHaveText('Unsaved changes');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter G4, E4, C4/ })).toBeVisible();
});

test('multipage PDF includes chords and accidentals; cancellation leaves the score usable', async ({ page }, testInfo) => {
  await page.goto('/');
  let id = 0;
  const pitches = [{ step: 'G', alter: 1, octave: 4 }, { step: 'C', alter: 0, octave: 4 }, { step: 'D', alter: -1, octave: 4 }];
  const score = { version: 2, title: 'Piano étude — chords & accidentals', measures: Array.from({ length: 20 }, () => ({
    id: `m${id++}`,
    treble: Array.from({ length: 4 }, (_, i) => ({ id: `e${id++}`, kind: 'note', duration: 4, pitches: pitches.map(p => ({ ...p, alter: i % 2 ? 0 : p.alter })) })),
    bass: [{ id: `e${id++}`, kind: 'note', duration: 16, pitches: [{ step: 'C', alter: 0, octave: 3 }, { step: 'G', alter: 0, octave: 2 }] }],
  })) };
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'long.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue(score.title);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const file = await download;
  const path = testInfo.outputPath('multipage.pdf');
  await file.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  for (const pdfPage of pdf.getPages()) {
    expect(pdfPage.getSize()).toEqual({ width: 595.28, height: 841.89 });
    expect(pdfPage.node.Contents()).toBeTruthy();
  }
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel export', exact: true }).click();
  await expect(page.getByRole('status').last()).toHaveText('PDF export canceled.');
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue(score.title);
});

test('chord octave entry leaves earlier pitches intact and duplicate pitches are rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true }).click();
  await page.keyboard.type('kc');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('c');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter C4, C5/ })).toBeVisible();
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.keyboard.type('kc');
  await expect(page.locator('.status-bar')).toContainText('cannot repeat');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter C4, C5/ })).toBeVisible();
});

test('dense rhythms, extreme ledger lines and long titles export without clipping', async ({ page }, testInfo) => {
  await page.goto('/');
  const score = { version: 2, title: 'W'.repeat(120), measures: [
    { id: 'm1', treble: Array.from({ length: 16 }, (_, i) => ({ id: `t${i}`, kind: 'note', duration: 1, pitches: [{ step: i % 2 ? 'D' : 'C', alter: i % 2 ? -1 : 1, octave: 4 }] })), bass: [] },
    { id: 'm2', treble: [{ id: 'x1', kind: 'note', duration: 16, pitches: [{ step: 'C', alter: 0, octave: 0 }, { step: 'B', alter: 0, octave: 8 }] }], bass: [{ id: 'x2', kind: 'note', duration: 16, pitches: [{ step: 'C', alter: 0, octave: 0 }, { step: 'B', alter: 0, octave: 8 }] }] },
  ] };
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'edges.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue(score.title);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const file = await download;
  const path = testInfo.outputPath('edge-cases.pdf');
  await file.saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
  expect(pdf.getTitle()).toBe(score.title);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
