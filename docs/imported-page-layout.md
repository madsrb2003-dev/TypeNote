# Imported score page layout and original lettering

## Problem and cause

The first music page of *A Lannister Always Pays His Debts* had twenty bars in four
five-bar systems. Audiveris encoded those system breaks correctly, but TypeNote's
Verovio `smart` layout reflowed them, leaving a bar on its own system. Vertical
justification was also restricted, leaving a large unused area below the music.
Audiveris omitted the large title, misread the footer, and supplied positioned
credits which the renderer gathered into a heading.

## Implemented behavior

- Use encoded system/page breaks when available. Distribute space between systems,
  preserving grand-staff spacing. Keep natural gaps for one/two-system excerpts
  and final pages of up to three systems following fuller pages.
- Position supported MusicXML credits in page coordinates instead of aggregating
  them into the heading. Preview and downloaded PDF use the same layout.
- After successful local recognition, optionally preserve safe original page-edge
  bands and unrepresented opening directions as PNG images in standard
  [MusicXML credit-image elements](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/credit-image/).
  This retains the original lettering, including a title missed by OCR.
- Reserve space around these images, moving whole engraved systems without
  stretching individual musical glyphs. When necessary systems can be uniformly
  reduced; a layout requiring a scale below 65% fails with a correction message.
- Keep musical content and existing metadata intact. Raw provider files are
  unchanged; original extracted XML is retained in `provider-musicxml/` when
  enriched XML is emitted. Layout preparation modifies a disposable rendering copy.
- Save images inside authoritative XML, including version-4 TypeNote JSON. The
  whole original PDF remains separately in the local recognition job folder.
- Offer **Use editable page text** with undo. It removes only TypeNote's facsimile
  credits and enables title/composer editing; notes are editable throughout.

The optional backend uses existing Audiveris staff/symbol geometry and local
Poppler at 150 dpi. It never uploads documents or reruns recognition. Crops avoid
recognized music and crossing text; an opening direction already represented as
words/metronome stays editable instead of also being copied as an image. Only
embedded, bounded PNG images are drawn; remote image URLs and SVG images are not
overlaid. Per-image, aggregate, time and editable-file limits apply. Optional
failure keeps the unmodified recognized score and supplies a diagnostic.

## Verification

Private artifacts are in ignored `test-results/import-layout/`; no supplied score
or extracted image is committed. The review reused retained recognition results,
without another expensive full-corpus recognition run.

- Inspected original and rendered Lannister first-page and full-score pages.
  The first page has four systems of five bars. The full score retains three
  pages with four/five/five systems. Original title, composer, opening
  “Moderately”, copyright footer and later page numbers are visible.
- All 19 retained 400 dpi MusicXML outputs, including the separately recovered
  Cantina result, open, render and survive source serialization/reopening.
  This checks renderer compatibility, not the musical accuracy of those outputs.
- Added real facsimiles to First Step (three pages, six images) and Kadoran
  (four pages, eight images); verified their musical parts remain unchanged and
  inspected the resulting pages. First Step exposed two additional bugs, now
  fixed: a footer crop containing most of a sparse page's blank space prevented
  rendering, and an opening tempo inside a header image duplicated the editable
  marking. Footer crops now start near detected lettering and opening directions
  are kept separate from header bands even when entirely above the cutoff.
- Exercised actual Save score → reopen → Download PDF for Lannister's first-page
  and full-score files and First Step. Notes/rests remain 132/687/518 respectively;
  saved images remain 3/5/6 and exported A4 page counts remain 1/3/3. Inspected the
  actual PDF pages. Matching pixel crops confirm First Step's repeated footer on
  all three exported pages. Layout does not establish correctness of every note.
- Dense Cantina, Kadoran and extended-notation fixture checks found no tested
  rendered glyph outside the page. Cantina still reports compressed horizontal
  justification; this does not establish that every internal collision is absent.
- Automated cases cover five-bar systems, positioned credits, short excerpts,
  source preservation, image safety, switching to editable text and undo.
  Backend cases cover page mapping, bounds, limits, optional failure, unchanged
  notation, retained provider XML and avoiding duplicate opening directions.
- Final checks passed: typecheck/build, 59 unit tests, all 47 browser tests,
  28 recognition Python tests, both recognition API tests, and `git diff --check`.
  Existing build warnings about bundle size, mixed imports and Verovio's
  browser-externalized Node module remain.

## Limits

This is not a reconstruction of every text object in a PDF. Facsimiles preserve
lettering and paper color as pixels rather than editable text. Text interleaved
with music, unrecognized footers, partially recognized opening directions,
skewed/cropped scans and ambiguous provider page mappings can still need manual
correction. Conservative cropping can omit content rather than duplicate music.
If any opening words/metronome are already encoded, separate direction crops for
that page are skipped; a second missed opening instruction may therefore remain
missing. Ordinary positioned OCR text still depends on recognition accuracy and
does not reproduce the original font exactly.

Provider/renderer defects remain visible in the extra samples: First Step's
side-by-side coda is rendered as a separate system and its OCR can misread
expression text; Kadoran has invalid self-ties and compressed lines. These
musical/structural problems are not repaired by preserving surrounding text.

A4 engraving preserves encoded breaks and uses available vertical space; it does
not reproduce every original staff position, horizontal bar width or page aspect
ratio exactly. Existing saved scores gain layout fixes, but a title absent from
their XML cannot be recovered without the original PDF and retained recognition
geometry. New PDF imports add the facsimiles automatically where possible.
