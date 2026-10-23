# Local scan recognition checkpoint — 2026-10-24

Work is paused at the user's request. All 14 requested PDFs were run, excluding
Lannister. This is pipeline tuning and evaluation, not model training. Runtime
recognition does not substitute filename-specific answers. No scores were sent
to an external recognition service.

## Implemented

- Experimental Curved piano scan mode keeps one piano piece together and relaxes
  staff tracking. Optional local grayscale straightening, retained coordinate maps
  and binary contrast preparation preserve the original PDF. Standard remains the
  default; uncertain preparation falls back with a warning.
- Capped local thresholds avoid artificial dark halos beside faint staff lines.
  Audiveris receives the prepared binary image unchanged. Prepared page lettering
  uses matching grayscale coordinates, rather than original unwarped crops.
- Bounded recovery handles known project-loading/courtesy-measure crashes using
  copies. Empty glyph removal requires zero pixel area and no references; original
  provider projects remain. Missing music pages are never silently dropped.
- Diagnostics now expose unplaced chords and deleted incomplete barline columns,
  in addition to rhythm failures. Successful conversion still requires review.

## Last completed corpus results

The PDFs contain 57 tested musical pages. Cantina's cover was explicitly excluded.
Counts below compare manually inventoried written bars with the sum of the longest
part in each exported document. They are structural checks, not note accuracy.
All last-completed results cover the expected pages, systems and paired staves.
That limited coverage check can pass while many bars or notes are wrong.

| Score | Source bars | Exported bars |
| --- | ---: | ---: |
| Cantina Band | 132 | 132 |
| Corynorhinus | 45 | 45 |
| Departure (Lullaby) | 34 | 34 |
| First Step | 53 | 53 |
| Flight of The Pigeon | 36 | 36 |
| I Giorni | 189 | **43** |
| Kadoran | 85 | 85 |
| La dispute | 96 | 96 |
| Lily's Theme | 37 | **38** |
| Mhysa | 128 | 128 |
| One Day | 58 | 58 |
| Severus and Lily | 122 (provisional inventory) | **121** |
| Sleeping Lotus | 81 | 81 |
| The Imitation Game | 57 | **50** |

### Remaining failures

- **Severus and Lily:** all six pages and 58 staves export together. The earlier
  completed result matched an independently transcribed opening bar's 11 pitches
  and durations. Its six-page UI open/save/reopen and PDF export were exercised;
  exported page one was visually inspected. A later capped-filter run also
  completed, with 1,019 pitched notes and 121 bars, but has not received the same
  UI/visual review. It reports 63 rhythm problems, 26 unplaced chord records and
  one removed barline column. PDF page two, system three contains a merged bar
  pair in the reviewed result. This score is not fully correct.
- **I Giorni:** an earlier aggressive contrast setting regressed to 43 bars.
  The capped replacement preserves faint lines in targeted GRID-only checks and
  matches the prepared binary image pixel for pixel. Its full recognition retry
  was stopped before completion. The 43-bar result remains explicitly failed
  evidence; it is not a successful recognition claim. Earlier standard output
  contained 189 bars split across documents, also requiring review.
- **Lily's Theme:** one extra/misaligned bar and pitch/rhythm errors remain.
- **One Day:** 58 bars does not establish accuracy: the opening upper-staff
  third-bar G3/B-natural3 whole-note chord is missing. Latest dark-paper
  preparation refused ambiguous staff tracking and retained the original input.
- **The Imitation Game:** repairing an unreferenced zero-width project glyph
  recovers a five-page export, but many sixteenths become sparse quarter-note
  onsets. The original embedded bitmap is only about 94 ppi. Severe musical
  errors remain despite successful export.
- Matching counts for the other scores do not verify their pitches, rhythm,
  clefs, fingerings, dynamics or text. Not all 14 final outputs were visually
  reviewed in the application.

## Retained evidence and verification

Private PDFs, logs, references, projects and outputs remain under ignored
`test-results/omr-next/`. `corpus/summary.json` records completed runs;
`structure-audit/current-structure-audit.json` records page/system/staff and bar
comparisons with `accuracy_verified: false`. `attempts/` retains prior results.
The interrupted I Giorni capped retry is retained separately as cancelled;
its last completed output is restored in the corpus. No score artifacts are
included in source changes.

Final quick checks passed: 72 recognition Python tests, 20 OMR adapter/harness
Python tests, both local API tests, TypeScript checking and diff whitespace checks. Earlier in this
work, 59 app unit tests, production build and six focused PDF-import browser tests
passed. The full 60-test browser suite passed before the final preparation
changes; it was not repeated at shutdown. Conversion/UI tests cannot establish
musical recognition accuracy.

## Resume here

1. Finish the capped-filter full I Giorni retry, then compare its output with the
   independent source inventory. Do not accept the retained 43-bar regression.
2. Review the completed capped Severus output against the PDF, especially the
   merged page-two barline and missing rhythmic events; rerun Corynorhinus only
   if a changed preparation stage warrants it.
3. Investigate the One Day chord loss and Imitation sixteenth-note segmentation
   with independently transcribed excerpts before broad parameter changes.
4. An isolated, ignored Homr 0.7.0 evaluation environment and CPU model downloads
   are ready in `.typenote-tools/homr-evaluation/`. **No Homr score inference has
   run**, no weights were trained, and it is not an app provider/dependency.
   Evaluate one difficult page locally before considering integration. See the
   [upstream project](https://github.com/liebharc/homr) for implementation and limits.
   Run only one heavy recognizer at a time on this machine.
