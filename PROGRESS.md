# TypeNote progress

## Completed before the PDF recognition investigation

- Native piano score entry, notation editing, versioned local files and A4 PDF export.
- Complete MusicXML document preservation, local Verovio rendering, targeted corrections,
  source editing, undo/redo and imported-score PDF export.

## Completed: PDF recognition feasibility (2026-10-23)

- Reviewed the 15 supplied PDFs (61 pages); visually inspected 31 source pages.
  Source quality and notation findings are in `docs/omr-corpus-review.md`.
- Added a local command-line evaluation harness in `scripts/omr/`, with preserved
  originals, hashes, logs, bounded MXL inspection and cancellation/timeouts.
- Evaluated first pages with Audiveris 5.11.0 and separately selected Cantina Band's
  first music page (PDF page 2). Raw private results remain under ignored `test-results/`.
- Ran all 15 whole PDFs / 61 pages: 12 jobs generated MusicXML successfully;
  3 failed. Retained projects record 59 sheets reaching PAGE, which does not
  establish musical correctness or successful book export. Re-exported Cantina's
  retained musical pages separately and verified source round-trip/rendering.
- Independently hand-read four bars across three scores and added an exact rational
  excerpt comparator; subsequently audited a fifth bar selected to investigate
  low-resolution recognition loss. Reference transcriptions and detailed output stay local.
- Exercised recognized MusicXML in the browser: pitch correction, undo/redo,
  save/reopen and A4 PDF export; inspected both actual exported pages.
- Fixed mouse selection in hollow imported noteheads and isolated browser-test
  output so test cleanup preserves sibling OMR evidence.
- Verification passed: 19 Python harness/audit tests, 59 existing unit tests,
  typecheck, build and 35 browser tests. Reviewed actual source and rendered output;
  all original PDF hashes still match. Results and the integration decision are in
  [the feasibility report](docs/omr-feasibility.md).

## Completed: choose PDF → editable score (2026-10-23)

- Added **Open PDF** to both editors. Choose all pages or a page range, run local
  recognition, cancel it, and open complete MusicXML results in the existing editor.
  A single successful result opens automatically and is marked unsaved. **Save score**
  downloads version-4 `.typenote.json`; **Save MusicXML** downloads XML.
- Multiple outputs remain selectable through **Recognition results**. Failures retain
  the current score; readable partial results require an explicit open action.
  Unsaved edits are checked before a recognized document replaces the current score.
- Added the loopback/same-origin development/preview API and Python worker in
  `scripts/recognition/`, reusing the replaceable Audiveris adapter. The evaluated
  runtime and OCR data are configured locally in ignored `.typenote-tools/`.
  Originals, MusicXML, provider projects and logs persist in ignored `.typenote-imports/`.
  Private folders are blocked from static serving and excluded from file watching.
- Verified actual PDF selection → local recognition → 297-note/rest MusicXML document
  → correction/undo → TypeNote/MusicXML downloads → reopened JSON and A4 PDF export.
  The copied original PDF's hash matches its source. Inspected the desktop workflow
  and both rendered PDF pages. This verifies the workflow, not recognition fidelity.
- Passed typecheck/build, 59 unit tests, 40 browser tests (including five new PDF
  workflows), 9 recognition-worker tests, 2 API integration test groups and the
  19 existing OMR harness tests. Fixed a first-render dependency-optimizer reload
  that otherwise reset the just-opened document in development.

## Completed: Departure source comparison and recovery (2026-10-23)

- Compared both original pages with the user's retained conversion, provider
  project and rendered MusicXML. The provider missed one upper staff, created a
  spurious Voice part and reduced 34 bars to 32. Both original staves initially
  use treble clef; staff identity and hand role cannot be inferred from clef.
- Browser recognition now explicitly requests 400 dpi. A fresh conversion
  restores one two-staff piano part and all 34 bars. Added read-only warnings for
  reduced staff counts and INFO-level provider rhythm failures. No XML pitch or
  staff relabeling is applied; raw provider output and originals are preserved.
- Checked every bar against a private manual transcription. Raw 400 dpi still
  matches only 33/56 upper and 261/265 lower events exactly. Corrected the private
  editable Departure score, including sustained notes, octave chords, rhythm,
  clef changes and four ties. Verified save/reopen and two-page PDF export.
  [Detailed findings and limits](docs/departure-recognition-review.md).
- Passed 12 worker tests, 19 harness tests, 2 API test groups, 59 app unit tests,
  typecheck/build and 8 affected browser tests. Original PDF hash is unchanged.

## Other-score edge cases: stopped at user request

- Started a sequential 400 dpi comparison, then stopped the broader testing at
  the user's request. Completed Lannister: one two-staff part, 59 bars; the
  independently transcribed opening bass bar still matches 4/4 events exactly.
  Later rhythmic and engraving problems remain; this is not a full accuracy pass.
  Completed/partial evidence stays in ignored `test-results/omr-400-regression/`.

## Remaining work

- Decide production distribution and packaging. Local import now uses Audiveris
  through the Node/Python development/preview server; a static deployment alone
  cannot recognize PDFs. No remote upload service or desktop package is selected.
- Build a source-PDF/result review workflow with page mapping, partial-failure
  recovery and practical rhythm/voice/rest/chord corrections.
- Expand independently checked notation samples and measure musician correction
  effort before setting recognition acceptance thresholds. Current results include
  lost notes/rhythm, missing fingerings, incorrect dynamics, segmentation errors
  and provider/renderer failures.
- A saved project bundle containing original PDF, source-page/result links and
  editable XML remains a proposed extension. Current TypeNote JSON contains XML only;
  recognition job/source links are session-only in the UI, while job files remain on disk.
- Improve provider failures, multi-document segmentation and correction usability.
  Recognition still needs review against the original. Playback remains unimplemented.
