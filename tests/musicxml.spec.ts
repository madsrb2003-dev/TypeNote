import { expect, test } from '@playwright/test';

test('MusicXML preserves voices, pitch semantics, signatures, and conventional notation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { exportMusicXml, importMusicXml } = await import('/src/interchange/musicxml.ts');
    const score = {
      version: 3, title: 'Piano & étude', composer: 'A. Composer', measures: [
        { id: 'm1', keySignature: { name: 'G', fifths: 1, alterations: { F: 1 } }, timeSignature: { beats: 4, beatType: 4 }, treble: [
          { id: 'a', kind: 'note', duration: 4, dots: 1, pitches: [{ step: 'F', octave: 4, alter: 1, accidental: 'auto', fingering: '2' }, { step: 'C', octave: 3, alter: 0, accidental: 'auto', staff: 'bass' }], articulations: ['staccato', 'fermata'], ornament: 'trill', arpeggio: 'up', grace: [{ pitches: [{ step: 'E', octave: 4, alter: 0, accidental: 'auto' }], duration: 2, slash: true }] },
          { id: 'b', kind: 'note', duration: 2, pitches: [{ step: 'F', octave: 4, alter: 0, accidental: 'courtesy' }] },
          { id: 'c', kind: 'note', duration: 8, pitches: [{ step: 'F', octave: 4, alter: 0, accidental: 'explicit' }] },
        ], bass: [{ id: 'd', kind: 'rest', duration: 16, restLine: 4.5 }], extraVoices: { treble: [[{ id: 'inner', kind: 'note', duration: 16, pitches: [{ step: 'C', octave: 4, alter: 0, accidental: 'auto' }], stem: 'down' }]] } },
        { id: 'm2', keySignature: { alterations: { C: 1, F: -1 } }, timeSignature: { beats: 3, beatType: 4 }, clefs: { treble: 'bass' }, systemBreak: true, repeatStart: true, barline: 'repeatEnd', treble: [
          ...['e', 'f', 'g'].map((id) => ({ id, kind: 'note', duration: 4, tuplet: { actual: 3, normal: 2, group: 'triplet' }, pitches: [{ step: 'C', octave: 3, alter: 1, accidental: 'auto' }] })),
          { id: 'h', kind: 'rest', duration: 4 },
        ], bass: [] },
      ], marks: [
        { id: 'mf', kind: 'dynamic', value: 'mf', placement: 'below', start: { measureId: 'm1', staff: 'treble', eventId: 'a' } },
        { id: 'hp', kind: 'hairpin', value: 'crescendo', placement: 'below', start: { measureId: 'm1', staff: 'treble', eventId: 'a' }, end: { measureId: 'm2', staff: 'treble', eventId: 'g' } },
        { id: 'tie', kind: 'tie', value: '', placement: 'above', start: { measureId: 'm1', staff: 'treble', eventId: 'b' }, end: { measureId: 'm1', staff: 'treble', eventId: 'c' } },
        { id: 'slur', kind: 'slur', value: '', placement: 'above', start: { measureId: 'm1', staff: 'treble', eventId: 'inner' }, end: { measureId: 'm1', staff: 'treble', eventId: 'c' } },
        { id: 'pedal', kind: 'pedal', value: 'soft', placement: 'below', start: { measureId: 'm1', staff: 'treble', eventId: 'a' }, end: { measureId: 'm1', staff: 'treble', eventId: 'c' } },
        { id: 'octave', kind: 'octave', value: '8va', placement: 'above', start: { measureId: 'm1', staff: 'treble', eventId: 'a' }, end: { measureId: 'm1', staff: 'treble', eventId: 'c' } },
        { id: 'tempo', kind: 'tempo', value: 'quarter = 120', placement: 'above', start: { measureId: 'm1', staff: 'treble' } },
        { id: 'ending', kind: 'ending', value: '1.', placement: 'above', start: { measureId: 'm2', staff: 'treble' }, end: { measureId: 'm2', staff: 'treble' } },
        { id: 'glissando', kind: 'glissando', value: 'straight', placement: 'above', start: { measureId: 'm1', staff: 'treble', eventId: 'a' }, end: { measureId: 'm1', staff: 'treble', eventId: 'b' } },
        { id: 'navigation', kind: 'navigation', value: 'dc-al-fine', placement: 'above', start: { measureId: 'm2', staff: 'treble' } },
      ],
    };
    const xml = exportMusicXml(score);
    const imported = importMusicXml(xml);
    return { xml, ...imported };
  });
  expect(result.warnings).toEqual([]);
  expect(result.xml).toContain('<score-partwise version="4.0">');
  expect(result.xml).toContain('<backup>');
  expect(result.xml).toContain('<key-step>C</key-step>');
  expect(result.xml).toContain('line-type="solid"');
  expect(result.xml).toContain('<ending number="1" type="start">1.</ending>');
  expect(result.score.title).toBe('Piano & étude');
  expect(result.score.composer).toBe('A. Composer');
  const [first, second] = result.score.measures;
  expect(first.treble[0]).toMatchObject({ duration: 4, dots: 1, ornament: 'trill', articulations: ['staccato', 'fermata'], arpeggio: 'up' });
  expect(first.treble[0].pitches[0]).toMatchObject({ step: 'F', alter: 1, accidental: 'auto', fingering: '2' });
  expect(first.treble[0].pitches[1]).toMatchObject({ step: 'C', octave: 3, staff: 'bass' });
  expect(first.treble[0].grace[0]).toMatchObject({ duration: 2, slash: true });
  expect(first.treble[1].pitches[0]).toMatchObject({ alter: 0, accidental: 'courtesy' });
  expect(first.extraVoices.treble[0][0]).toMatchObject({ duration: 16, stem: 'down' });
  expect(first.bass[0].restLine).toBe(4.5);
  expect(second).toMatchObject({ timeSignature: { beats: 3, beatType: 4 }, clefs: { treble: 'bass' }, repeatStart: true, barline: 'repeatEnd', systemBreak: true });
  expect(second.treble.slice(0, 3).every((e: { tuplet: { actual: number; normal: number } }) => e.tuplet.actual === 3 && e.tuplet.normal === 2)).toBe(true);
  expect(result.score.marks.map((m: { kind: string }) => m.kind).sort()).toEqual(['dynamic', 'hairpin', 'tie', 'slur', 'pedal', 'octave', 'tempo', 'ending', 'navigation', 'glissando'].sort());
  expect(result.score.marks.find((m: { kind: string }) => m.kind === 'pedal').value).toBe('soft');
  expect(result.score.marks.find((m: { kind: string }) => m.kind === 'navigation').value).toBe('dc-al-fine');
});

test('MusicXML rejects unsupported structure and reports omitted notation', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { importMusicXml } = await import('/src/interchange/musicxml.ts');
    const wrap = (content: string) => `<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes>${content}</measure></part></score-partwise>`;
    const failures = ['PKzip', '<broken>', '<score-timewise/>', wrap('<note><unpitched/><duration>1</duration><type>quarter</type></note>'), wrap('<note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><type>quarter</type></note>')].map((xml) => {
      try { importMusicXml(xml); return ''; } catch (error) { return (error as Error).message; }
    });
    const imported = importMusicXml(wrap('<note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><lyric><text>word</text></lyric></note>'));
    return { failures, warnings: imported.warnings };
  });
  expect(result.failures.every(Boolean)).toBe(true);
  expect(result.failures[0]).toContain('Compressed');
  expect(result.failures[4]).toContain('disagrees');
  expect(result.warnings).toContain('Note feature lyric was omitted.');
});

test('MusicXML preserves a whole-measure rest in a non-four-four meter', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { importMusicXml, exportMusicXml } = await import('/src/interchange/musicxml.ts');
    const xml = '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>5</beats><beat-type>8</beat-type></time></attributes><note><rest measure="yes"/><duration>5</duration><voice>1</voice><staff>1</staff></note></measure></part></score-partwise>';
    const first = importMusicXml(xml);
    const exported = exportMusicXml(first.score);
    return { first, exported, second: importMusicXml(exported) };
  });
  expect(result.first.warnings).toEqual([]);
  expect(result.first.score.measures[0].treble[0]).toMatchObject({ kind: 'rest', duration: 16, measureRest: 10 });
  expect(result.exported).toContain('<rest measure="yes"/>');
  expect(result.second.score.measures[0].treble[0]).toMatchObject({ kind: 'rest', duration: 16, measureRest: 10 });
});
