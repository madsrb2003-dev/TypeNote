import { expect, test } from '@playwright/test';

const source = `<score-partwise version="4.0"><work><work-title>Source study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note id="base"><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note><note id="upper"><chord/><pitch><step>F</step><alter>1</alter><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;

async function open(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Open MusicXML file').setInputFiles({ name: 'study.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 15000 });
}

test('hollow imported chord heads select independently and follow key without local signs', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Select imported note upper', exact: true }).locator('.notehead').click();
  await expect(page.getByLabel('Selected imported note')).toHaveValue('upper');
  await expect(page.locator('[data-note-id="upper"]')).toHaveClass(/imported-selected/);
  await expect(page.locator('[data-note-id="base"]')).not.toHaveClass(/imported-selected/);
  await page.getByRole('button', { name: 'Natural', exact: true }).click();
  await page.getByRole('button', { name: 'Follow signature', exact: true }).click();
  await page.getByText('Advanced MusicXML editing', { exact: true }).click();
  const xml = await page.getByLabel('MusicXML source').inputValue();
  expect(xml).toContain('<alter>1</alter>');
  expect(xml).not.toContain('<accidental>');
  expect(xml).toContain('<step>C</step>');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('source drafts cannot overwrite newer edits or be silently omitted from saves', async ({ page }) => {
  await open(page);
  await page.getByText('Advanced MusicXML editing', { exact: true }).click();
  const editor = page.getByLabel('MusicXML source');
  const initial = await editor.inputValue();
  await editor.fill(initial.replace('Source study', 'Draft study'));
  await expect(page.getByRole('button', { name: 'Save score', exact: true })).toBeDisabled();
  await page.getByLabel('Composer', { exact: true }).fill('New composer');
  await page.getByRole('button', { name: 'Apply source changes' }).click();
  await expect(page.locator('.status-bar')).toContainText('score changed');
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Source study');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reload current source' }).click();
  expect(await editor.inputValue()).toContain('New composer');
  await editor.fill((await editor.inputValue()).replace('Source study', 'Applied study'));
  await page.getByRole('button', { name: 'Apply source changes' }).click();
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Applied study');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Source study');
  await expect(page.getByLabel('Composer', { exact: true })).toHaveValue('New composer');
});

test('invalid XML preserves the current imported score and it can return to native editing', async ({ page }) => {
  await open(page);
  await page.getByLabel('Open imported score file').setInputFiles({ name: 'bad.xml', mimeType: 'application/xml', buffer: Buffer.from('<broken>') });
  await expect(page.locator('.status-bar')).toContainText('malformed XML');
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Source study');
  await page.getByRole('button', { name: 'New score', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build chord K', exact: true })).toBeVisible();
});
