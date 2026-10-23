# PDF recognition feasibility

Subsequent implementation: the browser UI now offers **Open PDF** through the
local development/preview server and the replaceable Audiveris adapter. See
[current import instructions](../README.md#imported-scores). This report retains
the findings and decisions from the earlier feasibility milestone; the accuracy
limitations below still apply.

Investigation: 2026-10-22 to 2026-10-23. This milestone evaluates a local
PDF → recognition → complete MusicXML → correction → PDF workflow using the
15 supplied scores. It does not add browser PDF import.

## Decision

Local recognition can produce editable material, but unattended conversion is
not ready for these scores. Keep Audiveris as an experimental, replaceable local
provider. A production integration needs explicit review against the original,
page selection, failure recovery, and practical structural/rhythm corrections.
Do not label an exported MusicXML file or successful engraving as an accurate
conversion. No production provider, cloud upload service or desktop/local-service
packaging is selected by this investigation.

The existing complete-MusicXML document path is a useful integration boundary.
It preserves provider output without reducing it to the native editor's smaller
model. It also makes recognition mistakes and renderer limitations distinct:
retained XML can still have wrong notes, and correct source notation can render
incompletely. Keep the original PDF and the provider's editable recognition
project alongside the MusicXML.

## Corpus and experimental conditions

The [source review](omr-corpus-review.md) records 15 PDFs / 61 PDF pages:
5 vector-looking files, 8 visibly scanned/photographed paper files, and 2 clean
raster files whose original production method is uncertain. Thirty-one source
pages were visually inspected. All PDFs were readable and unencrypted.
Cantina Band has a cover on PDF page 1. The Imitation Game embeds only 595 × 842
pixels per page, so rasterizing it at 300 dpi cannot restore absent detail.

Audiveris **5.11.0**, commit `9e1e55cd2746037d059345881c53e6a6754bffbd`, ran
locally on macOS arm64 with its bundled Java 25.0.3 runtime, a 4 GiB Java heap
limit and English Tesseract data. The official macOS arm64 DMG SHA-256 was
`17491af8b6d40153b031dd1f0815e37213f0999ef23f10586af46706e59b2eb6`, matching
the release metadata. The English model came from the official Tesseract
`tessdata` 4.1.0 tag. Downloads retrieved software only; no score was uploaded.
The app was run from a temporary, read-only mounted image, without installing
it into Applications. Audiveris's attempts to create its usual user-library log
folders were denied by the sandbox; job logs and projects were retained in the
evaluation output. These environmental warnings are distinct from OMR failures.
The exact launcher and OCR model hash are retained in
`test-results/omr-review/audiveris-launcher.sh` and `environment.json`.

The default recognition settings were used, without deskewing/dewarping,
manually repairing recognition projects or tuning per-score parameters. Both
vector and raster PDFs went through Audiveris's image-recognition path.
This is a baseline for one provider/version/configuration, not a comparison of
all available OMR engines.

## First musical-page results

The first-page smoke test processed all 15 files with a 300-second limit per
PDF. Thirteen produced inspectable MusicXML; Cantina Band's cover and Severus
and Lily failed. Selecting Cantina Band PDF page 2 separately produced
MusicXML, giving **14 of 15 scores with a recognized first music page**.
The cover failure is a page-selection issue, not a music-recognition error.
Severus and Lily failed during MEASURES with a provider null-pointer exception
in `MeasuresBuilder.emptyCourtesyMeasure`; its source and partial project
remain intact. No recognition content was fabricated to replace it.

| Score | PDF page | Provider exit / MusicXML | Seconds | Rendered pages / diagnostic messages |
| --- | ---: | --- | ---: | --- |
| A Lannister Always Pays His Debts | 1 | 0 / present | 37.0 | 1 / 2 |
| Cantina Band | 1 (cover) | 1 / absent | 7.0 | — |
| Cantina Band | 2 (music) | 0 / present | 39.5 | 2 / 9 |
| Corynorhinus | 1 | 0 / present | 25.0 | 1 / 5 |
| Departure (Lullaby) | 1 | 0 / present | 50.9 | 2 / 0 |
| First Step | 1 | 0 / present | 27.6 | 1 / 1 |
| Flight of The Pigeon | 1 | 0 / present | 29.3 | 2 / 0 |
| I Giorni | 1 | 0 / present | 21.6 | 2 / 0 |
| Kadoran | 1 | 0 / present | 20.4 | 1 / 16 |
| La dispute | 1 | 0 / present | 24.1 | 2 / 3 |
| Lily's Theme | 1 | 0 / present | 22.4 | 1 / 2 |
| Mhysa | 1 | 0 / present | 23.9 | 1 / 9 |
| One Day | 1 | 0 / present | 22.3 | 1 / 0 |
| Severus and Lily | 1 | 1 / absent | 18.0 | — |
| Sleeping Lotus | 1 | 0 / present | 28.2 | 2 / 1 |
| The Imitation Game | 1 | 0 / present | 26.4 | 1 / 3 |

Times include provider startup, recognition, project saving and export. They
are individual local observations, not performance guarantees. A rendered-page
count describes re-engraving of the selected input page, not recovery of that
many original PDF pages. A zero diagnostic count is not a correctness result.

All 14 generated musical-page documents opened, survived TypeNote JSON
serialization/reopening without changing their normalized XML, and produced
Verovio pages. Ten had engraving diagnostics; four included error-level
messages despite returning pages. Examples include unsupported `heavy-light`
barlines, open spans, self-referencing ties, and chord/beam conversion errors.
Some open spans can result from selecting a page whose continuation is omitted;
they cannot all be classified as recognition failures from this experiment.

Visual review of each first rendered page showed substantial issues outside
the small audited excerpts: extra parts/staves in Corynorhinus, OCR text and
fingering digits appearing in headings, malformed/missing expression, and
missing chord detail in later La dispute bars. These are reasons to review
the complete source, not to accept a clean-looking opening bar. The renderer
and provider stages need separate investigation before assigning every visible
loss to one of them.

## Whole-document trial

On 2026-10-23, all 15 original PDFs were submitted with all pages selected and
600 seconds per file. The jobs covered 61 source pages (60 musical pages and
one known cover). **12/15 jobs exited successfully with inspectable MusicXML**.
The retained projects record **59/61 sheets reaching the provider's PAGE
stage**. This is pipeline completion, not correct musical reconstruction.
All original source hashes still match their pre-recognition values.

| Score | PDF pages | Sheets reaching PAGE | Job status | XML outputs | Seconds |
| --- | ---: | ---: | --- | ---: | ---: |
| A Lannister Always Pays His Debts | 3 | 3 | completed | 1 | 60.9 |
| Cantina Band | 10 | 9 | failed | 0 | 171.8 |
| Corynorhinus | 3 | 3 | completed | 4 | 98.1 |
| Departure (Lullaby) | 2 | 2 | completed | 1 | 49.1 |
| First Step | 3 | 3 | completed | 1 | 57.9 |
| Flight of The Pigeon | 2 | 2 | completed | 1 | 37.2 |
| I Giorni | 6 | 6 | completed | 2 | 120.1 |
| Kadoran | 4 | 4 | completed | 1 | 79.2 |
| La dispute | 3 | 3 | completed | 1 | 71.9 |
| Lily's Theme | 2 | 2 | completed | 3 | 39.4 |
| Mhysa | 5 | 5 | completed | 1 | 109.9 |
| One Day | 5 | 5 | completed | 2 | 88.0 |
| Severus and Lily | 6 | 5 | failed | 0 | 112.1 |
| Sleeping Lotus | 2 | 2 | completed | 1 | 51.0 |
| The Imitation Game | 5 | 5 | failed | 0 | 121.6 |

No job hit the 600-second limit. Besides the cover failure, Severus and Lily
failed at measure construction on its first sheet. The Imitation Game recorded
PAGE for all five sheets but then failed while reloading saved sheet structure
and reducing the score (`RunTable` unmarshalling and a null sheet). PAGE alone
therefore cannot establish even successful book export. Both failures retain
original PDFs, logs and partial projects.

The 12 successful jobs produced 19 inspectable MusicXML files. Several PDFs
were split into multiple outputs, including four for Corynorhinus and three for
Lily's Theme. These may reflect recognition/segmentation mistakes; they are not
verified intended movements. Review every output and its page mapping. TypeNote
opens one MusicXML document at a time; automatic reassembly was not implemented.

The original Cantina whole-book job failed because its cover did not reach
recognition's staff-line stage; the musical pages had retained processing data.
A separate re-export of saved-project pages 2–10 produced MusicXML with 132
measure elements and 2,493 notes/rests. TypeNote retained that source through a
save/reopen round trip and Verovio returned 9 pages with 28 diagnostics. The
provider itself logged key-cancellation export exceptions despite exit zero.
This recovery therefore supplies editable material, not verified musical fidelity.

Audiveris wrote the recovery XML beside the loaded project and re-saved the
project despite a different `-output` directory. The original failed job's status
is retained; its raw folder now also contains that later recovery export. Copies
of the recovery result, project and separate log are under
`test-results/omr-cantina-recovered/`. Future recovery should first copy the
project to a new directory, as documented in the harness instructions. Original
PDFs were unaffected.

The whole-document results extend failure/coverage evidence beyond the opening
pages. They were not all manually corrected, re-engraved, or compared note by
note. Provider warnings and source ambiguity remain; complete XML generation
must not be interpreted as complete recognition.

## Checked excerpts

Before inspecting provider output, four bars were manually read from
180-dpi source renders: one bass bar from the scanned Lannister score, two
upper-staff bars from La dispute, and one upper-staff chord bar from Cantina
Band PDF page 2. These comprise 12 written note/chord events and 20 pitch
instances. The reference contains exact rational quarter-note onsets and
durations, spelling, staff context and separate marking observations.

The excerpt comparator follows MusicXML divisions, backup, forward and chord
grouping using rational arithmetic. An exact event match requires the same
measure, onset, duration and complete spelled chord. Voice-number labels,
engraving placement and accidental display intent are not scored.

| Excerpt | Exact events | Pitch instances at correct onset/duration | Separate marking observations |
| --- | ---: | ---: | --- |
| Lannister, p1 m1, lower staff | 4 / 4 | 4 / 4 | `mp` and Moderately present |
| La dispute, p1 m1–2, upper staff | 4 / 4 | 4 / 4 | `mp` and the tie's two endpoints present |
| Cantina Band, p2 m1, upper staff | 4 / 4 | 12 / 12 | 0 / 5 expected fingerings; expected `mf` absent, `sf`, `p`, `f` emitted instead; half-note = 120 present |

These easy opening excerpts all matched pitch/rhythm, while the Cantina
markings demonstrably failed. **12/12 is not a whole-score accuracy estimate.**
It does not measure difficult later voices, tuplets, clef changes, repeats,
handwriting, page boundaries or total correction effort. The broader source
review identifies those audit locations; no complete ground truth exists for
the 61 pages. Private reference and detailed audit files stay in ignored local
outputs instead of becoming redistributable fixtures.

A fourth excerpt was added after screening the visible low-resolution losses:
The Imitation Game p1 m1, upper staff. This was manually transcribed from the
source, but deliberately selected to investigate a failure already seen in the
output; it is not a blind sample. The source has 16 sixteenth-note events. The
XML has 7 events in the sampled staff/bar, with only **3/16 exact
pitch/onset/duration matches**, 13 missing-or-changed expected events and 4
extra-or-changed recognized events. The expected `p` and Allegretto text are
absent from that bar's emitted directions. This shows concrete rhythmic/event
loss even when recognition exits successfully and the result renders without
a fatal error. Do not pool these deliberately selected excerpts into a corpus
accuracy percentage.

## Correction and export verification

The recognized La dispute first-page document was opened in the actual browser
editor. A pitch accidental was changed, undone and redone, then saved as
version-4 TypeNote JSON and reopened. Saved MusicXML matched the edited source.
The reopened document exported to a two-page A4 PDF. Both actual PDF pages were
rasterized with Poppler and visually inspected: staff systems, margins and
page boundaries were visible without page-edge clipping. This establishes the
local correction/save/export path, not fidelity to the original score. The
recognized rendering already contains losses and uneven spacing, and one
deliberate correction in this check is not a full correction of the score.

Browser verification exposed a pre-existing selection problem: clicking the
unpainted centre of a hollow imported chord head missed the note. The preview
now adds an invisible hit rectangle within each notehead. It changes neither
authoritative MusicXML nor the SVG used for PDF export. The chord-selection
browser test exercises this actual mouse target.

The dedicated editor corrects pitch, fingering, metadata and selected direction
types. Structural/rhythm mistakes currently require advanced MusicXML source
editing or repair in the provider's `.omr` project. Recognition is therefore
technically editable, but the trial has not established a comfortable musician
correction workflow or measured human correction time.

## Reproduce and inspect

See [harness instructions](../scripts/omr/README.md) for installation boundaries,
CLI commands, hand-reference format and tests. Run the supplied executable in
batch mode with `-transcribe -export -save`; the harness preserves each original
and its hash, provider files, logs, complete XML bytes and a JSON summary.
An existing output directory is refused. Timeout/Ctrl+C terminates the provider
process group and retains partial results. No extra app dependency was added.

Browser-test artifacts now default to `test-results/e2e/`, so running the
standard test command preserves sibling OMR evidence. An earlier test run had
cleaned the parent directory; source review previews and inventory were
regenerated, and the recognition trials cited here were retained separately.

Local evidence paths (ignored because they contain copyrighted/private data):

- `test-results/omr-review/`: source inventory, 31 previews, hand reference and audit results.
- `test-results/omr-first-pages/summary.json`: all 15 first-page jobs.
- `test-results/omr-cantina-page2/summary.json`: explicit first music-page trial.
- `test-results/omr-render-audit/`: browser acceptance, diagnostics, SVGs and first-page previews.
- `test-results/omr-browser/`: actual correction/save/reopen check and rendered exported PDF pages.
- `test-results/omr-full-corpus/summary.json`: whole-document trial; see results below.
- `test-results/omr-cantina-recovered/`: separate retained-project re-export of music pages 2–10.

Provider originals are copied byte-for-byte and checked against SHA-256.
MusicXML extraction never writes archive paths; it validates the container,
bounds data sizes and rejects unsafe paths/entities. The `completed` status
means provider exit zero plus inspectable XML, not musical validation.
TypeNote's own document validator and renderer are checked separately.

## Provider choices and integration boundary

Audiveris is suitable for a local experiment because it supplies batch
recognition, an editable recognition project and MusicXML export, and accepts
image/PDF input. Its official limitations include certain opposed stems,
chord-name accidentals and tuplets beyond triplets/sextuplets. Its MusicXML
export is a subset of its internal recognition representation. The upstream
license is AGPL-3.0; no Audiveris binaries or code were bundled into TypeNote.
Consult its distribution terms when deciding how to package a future provider.
[Official project](https://github.com/Audiveris/audiveris),
[CLI documentation](https://audiveris.github.io/audiveris/_pages/guides/advanced/cli/),
[known limitations](https://github.com/Audiveris/audiveris/blob/master/docs/_pages/reference/limitations.md),
[license](https://github.com/Audiveris/audiveris/blob/master/LICENSE).

PDFtoMusic is a distinct candidate for vector-generated PDFs: its manual
describes analysis of PDF graphics and states that full-page scanned images
cannot be processed; MusicXML export is a Pro feature. It was not installed,
purchased or benchmarked here, and cannot be a single solution for this mixed
corpus. Commercial/remote providers were not evaluated and no service was
given these PDFs. [Official manual](https://www.myriad-online.com/resources/docs/pdftomusic/english/index.htm).

A future app integration should keep a replaceable job interface with source
PDF/page mapping, cancellation, progress, full provider output, diagnostics and
explicit failure/partial states. It should show the original beside the result,
retain page selection and source provenance, and make rhythm/voice/rest/chord
corrections practical with undo. Browser-only WebAssembly recognition versus a
local companion/desktop process remains a product and packaging decision;
this Java command-line experiment does not resolve it. Accuracy acceptance
thresholds must be defined against a larger independently checked sample,
including correction time, before a provider can be called production-ready.

## Verification

- Python harness/excerpt tests: 19 passed using synthetic fixtures, including real
  `pdfinfo` integration, safe archive handling, invalid/encrypted input, source
  retention, no-overwrite, process timeout/cancellation and rational excerpt matching.
- Typecheck: passed. Existing unit suite: 59 tests passed. Production build: passed,
  with existing Vite chunk/module warnings.
- Integrated browser suite: 35 tests passed. Initial runs exposed the hollow-notehead
  hit problem and a renderer startup wait; the corrected workflow passes.
  The full suite used an explicit isolated output directory. Three imported-editor
  tests then passed with the new default directory, preserving the corpus summary
  and hand-reference artifacts; test discovery also passed.
- Real provider, browser serialization/rendering and correction/export checks are
  described above. Whole-corpus recognition does not imply whole-corpus musical
  verification; the untranscribed pages have no measured accuracy score.
