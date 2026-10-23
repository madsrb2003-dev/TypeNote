import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const id = '12345678-1234-1234-1234-123456789abc';
const xml = `<score-partwise version="4.0"><work><work-title>Recognized study</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
const file = { name: 'study.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nsynthetic mocked recognition input') };

async function mock(page: Page, mode: 'success' | 'multiple' | 'failed' | 'cancel' | 'unavailable') {
  let cancelled = false;
  let polls = 0;
  await page.route('**/api/pdf-recognition/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/status')) return route.fulfill({ json: { available: mode !== 'unavailable', message: 'Local recognition needs setup on this computer.' } });
    if (url.pathname.endsWith('/jobs') && request.method() === 'POST') {
      expect(request.headers()['x-typenote-request']).toBe('pdf-import');
      expect(request.headers()['content-type']).toBe('application/pdf');
      expect(url.searchParams.get('pages')).toBe('2-3');
      return route.fulfill({ status: 202, json: { id } });
    }
    if (url.pathname.endsWith('/cancel')) { cancelled = true; return route.fulfill({ json: {} }); }
    if (url.pathname.includes('/outputs/')) return route.fulfill({ contentType: 'application/vnd.recordare.musicxml+xml', body: xml });
    polls++;
    const running = mode === 'cancel' && !cancelled;
    // Even a completed response after a cancel click must not replace the editor.
    const status = running ? 'recognizing' : mode === 'failed' ? 'failed' : 'completed';
    return route.fulfill({ json: { id, status, message: running ? `Recognizing locally (${polls})` : mode === 'failed' ? 'Recognition failed. Original PDF retained.' : 'Recognition finished.', diagnostics: ['Review recognized notation.'], outputs: running ? [] : mode === 'multiple' ? [{ id: '0', name: 'first.musicxml' }, { id: '1', name: 'second.musicxml' }] : [{ id: '0', name: 'study.musicxml' }] } });
  });
  await page.goto('/');
  await page.getByLabel('Open PDF file').setInputFiles(file);
  await expect(page.getByRole('dialog')).toBeVisible();
}

async function recognize(page: Page) {
  await page.getByLabel('Pages to recognize').fill('2–3');
  await page.getByRole('button', { name: 'Recognize PDF', exact: true }).click();
}

test('PDF selection opens recognized MusicXML as an unsaved TypeNote document and saves/reopens it', async ({ page }) => {
  await mock(page, 'success');
  await recognize(page);
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Recognized study');
  await expect(page.locator('.save-state')).toContainText('Unsaved changes');
  await expect(page.locator('.recognition-source')).toContainText('study.pdf');
  const waiting = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save score', exact: true }).click();
  const download = await waiting;
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile((await download.path())!);
  const stored = JSON.parse(bytes.toString());
  expect(stored).toMatchObject({ version: 4, kind: 'musicxml' });
  expect(stored.xml).toContain('<step>C</step>');
  expect(download.suggestedFilename()).toMatch(/\.typenote\.json$/);
  await page.getByLabel('Open imported score file').setInputFiles({ name: 'recognized.typenote.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Recognized study');
  await expect(page.locator('.save-state')).toContainText('No unsaved changes');
});

test('separate recognition outputs stay selectable after opening one', async ({ page }) => {
  await mock(page, 'multiple');
  await recognize(page);
  await expect(page.getByRole('button', { name: 'Open result', exact: true })).toHaveCount(2);
  await expect(page.getByLabel('Score title', { exact: true })).not.toHaveValue('Recognized study');
  await page.getByRole('button', { name: 'Open result', exact: true }).first().click();
  await expect(page.getByLabel('Score title', { exact: true })).toHaveValue('Recognized study');
  await page.getByRole('button', { name: 'Recognition results', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open result', exact: true })).toHaveCount(2);
});

test('recognition failure preserves the current score and permits changing pages to retry', async ({ page }) => {
  await mock(page, 'failed');
  await recognize(page);
  await expect(page.getByRole('dialog')).toContainText('Recognition failed. Original PDF retained.');
  await expect(page.getByRole('button', { name: 'Open partial result', exact: true })).toBeVisible();
  await expect(page.getByLabel('Score title', { exact: true })).not.toHaveValue('Recognized study');
  await expect(page.getByLabel('Pages to recognize')).toBeEnabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Build chord K', exact: true })).toBeVisible();
});

test('cancel suppresses late successful results instead of replacing the current score', async ({ page }) => {
  await mock(page, 'cancel');
  await recognize(page);
  await expect(page.getByRole('dialog')).toContainText('Recognizing locally');
  await page.getByRole('button', { name: 'Cancel recognition', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open result', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Score title', { exact: true })).not.toHaveValue('Recognized study');
});

test('unconfigured local recognition gives setup feedback without allowing a fake import', async ({ page }) => {
  await mock(page, 'unavailable');
  await expect(page.getByRole('alert')).toContainText('needs setup');
  await expect(page.getByRole('button', { name: 'Recognize PDF', exact: true })).toBeDisabled();
});
