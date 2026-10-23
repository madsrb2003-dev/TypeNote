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

## Completed: other-score edge cases and chord-rendering fix (2026-10-23)

- Resumed and completed all 14 other whole-PDF attempts at 400 dpi: 59 requested
  pages, 57 retained sheets reaching PAGE, 11 successful jobs and 18 XML outputs.
  Cantina, Severus and Imitation failed. Separately recovered Cantina's musical
  pages from a copied recognition project, preserving the failed whole-PDF status.
- Reviewed selected source/render locations, staff/part/movement structure and
  independent excerpts. Found missing bars, spurious parts, incorrect score
  splitting, genuine missing chord tones and lost markings. Higher DPI does not
  uniformly improve results; Lily gains an erroneous extra part.
- Isolated a renderer bug: repeated beam instructions on chord members hide
  correctly recognized bass content. Added a conservative rendering-copy adapter;
  authoritative XML stays unchanged. Verified Lannister's restored five-note
  bass passage and all three actual exported PDF pages.
- All 19 XML documents, including recovery, pass actual TypeNote open/render and
  source save/reopen checks. All 14 original/copy hashes match. Passed typecheck,
  build, 59 unit tests and 20 affected browser tests, including two new beam tests.
  No recognition processes remain. [Findings, coverage and limits](docs/omr-400-regression.md).

## Completed: imported page layout and surrounding text (2026-10-23)

- Fixed Lannister's five-bar first system being split by the renderer. Encoded
  system/page breaks now drive engraving, with space distributed between systems
  and natural gaps retained for short excerpts and sparse final pages.
- Positioned credits separately from notation. Successful new local imports can
  preserve original headers, footers and unrepresented opening directions as
  embedded PNG credits. Existing metadata and musical parts remain intact;
  exact extracted provider XML is retained separately when images are added.
- Added an undoable **Use editable page text** action. Facsimile lettering remains
  an image; notes stay editable. Images survive MusicXML/TypeNote saving and reopening.
- Verified Lannister's real first-page and full-score JSON round trips and one/three
  A4 PDF pages. The first page has four five-bar systems, original title/composer,
  opening instruction and copyright footer. Inspected all three exported pages.
- Tested added facsimiles on First Step and Kadoran without another OMR run.
  Fixed First Step's oversized blank footer crop, duplicate opening tempo in its
  header, and excessive final-page spacing. Verified First Step's three-page PDF
  and saved score; its repeated PDF footers have identical rendered pixel crops.
- All 19 retained recognition outputs open/render and preserve source on
  save/reopen. Passed typecheck/build, 59 unit tests, all 47 browser tests,
  28 recognition Python tests and both recognition API tests. No new dependencies.
- Exact source geometry and all interleaved text are not guaranteed. Existing
  recognition errors, invalid ties and First Step's displaced coda remain.
  [Implementation, verification and limits](docs/imported-page-layout.md).

## Completed: note entry and structural editing for imported scores (2026-10-23)

- Added visible Correct / Insert / Build chord modes to the imported editor.
  Enter notes/rests using buttons or C D E F G A H / R, preserving H/B spelling
  and inherited staff/voice context. Select a rest to fill it; later entries
  continue after the newly selected event.
- Added chord-tone entry, whole-chord duration changes, conservative deletion,
  and empty-bar insertion across aligned parts. Exact source timing is retained:
  shorter notes leave rests, longer notes consume following rests, and full bars
  reject additions without moving other voices.
- New bars inherit musical settings without redundant signature/clef changes.
  Original measure labels remain; new labels use `-new-N`. Missing active staff
  lanes receive rests. A simple terminal barline moves to an appended bar.
- Undo/redo restores the document, selection and entry mode/position. Save/reopen
  retains new notes without migrating the version-4 format. Source drafts and
  ordinary text inputs keep their existing protection.
- Tested real Lannister edits, including chord/rhythm edits, a new bar, note/rest
  entry, undo/redo, JSON reopening and PDF export. All other 19 measures, original
  bass notes and credits remain structurally unchanged. Inspected the exported
  Lannister and entry-study PDFs, plus desktop/tablet controls without overflow.
- Unsupported source timing/connections reject transactionally: no cross-bar
  ripple, automatic divisions rescaling, new voice/staff creation or tuplet/tie/
  grace rewriting. Bar insertion cannot separate ties/tuplets or safely rewrite
  multiple-rest/measure-repeat groups. Complex notation still needs source editing.
- Passed typecheck/build, all 59 app unit tests and all 59 browser tests, including
  12 structural/entry cases. No dependencies or saved-file format changes.
- [User workflow, implementation and verification](docs/imported-score-editing.md).

## Paused: difficult-score recognition recovery (2026-10-24)

- Evaluated all 14 requested PDFs, excluding Lannister; 57 musical pages with
  Cantina's cover excluded. Added experimental local piano-scan preparation,
  conservative provider-project recovery and clearer missing-rhythm/bar warnings.
- Severus now exports six pages with paired staves, but still has 121/122 bars,
  merged-bar and rhythm errors. I Giorni's 43/189-bar contrast regression remains
  unresolved: the capped-filter full retry was cancelled when work was stopped.
  Lily's Theme, One Day and Imitation also have confirmed musical errors.
- Kept completed results and cancelled experiments separately. No model weights
  were trained; Homr is installed only for a later isolated evaluation, not yet run.
- Final checks: 72 recognition and 20 OMR Python tests, both API tests, typecheck and diff checks
  passed. Earlier app unit/build and focused PDF-import browser checks passed.
- [Detailed results, retained evidence and exact next steps](docs/omr-recovery-review.md).

## Remaining work

- Decide production distribution and packaging. Local import now uses Audiveris
  through the Node/Python development/preview server; a static deployment alone
  cannot recognize PDFs. No remote upload service or desktop package is selected.
- Build a source-PDF/result review workflow with page mapping and partial-failure
  recovery. Expand imported editing beyond the implemented rest/chord/duration/bar
  operations to richer voice editing, finer timing and connected rhythmic notation.
- Expand independently checked notation samples and measure musician correction
  effort before setting recognition acceptance thresholds. Current results include
  lost notes/rhythm, missing fingerings, incorrect dynamics, segmentation errors
  and provider/renderer failures.
- A saved project bundle containing original PDF, source-page/result links and
  editable XML remains a proposed extension. Current TypeNote JSON contains XML only;
  recognition job/source links are session-only in the UI, while job files remain on disk.
- Improve provider failures, multi-document segmentation and correction usability.
  Recognition still needs review against the original. Playback remains unimplemented.
