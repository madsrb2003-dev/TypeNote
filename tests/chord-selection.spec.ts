import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Pitch, Score } from '../src/domain/types';

const pitchTarget = (page: Page, pitch: string, voice = '') => page.getByRole('button', {
  name: `Select pitch ${pitch} in treble${voice} measure 1 event 1`, exact: true,
});

async function saveScore(page: Page): Promise<Score> {
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  const stream = await (await downloaded).createReadStream();
  if (!stream) throw new Error('No downloaded score');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Score;
}

function pitches(score: Score, voice = 0) {
  const event = voice ? score.measures[0].extraVoices?.treble?.[voice - 1][0] : score.measures[0].treble[0];
  if (event?.kind !== 'note') throw new Error('Expected a chord');
  return event.pitches.map(({ step, octave }) => `${step}${octave}`);
}

async function openChord(page: Page, chord: Pitch[], voice = 0) {
  await page.goto('/');
  const event = { id: 'chord', kind: 'note' as const, duration: 4 as const, pitches: chord };
  const score: Score = { version: 3, title: 'Individual chord pitches', measures: [{
    id: 'measure', treble: voice ? [] : [event], bass: [],
    ...(voice ? { extraVoices: { treble: [[event]] } } : {}),
  }] };
  await page.getByLabel('Open TypeNote file').setInputFiles({
    name: 'chord.typenote.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(score)),
  });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue(score.title);
}

test('clicking upper, middle and lower chord heads selects the original pitch order', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Insert treble measure 1 position 1', exact: true }).click();
  await page.keyboard.type('kgec'); // Source order differs from the renderer's ascending pitch order.
  await page.keyboard.press('Enter');
  for (const pitch of ['G4', 'E4', 'C4']) {
    await pitchTarget(page, pitch).click();
    await expect(pitchTarget(page, pitch)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.score-pitch[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: `Edit pitch ${pitch}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: 'Edit pitch G4', exact: true }).click();
  await expect(pitchTarget(page, 'G4')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.score-pitch[aria-pressed="true"]')).toHaveCount(1);
  await pitchTarget(page, 'E4').click();
  await page.locator('.score-paper').screenshot({ path: testInfo.outputPath('selected-middle-pitch.png') });
  await page.keyboard.press('f');
  expect(pitches(await saveScore(page))).toEqual(['G4', 'F4', 'C4']);
  await pitchTarget(page, 'G4').click();
  await page.keyboard.press('ArrowUp');
  await expect(pitchTarget(page, 'G5')).toHaveAttribute('aria-pressed', 'true');
  expect(pitches(await saveScore(page))).toEqual(['G5', 'F4', 'C4']);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('deleting a clicked chord pitch and undo/redo retain the selected pitch', async ({ page }) => {
  await openChord(page, [
    { step: 'G', octave: 4, alter: 0 }, { step: 'C', octave: 4, alter: 0 }, { step: 'E', octave: 4, alter: 0 },
  ]);
  await pitchTarget(page, 'E4').click();
  await page.keyboard.press('Delete');
  expect(pitches(await saveScore(page))).toEqual(['G4', 'C4']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pitchTarget(page, 'E4')).toHaveAttribute('aria-pressed', 'true');
  expect(pitches(await saveScore(page))).toEqual(['G4', 'C4', 'E4']);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  expect(pitches(await saveScore(page))).toEqual(['G4', 'C4']);
  await expect(pitchTarget(page, 'C4')).toHaveAttribute('aria-pressed', 'true');
  await pitchTarget(page, 'G4').click();
  await page.keyboard.press('Backspace');
  expect(pitches(await saveScore(page))).toEqual(['C4']);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(pitchTarget(page, 'G4')).toHaveAttribute('aria-pressed', 'true');
  // Selecting the event itself still permits deletion of the entire chord.
  await page.getByRole('button', { name: /^Select treble measure 1 event 1,/ }).click();
  await page.keyboard.press('Delete');
  expect((await saveScore(page)).measures[0].treble).toEqual([]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await pitchTarget(page, 'C4').click();
  await page.getByRole('button', { name: 'Delete selected event', exact: true }).click();
  expect((await saveScore(page)).measures[0].treble).toEqual([]);
});

test('displaced adjacent noteheads remain individually clickable at tablet width', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openChord(page, [
    { step: 'E', octave: 4, alter: 0 }, { step: 'C', octave: 4, alter: 0 }, { step: 'D', octave: 4, alter: 0 },
  ]);
  for (const [pitch, sourceIndex] of [['C4', 1], ['D4', 2], ['E4', 0]] as const) {
    const target = pitchTarget(page, pitch);
    await expect(target).toBeVisible();
    await target.scrollIntoViewIfNeeded();
    // Glyph groups follow source pitch order. Measure the engraving independently
    // of its overlay so an incorrectly displaced hit target cannot pass this test.
    const glyph = page.locator('.vf-stavenote').first().locator('.vf-notehead').nth(sourceIndex);
    const glyphBox = await glyph.boundingBox();
    const targetBox = await target.boundingBox();
    if (!glyphBox || !targetBox) throw new Error(`Missing notehead bounds for ${pitch}`);
    const center = { x: glyphBox.x + glyphBox.width / 2, y: glyphBox.y + glyphBox.height / 2 };
    expect(Math.abs(targetBox.x + targetBox.width / 2 - center.x)).toBeLessThan(2);
    expect(Math.abs(targetBox.y + targetBox.height / 2 - center.y)).toBeLessThan(2);
    await page.mouse.click(center.x, center.y);
    await expect(pitchTarget(page, pitch)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: `Edit pitch ${pitch}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await pitchTarget(page, 'D4').click();
  await page.locator('.score-paper').screenshot({ path: testInfo.outputPath('selected-adjacent-pitch.png') });
  await page.getByRole('button', { name: 'Sharp', exact: true }).click();
  const event = (await saveScore(page)).measures[0].treble[0];
  expect(event.kind).toBe('note');
  if (event.kind !== 'note') throw new Error('Expected a chord');
  expect(event.pitches.map(pitch => pitch.alter)).toEqual([0, 0, 1]);
});

test('split-staff chord heads in a secondary voice edit their source pitch', async ({ page }) => {
  await openChord(page, [
    { step: 'E', octave: 4, alter: 0 }, { step: 'G', octave: 2, alter: 0, staff: 'bass' },
    { step: 'C', octave: 4, alter: 0 },
  ], 1);
  const bassHead = pitchTarget(page, 'G2', ' voice 2');
  await bassHead.click();
  await expect(bassHead).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('ArrowUp');
  await expect(pitchTarget(page, 'G3', ' voice 2')).toHaveAttribute('aria-pressed', 'true');
  const score = await saveScore(page);
  expect(pitches(score, 1)).toEqual(['E4', 'G3', 'C4']);
  const event = score.measures[0].extraVoices!.treble![0][0];
  if (event.kind !== 'note') throw new Error('Expected a chord');
  expect(event.pitches[1].staff).toBe('bass');
  expect(score.measures[0].bass).toEqual([]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
