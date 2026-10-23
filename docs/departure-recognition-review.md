# Departure recognition review — 2026-10-23

Compared both supplied PDF pages with the user's retained recognition job,
the Audiveris project, complete MusicXML and rendered notation.

## What went wrong

- The original has one piano grand staff and 34 bars: page 1 contains 1–18,
  page 2 contains 19–34. Both staves start in **treble clef**. The lower
  accompaniment uses treble notation; changing it to bass without changing
  pitches would misrepresent the source. Page 2 explicitly switches hand roles
  and has mid-bar clef changes in the upper staff.
- At the default 300 dpi, Audiveris failed to detect the upper staff in page 1,
  system 4 (bars 13–15). Its project records only one staff there and collapses
  the three bars into one. Export creates a spurious single-staff Voice part
  alongside the two-staff Piano, with only 32 bars. This error already exists
  in provider output, before TypeNote opens or renders it.
- Further failures include missing sustained melody notes, incorrect/missing
  mid-bar clefs, invented chord tones and wrong durations. A successfully
  generated MusicXML file was insufficient evidence of usable recognition.

## Changes and recovery

- Browser recognition now requests **400 dpi** explicitly. A fresh whole-score
  run recovered one Piano part, two staves and all 34 bars. A 250 dpi experiment
  also recovered the layout but had substantial note/rhythm errors. Resolution
  changes are recognition settings, not post-processing guesses about hands.
- Added read-only project diagnostics for reduced staff counts, with page/system
  references, and surfaced INFO-level provider rhythm failures. The old Departure
  project triggers the missing-staff warning; the new 400 dpi project does not.
  A staff-count warning is an observation, since deliberate condensation exists.
- Higher resolution alone still misrecognizes melody and clefs. A separate
  manual transcription checks all 34 bars against the source and supplies a
  corrected editable score. It is **not** a special-case runtime replacement or
  evidence that future automatic imports will be note-perfect.

The full-score event audit of raw 400 dpi output finds 33/56 exact upper-staff
events and 261/265 exact lower-staff events (pitch/chord, onset and duration).
Lower bar 26 has its second four-eighth group starting simultaneously in another
voice instead of on beat 3. All lower pitches are present, which alone would
have missed this error. The converter also loses all four pitch ties. These
numbers apply only to this score and this manually checked reference.

The corrected file was opened in TypeNote, saved as version-4 JSON, reopened,
and exported as a two-page A4 PDF. Both exported pages were rendered for visual
inspection. Automated serialization checks confirm both staves, all 34 bars
and the same musical event content after saving. Exact event comparisons with
the recorded reference pass for all 56 upper and 265 lower events; those checks
verify serialization, while visual source review supports the transcription.

Private originals, provider experiments, reference transcription and visual
verification stay in ignored `test-results/departure-fix/` and
`test-results/departure-audit/`. The corrected transcription retains the two
staves, verified pitches/durations, octave chords, mid-bar clefs, ties, phrases,
key/meter, tempo, hand labels and principal expression. Exact engraving placement
and the first-bar pedal release are approximate; handwritten pencil annotations
and publisher page furniture are omitted. The supplied PDF and previous import
remain intact.

The app continues to preserve complete provider MusicXML. It does not infer a
bass clef from low pitches, force hand assignments, or fabricate missing music.
General recognition of sustained notes, clefs and chords remains a provider
accuracy limitation requiring source comparison and correction.
