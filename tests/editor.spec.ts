import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true })).toBeVisible();
}
async function savedDocument(page: Page) {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  if (!stream) throw new Error('No score download stream');
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8');
  return { text, score: JSON.parse(text), filename: download.suggestedFilename() };
}

test('keyboard entry, pitch convention, rest, overflow, deletion, undo and redo', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await start(page);
  await page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true }).click();
  await page.keyboard.type('hbrc');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, quarter H4/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 2, quarter B4/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 3, quarter rest/ })).toBeVisible();
  await expect(page.locator('.entry-strip')).toContainText('Measure 2');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 2', exact: true }).click();
  await page.keyboard.press('d');
  await expect(page.getByRole('status')).toContainText('measure is full');
  await page.getByRole('button', { name: /Select treble measure 1 event 2, quarter B4/ }).click();
  await page.keyboard.press('Delete');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 2, quarter rest/ })).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 2, quarter B4/ })).toBeVisible();
  await page.keyboard.press('Control+Shift+z');
  const { score } = await savedDocument(page);
  expect(score.measures[0].treble.map((event: { kind: string }) => event.kind)).toEqual(['note', 'rest', 'note']);
  expect(score.measures[0].treble[0].pitches[0]).toEqual({ step: 'B', alter: 0, octave: 4 });
  expect(errors).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('octaves, durations, selected-note controls and undo stay synchronized', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('4c');
  await page.getByRole('button', { name: /Select treble measure 1 event 1, eighth C5/ }).click();
  await page.getByRole('button', { name: 'Sharp', exact: true }).click();
  await page.getByRole('button', { name: 'Half note', exact: true }).click();
  await expect(page.getByRole('button', { name: /Select treble measure 1 event 1, half C♯5/ })).toBeVisible();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Eighth note', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Natural', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel(/^staff$/i).selectOption('bass');
  await page.getByLabel(/^octave$/i).selectOption('2');
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('2g');
  const { score } = await savedDocument(page);
  expect(score.measures[0].bass[0]).toMatchObject({ kind: 'note', duration: 8, pitches: [{ step: 'G', octave: 2, alter: 0 }] });
  expect(score.measures[0].treble[0]).toMatchObject({ duration: 2, pitches: [{ step: 'C', octave: 5, alter: 0 }] });
});

test('save and reopen preserves edits, bad files preserve current score, title typing is isolated', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('cde');
  await page.getByLabel('Score title', { exact: true }).fill('C D E F G A H 12345');
  const original = await savedDocument(page);
  expect(original.score.measures[0].treble).toHaveLength(3);
  await page.getByRole('button', { name: 'New score', exact: true }).click();
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: original.filename, mimeType: 'application/json', buffer: Buffer.from(original.text) });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('C D E F G A H 12345');
  expect((await savedDocument(page)).score).toEqual(original.score);
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{bad') });
  await expect(page.getByRole('status')).toContainText('not valid JSON');
  expect((await savedDocument(page)).score).toEqual(original.score);
});

test('demo renders on desktop and tablet with no notation errors', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Try a short example →' }).click();
  await expect(page.getByRole('button', { name: /Select bass measure 4 event 1, whole C3/ })).toBeVisible();
  await expect(page.locator('.score-engraving svg')).toHaveCount(2);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/desktop-editor.png', fullPage: true });
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.locator('.score-engraving svg')).toHaveCount(4);
  await page.screenshot({ path: 'test-results/tablet-editor.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('opening a delayed file protects edits made during the read', async ({ page }) => {
  await start(page);
  const blank = await savedDocument(page);
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise(resolve => setTimeout(resolve, 700));
      return original.call(this);
    };
  });
  await page.getByLabel('Open TypeNote file').setInputFiles({ name: 'slow.json', mimeType: 'application/json', buffer: Buffer.from(blank.text) });
  const dialog = page.waitForEvent('dialog');
  await page.getByLabel('Score title', { exact: true }).fill('Keep these new edits');
  await (await dialog).dismiss();
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Keep these new edits');
});

test('accidental cancellation, aligned rhythms and dense measures render correctly', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Enter music →' }).click();
  await page.keyboard.type('bh');
  await page.getByRole('button', { name: 'Sharp', exact: true }).click();
  await page.keyboard.type('c');
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await page.keyboard.type('c');
  await page.getByLabel(/^staff$/i).selectOption('bass');
  await page.getByRole('button', { name: 'Insert bass measure 1 position 1', exact: true }).click();
  await page.keyboard.type('2c');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.type('g');
  await page.getByRole('button', { name: /Select treble measure 1 event 2, quarter H4/ }).click();
  // B-flat is canceled by a natural; C-sharp is canceled by a second natural.
  const notation = page.locator('.score-engraving svg').first();
  await expect.poll(async () => (await notation.textContent())?.match(/[\uE260-\uE262]/g)).toEqual(['\uE260', '\uE261', '\uE262', '\uE261']);
  await page.locator('.score-paper').screenshot({ path: 'test-results/accidentals.png' });
  const thirdBeat = await page.getByRole('button', { name: /Select treble measure 1 event 3/ }).boundingBox();
  const bassThirdBeat = await page.getByRole('button', { name: /Select bass measure 1 event 2/ }).boundingBox();
  expect(Math.abs(thirdBeat!.x - bassThirdBeat!.x)).toBeLessThan(2);

  await page.getByRole('button', { name: 'Insert treble measure 2 position 1', exact: true }).click();
  await page.keyboard.type('5cdefgahccdefgahc');
  await expect(page.getByRole('button', { name: /Select treble measure 2 event 16/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.locator('.score-paper').screenshot({ path: 'test-results/dense-score.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
