# TypeNote

A local piano score editor built with React, TypeScript, Vite, and VexFlow SVG notation. Scores stay in the browser until you download an editable file. There are no accounts, uploads, or server storage.

## Run locally

Use Node.js 22.20 or newer (supported Node 22 LTS recommended) and npm.

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Stop the server with Ctrl+C.

## Implemented editor

- A piano grand staff with treble and bass clefs, fixed 4/4, and no key-signature accidentals.
- One voice on each staff; whole, half, quarter, eighth, and sixteenth notes, chords, and rests.
- Clickable insertion positions and events; pitch, octave, duration, and accidental editing.
- Undo/redo for up to 100 edits, including title and measure additions.
- Download and reopen versioned `.typenote.json` documents. Opening invalid data preserves the current score. New/Open/example actions confirm before discarding unsaved edits.
- An original short example, accessible controls, and responsive notation layout. Dense measures scroll horizontally.
- Chords with up to 10 pitches sharing one duration, individual pitch editing/removal, and undo/redo.
- Direct A4 portrait PDF download with automatic page breaks and locally rendered notation.

**Save score downloads a file.** Keep that file and use Open file to continue later. The editor does not autosave across refreshes and cannot overwrite an existing file directly. A browser navigation warning protects unsaved edits where the browser permits it. Undo history is session-only and is cleared when opening or creating a score.

## Controls

Click a gap or press **Enter music** to focus the editor. Shortcuts are active only within the editor and do not intercept text inputs or selectors.

| Control | Action |
| --- | --- |
| C D E F G A H | Enter a pitch with the selected accidental and octave |
| H / B | H is B natural by default; B always enters B-flat |
| 1 / 2 / 3 / 4 / 5 | Whole / half / quarter / eighth / sixteenth |
| R | Enter a rest with the chosen duration |
| K / Build chord | Start adding pitches at one position; press Enter or Finish chord to advance |
| Shift+Delete / Shift+Backspace | Remove the selected pitch; removing the last pitch deletes the event |
| Left / Right | Move between insertion positions and measures |
| Up / Down | Change octave; C4 is middle C |
| Backspace at a gap | Delete the preceding event in that measure |
| Delete or Backspace on a selection | Delete the selected event |
| Escape | Return from selected event to the gap before it |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Shift+Z | Redo |

Click a note/rest to select it. Toolbar controls edit the selection. For chords, click a pitch chip to choose the pitch to edit. Typing a pitch replaces only that selected pitch and advances the cursor; R replaces the entire event with a rest. Delete removes the whole event. Choose a staff from the toolbar or click its notation. The selected accidental persists for subsequent entry; choose Natural to reset it. H with Flat also spells B-flat. Internal pitch step B uses international pitch spelling, while all user-facing labels follow H/B.

**Build a chord:** press K at a gap and type C E G, then Enter. To extend an existing note/chord, select it and press K. In chord mode, octave and accidental controls apply to new pitches; duration changes the whole chord. Pitch changes do not advance time until you finish. Escape leaves the entered notes intact and returns to the gap before the event. Clicking a pitch chip exits chord mode and edits that existing pitch. Duplicate staff positions (the same step/octave, even with different accidentals) are rejected.

Insertion and deletion shift later events **within the current measure only**. A measure cannot exceed 16 sixteenth-note ticks. Entry that fills a measure advances to the next one (creating a measure if necessary). Empty time appears as gray rest placeholders; it is not saved as musical content. Add real rests with R. Scores may contain up to 200 measures, with octave numbers 0–8. Notes outside the acoustic piano range are currently allowed.

## PDF download and file compatibility

**Download PDF** creates an A4 portrait PDF from the current score, including unsaved edits. It does not open a print dialog or upload anything. The export uses a snapshot, so editing can continue during export. Use Cancel export to stop it. Exporting does not mark the editable document as saved.

PDFs have approximately 15 mm margins, a title, page numbers, and automatic system/page breaks. Each grand-staff system stays together. Incomplete measure time is printed as black rests; empty trailing measures are retained. PDF export uses 300 dpi notation images rather than vector notation or selectable musical text. Unusually dense measures that cannot fit legibly produce an error instead of being clipped. Notation and title rendering reuse the browser's locally available fonts; music fonts are bundled.

New editable files use **version 2**. The editor validates and migrates original version-1 single-note files on opening, preserving pitches, durations, IDs, title, and measures. The older first-milestone application cannot open version-2 files. Files may be up to 10 MB, enough for the supported maximum of 200 measures with 10-pitch chords. Keep the editable TypeNote file as well as your PDF.

## Architecture

- `src/domain/types.ts`: version-2 score schema and exact integer timing. Notes/chords contain 1–10 pitches with stable editing order.
- `src/domain/model.ts`: immutable, renderer-independent musical operations.
- `src/domain/validation.ts`: shared structural and musical validation.
- `src/domain/history.ts`: bounded undo/redo snapshots including cursor position.
- `src/domain/storage.ts`: JSON file boundaries, size checks, and version validation.
- `src/notation/engraving.ts`: shared VexFlow notation, accidental handling, and system geometry for SVG editing and Canvas export.
- `src/components/ScoreView.tsx`: responsive SVG grand staff and selection targets.
- `src/export/`: A4 pagination and PDF generation using `pdf-lib`, loaded when exporting. This dependency packages rendered systems into PDF pages entirely in the browser.
- `src/App.tsx`: editor controls, keyboard interaction, and file download/open.

New schema versions must preserve compatibility or explicitly migrate old scores. MusicXML remains a later interchange candidate. Future OMR will produce structured score data through a separate adapter.

## Checks

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit tests cover musical operations, chords, H/B spelling, timing boundaries, migration, persistence validation, undo/redo, and pagination. Browser tests exercise keyboard editing, chord controls, file round trips, direct PDF download, cancellation, and desktop/tablet rendering. Downloaded PDFs are checked for A4 dimensions and page counts. Actual exported pages were also rendered with `pdftoppm` and visually inspected; the PDF metadata checks alone do not establish notation correctness. Playwright starts and stops its own local Vite server. Screenshots, PDFs, and traces are generated under ignored `test-results/`.

## Later milestones

Multiple voices on one staff, cross-staff chords, dotted notes, ties, tuplets, playback, variable key/time signatures, and MusicXML interchange are not implemented. PDF-to-score recognition requires a separate OMR feasibility investigation, including scanned and digitally generated inputs, accuracy measurements, privacy, and correction workflows. No PDF recognition provider has been selected.
