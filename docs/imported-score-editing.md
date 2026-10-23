# Adding music to imported scores

## User workflow

The **Notes and rhythm** controls operate on the complete imported document.
Existing saved imports can use them without repeating PDF recognition.

- Select a rest, choose **Insert notes and rests**, then choose duration, dots,
  octave and accidental. Click **Add note** / **Add rest** or focus the score
  and type pitch letters / R. Successful entries continue after the new event.
- Select a note and choose **Build chord** to add a pitch sharing its duration.
  **Correct selected note** retains the original pitch-replacement behavior.
- **Set selected duration** changes a whole chord together. Shortening fills the
  released time with rests; growth consumes following rests.
- **Delete note**, Delete or Backspace removes one chord pitch or replaces a
  standalone note with a rest of equal duration.
- **Insert bar before/after** creates an empty bar across aligned parts. It selects
  the matching staff/voice rest and switches to Insert mode. Original bar numbers
  stay intact; the new bar has a unique label such as `1-new-1`.

The visible location identifies the part, measure, staff and voice. Entry settings
are separate from the selected note's pitch controls. H selects the international
B position; B enters explicit B-flat. Auto follows the key and local accidental
context. Arrow keys select notes or change the selected/entry octave according
to mode. Undo/redo restores selection and entry context as well as XML. Normal
inputs and source drafts are protected from note-entry shortcuts.

## Source and timing rules

`src/documents/structure.ts` performs transactional DOM edits to version-4 XML;
there is no conversion to the restricted native score model or persisted format
change. New notes have stable IDs. All operations validate before the UI commits
an undo step, and rejected operations leave the original document unchanged.

Timing uses exact integer ticks at the source divisions. Rest splitting keeps
the total stream duration unchanged, preserving backups, other voices, directions
and following onsets. Before/after insertion consumes adjacent rest time;
unused capacity can be used only at the end of the final encoded voice. Duration
changes keep whole-chord timing consistent. This follows MusicXML's distinction
between the cursor-advancing base note and additional
[chord tones](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/chord/).

New bars inherit the preceding settings rather than printing redundant clef/key/
time changes in the middle of a system. Before the first bar, initial settings
are copied in the required
[attribute order](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/attributes/).
Every active staff receives a rest, with observed voice lanes preserved. Parts
must have aligned measure counts/anchor labels and equal inserted bar lengths.
A plain final barline moves when appending a bar; repeat/ending boundaries stay
with the original measure. Attribute IDs are not duplicated into an initial bar.

Rhythm edits remove the affected explicit beam run for the engraver to regroup,
guarding referenced beam IDs. Independent fingerings, simple articulations and
fermatas survive duration edits. Unknown notation outside the changed passage,
original credits and page-text images are retained.

## Deliberate limits

- No cross-bar ripple, automatic movement of other voices, new voice/staff
  creation, or arbitrary insertion into a completely full bar. Use rest space or
  insert an empty bar.
- Durations too fine for the existing divisions are rejected, without rounding
  or rescaling unrelated timing. Integer divisions/durations and supported meter
  are required. Additive/polymetric contexts and existing overfull bars require
  source correction.
- Tuplets, grace passages, ambiguous/cross-staff chords, ties and other connected
  or unknown notation may require advanced source editing for structural changes.
  A new bar cannot separate an active tie/tuplet or rewrite multiple-rest or
  measure-repeat groups. Existing dedicated tied-pitch correction remains available.
- Deletion is conservative: connected notation, references and unsupported note
  content are guarded. A rest is not removed by Delete because doing so would
  change the voice timing.
- Existing system/page breaks and page-text facsimiles remain. Substantial new
  content can need layout/source correction; preservation does not imply perfect
  engraving of every edited score.

## Verification

Focused browser cases cover keyboard note/rest entry, H/B/key context, chord
creation/resizing/deletion, before/after rest consumption, exact multi-voice
timing, history selection, file round trips, bar inheritance/alignment, source
references, limits, independent annotations and local PDF export.

An actual first-page Lannister copy was edited through the UI: filled an upper
rest, built a chord, changed its duration, undid/redid, inserted an empty bar and
entered more notes/rests. The other 19 original measures, all original bass notes
and original credits are structurally unchanged. The edited copy has 21 measures
and 139 notes/rests. Saved JSON reopened and exported to PDF; the actual page was
visually inspected. Desktop and 820-pixel tablet views were inspected without
horizontal overflow. The original recognized file was not overwritten. Private
QA artifacts remain in ignored `test-results/imported-entry/`; no OMR rerun or
external upload was used.

Final checks passed: `npm run typecheck`, `npm test` (59), `npm run build`,
`npm run test:e2e -- --workers=2` (all 59, including 12 entry/structural cases),
and `git diff --check`. Existing bundle-size, mixed-import and Verovio Node-module
build warnings remain. No new dependencies were added.
