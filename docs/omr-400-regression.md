# Other-score recognition regression — 2026-10-23

## Scope and outcome

Resumed the interrupted local test of all **14 non-Departure PDFs**, requesting
all their **59 source pages** with Audiveris 5.11.0 at the browser's 400 dpi
setting. Kept the completed Lannister run, retried interrupted jobs in new
directories, and preserved cancelled attempts. Originals, projects, logs and
complete XML remain private under ignored `test-results/omr-400-regression/`.

- **11 jobs exported 18 MusicXML documents; 3 jobs failed without XML.** The
  failures are Cantina Band, Severus and Lily, and The Imitation Game, the same
  three failures as the previous 300 dpi run.
- Retained projects record **57/59 sheets reaching PAGE**. Cantina's cover and
  Severus's first page do not. Reaching PAGE does not establish correct music
  or successful export: Imitation reaches PAGE on all five sheets, then fails.
- A separate Cantina recovery exported pages 2–10 from a **copy** of its retained
  project. That adds one document without changing the failed whole-PDF status
  or the original recognition project.
- All **19 documents**, including recovery, opened, rendered and survived the
  TypeNote save/reopen source check with the compatibility fix below.
- All 14 original PDF hashes and their retained copies still match.

The latest provider attempts total approximately 31.9 minutes versus 20.3 at
300 dpi, excluding cancelled attempts, recovery and review/render time. These
are observations on this computer, not a controlled performance benchmark.
Higher resolution is **not a general accuracy improvement**; Lily's Theme gains
an erroneous extra part at 400 dpi.

## Per-score findings

“XML” counts separate provider documents, not correctly recognized pieces.
Findings come from project/XML inspection and comparisons at selected source
locations; this is not a transcription audit of every bar on all 59 pages.
Direct comparisons covered 11 source pages and 12 selected raw-render pages.
Raw Verovio generated all 64 SVG pages across the 19 files without a loading or
rendering failure; generation alone is not visual or musical verification.

| Score | PDF pages | XML | Main observed edge case |
| --- | ---: | ---: | --- |
| A Lannister Always Pays His Debts | 3 | 1 | Correct bass content at bar 20 was lost by the renderer; fixed as described below. Opening bass excerpt matches. |
| Cantina Band | 10 | 0; 1 recovered | Cover blocks whole-book export. Musical-page recovery works, but key/cut time, dynamics and fingerings are misread or lost. Export also logs a key-cancellation exception despite exit 0. |
| Corynorhinus | 3 | 4 | Curved piano systems become multiple fragments with extra Voice parts and an empty Piano grand staff. Increasing DPI does not restore grouping. |
| First Step | 3 | 1 | Repeat dots and sustained ties disappear. Some collapsed chords were rendering failures associated with duplicate beams, not established recognition loss. |
| Flight of The Pigeon | 2 | 1 | Sparse final page survives, but high eighth notes, accompaniment rhythm and final fermatas are lost. Both source staves correctly use treble clef. |
| I Giorni | 6 | 2 | A coda within the same piece becomes a separate movement; coda/arpeggio marks and some sustained notes disappear. |
| Kadoran | 4 | 1 | Header meter/metronome remain unresolved; the original render itself has ambiguous glyphs. Missing ties and engraving diagnostics remain. No replacement meter was guessed. |
| La dispute | 3 | 1 | Opening two-bar reference matches. Duplicate beams explain many chord-rendering errors; a quiet provider log does not establish full fidelity. |
| Lily's Theme | 2 | 3 | First system has only three recognized bars versus four in the source. An extra empty Voice staff appears at 400 dpi. Pedal details disappear; a correctly aligned triplet excerpt still matches. |
| Mhysa | 5 | 1 | Tied chord content/marks display incorrectly, with chord-related renderer diagnostics. Some discrepancies require further provider-versus-renderer isolation. |
| One Day | 5 | 2 | Extra empty Voice staves and fragmented output; fingerings become heading text. A sustained upper chord in the first system's third bar is genuinely absent from every raw XML part. |
| Severus and Lily | 6 | 0 | Measure-construction exception on page 1; five of six sheets reach PAGE but book export fails. Missing header clefs also occur. |
| Sleeping Lotus | 2 | 1 | Two single-staff Voice parts encode the pair, rather than an extra third staff. A held chord loses a member in raw XML; a fermata is missing. |
| The Imitation Game | 5 | 0 | All sheets reach PAGE, then project reload/export fails with run-table/null-sheet errors. Its low-resolution source cannot gain detail merely through resampling. |

Source/render crops, raw renderer diagnostics and detailed locations are retained
in the private `visual-audit.md`, `comparison.json` and `render-results.json`.
Provider output and the renderer's response are recorded separately.

## Exact excerpt checks

References were read from original PDFs independently of converter pitch output.
An event match includes spelled pitches/chord, onset and duration. These small
samples do **not** estimate corpus-wide accuracy or cover all markings.

| Source excerpt | Exact events | Matching timed pitches | Qualification |
| --- | ---: | ---: | --- |
| Lannister, page 1 bar 1, lower staff | 4/4 | 4/4 | Narrow opening-bass check. |
| La dispute, page 1 bars 1–2, upper staff | 4/4 | 4/4 | Does not validate later voices/chords. |
| Lily, page 1 bar 6, upper staff | 5/5 | 5/5 | Source bar 6 aligns to output fragment 1, Piano part P2, bar 5, because the preceding system loses a bar. Includes quarter-note triplets. |
| Cantina, PDF page 2 bar 1, upper staff | 4/4 | 12/12 | Recovered musical pages only. Correct chord events coexist with wrong/missing key, meter, dynamics, tempo and fingerings. |

Lily's baseline 300 dpi triplets also match after explicit alignment. Comparing
source bar 6 directly with output bar 6 gives a misleading error count. The
alignment is supported by retained staff-system/barline geometry, not by choosing
the best-matching notes. The audit selects the Piano part only in memory and
does not replace or merge the authoritative multi-part document.

## Implemented: chord-beam rendering compatibility

Lannister bar 20 exposed a separate, fixable failure: its complete bass chord,
following eighth, half note and quarter note are present correctly in MusicXML,
but Verovio 6.3 loses them when identical beam instructions appear on multiple
members of the chord. Removing duplicate member instructions in an experimental
**rendering copy** restores all five noteheads and eliminates its chord errors.

`src/notation/importedCompatibility.ts` now prepares that disposable copy before
the notation worker runs. It removes only exact duplicate beam elements on
matching-duration members with the same voice, staff and grace/cue status.
Different beam instructions, attributes, voices, staves and durations remain.
Voice and grace/cue distinctions matter to beam grouping; see the official
[MusicXML beam reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/beam/).

The authoritative XML, note IDs, pitches, timing, staff assignments and saved
TypeNote/MusicXML source remain intact. Preview and PDF export share the fix;
engraving diagnostics disclose the adjustment. It does not recover notation
that is absent from provider output or fix part/movement segmentation.

Verification passed: typecheck, build, 59 unit tests and 20 affected browser
tests, including new visible-note/source-preservation and conservative-boundary
checks. All 19 real outputs passed parser, renderer and source-roundtrip checks.
For actual Lannister, all 199 source beam elements survived saving; all five bass
noteheads in bar 20 appeared. Exported its three-page A4 PDF, rendered and
inspected all pages, and checked notation bounds. Private verification artifacts
are in `test-results/omr-400-reference-checks/`.

## Priorities established by the evidence

Next work should address staff/bar/movement segmentation and recovery of musical
pages, then practical rhythm, voice, rest and chord correction alongside the PDF.
Missing chord members, ties, fingering, pedal and navigation marks need explicit
review. Further changes to raster resolution alone are insufficient.

Those are proposed priorities, not newly implemented features. No new recognition
provider or external service was selected, and these 14 scores were not manually
corrected in full. The separate manually corrected Departure file remains as
documented in [its review](departure-recognition-review.md).
