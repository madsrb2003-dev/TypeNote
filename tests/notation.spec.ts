import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import type { Score, ScoreEvent, ScoreMark, StaffId } from '../src/domain/types';

async function saved(page: Page) {
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  return JSON.parse(await readFile((await (await waiting).path())!, 'utf8')) as Score;
}

test('named and manual signatures, automatic entry, explicit naturals and persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Key signature', { exact: true }).selectOption('G');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('ff');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter F♯4/ })).toBeVisible();
  const svg = page.locator('.score-engraving svg').first();
  // Two staff signatures, no redundant local sharp on either F.
  await expect.poll(async () => (await svg.textContent())?.match(/\uE262/g)?.length).toBe(2);
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter F4/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 2, quarter F4/ })).toBeVisible();
  await expect.poll(async () => (await svg.textContent())?.match(/\uE261/g)?.length).toBe(1);
  let score = await saved(page);
  expect(score.measures[0].treble[0]).toMatchObject({ pitches: [{ alter: 0, accidental: 'explicit' }] });
  expect(score.measures[0].treble[1]).toMatchObject({ pitches: [{ alter: 0, accidental: 'auto' }] });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter F♯4/ })).toBeVisible();
  await page.getByLabel('Signature C', { exact: true }).selectOption('1');
  await expect(page.getByLabel('Key signature', { exact: true })).toHaveValue('custom');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 3', exact: true }).click();
  await page.keyboard.type('c');
  score = await saved(page);
  expect(score.measures[0].treble[2]).toMatchObject({ pitches: [{ step: 'C', alter: 1, accidental: 'auto' }] });
  await page.getByRole('button', { name: 'New score', exact: true }).click();
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'notation.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  expect(await saved(page)).toEqual(score);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('voice entry, dotted rhythms, tuplets, markings and undo are editable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('4cde');
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByRole('button', { name: 'Note & rhythm', exact: true }).click();
  await page.getByRole('button', { name: 'Group next 3 events', exact: true }).click();
  let score = await saved(page);
  expect(score.measures[0].treble.map(e => e.tuplet?.actual)).toEqual([3, 3, 3]);
  await page.getByLabel('Voice', { exact: true }).selectOption('2');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('3g');
  score = await saved(page);
  expect(score.measures[0].extraVoices?.treble?.[0][0]).toMatchObject({ duration: 4, pitches: [{ step: 'G' }] });
  await page.getByLabel('Voice', { exact: true }).selectOption('1');
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByRole('button', { name: 'Marks & spans', exact: true }).click();
  await page.getByLabel('Marking value', { exact: true }).selectOption('pp');
  await page.getByRole('button', { name: 'Add marking', exact: true }).click();
  await page.getByLabel('Marking type', { exact: true }).selectOption('hairpin');
  await page.getByRole('button', { name: 'Set start', exact: true }).click();
  await page.getByRole('button', { name: /Select treble measure 1 event 3,/ }).click();
  await page.getByRole('button', { name: 'Set end', exact: true }).click();
  await page.getByRole('button', { name: 'Add marking', exact: true }).click();
  score = await saved(page);
  expect(score.marks?.map(m => m.kind)).toEqual(['dynamic', 'hairpin']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  expect((await saved(page)).marks?.map(m => m.kind)).toEqual(['dynamic']);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

function coverageScore(): Score {
  let id = 0;
  const note = (step = 'C', octave = 4, extra = {}): ScoreEvent => ({ id: `n${id++}`, kind: 'note', duration: 4, pitches: [{ step: step as 'C', octave, alter: 0, accidental: 'auto' }], ...extra });
  const measures = Array.from({ length: 8 }, (_, m) => ({ id: `m${m}`, treble: [note('C'), note('D'), note('E'), note('G')], bass: [note('C', 3, { duration: 16 })] }));
  const score: Score = { version: 3, title: 'Piano notation study', composer: 'TypeNote test fixture', measures, marks: [] };
  const m = score.measures;
  m[0].keySignature = { name: 'G', fifths: 1, alterations: { F: 1 } };
  m[0].treble = [note('F', 4, { duration: 2, tuplet: { actual: 3, normal: 2, group: 'triplet' } }), note('G', 4, { duration: 2, tuplet: { actual: 3, normal: 2, group: 'triplet' } }), note('A', 4, { duration: 2, tuplet: { actual: 3, normal: 2, group: 'triplet' } }), note('G', 4, { duration: 4, dots: 1, articulations: ['staccato'] }), note('F', 4, { duration: 4 })];
  m[0].extraVoices = { treble: [[note('C', 4, { duration: 8, stem: 'down' }), { id: 'voice-rest', kind: 'rest', duration: 8, restLine: 3 }]] };
  m[1].treble[0] = note('C', 4, { pitches: [{ step: 'C', alter: 0, octave: 4, fingering: '1' }, { step: 'E', alter: 0, octave: 4, fingering: '3' }, { step: 'G', alter: 0, octave: 4, fingering: '5' }], arpeggio: 'up', grace: [{ pitches: [{ step: 'D', octave: 4, alter: 0 }], duration: 2, slash: true }] });
  m[1].treble[1].ornament = 'trill'; m[1].treble[2].tremolo = 2; m[1].treble[3].articulations = ['fermata'];
  m[2].keySignature = { name: 'F', fifths: -1, alterations: { B: -1 } };
  m[2].treble[0] = note('C', 4, { pitches: [{ step: 'C', alter: 1, octave: 4, accidental: 'courtesy' }], dots: 2, duration: 2 });
  m[2].treble[1].ornament = 'turn'; m[2].treble[2].ornament = 'mordent'; m[2].treble[3].articulations = ['accent', 'tenuto'];
  m[3].repeatStart = true; m[3].barline = 'repeatEnd';
  m[3].treble = [note('C', 4, { duration: 2, beam: 'start' }), note('G', 3, { duration: 2, displayStaff: 'bass', beam: 'continue' }), note('E', 4, { duration: 2, beam: 'end' }), note('C', 4, { pitches: [{ step: 'C', octave: 4, alter: 0 }, { step: 'G', octave: 2, alter: 0, staff: 'bass' }] })];
  m[4].pageBreak = true; m[4].timeSignature = { beats: 3, beatType: 4 }; m[4].clefs = { treble: 'bass' };
  for (let i = 4; i < 8; i++) { m[i].treble = [note('G', 3), note('A', 3), note('G', 3)]; m[i].bass = [note('C', 2, { duration: 8, dots: 1 })]; }
  m[5].clefs = { treble: 'treble' }; m[5].systemBreak = true;
  m[5].treble = [note('C', 4), note('D', 4), note('C', 4)];
  m[6].treble = [note('C', 4), note('F', 4), note('G', 4)]; m[6].treble[0].articulations = ['marcato']; m[6].treble[1].ornament = 'inverted-turn'; m[6].treble[2].ornament = 'inverted-mordent';
  m[7].bass[0] = { id: 'full-rest', kind: 'rest', duration: 16, measureRest: 12 };
  m[7].treble[0].ornament = 'delayed-turn'; m[7].treble[1].articulations = ['staccatissimo']; m[7].barline = 'final';
  function mark(kind: ScoreMark['kind'], value: string, bar: number, index: number, endBar?: number, endIndex = 0, staff: StaffId = 'treble', placement: 'above' | 'below' = 'below') {
    score.marks!.push({ id: `mark${id++}`, kind, value, placement, start: { measureId: m[bar].id, staff, eventId: m[bar][staff][index].id }, ...(endBar !== undefined ? { end: { measureId: m[endBar].id, staff, eventId: m[endBar][staff][endIndex].id } } : {}) });
  }
  mark('tempo', 'Allegro · quarter = 100', 0, 0, undefined, 0, 'treble', 'above');
  mark('dynamic', 'pp', 0, 0); mark('hairpin', 'crescendo', 0, 0, 0, 4); mark('slur', '', 0, 0, 0, 2, 'treble', 'above');
  mark('pedal', 'sustain', 0, 0, 1, 0, 'bass'); mark('dynamic', 'mf', 1, 0); mark('octave', '8va', 1, 0, 2, 3, 'treble', 'above');
  mark('hairpin', 'diminuendo', 2, 0, 3, 3); mark('glissando', 'wavy', 2, 1, 2, 3, 'treble', 'above');
  mark('ending', '1.', 3, 0, 3, 3, 'treble', 'above'); mark('rehearsal', 'A', 4, 0, undefined, 0, 'treble', 'above');
  mark('pedal', 'sostenuto', 4, 0, 5, 0, 'bass'); mark('tie', '', 5, 2, 6, 0); mark('text', 'dolce', 5, 0, undefined, 0, 'treble', 'above');
  mark('tremolo', '2', 6, 0, 6, 1); mark('pedal', 'soft', 6, 0, 7, 0, 'bass'); mark('navigation', 'fine', 7, 2, undefined, 0, 'treble', 'above');
  return score;
}

test('representative piano notation draws and exports across systems and pages', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  const score = coverageScore();
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'coverage.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)) });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue(score.title);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Select treble measure 8 event 3,/ })).toBeVisible();
  await page.locator('.score-paper').screenshot({ path: testInfo.outputPath('notation-study.png') });
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download PDF', exact: true }).click();
  const path = testInfo.outputPath('notation-study.pdf');
  await (await waiting).saveAs(path);
  const pdf = await PDFDocument.load(await readFile(path));
  expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2);
  for (const p of pdf.getPages()) expect(p.getSize()).toEqual({ width: 595.28, height: 841.89 });
  expect(errors).toEqual([]);
  const xmlDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save MusicXML', exact: true }).click();
  await (await xmlDownload).saveAs(testInfo.outputPath('notation-study.musicxml'));
  const reopened = await saved(page);
  expect(reopened.marks).toHaveLength(score.marks!.length);
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.score-paper').screenshot({ path: testInfo.outputPath('notation-study-tablet.png') });
});

test('rhythm and pitch metadata survive note/rest conversion and keyboard replacement', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('4cde');
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByRole('button', { name: 'Note & rhythm', exact: true }).click();
  await page.getByRole('button', { name: 'Group next 3 events', exact: true }).click();
  await page.getByLabel('Fingering', { exact: true }).fill('1-2');
  await page.getByLabel('Pitch staff', { exact: true }).selectOption('bass');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('g');
  let score = await saved(page);
  expect(score.measures[0].treble[0]).toMatchObject({ pitches: [{ step: 'G', staff: 'bass', fingering: '1-2' }], tuplet: { actual: 3 } });
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.keyboard.type('r');
  score = await saved(page);
  expect(score.measures[0].treble[0]).toMatchObject({ kind: 'rest', duration: 2, tuplet: { actual: 3 } });
  await page.getByRole('button', { name: /Select treble measure 1 event 1,/ }).click();
  await page.getByLabel('Rest staff line', { exact: true }).fill('3');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('f');
  score = await saved(page);
  expect(score.measures[0].treble[0]).toMatchObject({ kind: 'note', duration: 2, tuplet: { actual: 3 } });
  expect(score.measures[0].treble[0].restLine).toBeUndefined();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
