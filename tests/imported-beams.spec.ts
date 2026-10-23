import { expect, test } from '@playwright/test';

const notes = `<note id="base"><pitch><step>A</step><octave>2</octave></pitch><duration>1</duration><voice>5</voice><type>eighth</type><staff>2</staff><beam number="1">begin</beam></note>
<note id="member"><chord/><pitch><step>F</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>eighth</type><staff>2</staff><beam number="1">begin</beam><notations><other-notation type="single">keep</other-notation></notations></note>
<note id="following"><pitch><step>E</step><octave>3</octave></pitch><duration>1</duration><voice>5</voice><type>eighth</type><staff>2</staff><beam number="1">end</beam></note>
<note id="held"><pitch><step>A</step><octave>2</octave></pitch><duration>4</duration><voice>5</voice><type>half</type><staff>2</staff></note>
<note id="last"><pitch><step>A</step><octave>2</octave></pitch><duration>2</duration><voice>5</voice><type>quarter</type><staff>2</staff></note>`;
const source = `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note id="rest"><rest measure="yes"/><duration>8</duration><voice>1</voice><staff>1</staff></note><backup><duration>8</duration></backup>${notes}</measure></part></score-partwise>`;

test('beam compatibility removes exact duplicates only from a disposable rendering copy', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async xml => {
    const { prepareMusicXmlForRendering: prepare } = await import('/src/notation/importedCompatibility.ts');
    const prepared = prepare(xml);
    const parse = (value: string) => new DOMParser().parseFromString(value, 'application/xml');
    const original = parse(xml), output = parse(prepared.xml);
    const retained = (change: (doc: Document) => void) => {
      const doc = parse(xml); change(doc);
      const changed = new XMLSerializer().serializeToString(doc);
      return prepare(changed).xml === changed;
    };
    return {
      originalBeams: original.querySelectorAll('beam').length,
      outputBeams: output.querySelectorAll('beam').length,
      notes: output.querySelectorAll('note').length,
      unknown: output.querySelector('other-notation')?.textContent,
      diagnostics: prepared.diagnostics,
      idempotent: prepare(prepared.xml).xml === prepared.xml,
      otherVoice: retained(doc => { doc.querySelector('#member voice')!.textContent = '6'; }),
      otherStaff: retained(doc => { doc.querySelector('#member staff')!.textContent = '1'; }),
      otherDuration: retained(doc => { doc.querySelector('#member duration')!.textContent = '2'; }),
      otherBeam: retained(doc => { doc.querySelector('#member beam')!.textContent = 'continue'; }),
      otherAttributes: retained(doc => { doc.querySelector('#member beam')!.setAttribute('fan', 'accel'); }),
      cue: retained(doc => { doc.querySelector('#member')!.prepend(doc.createElement('cue')); }),
      boundary: retained(doc => { doc.querySelector('#member')!.before(doc.createElement('backup')); }),
    };
  }, source);
  expect(result).toMatchObject({ originalBeams: 3, outputBeams: 2, notes: 6, unknown: 'keep', idempotent: true,
    otherVoice: true, otherStaff: true, otherDuration: true, otherBeam: true, otherAttributes: true, cue: true, boundary: true });
  expect(result.diagnostics).toHaveLength(1);
});

test('repeated chord beams render all bass notes and survive source saves', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open MusicXML file').setInputFiles({ name: 'beamed-chord.musicxml', mimeType: 'application/xml', buffer: Buffer.from(source) });
  await expect(page.getByRole('button', { name: 'Download PDF', exact: true })).toBeEnabled({ timeout: 30000 });
  for (const id of ['base', 'member', 'following', 'held', 'last']) {
    await expect(page.getByRole('button', { name: `Select imported note ${id}`, exact: true }).locator('.notehead')).toBeVisible();
  }
  await page.getByText('Advanced MusicXML editing', { exact: true }).click();
  const saved = await page.getByLabel('MusicXML source').inputValue();
  expect((saved.match(/<beam\b/g) ?? []).length).toBe(3);
  expect(saved).toContain('keep');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
